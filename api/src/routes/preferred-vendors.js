const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// GET /preferred-vendors?ingredient_id=&country_id=
router.get('/', async (req, res) => {
  try {
    const { ingredient_id, country_id } = req.query;
    const conditions = [];
    const vals = [];
    let i = 1;

    if (ingredient_id) { conditions.push(`pv.ingredient_id = $${i++}`); vals.push(ingredient_id); }
    if (country_id)    { conditions.push(`pv.country_id = $${i++}`);    vals.push(country_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT
        pv.*,
        ing.name       as ingredient_name,
        v.name         as vendor_name,
        c.name         as country_name,
        c.currency_code,
        pq.purchase_price,
        pq.qty_in_base_units,
        pq.purchase_unit,
        CASE WHEN pq.qty_in_base_units > 0
             THEN ROUND(pq.purchase_price / pq.qty_in_base_units, 6)
             ELSE NULL
        END            as price_per_base_unit
      FROM mcogs_ingredient_preferred_vendor pv
      JOIN mcogs_ingredients ing ON ing.id = pv.ingredient_id
      JOIN mcogs_vendors v       ON v.id   = pv.vendor_id
      JOIN mcogs_countries c     ON c.id   = pv.country_id
      JOIN mcogs_price_quotes pq ON pq.id  = pv.quote_id
      ${where}
      ORDER BY ing.name ASC, c.name ASC
    `, vals);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch preferred vendors' } });
  }
});

// POST /preferred-vendors  (upsert — one preferred per ingredient+country)
router.post('/', async (req, res) => {
  const { ingredient_id, country_id, vendor_id, quote_id } = req.body;
  if (!ingredient_id) return res.status(400).json({ error: { message: 'ingredient_id is required' } });
  if (!country_id)    return res.status(400).json({ error: { message: 'country_id is required' } });
  if (!vendor_id)     return res.status(400).json({ error: { message: 'vendor_id is required' } });
  if (!quote_id)      return res.status(400).json({ error: { message: 'quote_id is required' } });
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_ingredient_preferred_vendor
        (ingredient_id, country_id, vendor_id, quote_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (ingredient_id, country_id)
      DO UPDATE SET vendor_id=$3, quote_id=$4, updated_at=NOW()
      RETURNING *
    `, [ingredient_id, country_id, vendor_id, quote_id]);
    logAudit(pool, req, { action: 'create', entity_type: 'preferred_vendor', entity_id: rows[0].id, entity_label: `ingredient:${ingredient_id} country:${country_id}` });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to set preferred vendor' } });
  }
});

// DELETE /preferred-vendors/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_ingredient_preferred_vendor WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'preferred_vendor', entity_id: Number(req.params.id), entity_label: `id:${req.params.id}` });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete preferred vendor' } });
  }
});

// DELETE /preferred-vendors/by-ingredient/:ingredient_id/country/:country_id
router.delete('/by-ingredient/:ingredient_id/country/:country_id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM mcogs_ingredient_preferred_vendor
       WHERE ingredient_id=$1 AND country_id=$2`,
      [req.params.ingredient_id, req.params.country_id]
    );
    logAudit(pool, req, { action: 'delete', entity_type: 'preferred_vendor', entity_id: null, entity_label: `ingredient:${req.params.ingredient_id} country:${req.params.country_id}` });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to remove preferred vendor' } });
  }
});

module.exports = router;
