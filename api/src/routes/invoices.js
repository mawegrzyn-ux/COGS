const router = require('express').Router();
const pool   = require('../db/pool');

// ── Helper: recalculate invoice subtotal/total after item changes ────────────
async function recalcTotals(client, invoiceId) {
  const { rows } = await client.query(
    'SELECT COALESCE(SUM(line_total),0) AS subtotal FROM mcogs_invoice_items WHERE invoice_id=$1',
    [invoiceId]
  );
  const subtotal = parseFloat(rows[0].subtotal);
  await client.query(
    'UPDATE mcogs_invoices SET subtotal=$1, total=$1+tax_amount, updated_at=NOW() WHERE id=$2',
    [subtotal, invoiceId]
  );
}

// GET /invoices
router.get('/', async (req, res) => {
  const { store_id, vendor_id, status, from, to } = req.query;
  try {
    let query = `
      SELECT inv.*,
             s.name  AS store_name,
             v.name  AS vendor_name,
             ic.item_count
      FROM   mcogs_invoices inv
      LEFT JOIN mcogs_stores  s ON s.id = inv.store_id
      LEFT JOIN mcogs_vendors v ON v.id = inv.vendor_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_invoice_items
        WHERE  invoice_id = inv.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)  { query += ` AND inv.store_id = $${p++}`;      vals.push(store_id); }
    if (vendor_id) { query += ` AND inv.vendor_id = $${p++}`;     vals.push(vendor_id); }
    if (status)    { query += ` AND inv.status = $${p++}`;        vals.push(status); }
    if (from)      { query += ` AND inv.invoice_date >= $${p++}`; vals.push(from); }
    if (to)        { query += ` AND inv.invoice_date <= $${p++}`; vals.push(to); }
    query += ` ORDER BY inv.invoice_date DESC`;

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch invoices' } });
  }
});

// GET /invoices/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [inv] } = await pool.query(`
      SELECT inv.*,
             s.name  AS store_name,
             v.name  AS vendor_name
      FROM   mcogs_invoices inv
      LEFT JOIN mcogs_stores  s ON s.id = inv.store_id
      LEFT JOIN mcogs_vendors v ON v.id = inv.vendor_id
      WHERE  inv.id = $1
    `, [req.params.id]);
    if (!inv) return res.status(404).json({ error: { message: 'Invoice not found' } });

    const { rows: items } = await pool.query(`
      SELECT ii.*,
             ing.name AS ingredient_name
      FROM   mcogs_invoice_items ii
      LEFT JOIN mcogs_ingredients ing ON ing.id = ii.ingredient_id
      WHERE  ii.invoice_id = $1
      ORDER BY ii.sort_order, ii.id
    `, [req.params.id]);

    inv.items = items;
    res.json(inv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch invoice' } });
  }
});

// POST /invoices
router.post('/', async (req, res) => {
  const { store_id, vendor_id, grn_id, invoice_date, due_date, currency_code, notes, items } = req.body;
  if (!store_id)  return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!vendor_id) return res.status(400).json({ error: { message: 'vendor_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [inv] } = await client.query(`
      INSERT INTO mcogs_invoices
        (store_id, vendor_id, grn_id, invoice_number, status, invoice_date, due_date,
         subtotal, tax_amount, total, currency_code, notes, created_by)
      VALUES ($1, $2, $3, 'INV-' || nextval('mcogs_inv_number_seq'), 'draft',
              $4, $5, 0, 0, 0, $6, $7, $8)
      RETURNING *
    `, [
      store_id, vendor_id, grn_id || null,
      invoice_date || new Date().toISOString().slice(0, 10),
      due_date || null, currency_code || null, notes?.trim() || null,
      req.user?.email || req.user?.name || 'system'
    ]);

    if (items?.length) {
      let sort = 0;
      for (const item of items) {
        const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
        await client.query(`
          INSERT INTO mcogs_invoice_items
            (invoice_id, ingredient_id, description, quantity, unit_price, line_total, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          inv.id, item.ingredient_id || null, item.description?.trim() || null,
          item.quantity || 0, item.unit_price || 0, lineTotal, sort++
        ]);
      }
      await recalcTotals(client, inv.id);
    }

    // Re-fetch to get updated totals
    const { rows: [result] } = await client.query('SELECT * FROM mcogs_invoices WHERE id=$1', [inv.id]);

    await client.query('COMMIT');
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create invoice' } });
  } finally {
    client.release();
  }
});

