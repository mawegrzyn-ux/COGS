const router = require('express').Router();
const pool   = require('../db/pool');

// GET /stocktakes?store_id=&status=&stocktake_type=&from=&to=
router.get('/', async (req, res) => {
  try {
    const { store_id, status, stocktake_type, from, to } = req.query;
    let query = `
      SELECT st.*,
             s.name AS store_name,
             ic.item_count,
             ic.variance_count
      FROM   mcogs_stocktakes st
      JOIN   mcogs_stores s ON s.id = st.store_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int                                        AS item_count,
               COUNT(*) FILTER (WHERE variance != 0 AND variance IS NOT NULL)::int AS variance_count
        FROM   mcogs_stocktake_items
        WHERE  stocktake_id = st.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)       { query += ` AND st.store_id = $${p++}`;       vals.push(store_id); }
    if (status)         { query += ` AND st.status = $${p++}`;         vals.push(status); }
    if (stocktake_type) { query += ` AND st.stocktake_type = $${p++}`; vals.push(stocktake_type); }
    if (from)           { query += ` AND st.created_at >= $${p++}`;    vals.push(from); }
    if (to)             { query += ` AND st.created_at <= $${p++}`;    vals.push(to); }
    query += ` ORDER BY st.created_at DESC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch stocktakes' } });
  }
});

// GET /stocktakes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: stRows } = await pool.query(`
      SELECT st.*,
             s.name AS store_name
      FROM   mcogs_stocktakes st
      JOIN   mcogs_stores s ON s.id = st.store_id
      WHERE  st.id = $1
    `, [req.params.id]);
    if (!stRows.length) return res.status(404).json({ error: { message: 'Not found' } });

    const { rows: items } = await pool.query(`
      SELECT si.*,
             i.name          AS ingredient_name,
             u.abbreviation  AS unit_abbr
      FROM   mcogs_stocktake_items si
      JOIN   mcogs_ingredients i ON i.id = si.ingredient_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      WHERE  si.stocktake_id = $1
      ORDER BY si.id
    `, [req.params.id]);

    res.json({ ...stRows[0], items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch stocktake' } });
  }
});

// POST /stocktakes — start a new stocktake
router.post('/', async (req, res) => {
  const { store_id, stocktake_type, notes } = req.body;
  if (!store_id) return res.status(400).json({ error: { message: 'store_id is required' } });

  try {
    const created_by = req.user?.email || req.user?.name || 'system';
    const { rows } = await pool.query(`
      INSERT INTO mcogs_stocktakes (store_id, stocktake_type, status, notes, created_by, started_at)
      VALUES ($1, $2, 'in_progress', $3, $4, NOW())
      RETURNING *
    `, [store_id, stocktake_type || 'full', notes || null, created_by]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create stocktake' } });
  }
});

// PUT /stocktakes/:id — update metadata (notes)
router.put('/:id', async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_stocktakes
      SET    notes = $1, updated_at = NOW()
      WHERE  id = $2
      RETURNING *
    `, [notes || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update stocktake' } });
  }
});

// DELETE /stocktakes/:id — delete in_progress only
router.delete('/:id', async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT status FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Not found' } });
    if (check[0].status !== 'in_progress') {
      return res.status(409).json({ error: { message: 'Can only delete in-progress stocktakes' } });
    }
    await pool.query(`DELETE FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete stocktake' } });
  }
});

// POST /stocktakes/:id/populate — auto-populate items from current stock levels
router.post('/:id/populate', async (req, res) => {
  try {
    const { rows: stRows } = await pool.query(
      `SELECT * FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) return res.status(404).json({ error: { message: 'Not found' } });
    if (stRows[0].status !== 'in_progress') {
      return res.status(409).json({ error: { message: 'Can only populate in-progress stocktakes' } });
    }

    const stocktake = stRows[0];
    const { rowCount } = await pool.query(`
      INSERT INTO mcogs_stocktake_items (stocktake_id, ingredient_id, expected_qty)
      SELECT $1, sl.ingredient_id, sl.qty_on_hand
      FROM   mcogs_stock_levels sl
      WHERE  sl.store_id = $2
      ON CONFLICT (stocktake_id, ingredient_id) DO NOTHING
    `, [stocktake.id, stocktake.store_id]);

    res.json({ items_added: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to populate stocktake items' } });
  }
});

