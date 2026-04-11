const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// GET /goods-received
router.get('/', async (req, res) => {
  const { store_id, po_id, vendor_id, status, from, to } = req.query;
  try {
    let query = `
      SELECT grn.*,
             s.name  AS store_name,
             v.name  AS vendor_name,
             po.po_number,
             ic.item_count
      FROM   mcogs_goods_received grn
      LEFT JOIN mcogs_stores           s  ON s.id  = grn.store_id
      LEFT JOIN mcogs_vendors          v  ON v.id  = grn.vendor_id
      LEFT JOIN mcogs_purchase_orders  po ON po.id = grn.po_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_goods_received_items
        WHERE  grn_id = grn.id
      ) ic ON true
      WHERE 1=1
    `;
    const vals = [];
    let p = 1;
    if (store_id)  { query += ` AND grn.store_id = $${p++}`;  vals.push(store_id); }
    if (po_id)     { query += ` AND grn.po_id = $${p++}`;     vals.push(po_id); }
    if (vendor_id) { query += ` AND grn.vendor_id = $${p++}`; vals.push(vendor_id); }
    if (status)    { query += ` AND grn.status = $${p++}`;    vals.push(status); }
    if (from)      { query += ` AND grn.received_date >= $${p++}`; vals.push(from); }
    if (to)        { query += ` AND grn.received_date <= $${p++}`; vals.push(to); }
    query += ` ORDER BY grn.received_date DESC, grn.created_at DESC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch goods received notes' } });
  }
});

// GET /goods-received/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [grn] } = await pool.query(`
      SELECT grn.*,
             s.name  AS store_name,
             v.name  AS vendor_name,
             po.po_number
      FROM   mcogs_goods_received grn
      LEFT JOIN mcogs_stores           s  ON s.id  = grn.store_id
      LEFT JOIN mcogs_vendors          v  ON v.id  = grn.vendor_id
      LEFT JOIN mcogs_purchase_orders  po ON po.id = grn.po_id
      WHERE  grn.id = $1
    `, [req.params.id]);
    if (!grn) return res.status(404).json({ error: { message: 'GRN not found' } });

    const { rows: items } = await pool.query(`
      SELECT gi.*,
             ing.name         AS ingredient_name,
             ing.base_unit_id,
             u.name           AS base_unit_name,
             u.abbreviation   AS base_unit_abbr
      FROM   mcogs_goods_received_items gi
      LEFT JOIN mcogs_ingredients ing ON ing.id = gi.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  gi.grn_id = $1
      ORDER BY gi.sort_order, gi.id
    `, [req.params.id]);

    res.json({ ...grn, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch GRN' } });
  }
});

// POST /goods-received
router.post('/', async (req, res) => {
  const { store_id, vendor_id, po_id, received_date, notes, items } = req.body;
  if (!store_id)  return res.status(400).json({ error: { message: 'store_id is required' } });
  if (!vendor_id) return res.status(400).json({ error: { message: 'vendor_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [grn] } = await client.query(`
      INSERT INTO mcogs_goods_received
        (store_id, po_id, vendor_id, grn_number, status, received_date, notes, created_by)
      VALUES ($1, $2, $3, 'GRN-' || nextval('mcogs_grn_number_seq'), 'draft', $4, $5, $6)
      RETURNING *
    `, [
      store_id,
      po_id || null,
      vendor_id,
      received_date || new Date().toISOString().slice(0, 10),
      notes?.trim() || null,
      req.user?.email || req.user?.name || 'system',
    ]);

    let insertItems = items;

    // If po_id provided and no items, auto-populate from PO remaining quantities
    if (po_id && (!items || !items.length)) {
      const { rows: poItems } = await client.query(`
        SELECT poi.id AS po_item_id, poi.ingredient_id, poi.quote_id,
               poi.qty_ordered, poi.qty_received, poi.unit_price,
               poi.purchase_unit, poi.qty_in_base_units, poi.sort_order
        FROM   mcogs_purchase_order_items poi
        WHERE  poi.po_id = $1 AND poi.qty_ordered - poi.qty_received > 0
        ORDER BY poi.sort_order, poi.id
      `, [po_id]);

      insertItems = poItems.map(pi => ({
        po_item_id:       pi.po_item_id,
        ingredient_id:    pi.ingredient_id,
        qty_received:     pi.qty_ordered - pi.qty_received,
        unit_price:       pi.unit_price,
        purchase_unit:    pi.purchase_unit,
        qty_in_base_units: pi.qty_in_base_units,
        sort_order:       pi.sort_order,
      }));
    }

    if (insertItems && insertItems.length) {
      for (let i = 0; i < insertItems.length; i++) {
        const it = insertItems[i];
        await client.query(`
          INSERT INTO mcogs_goods_received_items
            (grn_id, ingredient_id, po_item_id, qty_received, unit_price, purchase_unit, qty_in_base_units, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          grn.id,
          it.ingredient_id,
          it.po_item_id || null,
          it.qty_received || 0,
          it.unit_price || 0,
          it.purchase_unit || null,
          it.qty_in_base_units || 0,
          it.sort_order ?? i,
        ]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(grn);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create GRN' } });
  } finally {
    client.release();
  }
});

