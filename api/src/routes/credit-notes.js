const router = require('express').Router();
const pool   = require('../db/pool');

// ── Helper: recalculate credit note total after item changes ─────────────────
async function recalcTotal(client, creditNoteId) {
  const { rows } = await client.query(
    'SELECT COALESCE(SUM(line_total),0) AS total FROM mcogs_credit_note_items WHERE credit_note_id=$1',
    [creditNoteId]
  );
  const total = parseFloat(rows[0].total);
  await client.query(
    'UPDATE mcogs_credit_notes SET total=$1, updated_at=NOW() WHERE id=$2',
    [total, creditNoteId]
  );
}

// GET /credit-notes
router.get('/', async (req, res) => {
  const { store_id, vendor_id, invoice_id, status } = req.query;
  try {
    let query = `
      SELECT cn.*,
             s.name  AS store_name,
             v.name  AS vendor_name,
             ic.item_count
      FROM   mcogs_credit_notes cn
      LEFT JOIN mcogs_stores  s ON s.id = cn.store_id
      LEFT JOIN mcogs_vendors v ON v.id = cn.vendor_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_credit_note_items
        WHERE  credit_note_id = cn.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)   { query += ` AND cn.store_id = $${p++}`;   vals.push(store_id); }
    if (vendor_id)  { query += ` AND cn.vendor_id = $${p++}`;  vals.push(vendor_id); }
    if (invoice_id) { query += ` AND cn.invoice_id = $${p++}`; vals.push(invoice_id); }
    if (status)     { query += ` AND cn.status = $${p++}`;     vals.push(status); }
    query += ` ORDER BY cn.credit_date DESC`;

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch credit notes' } });
  }
});

// GET /credit-notes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [cn] } = await pool.query(`
      SELECT cn.*,
             s.name  AS store_name,
             v.name  AS vendor_name
      FROM   mcogs_credit_notes cn
      LEFT JOIN mcogs_stores  s ON s.id = cn.store_id
      LEFT JOIN mcogs_vendors v ON v.id = cn.vendor_id
      WHERE  cn.id = $1
    `, [req.params.id]);
    if (!cn) return res.status(404).json({ error: { message: 'Credit note not found' } });

    const { rows: items } = await pool.query(`
      SELECT ci.*,
             ing.name AS ingredient_name
      FROM   mcogs_credit_note_items ci
      LEFT JOIN mcogs_ingredients ing ON ing.id = ci.ingredient_id
      WHERE  ci.credit_note_id = $1
      ORDER BY ci.sort_order, ci.id
    `, [req.params.id]);

    cn.items = items;
    res.json(cn);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch credit note' } });
  }
});

// POST /credit-notes
router.post('/', async (req, res) => {
  const { store_id, vendor_id, invoice_id, grn_id, credit_date, reason, items } = req.body;
  if (!store_id)  return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!vendor_id) return res.status(400).json({ error: { message: 'vendor_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [cn] } = await client.query(`
      INSERT INTO mcogs_credit_notes
        (store_id, vendor_id, invoice_id, grn_id, credit_number, status, credit_date,
         reason, total, created_by)
      VALUES ($1, $2, $3, $4, 'CN-' || nextval('mcogs_cn_number_seq'), 'draft',
              $5, $6, 0, $7)
      RETURNING *
    `, [
      store_id, vendor_id, invoice_id || null, grn_id || null,
      credit_date || new Date().toISOString().slice(0, 10),
      reason?.trim() || null,
      req.user?.email || req.user?.name || 'system'
    ]);

    if (items?.length) {
      let sort = 0;
      for (const item of items) {
        const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
        await client.query(`
          INSERT INTO mcogs_credit_note_items
            (credit_note_id, ingredient_id, description, quantity, unit_price, line_total, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          cn.id, item.ingredient_id || null, item.description?.trim() || null,
          item.quantity || 0, item.unit_price || 0, lineTotal, sort++
        ]);
      }
      await recalcTotal(client, cn.id);
    }

    const { rows: [result] } = await client.query('SELECT * FROM mcogs_credit_notes WHERE id=$1', [cn.id]);

    await client.query('COMMIT');
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create credit note' } });
  } finally {
    client.release();
  }
});

