const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /price-quotes?ingredient_id=&vendor_id=&country_id=&is_active=
router.get('/', async (req, res) => {
  try {
    const { ingredient_id, vendor_id, country_id, is_active } = req.query;
    const conditions = [];
    const vals = [];
    let i = 1;

    if (ingredient_id) { conditions.push(`pq.ingredient_id = $${i++}`); vals.push(ingredient_id); }
    if (vendor_id)     { conditions.push(`pq.vendor_id = $${i++}`);     vals.push(vendor_id); }
    if (country_id)    { conditions.push(`v.country_id = $${i++}`);     vals.push(country_id); }
    if (is_active !== undefined && is_active !== '') {
      conditions.push(`pq.is_active = $${i++}`);
      vals.push(is_active === 'true' || is_active === '1');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT
        pq.*,
        ing.name                            as ingredient_name,
        cat.name                            as ingredient_category,
        u.name                              as base_unit_name,
        u.abbreviation                      as base_unit_abbr,
        v.name                              as vendor_name,
        v.country_id,
        c.name                              as country_name,
        c.currency_code,
        c.currency_symbol,
        CASE WHEN pq.qty_in_base_units > 0
             THEN ROUND(pq.purchase_price / pq.qty_in_base_units, 6)
             ELSE NULL
        END                                 as price_per_base_unit,
        pref.id IS NOT NULL                 as is_preferred
      FROM mcogs_price_quotes pq
      JOIN mcogs_ingredients ing ON ing.id = pq.ingredient_id
      LEFT JOIN mcogs_categories cat ON cat.id = ing.category_id
      LEFT JOIN mcogs_units u    ON u.id   = ing.base_unit_id
      JOIN mcogs_vendors v       ON v.id   = pq.vendor_id
      JOIN mcogs_countries c     ON c.id   = v.country_id
      LEFT JOIN mcogs_ingredient_preferred_vendor pref
             ON pref.quote_id = pq.id
      ${where}
      ORDER BY ing.name ASC, c.name ASC, pq.is_active DESC, price_per_base_unit ASC
    `, vals);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch price quotes' } });
  }
});

// GET /price-quotes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pq.*,
             ing.name          as ingredient_name,
             u.abbreviation    as base_unit_abbr,
             v.name            as vendor_name,
             v.country_id,
             c.name            as country_name,
             c.currency_code,
             c.currency_symbol,
             CASE WHEN pq.qty_in_base_units > 0
                  THEN ROUND(pq.purchase_price / pq.qty_in_base_units, 6)
                  ELSE NULL
             END               as price_per_base_unit
      FROM mcogs_price_quotes pq
      JOIN mcogs_ingredients ing ON ing.id = pq.ingredient_id
      LEFT JOIN mcogs_units u    ON u.id   = ing.base_unit_id
      JOIN mcogs_vendors v       ON v.id   = pq.vendor_id
      JOIN mcogs_countries c     ON c.id   = v.country_id
      WHERE pq.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch price quote' } });
  }
});

// POST /price-quotes
router.post('/', async (req, res) => {
  const { ingredient_id, vendor_id, purchase_price, qty_in_base_units, purchase_unit, is_active, vendor_product_code } = req.body;
  if (!ingredient_id)               return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (!vendor_id)                   return res.status(400).json({ error: { message: 'vendor_id is required' } });
  if (purchase_price == null)       return res.status(400).json({ error: { message: 'purchase_price is required' } });
  if (!qty_in_base_units)           return res.status(400).json({ error: { message: 'qty_in_base_units is required' } });
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_price_quotes
        (ingredient_id, vendor_id, purchase_price, qty_in_base_units, purchase_unit, is_active, vendor_product_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [
      ingredient_id,
      vendor_id,
      purchase_price,
      qty_in_base_units,
      purchase_unit?.trim()        || null,
      is_active !== false && is_active !== 'false',
      vendor_product_code?.trim()  || null,
    ]);
    const created = rows[0];

    // Audit: look up names for label
    const { rows: meta } = await pool.query(
      `SELECT i.name AS ingredient_name, v.name AS vendor_name
       FROM mcogs_ingredients i, mcogs_vendors v
       WHERE i.id=$1 AND v.id=$2`, [ingredient_id, vendor_id]
    );
    const label = meta[0] ? `${meta[0].ingredient_name} — ${meta[0].vendor_name}` : `Quote #${created.id}`;
    await logAudit(pool, req, {
      action: 'create',
      entity_type: 'price_quote',
      entity_id: created.id,
      entity_label: label,
      field_changes: { purchase_price: { old: null, new: purchase_price }, qty_in_base_units: { old: null, new: qty_in_base_units }, is_active: { old: null, new: created.is_active } },
      context: { source: 'manual' },
    });

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create price quote' } });
  }
});

// PUT /price-quotes/:id
router.put('/:id', async (req, res) => {
  const { ingredient_id, vendor_id, purchase_price, qty_in_base_units, purchase_unit, is_active, vendor_product_code } = req.body;
  if (!ingredient_id)         return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (!vendor_id)             return res.status(400).json({ error: { message: 'vendor_id is required' } });
  if (purchase_price == null) return res.status(400).json({ error: { message: 'purchase_price is required' } });
  if (!qty_in_base_units)     return res.status(400).json({ error: { message: 'qty_in_base_units is required' } });
  try {
    // Snapshot before update for diff
    const { rows: [oldRow] } = await pool.query('SELECT * FROM mcogs_price_quotes WHERE id=$1', [req.params.id]);
    if (!oldRow) return res.status(404).json({ error: { message: 'Not found' } });

    const { rows } = await pool.query(`
      UPDATE mcogs_price_quotes
      SET ingredient_id=$1, vendor_id=$2, purchase_price=$3, qty_in_base_units=$4,
          purchase_unit=$5, is_active=$6, vendor_product_code=$7, updated_at=NOW()
      WHERE id=$8 RETURNING *
    `, [
      ingredient_id,
      vendor_id,
      purchase_price,
      qty_in_base_units,
      purchase_unit?.trim()       || null,
      is_active !== false && is_active !== 'false',
      vendor_product_code?.trim() || null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });

    const changes = diffFields(oldRow, rows[0], [
      'purchase_price', 'qty_in_base_units', 'purchase_unit', 'is_active',
      'vendor_product_code', 'ingredient_id', 'vendor_id',
    ]);
    if (changes) {
      const { rows: meta } = await pool.query(
        `SELECT i.name AS ingredient_name, v.name AS vendor_name
         FROM mcogs_ingredients i, mcogs_vendors v
         WHERE i.id=$1 AND v.id=$2`, [ingredient_id, vendor_id]
      );
      const label = meta[0] ? `${meta[0].ingredient_name} — ${meta[0].vendor_name}` : `Quote #${req.params.id}`;
      await logAudit(pool, req, {
        action: 'update',
        entity_type: 'price_quote',
        entity_id: parseInt(req.params.id),
        entity_label: label,
        field_changes: changes,
        context: { source: 'manual' },
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update price quote' } });
  }
});

// DELETE /price-quotes/:id
router.delete('/:id', async (req, res) => {
  try {
    // Snapshot before delete for audit
    const { rows: [old] } = await pool.query(`
      SELECT pq.*, i.name AS ingredient_name, v.name AS vendor_name
      FROM mcogs_price_quotes pq
      LEFT JOIN mcogs_ingredients i ON i.id = pq.ingredient_id
      LEFT JOIN mcogs_vendors v ON v.id = pq.vendor_id
      WHERE pq.id=$1`, [req.params.id]);

    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_price_quotes WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });

    if (old) {
      await logAudit(pool, req, {
        action: 'delete',
        entity_type: 'price_quote',
        entity_id: parseInt(req.params.id),
        entity_label: `${old.ingredient_name} — ${old.vendor_name}`,
        field_changes: { purchase_price: { old: old.purchase_price, new: null }, is_active: { old: old.is_active, new: null } },
        context: { source: 'manual' },
      });
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete price quote' } });
  }
});

module.exports = router;