// PUT /goods-received/:id
router.put('/:id', async (req, res) => {
  const { vendor_id, po_id, received_date, notes } = req.body;
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'GRN not found' } });
    if (existing.status !== 'draft') return res.status(409).json({ error: { message: 'Only draft GRNs can be edited' } });

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_goods_received
      SET    vendor_id=$1, po_id=$2, received_date=COALESCE($3, received_date), notes=$4, updated_at=NOW()
      WHERE  id=$5
      RETURNING *
    `, [
      vendor_id,
      po_id || null,
      received_date || null,
      notes?.trim() || null,
      req.params.id,
    ]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update GRN' } });
  }
});

// DELETE /goods-received/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT status FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'GRN not found' } });
    if (existing.status !== 'draft') return res.status(409).json({ error: { message: 'Only draft GRNs can be deleted' } });

    await pool.query(`DELETE FROM mcogs_goods_received WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete GRN' } });
  }
});

// POST /goods-received/:id/items
router.post('/:id/items', async (req, res) => {
  const { ingredient_id, po_item_id, qty_received, unit_price, purchase_unit, qty_in_base_units } = req.body;
  if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (qty_received !== undefined && Number(qty_received) <= 0) return res.status(400).json({ error: { message: 'qty_received must be positive' } });

  try {
    const { rows: [grn] } = await pool.query(
      `SELECT status FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!grn) return res.status(404).json({ error: { message: 'GRN not found' } });
    if (grn.status !== 'draft') return res.status(409).json({ error: { message: 'Can only add items to draft GRNs' } });

    const { rows: [maxSort] } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM mcogs_goods_received_items WHERE grn_id = $1`,
      [req.params.id]
    );

    const { rows: [item] } = await pool.query(`
      INSERT INTO mcogs_goods_received_items
        (grn_id, ingredient_id, po_item_id, qty_received, unit_price, purchase_unit, qty_in_base_units, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.params.id,
      ingredient_id,
      po_item_id || null,
      qty_received || 0,
      unit_price || 0,
      purchase_unit || null,
      qty_in_base_units || 0,
      maxSort.next_sort,
    ]);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add GRN item' } });
  }
});

// PUT /goods-received/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const { ingredient_id, po_item_id, qty_received, unit_price, purchase_unit, qty_in_base_units, sort_order } = req.body;
  try {
    const { rows: [grn] } = await pool.query(
      `SELECT status FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!grn) return res.status(404).json({ error: { message: 'GRN not found' } });
    if (grn.status !== 'draft') return res.status(409).json({ error: { message: 'Can only edit items on draft GRNs' } });

    const { rows: [item] } = await pool.query(`
      UPDATE mcogs_goods_received_items
      SET    ingredient_id=$1, po_item_id=$2, qty_received=$3, unit_price=$4,
             purchase_unit=$5, qty_in_base_units=$6, sort_order=$7
      WHERE  id=$8 AND grn_id=$9
      RETURNING *
    `, [
      ingredient_id,
      po_item_id || null,
      qty_received || 0,
      unit_price || 0,
      purchase_unit || null,
      qty_in_base_units || 0,
      sort_order ?? 0,
      req.params.itemId,
      req.params.id,
    ]);
    if (!item) return res.status(404).json({ error: { message: 'GRN item not found' } });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update GRN item' } });
  }
});

// DELETE /goods-received/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows: [grn] } = await pool.query(
      `SELECT status FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!grn) return res.status(404).json({ error: { message: 'GRN not found' } });
    if (grn.status !== 'draft') return res.status(409).json({ error: { message: 'Can only remove items from draft GRNs' } });

    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_goods_received_items WHERE id = $1 AND grn_id = $2`,
      [req.params.itemId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'GRN item not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete GRN item' } });
  }
});

