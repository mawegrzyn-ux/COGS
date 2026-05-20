const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /order-templates
router.get('/', async (req, res) => {
  const { store_id, vendor_id } = req.query;
  try {
    let query = `
      SELECT t.*,
             s.name AS store_name,
             v.name AS vendor_name,
             ic.item_count
      FROM   mcogs_order_templates t
      LEFT JOIN mcogs_stores  s ON s.id = t.store_id
      LEFT JOIN mcogs_vendors v ON v.id = t.vendor_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_order_template_items
        WHERE  template_id = t.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)  { query += ` AND t.store_id = $${p++}`;  vals.push(store_id); }
    if (vendor_id) { query += ` AND t.vendor_id = $${p++}`; vals.push(vendor_id); }
    query += ` ORDER BY t.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch order templates' } });
  }
});

// GET /order-templates/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [tpl] } = await pool.query(`
      SELECT t.*,
             s.name AS store_name,
             v.name AS vendor_name
      FROM   mcogs_order_templates t
      LEFT JOIN mcogs_stores  s ON s.id = t.store_id
      LEFT JOIN mcogs_vendors v ON v.id = t.vendor_id
      WHERE  t.id = $1
    `, [req.params.id]);
    if (!tpl) return res.status(404).json({ error: { message: 'Order template not found' } });

    const { rows: items } = await pool.query(`
      SELECT ti.*,
             ing.name         AS ingredient_name,
             ing.base_unit_id,
             u.name           AS base_unit_name,
             u.abbreviation   AS base_unit_abbr
      FROM   mcogs_order_template_items ti
      LEFT JOIN mcogs_ingredients ing ON ing.id = ti.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  ti.template_id = $1
      ORDER BY ti.sort_order, ti.id
    `, [req.params.id]);

    res.json({ ...tpl, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch order template' } });
  }
});

// POST /order-templates
router.post('/', async (req, res) => {
  const { store_id, vendor_id, name, notes, items } = req.body;
  if (!store_id)    return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!vendor_id)   return res.status(400).json({ error: { message: 'vendor_id is required' } });
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [tpl] } = await client.query(`
      INSERT INTO mcogs_order_templates (store_id, vendor_id, name, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [store_id, vendor_id, name.trim(), notes?.trim() || null]);

    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(`
          INSERT INTO mcogs_order_template_items
            (template_id, ingredient_id, quote_id, default_qty, purchase_unit, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          tpl.id,
          it.ingredient_id,
          it.quote_id || null,
          it.default_qty || 0,
          it.purchase_unit || null,
          it.sort_order ?? i,
        ]);
      }
    }

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'create', entity_type: 'order_template', entity_id: tpl.id, entity_label: tpl.name });
    res.status(201).json(tpl);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create order template' } });
  } finally {
    client.release();
  }
});

// PUT /order-templates/:id
router.put('/:id', async (req, res) => {
  const { store_id, vendor_id, name, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: oldRows } = await pool.query(`SELECT * FROM mcogs_order_templates WHERE id=$1`, [req.params.id]);
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_order_templates
      SET    store_id=$1, vendor_id=$2, name=$3, notes=$4, updated_at=NOW()
      WHERE  id=$5
      RETURNING *
    `, [
      store_id,
      vendor_id,
      name.trim(),
      notes?.trim() || null,
      req.params.id,
    ]);
    if (!row) return res.status(404).json({ error: { message: 'Order template not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'order_template', entity_id: row.id, entity_label: row.name, field_changes: diffFields(oldRows[0], row, ['name', 'notes', 'store_id', 'vendor_id']) });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update order template' } });
  }
});

// DELETE /order-templates/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: old } = await pool.query(`SELECT id, name FROM mcogs_order_templates WHERE id=$1`, [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_order_templates WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Order template not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'order_template', entity_id: Number(req.params.id), entity_label: old[0]?.name || `id:${req.params.id}` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete order template' } });
  }
});

// POST /order-templates/:id/items
router.post('/:id/items', async (req, res) => {
  const { ingredient_id, quote_id, default_qty, purchase_unit } = req.body;
  if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });

  try {
    const { rows: [tpl] } = await pool.query(
      `SELECT id FROM mcogs_order_templates WHERE id = $1`, [req.params.id]
    );
    if (!tpl) return res.status(404).json({ error: { message: 'Order template not found' } });

    const { rows: [maxSort] } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM mcogs_order_template_items WHERE template_id = $1`,
      [req.params.id]
    );

    const { rows: [item] } = await pool.query(`
      INSERT INTO mcogs_order_template_items
        (template_id, ingredient_id, quote_id, default_qty, purchase_unit, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      req.params.id,
      ingredient_id,
      quote_id || null,
      default_qty || 0,
      purchase_unit || null,
      maxSort.next_sort,
    ]);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add template item' } });
  }
});

// PUT /order-templates/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const { ingredient_id, quote_id, default_qty, purchase_unit, sort_order } = req.body;
  try {
    const { rows: [item] } = await pool.query(`
      UPDATE mcogs_order_template_items
      SET    ingredient_id=$1, quote_id=$2, default_qty=$3, purchase_unit=$4, sort_order=$5
      WHERE  id=$6 AND template_id=$7
      RETURNING *
    `, [
      ingredient_id,
      quote_id || null,
      default_qty || 0,
      purchase_unit || null,
      sort_order ?? 0,
      req.params.itemId,
      req.params.id,
    ]);
    if (!item) return res.status(404).json({ error: { message: 'Template item not found' } });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update template item' } });
  }
});

// DELETE /order-templates/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_order_template_items WHERE id = $1 AND template_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Template item not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete template item' } });
  }
});

// POST /order-templates/from-po/:poId
router.post('/from-po/:poId', async (req, res) => {
  const { name, notes } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load PO header
    const { rows: [po] } = await client.query(
      `SELECT * FROM mcogs_purchase_orders WHERE id = $1`, [req.params.poId]
    );
    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Purchase order not found' } });
    }

    // Create template
    const { rows: [tpl] } = await client.query(`
      INSERT INTO mcogs_order_templates (store_id, vendor_id, name, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [
      po.store_id,
      po.vendor_id,
      name?.trim() || `Template from ${po.po_number}`,
      notes?.trim() || po.notes || null,
    ]);

    // Copy PO items as template items
    const { rows: poItems } = await client.query(`
      SELECT * FROM mcogs_purchase_order_items WHERE po_id = $1 ORDER BY sort_order, id
    `, [po.id]);

    for (let i = 0; i < poItems.length; i++) {
      const it = poItems[i];
      await client.query(`
        INSERT INTO mcogs_order_template_items
          (template_id, ingredient_id, quote_id, default_qty, purchase_unit, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        tpl.id,
        it.ingredient_id,
        it.quote_id || null,
        it.qty_ordered || 0,
        it.purchase_unit || null,
        it.sort_order ?? i,
      ]);
    }

    await client.query('COMMIT');
    logAudit(pool, req, { action: 'create', entity_type: 'order_template', entity_id: tpl.id, entity_label: tpl.name, context: { source_po_id: Number(req.params.poId) } });
    res.status(201).json(tpl);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create template from PO' } });
  } finally {
    client.release();
  }
});

module.exports = router;