// PUT /credit-notes/:id — draft only
router.put('/:id', async (req, res) => {
  const { store_id, vendor_id, invoice_id, grn_id, credit_date, reason } = req.body;
  try {
    const { rows: [existing] } = await pool.query('SELECT status FROM mcogs_credit_notes WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: { message: 'Credit note not found' } });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: { message: 'Can only update draft credit notes' } });
    }

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_credit_notes
      SET    store_id=$1, vendor_id=$2, invoice_id=$3, grn_id=$4,
             credit_date=$5, reason=$6, updated_at=NOW()
      WHERE  id=$7
      RETURNING *
    `, [store_id, vendor_id, invoice_id || null, grn_id || null, credit_date, reason?.trim() || null, req.params.id]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update credit note' } });
  }
});

// DELETE /credit-notes/:id — draft only
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query('SELECT status FROM mcogs_credit_notes WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: { message: 'Credit note not found' } });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: { message: 'Can only delete draft credit notes' } });
    }
    await pool.query('DELETE FROM mcogs_credit_notes WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete credit note' } });
  }
});

// ── Line Items ───────────────────────────────────────────────────────────────

// POST /credit-notes/:id/items
router.post('/:id/items', async (req, res) => {
  const { ingredient_id, description, quantity, unit_price } = req.body;
  const lineTotal = (parseFloat(quantity) || 0) * (parseFloat(unit_price) || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [existing] } = await client.query('SELECT id FROM mcogs_credit_notes WHERE id=$1', [req.params.id]);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Credit note not found' } });
    }

    const { rows: [{ max_sort }] } = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1)::int AS max_sort FROM mcogs_credit_note_items WHERE credit_note_id=$1',
      [req.params.id]
    );

    const { rows: [item] } = await client.query(`
      INSERT INTO mcogs_credit_note_items
        (credit_note_id, ingredient_id, description, quantity, unit_price, line_total, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.id, ingredient_id || null, description?.trim() || null, quantity || 0, unit_price || 0, lineTotal, max_sort + 1]);

    await recalcTotal(client, req.params.id);
    await client.query('COMMIT');
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add credit note item' } });
  } finally {
    client.release();
  }
});

// PUT /credit-notes/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const { ingredient_id, description, quantity, unit_price, sort_order } = req.body;
  const lineTotal = (parseFloat(quantity) || 0) * (parseFloat(unit_price) || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [item] } = await client.query(`
      UPDATE mcogs_credit_note_items
      SET    ingredient_id=$1, description=$2, quantity=$3, unit_price=$4,
             line_total=$5, sort_order=COALESCE($6, sort_order)
      WHERE  id=$7 AND credit_note_id=$8
      RETURNING *
    `, [ingredient_id || null, description?.trim() || null, quantity || 0, unit_price || 0, lineTotal, sort_order ?? null, req.params.itemId, req.params.id]);

    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Credit note item not found' } });
    }

    await recalcTotal(client, req.params.id);
    await client.query('COMMIT');
    res.json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update credit note item' } });
  } finally {
    client.release();
  }
});

// DELETE /credit-notes/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      'DELETE FROM mcogs_credit_note_items WHERE id=$1 AND credit_note_id=$2',
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Credit note item not found' } });
    }

    await recalcTotal(client, req.params.id);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete credit note item' } });
  } finally {
    client.release();
  }
});

// ── Status Transitions ──────────────────────────────────────────────────────

// POST /credit-notes/:id/submit — draft → submitted
router.post('/:id/submit', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_credit_notes SET status='submitted', updated_at=NOW()
      WHERE  id=$1 AND status='draft'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Credit note not found or not in draft status' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to submit credit note' } });
  }
});

// POST /credit-notes/:id/approve — submitted → approved
router.post('/:id/approve', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_credit_notes SET status='approved', updated_at=NOW()
      WHERE  id=$1 AND status='submitted'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Credit note not found or not in submitted status' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to approve credit note' } });
  }
});

// POST /credit-notes/:id/apply — approved → applied (optionally adjusts stock)
router.post('/:id/apply', async (req, res) => {
  const { adjust_stock } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [cn] } = await client.query(`
      UPDATE mcogs_credit_notes SET status='applied', updated_at=NOW()
      WHERE  id=$1 AND status='approved'
      RETURNING *
    `, [req.params.id]);
    if (!cn) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: 'Credit note not found or not in approved status' } });
    }

    if (adjust_stock) {
      const { rows: items } = await client.query(
        'SELECT * FROM mcogs_credit_note_items WHERE credit_note_id=$1', [cn.id]
      );

      for (const item of items) {
        if (!item.ingredient_id || !item.quantity) continue;

        // Insert stock movement
        await client.query(`
          INSERT INTO mcogs_stock_movements
            (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by, created_at)
          VALUES ($1, $2, 'credit_note', $3, $4, 'credit_note', $5, $6, NOW())
        `, [
          cn.store_id, item.ingredient_id, item.quantity, item.unit_price || 0,
          cn.id, req.user?.email || req.user?.name || 'system'
        ]);

        // Upsert stock level (increment — credit note returns stock)
        await client.query(`
          INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (store_id, ingredient_id)
          DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
        `, [cn.store_id, item.ingredient_id, item.quantity]);
      }
    }

    await client.query('COMMIT');
    res.json(cn);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to apply credit note' } });
  } finally {
    client.release();
  }
});

// ── Bulk Operations ─────────────────────────────────────────────────────────

// POST /credit-notes/bulk-delete
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: { message: 'ids array is required' } });
  }
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM mcogs_credit_notes WHERE id = ANY($1) AND status='draft'
    `, [ids]);
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk delete credit notes' } });
  }
});

module.exports = router;
