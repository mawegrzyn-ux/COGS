const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// GET /stock-transfers?from_store_id=&to_store_id=&status=&from=&to=
router.get('/', async (req, res) => {
  try {
    const { from_store_id, to_store_id, status, from, to } = req.query;
    let query = `
      SELECT t.*,
             fs.name AS from_store_name,
             ts.name AS to_store_name,
             ic.item_count
      FROM   mcogs_stock_transfers t
      JOIN   mcogs_stores fs ON fs.id = t.from_store_id
      JOIN   mcogs_stores ts ON ts.id = t.to_store_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_stock_transfer_items
        WHERE  transfer_id = t.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (from_store_id) { query += ` AND t.from_store_id = $${p++}`; vals.push(from_store_id); }
    if (to_store_id)   { query += ` AND t.to_store_id = $${p++}`;   vals.push(to_store_id); }
    if (status)        { query += ` AND t.status = $${p++}`;         vals.push(status); }
    if (from)          { query += ` AND t.created_at >= $${p++}`;    vals.push(from); }
    if (to)            { query += ` AND t.created_at <= $${p++}`;    vals.push(to); }
    query += ` ORDER BY t.created_at DESC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch stock transfers' } });
  }
});

// GET /stock-transfers/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: tRows } = await pool.query(`
      SELECT t.*,
             fs.name AS from_store_name,
             ts.name AS to_store_name
      FROM   mcogs_stock_transfers t
      JOIN   mcogs_stores fs ON fs.id = t.from_store_id
      JOIN   mcogs_stores ts ON ts.id = t.to_store_id
      WHERE  t.id = $1
    `, [req.params.id]);
    if (!tRows.length) return res.status(404).json({ error: { message: 'Not found' } });

    const { rows: items } = await pool.query(`
      SELECT ti.*,
             i.name  AS ingredient_name,
             u.abbreviation AS unit_abbr
      FROM   mcogs_stock_transfer_items ti
      JOIN   mcogs_ingredients i ON i.id = ti.ingredient_id
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      WHERE  ti.transfer_id = $1
      ORDER BY ti.sort_order, ti.id
    `, [req.params.id]);

    res.json({ ...tRows[0], items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch stock transfer' } });
  }
});

// POST /stock-transfers
router.post('/', async (req, res) => {
  const { from_store_id, to_store_id, transfer_date, notes, items } = req.body;
  if (!from_store_id || !to_store_id) {
    return res.status(400).json({ error: { message: 'from_store_id and to_store_id are required' } });
  }
  if (Number(from_store_id) === Number(to_store_id)) {
    return res.status(400).json({ error: { message: 'from_store_id and to_store_id must be different' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const created_by = req.user?.email || req.user?.name || 'system';
    const { rows: tRows } = await client.query(`
      INSERT INTO mcogs_stock_transfers
        (from_store_id, to_store_id, transfer_number, status, transfer_date, notes, created_by)
      VALUES ($1, $2, 'TRF-' || nextval('mcogs_xfer_number_seq'), 'pending', $3, $4, $5)
      RETURNING *
    `, [from_store_id, to_store_id, transfer_date || new Date().toISOString(), notes || null, created_by]);

    const transfer = tRows[0];
    const insertedItems = [];
    if (Array.isArray(items)) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const { rows: iRows } = await client.query(`
          INSERT INTO mcogs_stock_transfer_items (transfer_id, ingredient_id, qty_sent, sort_order)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [transfer.id, it.ingredient_id, it.qty_sent, idx]);
        insertedItems.push(iRows[0]);
      }
    }

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'create', entity_type: 'stock_transfer', entity_id: transfer.id, entity_label: transfer.transfer_number });
    res.status(201).json({ ...transfer, items: insertedItems });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create stock transfer' } });
  } finally {
    client.release();
  }
});

