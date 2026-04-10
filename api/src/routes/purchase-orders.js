const router = require('express').Router();
const pool   = require('../db/pool');

// GET /purchase-orders
router.get('/', async (req, res) => {
  const { store_id, vendor_id, status, from, to } = req.query;
  try {
    let query = `
      SELECT po.*,
             s.name  AS store_name,
             s.location_id,
             v.name  AS vendor_name,
             loc.name AS location_name,
             ic.item_count
      FROM   mcogs_purchase_orders po
      LEFT JOIN mcogs_stores    s   ON s.id   = po.store_id
      LEFT JOIN mcogs_vendors   v   ON v.id   = po.vendor_id
      LEFT JOIN mcogs_locations loc ON loc.id  = s.location_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_purchase_order_items
        WHERE  po_id = po.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)  { query += ` AND po.store_id = $${p++}`;  vals.push(store_id); }
    if (vendor_id) { query += ` AND po.vendor_id = $${p++}`; vals.push(vendor_id); }
    if (status)    { query += ` AND po.status = $${p++}`;    vals.push(status); }
    if (from)      { query += ` AND po.order_date >= $${p++}`; vals.push(from); }
    if (to)        { query += ` AND po.order_date <= $${p++}`; vals.push(to); }
    query += ` ORDER BY po.created_at DESC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch purchase orders' } });
  }
});

// GET /purchase-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [po] } = await pool.query(`
      SELECT po.*,
             s.name AS store_name, s.location_id,
             v.name AS vendor_name,
             loc.name AS location_name
      FROM   mcogs_purchase_orders po
      LEFT JOIN mcogs_stores    s   ON s.id   = po.store_id
      LEFT JOIN mcogs_vendors   v   ON v.id   = po.vendor_id
      LEFT JOIN mcogs_locations loc ON loc.id  = s.location_id
      WHERE  po.id = $1
    `, [req.params.id]);
    if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });

    const { rows: items } = await pool.query(`
      SELECT poi.*,
             ing.name         AS ingredient_name,
             ing.base_unit_id,
             u.name           AS base_unit_name,
             u.abbreviation   AS base_unit_abbr
      FROM   mcogs_purchase_order_items poi
      LEFT JOIN mcogs_ingredients ing ON ing.id = poi.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  poi.po_id = $1
      ORDER BY poi.sort_order, poi.id
    `, [req.params.id]);

    res.json({ ...po, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch purchase order' } });
  }
});

// POST /purchase-orders
router.post('/', async (req, res) => {
  const { store_id, vendor_id, order_date, expected_date, notes, items } = req.body;
  if (!store_id)  return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!vendor_id) return res.status(400).json({ error: { message: 'vendor_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(`
      INSERT INTO mcogs_purchase_orders
        (store_id, vendor_id, po_number, status, order_date, expected_date, notes, created_by)
      VALUES ($1, $2, 'PO-' || nextval('mcogs_po_number_seq'), 'draft', COALESCE($3, CURRENT_DATE), $4, $5, $6)
      RETURNING *
    `, [
      store_id,
      vendor_id,
      order_date || null,
      expected_date || null,
      notes?.trim() || null,
      req.user?.email || req.user?.name || 'system',
    ]);

    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(`
          INSERT INTO mcogs_purchase_order_items
            (po_id, ingredient_id, quote_id, qty_ordered, unit_price, purchase_unit, qty_in_base_units, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          po.id,
          it.ingredient_id,
          it.quote_id || null,
          it.qty_ordered || 0,
          it.unit_price || 0,
          it.purchase_unit || null,
          it.qty_in_base_units || 0,
          it.sort_order ?? i,
        ]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(po);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create purchase order' } });
  } finally {
    client.release();
  }
});

// PUT /purchase-orders/:id
router.put('/:id', async (req, res) => {
  const { vendor_id, order_date, expected_date, notes } = req.body;
  try {
    // Only allow editing draft POs
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (existing.status !== 'draft') return res.status(409).json({ error: { message: 'Only draft POs can be edited' } });

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_purchase_orders
      SET    vendor_id=$1, order_date=COALESCE($2, order_date), expected_date=$3, notes=$4, updated_at=NOW()
      WHERE  id=$5
      RETURNING *
    `, [
      vendor_id,
      order_date || null,
      expected_date || null,
      notes?.trim() || null,
      req.params.id,
    ]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update purchase order' } });
  }
});

// DELETE /purchase-orders/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (existing.status !== 'draft') return res.status(409).json({ error: { message: 'Only draft POs can be deleted' } });

    await pool.query(`DELETE FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete purchase order' } });
  }
});

// POST /purchase-orders/:id/items
router.post('/:id/items', async (req, res) => {
  const { ingredient_id, quote_id, qty_ordered, unit_price, purchase_unit, qty_in_base_units } = req.body;
  if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });

  try {
    const { rows: [po] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (po.status !== 'draft') return res.status(409).json({ error: { message: 'Can only add items to draft POs' } });

    const { rows: [maxSort] } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM mcogs_purchase_order_items WHERE po_id = $1`,
      [req.params.id]
    );

    const { rows: [item] } = await pool.query(`
      INSERT INTO mcogs_purchase_order_items
        (po_id, ingredient_id, quote_id, qty_ordered, unit_price, purchase_unit, qty_in_base_units, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.params.id,
      ingredient_id,
      quote_id || null,
      qty_ordered || 0,
      unit_price || 0,
      purchase_unit || null,
      qty_in_base_units || 0,
      maxSort.next_sort,
    ]);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add PO item' } });
  }
});

