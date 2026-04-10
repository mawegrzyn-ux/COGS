const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// GET /stock-levels?store_id=&low_stock=&q=
router.get('/', async (req, res, next) => {
  try {
    const { store_id, low_stock, q } = req.query;
    if (!store_id) return res.status(400).json({ error: { message: 'store_id query param is required' } });

    let query = `
      SELECT sl.*,
             i.name          AS ingredient_name,
             cat.name        AS category_name,
             u.abbreviation  AS unit_abbr,
             u.name          AS unit_name
      FROM   mcogs_stock_levels sl
      JOIN   mcogs_ingredients i ON i.id = sl.ingredient_id
      LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      WHERE  sl.store_id = $1
    `;
    const vals = [store_id];
    let p = 2;

    if (low_stock === 'true') {
      query += ` AND sl.min_stock_level IS NOT NULL AND sl.qty_on_hand < sl.min_stock_level`;
    }
    if (q?.trim()) {
      query += ` AND i.name ILIKE $${p++}`;
      vals.push(`%${q.trim()}%`);
    }

    query += ` ORDER BY i.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /stock-levels/:store_id/:ingredient_id
router.get('/:store_id/:ingredient_id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT sl.*,
             i.name          AS ingredient_name,
             cat.name        AS category_name,
             u.abbreviation  AS unit_abbr
      FROM   mcogs_stock_levels sl
      JOIN   mcogs_ingredients i ON i.id = sl.ingredient_id
      LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      WHERE  sl.store_id = $1 AND sl.ingredient_id = $2
    `, [req.params.store_id, req.params.ingredient_id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Stock level not found' } });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /stock-levels/:id — update min/max thresholds only
router.put('/:id', async (req, res, next) => {
  const { min_stock_level, max_stock_level } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_stock_levels
      SET    min_stock_level = $1, max_stock_level = $2, updated_at = NOW()
      WHERE  id = $3
      RETURNING *
    `, [
      min_stock_level ?? null,
      max_stock_level ?? null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Stock level not found' } });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /stock-levels/adjust — single manual adjustment
router.post('/adjust', async (req, res, next) => {
  const { store_id, ingredient_id, quantity, notes } = req.body;
  if (!store_id)       return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!ingredient_id)  return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (quantity == null || quantity === '') return res.status(400).json({ error: { message: 'quantity is required' } });

  const qty = parseFloat(quantity);
  if (isNaN(qty)) return res.status(400).json({ error: { message: 'quantity must be a number' } });

  const createdBy = req.user?.email || req.user?.name || 'system';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert movement record
    const { rows: movRows } = await client.query(`
      INSERT INTO mcogs_stock_movements
        (store_id, ingredient_id, movement_type, quantity, notes, created_by)
      VALUES ($1,$2,'manual_adjust',$3,$4,$5)
      RETURNING *
    `, [store_id, ingredient_id, qty, notes?.trim() || null, createdBy]);

    // Upsert stock level
    const { rows: slRows } = await client.query(`
      INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (store_id, ingredient_id)
      DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
      RETURNING *
    `, [store_id, ingredient_id, qty]);

    await client.query('COMMIT');

    // Audit
    const { rows: meta } = await pool.query(
      'SELECT name FROM mcogs_ingredients WHERE id=$1', [ingredient_id]
    );
    await logAudit(pool, req, {
      action: 'update',
      entity_type: 'stock_level',
      entity_id: slRows[0].id,
      entity_label: meta[0]?.name || `Ingredient #${ingredient_id}`,
      field_changes: { qty_on_hand: { old: slRows[0].qty_on_hand - qty, new: slRows[0].qty_on_hand } },
      context: { source: 'manual_adjust', quantity: qty, notes: notes || null },
      related_entities: [{ type: 'store', id: store_id }, { type: 'stock_movement', id: movRows[0].id }],
    });

    res.status(201).json({ movement: movRows[0], stock_level: slRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ error: { message: 'Invalid store_id or ingredient_id — referenced record does not exist' } });
    }
    next(err);
  } finally {
    client.release();
  }
});