// PUT /stock-transfers/:id — update pending transfer header
router.put('/:id', async (req, res) => {
  try {
    // Only allow editing pending transfers
    const { rows: check } = await pool.query(
      `SELECT status FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Not found' } });
    if (check[0].status !== 'pending') {
      return res.status(409).json({ error: { message: 'Can only edit pending transfers' } });
    }

    const { from_store_id, to_store_id, transfer_date, notes } = req.body;
    if (from_store_id && to_store_id && Number(from_store_id) === Number(to_store_id)) {
      return res.status(400).json({ error: { message: 'from_store_id and to_store_id must be different' } });
    }

    const { rows } = await pool.query(`
      UPDATE mcogs_stock_transfers
      SET    from_store_id = COALESCE($1, from_store_id),
             to_store_id   = COALESCE($2, to_store_id),
             transfer_date = COALESCE($3, transfer_date),
             notes         = COALESCE($4, notes),
             updated_at    = NOW()
      WHERE  id = $5
      RETURNING *
    `, [from_store_id || null, to_store_id || null, transfer_date || null, notes || null, req.params.id]);
    logAudit(pool, req, { action: 'update', entity_type: 'stock_transfer', entity_id: rows[0].id, entity_label: rows[0].transfer_number });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update stock transfer' } });
  }
});

// DELETE /stock-transfers/:id — delete pending only
router.delete('/:id', async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT status, transfer_number FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Not found' } });
    if (check[0].status !== 'pending') {
      return res.status(409).json({ error: { message: 'Can only delete pending transfers' } });
    }
    await pool.query(`DELETE FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]);
    logAudit(pool, req, { action: 'delete', entity_type: 'stock_transfer', entity_id: Number(req.params.id), entity_label: check[0].transfer_number || `id:${req.params.id}` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete stock transfer' } });
  }
});

// POST /stock-transfers/:id/items — add item (pending only)
router.post('/:id/items', async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT status FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Transfer not found' } });
    if (check[0].status !== 'pending') {
      return res.status(409).json({ error: { message: 'Can only add items to pending transfers' } });
    }

    const { ingredient_id, qty_sent, sort_order } = req.body;
    if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });
    if (qty_sent !== undefined && Number(qty_sent) <= 0) return res.status(400).json({ error: { message: 'qty_sent must be positive' } });

    const { rows } = await pool.query(`
      INSERT INTO mcogs_stock_transfer_items (transfer_id, ingredient_id, qty_sent, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.params.id, ingredient_id, qty_sent || 0, sort_order || 0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add transfer item' } });
  }
});

// PUT /stock-transfers/:id/items/:itemId — update item (pending only)
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT status FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Transfer not found' } });
    if (check[0].status !== 'pending') {
      return res.status(409).json({ error: { message: 'Can only edit items on pending transfers' } });
    }

    const { ingredient_id, qty_sent, sort_order } = req.body;
    const { rows } = await pool.query(`
      UPDATE mcogs_stock_transfer_items
      SET    ingredient_id = COALESCE($1, ingredient_id),
             qty_sent      = COALESCE($2, qty_sent),
             sort_order    = COALESCE($3, sort_order)
      WHERE  id = $4 AND transfer_id = $5
      RETURNING *
    `, [ingredient_id || null, qty_sent, sort_order, req.params.itemId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Item not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update transfer item' } });
  }
});

// DELETE /stock-transfers/:id/items/:itemId — remove item (pending only)
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows: check } = await pool.query(
      `SELECT status FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: { message: 'Transfer not found' } });
    if (check[0].status !== 'pending') {
      return res.status(409).json({ error: { message: 'Can only remove items from pending transfers' } });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_stock_transfer_items WHERE id=$1 AND transfer_id=$2`,
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Item not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete transfer item' } });
  }
});

// POST /stock-transfers/:id/dispatch — pending → in_transit
router.post('/:id/dispatch', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: tRows } = await client.query(
      `SELECT * FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!tRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Not found' } }); }
    if (tRows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Transfer must be pending to dispatch' } }); }

    const transfer = tRows[0];
    const { rows: items } = await client.query(
      `SELECT * FROM mcogs_stock_transfer_items WHERE transfer_id=$1`, [transfer.id]
    );

    const created_by = req.user?.email || req.user?.name || 'system';
    for (const item of items) {
      // stock movement: transfer_out (negative)
      await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
        VALUES ($1, $2, 'transfer_out', $3, 'transfer', $4, $5, $6)
      `, [transfer.from_store_id, item.ingredient_id, -item.qty_sent, transfer.id,
          `Transfer ${transfer.transfer_number} dispatch`, created_by]);

      // decrement stock level
      await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, -$3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand - $3, updated_at = NOW()
      `, [transfer.from_store_id, item.ingredient_id, item.qty_sent]);
    }

    const { rows: updated } = await client.query(`
      UPDATE mcogs_stock_transfers
      SET    status = 'in_transit', updated_at = NOW()
      WHERE  id = $1
      RETURNING *
    `, [transfer.id]);

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'status_change', entity_type: 'stock_transfer', entity_id: transfer.id, entity_label: transfer.transfer_number, field_changes: { status: { old: 'pending', new: 'in_transit' } } });
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to dispatch transfer' } });
  } finally {
    client.release();
  }
});