// PUT /purchase-orders/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const { ingredient_id, quote_id, qty_ordered, unit_price, purchase_unit, qty_in_base_units, sort_order } = req.body;
  try {
    const { rows: [po] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (po.status !== 'draft') return res.status(409).json({ error: { message: 'Can only edit items on draft POs' } });

    const { rows: [item] } = await pool.query(`
      UPDATE mcogs_purchase_order_items
      SET    ingredient_id=$1, quote_id=$2, qty_ordered=$3, unit_price=$4,
             purchase_unit=$5, qty_in_base_units=$6, sort_order=$7
      WHERE  id=$8 AND po_id=$9
      RETURNING *
    `, [
      ingredient_id,
      quote_id || null,
      qty_ordered || 0,
      unit_price || 0,
      purchase_unit || null,
      qty_in_base_units || 0,
      sort_order ?? 0,
      req.params.itemId,
      req.params.id,
    ]);
    if (!item) return res.status(404).json({ error: { message: 'PO item not found' } });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update PO item' } });
  }
});

// DELETE /purchase-orders/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows: [po] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (po.status !== 'draft') return res.status(409).json({ error: { message: 'Can only remove items from draft POs' } });

    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_purchase_order_items WHERE id = $1 AND po_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'PO item not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete PO item' } });
  }
});

// POST /purchase-orders/:id/submit
router.post('/:id/submit', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (existing.status !== 'draft') return res.status(409).json({ error: { message: 'Only draft POs can be submitted' } });

    const { rows: [po] } = await pool.query(`
      UPDATE mcogs_purchase_orders
      SET    status='submitted', updated_at=NOW()
      WHERE  id=$1
      RETURNING *
    `, [req.params.id]);
    res.json(po);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to submit purchase order' } });
  }
});

// POST /purchase-orders/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_purchase_orders WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    if (existing.status === 'cancelled') return res.status(409).json({ error: { message: 'Purchase order is already cancelled' } });

    const { rows: [po] } = await pool.query(`
      UPDATE mcogs_purchase_orders
      SET    status='cancelled', updated_at=NOW()
      WHERE  id=$1
      RETURNING *
    `, [req.params.id]);
    res.json(po);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to cancel purchase order' } });
  }
});

// POST /purchase-orders/from-template/:templateId
router.post('/from-template/:templateId', async (req, res) => {
  const { store_id, order_date, expected_date, notes } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load template
    const { rows: [tpl] } = await client.query(
      `SELECT * FROM mcogs_order_templates WHERE id = $1`, [req.params.templateId]
    );
    if (!tpl) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Order template not found' } });
    }

    // Create PO from template
    const { rows: [po] } = await client.query(`
      INSERT INTO mcogs_purchase_orders
        (store_id, vendor_id, po_number, status, order_date, expected_date, notes, template_id, created_by)
      VALUES ($1, $2, 'PO-' || nextval('mcogs_po_number_seq'), 'draft', COALESCE($3, CURRENT_DATE), $4, $5, $6, $7)
      RETURNING *
    `, [
      store_id || tpl.store_id,
      tpl.vendor_id,
      order_date || null,
      expected_date || null,
      notes?.trim() || tpl.notes || null,
      tpl.id,
      req.user?.email || req.user?.name || 'system',
    ]);

    // Copy template items with current prices from linked quotes
    const { rows: tplItems } = await client.query(`
      SELECT ti.*, pq.purchase_price, pq.qty_in_base_units AS pq_base_units, pq.purchase_unit AS pq_unit
      FROM   mcogs_order_template_items ti
      LEFT JOIN mcogs_price_quotes pq ON pq.id = ti.quote_id AND pq.is_active = true
      WHERE  ti.template_id = $1
      ORDER BY ti.sort_order, ti.id
    `, [tpl.id]);

    for (let i = 0; i < tplItems.length; i++) {
      const it = tplItems[i];
      await client.query(`
        INSERT INTO mcogs_purchase_order_items
          (po_id, ingredient_id, quote_id, qty_ordered, unit_price, purchase_unit, qty_in_base_units, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        po.id,
        it.ingredient_id,
        it.quote_id || null,
        it.default_qty || 0,
        it.purchase_price || 0,
        it.purchase_unit || it.pq_unit || null,
        it.pq_base_units || 0,
        it.sort_order ?? i,
      ]);
    }

    await client.query('COMMIT');
    res.status(201).json(po);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create PO from template' } });
  } finally {
    client.release();
  }
});

// POST /purchase-orders/bulk-delete
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: { message: 'ids array is required' } });

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_purchase_orders WHERE id = ANY($1) AND status = 'draft'`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk delete purchase orders' } });
  }
});

module.exports = router;