// PUT /invoices/:id
router.put('/:id', async (req, res) => {
  const { store_id, vendor_id, grn_id, invoice_date, due_date, tax_amount, currency_code, notes } = req.body;
  try {
    const { rows: [existing] } = await pool.query('SELECT status FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: { message: 'Invoice not found' } });
    if (existing.status !== 'draft' && existing.status !== 'pending') {
      return res.status(400).json({ error: { message: 'Can only update draft or pending invoices' } });
    }

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_invoices
      SET    store_id=$1, vendor_id=$2, grn_id=$3, invoice_date=$4, due_date=$5,
             tax_amount=COALESCE($6, tax_amount), currency_code=$7, notes=$8,
             total=subtotal+COALESCE($6, tax_amount), updated_at=NOW()
      WHERE  id=$9
      RETURNING *
    `, [
      store_id, vendor_id, grn_id || null, invoice_date, due_date || null,
      tax_amount ?? null, currency_code || null, notes?.trim() || null,
      req.params.id
    ]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update invoice' } });
  }
});

// DELETE /invoices/:id — draft only
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query('SELECT status FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: { message: 'Invoice not found' } });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: { message: 'Can only delete draft invoices' } });
    }
    await pool.query('DELETE FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete invoice' } });
  }
});

// ── Line Items ───────────────────────────────────────────────────────────────

// POST /invoices/:id/items
router.post('/:id/items', async (req, res) => {
  const { ingredient_id, description, quantity, unit_price } = req.body;
  const lineTotal = (parseFloat(quantity) || 0) * (parseFloat(unit_price) || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [existing] } = await client.query('SELECT id, status FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Invoice not found' } });
    }
    if (existing.status !== 'draft' && existing.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { message: 'Can only add items to draft or pending invoices' } });
    }

    // Get next sort_order
    const { rows: [{ max_sort }] } = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1)::int AS max_sort FROM mcogs_invoice_items WHERE invoice_id=$1',
      [req.params.id]
    );

    const { rows: [item] } = await client.query(`
      INSERT INTO mcogs_invoice_items
        (invoice_id, ingredient_id, description, quantity, unit_price, line_total, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.id, ingredient_id || null, description?.trim() || null, quantity || 0, unit_price || 0, lineTotal, max_sort + 1]);

    await recalcTotals(client, req.params.id);
    await client.query('COMMIT');
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add invoice item' } });
  } finally {
    client.release();
  }
});

// PUT /invoices/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const { ingredient_id, description, quantity, unit_price, sort_order } = req.body;
  const lineTotal = (parseFloat(quantity) || 0) * (parseFloat(unit_price) || 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [inv] } = await client.query('SELECT status FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Invoice not found' } }); }
    if (inv.status !== 'draft' && inv.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Can only edit items on draft or pending invoices' } }); }

    const { rows: [item] } = await client.query(`
      UPDATE mcogs_invoice_items
      SET    ingredient_id=$1, description=$2, quantity=$3, unit_price=$4,
             line_total=$5, sort_order=COALESCE($6, sort_order)
      WHERE  id=$7 AND invoice_id=$8
      RETURNING *
    `, [ingredient_id || null, description?.trim() || null, quantity || 0, unit_price || 0, lineTotal, sort_order ?? null, req.params.itemId, req.params.id]);

    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Invoice item not found' } });
    }

    await recalcTotals(client, req.params.id);
    await client.query('COMMIT');
    res.json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update invoice item' } });
  } finally {
    client.release();
  }
});

// DELETE /invoices/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [inv] } = await client.query('SELECT status FROM mcogs_invoices WHERE id=$1', [req.params.id]);
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Invoice not found' } }); }
    if (inv.status !== 'draft' && inv.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: { message: 'Can only remove items from draft or pending invoices' } }); }

    const { rowCount } = await client.query(
      'DELETE FROM mcogs_invoice_items WHERE id=$1 AND invoice_id=$2',
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Invoice item not found' } });
    }

    await recalcTotals(client, req.params.id);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete invoice item' } });
  } finally {
    client.release();
  }
});