// POST /stocktakes/:id/items — add/update counted items (bulk upsert)
router.post('/:id/items', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: { message: 'items array is required' } });
  }

  try {
    const { rows: stRows } = await pool.query(
      `SELECT * FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) return res.status(404).json({ error: { message: 'Not found' } });
    if (stRows[0].status !== 'in_progress') {
      return res.status(409).json({ error: { message: 'Can only add items to in-progress stocktakes' } });
    }

    const stocktake = stRows[0];
    const counted_by = req.user?.email || req.user?.name || 'system';
    const upserted = [];

    for (const item of items) {
      if (!item.ingredient_id) continue;

      // Look up expected_qty from stock_levels if not already set
      let expected_qty = null;
      const { rows: existing } = await pool.query(
        `SELECT expected_qty FROM mcogs_stocktake_items WHERE stocktake_id=$1 AND ingredient_id=$2`,
        [stocktake.id, item.ingredient_id]
      );
      if (existing.length && existing[0].expected_qty != null) {
        expected_qty = existing[0].expected_qty;
      } else {
        const { rows: slRows } = await pool.query(
          `SELECT qty_on_hand FROM mcogs_stock_levels WHERE store_id=$1 AND ingredient_id=$2`,
          [stocktake.store_id, item.ingredient_id]
        );
        expected_qty = slRows.length ? slRows[0].qty_on_hand : 0;
      }

      const { rows } = await pool.query(`
        INSERT INTO mcogs_stocktake_items
          (stocktake_id, ingredient_id, expected_qty, counted_qty, notes, counted_by, counted_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (stocktake_id, ingredient_id)
        DO UPDATE SET counted_qty = $4, notes = $5, counted_by = $6, counted_at = NOW()
        RETURNING *
      `, [stocktake.id, item.ingredient_id, expected_qty, item.counted_qty, item.notes || null, counted_by]);
      upserted.push(rows[0]);
    }

    res.json(upserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to upsert stocktake items' } });
  }
});

// PUT /stocktakes/:id/items/:itemId — update single count item
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows: stRows } = await pool.query(
      `SELECT status FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) return res.status(404).json({ error: { message: 'Stocktake not found' } });
    if (stRows[0].status !== 'in_progress') {
      return res.status(409).json({ error: { message: 'Can only edit items on in-progress stocktakes' } });
    }

    const { counted_qty, notes } = req.body;
    const counted_by = req.user?.email || req.user?.name || 'system';
    const { rows } = await pool.query(`
      UPDATE mcogs_stocktake_items
      SET    counted_qty = $1, notes = $2, counted_by = $3, counted_at = NOW()
      WHERE  id = $4 AND stocktake_id = $5
      RETURNING *
    `, [counted_qty, notes || null, counted_by, req.params.itemId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Item not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update stocktake item' } });
  }
});

// POST /stocktakes/:id/complete — complete stocktake, calculate variances
router.post('/:id/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: stRows } = await client.query(
      `SELECT * FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Not found' } }); }
    if (stRows[0].status !== 'in_progress') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Stocktake must be in_progress to complete' } }); }

    // Calculate variance for all items with a counted_qty
    await client.query(`
      UPDATE mcogs_stocktake_items
      SET    variance = counted_qty - COALESCE(expected_qty, 0)
      WHERE  stocktake_id = $1 AND counted_qty IS NOT NULL
    `, [req.params.id]);

    const { rows: updated } = await client.query(`
      UPDATE mcogs_stocktakes
      SET    status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE  id = $1
      RETURNING *
    `, [req.params.id]);

    const { rows: items } = await client.query(`
      SELECT si.*,
             i.name          AS ingredient_name,
             u.abbreviation  AS unit_abbr
      FROM   mcogs_stocktake_items si
      JOIN   mcogs_ingredients i ON i.id = si.ingredient_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      WHERE  si.stocktake_id = $1
      ORDER BY si.id
    `, [req.params.id]);

    await client.query('COMMIT');
    res.json({ ...updated[0], items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to complete stocktake' } });
  } finally {
    client.release();
  }
});

// POST /stocktakes/:id/approve — approve and apply stock adjustments
router.post('/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: stRows } = await client.query(
      `SELECT * FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Not found' } }); }
    if (stRows[0].status !== 'completed') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Stocktake must be completed to approve' } }); }

    const stocktake = stRows[0];
    const { rows: items } = await client.query(
      `SELECT * FROM mcogs_stocktake_items WHERE stocktake_id=$1 AND variance != 0 AND variance IS NOT NULL`,
      [stocktake.id]
    );

    const created_by = req.user?.email || req.user?.name || 'system';
    for (const item of items) {
      // Insert stock movement for the adjustment
      await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
        VALUES ($1, $2, 'stocktake_adjust', $3, 'stocktake', $4, $5, $6)
      `, [stocktake.store_id, item.ingredient_id, item.variance, stocktake.id,
          `Stocktake adjustment`, created_by]);

      // Set stock level to the counted quantity (absolute set)
      await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = $3, updated_at = NOW()
      `, [stocktake.store_id, item.ingredient_id, item.counted_qty]);
    }

    const approved_by = req.user?.email || req.user?.name || 'system';
    const { rows: updated } = await client.query(`
      UPDATE mcogs_stocktakes
      SET    status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE  id = $2
      RETURNING *
    `, [approved_by, stocktake.id]);

    await client.query('COMMIT');
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to approve stocktake' } });
  } finally {
    client.release();
  }
});

// GET /stocktakes/:id/variance-report — variance report with cost impact
router.get('/:id/variance-report', async (req, res) => {
  try {
    const { rows: stRows } = await pool.query(
      `SELECT * FROM mcogs_stocktakes WHERE id=$1`, [req.params.id]
    );
    if (!stRows.length) return res.status(404).json({ error: { message: 'Not found' } });

    const { rows } = await pool.query(`
      SELECT si.id,
             si.ingredient_id,
             i.name          AS ingredient_name,
             u.abbreviation  AS unit_abbr,
             si.expected_qty,
             si.counted_qty,
             si.variance,
             si.notes,
             sm.unit_cost,
             CASE WHEN sm.unit_cost IS NOT NULL THEN si.variance * sm.unit_cost ELSE NULL END AS cost_impact
      FROM   mcogs_stocktake_items si
      JOIN   mcogs_ingredients i ON i.id = si.ingredient_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      LEFT JOIN LATERAL (
        SELECT unit_cost
        FROM   mcogs_stock_movements
        WHERE  ingredient_id = si.ingredient_id
               AND store_id = $2
               AND unit_cost IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) sm ON true
      WHERE  si.stocktake_id = $1
             AND si.variance != 0
             AND si.variance IS NOT NULL
      ORDER BY ABS(si.variance) DESC
    `, [req.params.id, stRows[0].store_id]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate variance report' } });
  }
});

module.exports = router;