// POST /goods-received/:id/confirm — CRITICAL TRANSACTION
router.post('/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load GRN
    const { rows: [grn] } = await client.query(
      `SELECT * FROM mcogs_goods_received WHERE id = $1`, [req.params.id]
    );
    if (!grn) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'GRN not found' } });
    }
    if (grn.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { message: 'Only draft GRNs can be confirmed' } });
    }

    // Load GRN items
    const { rows: grnItems } = await client.query(
      `SELECT * FROM mcogs_goods_received_items WHERE grn_id = $1`, [grn.id]
    );
    if (!grnItems.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: 'Cannot confirm a GRN with no items' } });
    }

    const createdBy = req.user?.email || req.user?.name || 'system';

    for (const item of grnItems) {
      const movementQty = item.qty_in_base_units || item.qty_received || 0;
      const movementType = grn.po_id ? 'goods_in' : 'goods_in_no_po';

      // 1. Insert stock movement
      await client.query(`
        INSERT INTO mcogs_stock_movements
          (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, 'grn', $6, $7, $8, NOW())
      `, [
        grn.store_id,
        item.ingredient_id,
        movementType,
        movementQty,
        item.unit_price || 0,
        grn.id,
        null,
        createdBy,
      ]);

      // 2. Upsert stock level
      await client.query(`
        INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, ingredient_id)
        DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
      `, [grn.store_id, item.ingredient_id, movementQty]);

      // 3. If linked to a PO item, update qty_received
      if (item.po_item_id) {
        await client.query(`
          UPDATE mcogs_purchase_order_items
          SET    qty_received = qty_received + $1
          WHERE  id = $2
        `, [item.qty_received || 0, item.po_item_id]);
      }
    }

    // 4. If linked to a PO, recalculate PO status
    if (grn.po_id) {
      const { rows: poItems } = await client.query(`
        SELECT qty_ordered, qty_received
        FROM   mcogs_purchase_order_items
        WHERE  po_id = $1
      `, [grn.po_id]);

      const allReceived = poItems.every(pi => pi.qty_received >= pi.qty_ordered);
      const someReceived = poItems.some(pi => pi.qty_received > 0);
      const newStatus = allReceived ? 'received' : someReceived ? 'partial' : 'submitted';

      await client.query(`
        UPDATE mcogs_purchase_orders
        SET    status = $1, updated_at = NOW()
        WHERE  id = $2
      `, [newStatus, grn.po_id]);
    }

    // 5. Set GRN status to confirmed
    const { rows: [confirmed] } = await client.query(`
      UPDATE mcogs_goods_received
      SET    status = 'confirmed', updated_at = NOW()
      WHERE  id = $1
      RETURNING *
    `, [grn.id]);

    await client.query('COMMIT');

    // Audit: log GRN confirmation with related entities
    await logAudit(pool, req, {
      action: 'confirm',
      entity_type: 'goods_received',
      entity_id: grn.id,
      entity_label: grn.grn_number,
      field_changes: { status: { old: 'draft', new: 'confirmed' } },
      context: { source: 'goods_received', items_count: grnItems.length },
      related_entities: [
        ...(grn.po_id ? [{ type: 'purchase_order', id: grn.po_id }] : []),
        { type: 'store', id: grn.store_id },
        { type: 'vendor', id: grn.vendor_id },
      ],
    });

    res.json(confirmed);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to confirm GRN' } });
  } finally {
    client.release();
  }
});

// POST /goods-received/bulk-confirm
router.post('/bulk-confirm', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: { message: 'ids array is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const confirmed = [];
    const createdBy = req.user?.email || req.user?.name || 'system';

    for (const grnId of ids) {
      // Load GRN
      const { rows: [grn] } = await client.query(
        `SELECT * FROM mcogs_goods_received WHERE id = $1`, [grnId]
      );
      if (!grn || grn.status !== 'draft') continue;

      // Load items
      const { rows: grnItems } = await client.query(
        `SELECT * FROM mcogs_goods_received_items WHERE grn_id = $1`, [grn.id]
      );
      if (!grnItems.length) continue;

      for (const item of grnItems) {
        const movementQty = item.qty_in_base_units || item.qty_received || 0;
        const movementType = grn.po_id ? 'goods_in' : 'goods_in_no_po';

        await client.query(`
          INSERT INTO mcogs_stock_movements
            (store_id, ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, created_by, created_at)
          VALUES ($1, $2, $3, $4, $5, 'grn', $6, $7, $8, NOW())
        `, [grn.store_id, item.ingredient_id, movementType, movementQty, item.unit_price || 0, grn.id, null, createdBy]);

        await client.query(`
          INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (store_id, ingredient_id)
          DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + $3, updated_at = NOW()
        `, [grn.store_id, item.ingredient_id, movementQty]);

        if (item.po_item_id) {
          await client.query(`
            UPDATE mcogs_purchase_order_items
            SET    qty_received = qty_received + $1
            WHERE  id = $2
          `, [item.qty_received || 0, item.po_item_id]);
        }
      }

      // Recalculate PO status if linked
      if (grn.po_id) {
        const { rows: poItems } = await client.query(`
          SELECT qty_ordered, qty_received
          FROM   mcogs_purchase_order_items
          WHERE  po_id = $1
        `, [grn.po_id]);

        const allReceived = poItems.every(pi => pi.qty_received >= pi.qty_ordered);
        const someReceived = poItems.some(pi => pi.qty_received > 0);
        const newStatus = allReceived ? 'received' : someReceived ? 'partial' : 'submitted';

        await client.query(`
          UPDATE mcogs_purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2
        `, [newStatus, grn.po_id]);
      }

      await client.query(`
        UPDATE mcogs_goods_received SET status = 'confirmed', updated_at = NOW() WHERE id = $1
      `, [grn.id]);

      confirmed.push(grnId);
    }

    await client.query('COMMIT');
    res.json({ confirmed: confirmed.length, ids: confirmed });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk confirm GRNs' } });
  } finally {
    client.release();
  }
});

// POST /goods-received/bulk-delete
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: { message: 'ids array is required' } });

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_goods_received WHERE id = ANY($1) AND status = 'draft'`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to bulk delete GRNs' } });
  }
});

module.exports = router;