// POST /stock-levels/bulk-adjust — multiple adjustments in one transaction
router.post('/bulk-adjust', async (req, res, next) => {
  const { store_id, items } = req.body;
  if (!store_id) return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: { message: 'items array is required and must not be empty' } });
  }

  const createdBy = req.user?.email || req.user?.name || 'system';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.ingredient_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { message: `items[${i}].ingredient_id is required` } });
      }
      const qty = parseFloat(item.quantity);
      if (isNaN(qty)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { message: `items[${i}].quantity must be a number` } });
      }

      // Insert movement
      const { rows: movRows } = await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, notes, created_by)
        VALUES ($1,$2,'manual_adjust',$3,$4,$5)
        RETURNING *
      `, [store_id, item.ingredient_id, qty, item.notes?.trim() || null, createdBy]);

      // Upsert stock level
      const { rows: slRows } = await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
        RETURNING *
      `, [store_id, item.ingredient_id, qty]);

      results.push({ movement: movRows[0], stock_level: slRows[0] });
    }

    await client.query('COMMIT');
    res.status(201).json(results);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ error: { message: 'Invalid store_id or ingredient_id — referenced record does not exist' } });
    }
    next(err);
  } finally {
    client.release();
  }
});

// GET /stock-levels/movements?store_id=&ingredient_id=&movement_type=&from=&to=&limit=&offset=
router.get('/movements', async (req, res, next) => {
  try {
    const { store_id, ingredient_id, movement_type, from, to, limit, offset } = req.query;

    let query = `
      SELECT m.*,
             i.name  AS ingredient_name,
             s.name  AS store_name
      FROM   mcogs_stock_movements m
      JOIN   mcogs_ingredients i ON i.id = m.ingredient_id
      JOIN   mcogs_stores s      ON s.id = m.store_id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;

    if (store_id)       { query += ` AND m.store_id = $${p++}`;       vals.push(store_id); }
    if (ingredient_id)  { query += ` AND m.ingredient_id = $${p++}`;  vals.push(ingredient_id); }
    if (movement_type)  { query += ` AND m.movement_type = $${p++}`;  vals.push(movement_type); }
    if (from)           { query += ` AND m.created_at >= $${p++}`;    vals.push(from); }
    if (to)             { query += ` AND m.created_at <= $${p++}`;    vals.push(to); }

    query += ` ORDER BY m.created_at DESC`;

    const lim = Math.min(parseInt(limit) || 50, 500);
    const off = parseInt(offset) || 0;
    query += ` LIMIT $${p++} OFFSET $${p++}`;
    vals.push(lim, off);

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /stock-levels/summary?store_id=
router.get('/summary', async (req, res, next) => {
  try {
    const { store_id } = req.query;

    let query = `
      SELECT sl.store_id,
             s.name             AS store_name,
             COUNT(*)::int      AS item_count,
             SUM(
               sl.qty_on_hand * COALESCE(latest_cost.unit_cost, 0)
             )                  AS total_value,
             COUNT(*) FILTER (
               WHERE sl.min_stock_level IS NOT NULL AND sl.qty_on_hand < sl.min_stock_level
             )::int             AS low_stock_count
      FROM   mcogs_stock_levels sl
      JOIN   mcogs_stores s ON s.id = sl.store_id
      LEFT JOIN LATERAL (
        SELECT unit_cost
        FROM   mcogs_stock_movements
        WHERE  store_id = sl.store_id
          AND  ingredient_id = sl.ingredient_id
          AND  unit_cost IS NOT NULL
        ORDER  BY created_at DESC
        LIMIT  1
      ) latest_cost ON true
    `;
    const vals = [];
    let p = 1;
    if (store_id) {
      query += ` WHERE sl.store_id = $${p++}`;
      vals.push(store_id);
    }
    query += ` GROUP BY sl.store_id, s.name ORDER BY s.name ASC`;

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
