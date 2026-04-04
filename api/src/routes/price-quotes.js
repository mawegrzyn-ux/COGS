const router = require('express').Router();
const pool   = require('../db/pool');

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
    res.status(201).json(rows[0]);
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
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update price quote' } });
  }
});

// DELETE /price-quotes/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_price_quotes WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete price quote' } });
  }
});

module.exports = router;
