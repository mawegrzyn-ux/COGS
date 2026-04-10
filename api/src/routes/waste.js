const router = require('express').Router();
const pool   = require('../db/pool');

// ══════════════════════════════════════════════════════════════════════════════
//  WASTE LOG
// ══════════════════════════════════════════════════════════════════════════════

// GET /waste
router.get('/', async (req, res) => {
  const { store_id, ingredient_id, reason_code_id, from, to, limit = 50, offset = 0 } = req.query;
  try {
    let query = `
      SELECT w.*,
             ing.name AS ingredient_name,
             s.name   AS store_name,
             rc.name  AS reason_name
      FROM   mcogs_waste_log w
      LEFT JOIN mcogs_ingredients        ing ON ing.id = w.ingredient_id
      LEFT JOIN mcogs_stores             s   ON s.id   = w.store_id
      LEFT JOIN mcogs_waste_reason_codes rc  ON rc.id  = w.reason_code_id
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)       { query += ` AND w.store_id = $${p++}`;       vals.push(store_id); }
    if (ingredient_id)  { query += ` AND w.ingredient_id = $${p++}`;  vals.push(ingredient_id); }
    if (reason_code_id) { query += ` AND w.reason_code_id = $${p++}`; vals.push(reason_code_id); }
    if (from)           { query += ` AND w.waste_date >= $${p++}`;    vals.push(from); }
    if (to)             { query += ` AND w.waste_date <= $${p++}`;    vals.push(to); }
    query += ` ORDER BY w.waste_date DESC, w.created_at DESC`;
    query += ` LIMIT $${p++} OFFSET $${p++}`;
    vals.push(Math.min(Number(limit) || 50, 500));
    vals.push(Number(offset) || 0);

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch waste log' } });
  }
});

// POST /waste — log single waste entry
router.post('/', async (req, res) => {
  const { store_id, ingredient_id, quantity, reason_code_id, unit_cost, waste_date, notes } = req.body;
  if (!store_id)      return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (!quantity || parseFloat(quantity) <= 0) {
    return res.status(400).json({ error: { message: 'quantity must be a positive number' } });
  }

  const qty = parseFloat(quantity);
  const createdBy = req.user?.email || req.user?.name || 'system';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert waste log entry
    const { rows: [waste] } = await client.query(`
      INSERT INTO mcogs_waste_log
        (store_id, ingredient_id, reason_code_id, quantity, unit_cost, waste_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      store_id, ingredient_id, reason_code_id || null,
      qty, unit_cost || 0,
      waste_date || new Date().toISOString().slice(0, 10),
      notes?.trim() || null, createdBy
    ]);

    // 2. Insert stock movement (negative quantity — waste removes stock)
    await client.query(`
      INSERT INTO mcogs_stock_movements
        (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by, created_at)
      VALUES ($1, $2, 'waste', $3, $4, 'waste', $5, $6, NOW())
    `, [store_id, ingredient_id, -qty, unit_cost || 0, waste.id, createdBy]);

    // 3. Upsert stock level — decrement qty_on_hand
    await client.query(`
      INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
      VALUES ($1, $2, -$3, NOW())
      ON CONFLICT (store_id, ingredient_id)
      DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand - $3, updated_at = NOW()
    `, [store_id, ingredient_id, qty]);

    await client.query('COMMIT');
    res.status(201).json(waste);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to log waste entry' } });
  } finally {
    client.release();
  }
});