// POST /stock-transfers/:id/confirm — in_transit → confirmed
router.post('/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: tRows } = await client.query(
      `SELECT * FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!tRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Not found' } }); }
    if (tRows[0].status !== 'in_transit') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Transfer must be in_transit to confirm' } }); }

    const transfer = tRows[0];
    const { rows: items } = await client.query(
      `SELECT * FROM mcogs_stock_transfer_items WHERE transfer_id=$1`, [transfer.id]
    );

    // Build a map of received quantities from the request body (if provided)
    const receivedMap = {};
    if (Array.isArray(req.body?.items)) {
      for (const ri of req.body.items) {
        receivedMap[ri.id] = ri.qty_received;
      }
    }

    const created_by = req.user?.email || req.user?.name || 'system';
    for (const item of items) {
      const qty_received = receivedMap[item.id] !== undefined ? receivedMap[item.id] : (item.qty_received || item.qty_sent);

      // stock movement: transfer_in (positive)
      await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
        VALUES ($1, $2, 'transfer_in', $3, 'transfer', $4, $5, $6)
      `, [transfer.to_store_id, item.ingredient_id, qty_received, transfer.id,
          `Transfer ${transfer.transfer_number} confirm`, created_by]);

      // increment stock level
      await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
      `, [transfer.to_store_id, item.ingredient_id, qty_received]);

      // update qty_received on the transfer item
      await client.query(`
        UPDATE mcogs_stock_transfer_items SET qty_received = $1 WHERE id = $2
      `, [qty_received, item.id]);
    }

    const confirmed_by = req.user?.email || req.user?.name || 'system';
    const { rows: updated } = await client.query(`
      UPDATE mcogs_stock_transfers
      SET    status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), updated_at = NOW()
      WHERE  id = $2
      RETURNING *
    `, [confirmed_by, transfer.id]);

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'status_change', entity_type: 'stock_transfer', entity_id: transfer.id, entity_label: transfer.transfer_number, field_changes: { status: { old: 'in_transit', new: 'confirmed' } } });
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to confirm transfer' } });
  } finally {
    client.release();
  }
});

// POST /stock-transfers/:id/cancel — cancel transfer, reverse dispatch if in_transit
router.post('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: tRows } = await client.query(
      `SELECT * FROM mcogs_stock_transfers WHERE id=$1`, [req.params.id]
    );
    if (!tRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Not found' } }); }

    const transfer = tRows[0];
    if (transfer.status === 'confirmed' || transfer.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { message: `Cannot cancel a ${transfer.status} transfer` } });
    }

    // If in_transit, reverse the dispatch stock movements
    if (transfer.status === 'in_transit') {
      const { rows: items } = await client.query(
        `SELECT * FROM mcogs_stock_transfer_items WHERE transfer_id=$1`, [transfer.id]
      );

      const created_by = req.user?.email || req.user?.name || 'system';
      for (const item of items) {
        // reverse movement: manual_adjust positive on from_store
        await client.query(`
          INSERT INTO mcogs_stock_movements
            (store_id, ingredient_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
          VALUES ($1, $2, 'manual_adjust', $3, 'transfer', $4, $5, $6)
        `, [transfer.from_store_id, item.ingredient_id, item.qty_sent, transfer.id,
            `Transfer ${transfer.transfer_number} cancelled — dispatch reversed`, created_by]);

        // increment stock level back
        await client.query(`
          INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (store_id, ingredient_id)
          DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
        `, [transfer.from_store_id, item.ingredient_id, item.qty_sent]);
      }
    }

    const { rows: updated } = await client.query(`
      UPDATE mcogs_stock_transfers
      SET    status = 'cancelled', updated_at = NOW()
      WHERE  id = $1
      RETURNING *
    `, [transfer.id]);

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'status_change', entity_type: 'stock_transfer', entity_id: transfer.id, entity_label: transfer.transfer_number, field_changes: { status: { old: transfer.status, new: 'cancelled' } } });
    res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to cancel transfer' } });
  } finally {
    client.release();
  }
});

// POST /stock-transfers/bulk-delete — bulk delete pending transfers
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: { message: 'ids array is required' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Only delete pending transfers
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows: check } = await client.query(
      `SELECT id, status FROM mcogs_stock_transfers WHERE id IN (${placeholders})`, ids
    );
    const nonPending = check.filter(r => r.status !== 'pending');
    if (nonPending.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { message: `Cannot delete non-pending transfers: ${nonPending.map(r => r.id).join(', ')}` } });
    }

    const { rowCount } = await client.query(
      `DELETE FROM mcogs_stock_transfers WHERE id IN (${placeholders}) AND status = 'pending'`, ids
    );

    await client.query('COMMIT');
    res.json({ deleted: rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk delete transfers' } });
  } finally {
    client.release();
  }
});

module.exports = router;