// ── Status Transitions ──────────────────────────────────────────────────────

// POST /invoices/:id/submit — draft → pending
router.post('/:id/submit', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_invoices SET status='pending', updated_at=NOW()
      WHERE  id=$1 AND status='draft'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Invoice not found or not in draft status' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to submit invoice' } });
  }
});

// POST /invoices/:id/approve — pending → approved
router.post('/:id/approve', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_invoices SET status='approved', updated_at=NOW()
      WHERE  id=$1 AND status='pending'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Invoice not found or not in pending status' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to approve invoice' } });
  }
});

// POST /invoices/:id/mark-paid — approved → paid
router.post('/:id/mark-paid', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_invoices SET status='paid', updated_at=NOW()
      WHERE  id=$1 AND status='approved'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Invoice not found or not in approved status' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to mark invoice as paid' } });
  }
});

// POST /invoices/:id/dispute — any status except paid → disputed
router.post('/:id/dispute', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_invoices SET status='disputed', updated_at=NOW()
      WHERE  id=$1 AND status != 'paid'
      RETURNING *
    `, [req.params.id]);
    if (!row) return res.status(400).json({ error: { message: 'Invoice not found or already paid' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to dispute invoice' } });
  }
});

// ── Create from GRN ─────────────────────────────────────────────────────────

// POST /invoices/from-grn/:grnId
router.post('/from-grn/:grnId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [grn] } = await client.query(`
      SELECT * FROM mcogs_goods_received WHERE id=$1 AND status='confirmed'
    `, [req.params.grnId]);
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'GRN not found or not confirmed' } });
    }

    // Check for existing invoice linked to this GRN
    const { rows: [dup] } = await client.query(
      'SELECT id FROM mcogs_invoices WHERE grn_id=$1', [req.params.grnId]
    );
    if (dup) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { message: 'Invoice already exists for this GRN', invoice_id: dup.id } });
    }

    const { rows: [inv] } = await client.query(`
      INSERT INTO mcogs_invoices
        (store_id, vendor_id, grn_id, invoice_number, status, invoice_date,
         subtotal, tax_amount, total, currency_code, notes, created_by)
      VALUES ($1, $2, $3, 'INV-' || nextval('mcogs_inv_number_seq'), 'draft',
              $4, 0, 0, 0, $5, $6, $7)
      RETURNING *
    `, [
      grn.store_id, grn.vendor_id, grn.id,
      new Date().toISOString().slice(0, 10),
      grn.currency_code || null,
      'Created from GRN #' + grn.id,
      req.user?.email || req.user?.name || 'system'
    ]);

    // Copy GRN items
    const { rows: grnItems } = await client.query(
      'SELECT * FROM mcogs_goods_received_items WHERE grn_id=$1 ORDER BY sort_order, id',
      [req.params.grnId]
    );

    let sort = 0;
    for (const gi of grnItems) {
      const lineTotal = (parseFloat(gi.qty_received) || 0) * (parseFloat(gi.unit_price) || 0);
      await client.query(`
        INSERT INTO mcogs_invoice_items
          (invoice_id, ingredient_id, description, quantity, unit_price, line_total, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [inv.id, gi.ingredient_id || null, gi.description || null, gi.qty_received || 0, gi.unit_price || 0, lineTotal, sort++]);
    }

    await recalcTotals(client, inv.id);

    const { rows: [result] } = await client.query('SELECT * FROM mcogs_invoices WHERE id=$1', [inv.id]);

    await client.query('COMMIT');
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create invoice from GRN' } });
  } finally {
    client.release();
  }
});

// ── Bulk Operations ─────────────────────────────────────────────────────────

// POST /invoices/bulk-approve
router.post('/bulk-approve', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: { message: 'ids array is required' } });
  }
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_invoices SET status='approved', updated_at=NOW()
      WHERE  id = ANY($1) AND status='pending'
      RETURNING *
    `, [ids]);
    res.json({ approved: rows.length, invoices: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk approve invoices' } });
  }
});

// POST /invoices/bulk-delete
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: { message: 'ids array is required' } });
  }
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM mcogs_invoices WHERE id = ANY($1) AND status='draft'
    `, [ids]);
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk delete invoices' } });
  }
});

module.exports = router;