// POST /waste/bulk — bulk waste entry
router.post('/bulk', async (req, res) => {
  const { store_id, items } = req.body;
  if (!store_id) return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: { message: 'items array is required' } });
  }

  const createdBy = req.user?.email || req.user?.name || 'system';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const item of items) {
      if (!item.ingredient_id || !item.quantity || parseFloat(item.quantity) <= 0) continue;

      const qty = parseFloat(item.quantity);

      // Insert waste log
      const { rows: [waste] } = await client.query(`
        INSERT INTO mcogs_waste_log
          (store_id, ingredient_id, reason_code_id, quantity, unit_cost, waste_date, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        store_id, item.ingredient_id, item.reason_code_id || null,
        qty, item.unit_cost || 0,
        new Date().toISOString().slice(0, 10),
        item.notes?.trim() || null, createdBy
      ]);

      // Insert stock movement
      await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by, created_at)
        VALUES ($1, $2, 'waste', $3, $4, 'waste', $5, $6, NOW())
      `, [store_id, item.ingredient_id, -qty, item.unit_cost || 0, waste.id, createdBy]);

      // Upsert stock level
      await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, -$3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand - $3, updated_at = NOW()
      `, [store_id, item.ingredient_id, qty]);

      results.push(waste);
    }

    await client.query('COMMIT');
    res.status(201).json({ created: results.length, entries: results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk log waste' } });
  } finally {
    client.release();
  }
});

// DELETE /waste/:id — reverse a waste entry
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load the waste entry
    const { rows: [waste] } = await client.query(
      'SELECT * FROM mcogs_waste_log WHERE id=$1', [req.params.id]
    );
    if (!waste) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Waste entry not found' } });
    }

    const qty = parseFloat(waste.quantity);
    const createdBy = req.user?.email || req.user?.name || 'system';

    // 2. Insert reversal stock movement (positive — restoring stock)
    await client.query(`
      INSERT INTO mcogs_stock_movements
        (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by, created_at)
      VALUES ($1, $2, 'manual_adjust', $3, $4, 'waste_reversal', $5, $6, NOW())
    `, [waste.store_id, waste.ingredient_id, qty, waste.unit_cost || 0, waste.id, createdBy]);

    // 3. Upsert stock level — increment qty_on_hand (reverse the decrement)
    await client.query(`
      INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (store_id, ingredient_id)
      DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
    `, [waste.store_id, waste.ingredient_id, qty]);

    // 4. Delete the waste log entry
    await client.query('DELETE FROM mcogs_waste_log WHERE id=$1', [req.params.id]);

    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to reverse waste entry' } });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  REASON CODES
// ══════════════════════════════════════════════════════════════════════════════

// GET /waste/reason-codes
router.get('/reason-codes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mcogs_waste_reason_codes ORDER BY sort_order, name'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch reason codes' } });
  }
});

// POST /waste/reason-codes
router.post('/reason-codes', async (req, res) => {
  const { name, description, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_waste_reason_codes (name, description, sort_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [name.trim(), description?.trim() || null, sort_order ?? 0]);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create reason code' } });
  }
});

// PUT /waste/reason-codes/:id
router.put('/reason-codes/:id', async (req, res) => {
  const { name, description, is_active, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_waste_reason_codes
      SET    name=$1, description=$2, is_active=$3, sort_order=$4
      WHERE  id=$5
      RETURNING *
    `, [name.trim(), description?.trim() || null, is_active !== false, sort_order ?? 0, req.params.id]);
    if (!row) return res.status(404).json({ error: { message: 'Reason code not found' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update reason code' } });
  }
});

// DELETE /waste/reason-codes/:id
router.delete('/reason-codes/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_waste_reason_codes WHERE id=$1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Reason code not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete reason code' } });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  WASTE SUMMARY REPORT
// ══════════════════════════════════════════════════════════════════════════════

// GET /waste/summary?store_id=&from=&to=&group_by=ingredient|reason|date
router.get('/summary', async (req, res) => {
  const { store_id, from, to, group_by = 'ingredient' } = req.query;
  try {
    let selectCols, groupCols, joinClause, orderClause;

    switch (group_by) {
      case 'reason':
        selectCols = 'rc.name AS reason_name';
        groupCols  = 'rc.name';
        joinClause = 'LEFT JOIN mcogs_waste_reason_codes rc ON rc.id = w.reason_code_id';
        orderClause = 'rc.name';
        break;
      case 'date':
        selectCols = 'w.waste_date';
        groupCols  = 'w.waste_date';
        joinClause = '';
        orderClause = 'w.waste_date DESC';
        break;
      default: // 'ingredient'
        selectCols = 'ing.name AS ingredient_name';
        groupCols  = 'ing.name';
        joinClause = 'LEFT JOIN mcogs_ingredients ing ON ing.id = w.ingredient_id';
        orderClause = 'ing.name';
        break;
    }

    let query = `
      SELECT ${selectCols},
             SUM(w.quantity)::numeric               AS total_qty,
             SUM(w.quantity * w.unit_cost)::numeric  AS total_cost
      FROM   mcogs_waste_log w
      ${joinClause}
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id) { query += ` AND w.store_id = $${p++}`;    vals.push(store_id); }
    if (from)     { query += ` AND w.waste_date >= $${p++}`;  vals.push(from); }
    if (to)       { query += ` AND w.waste_date <= $${p++}`;  vals.push(to); }
    query += ` GROUP BY ${groupCols} ORDER BY ${orderClause}`;

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch waste summary' } });
  }
});

module.exports = router;
