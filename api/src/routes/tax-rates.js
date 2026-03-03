const router  = require('express').Router();
const { pool } = require('../db');

// GET /tax-rates  (?country_id=X optional)
router.get('/', async (req, res) => {
  try {
    const { country_id } = req.query;
    let query = `SELECT t.*, c.name AS country_name
                 FROM mcogs_country_tax_rates t
                 JOIN mcogs_countries c ON c.id = t.country_id`;
    const vals = [];
    if (country_id) { query += ` WHERE t.country_id = $1`; vals.push(country_id); }
    query += ` ORDER BY c.name ASC, t.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch tax rates' } });
  }
});

// POST /tax-rates
router.post('/', async (req, res) => {
  const { country_id, name, rate } = req.body;
  if (!country_id || !name || rate == null)
    return res.status(400).json({ error: { message: 'country_id, name and rate are required' } });
  if (Number(rate) < 0)
    return res.status(400).json({ error: { message: 'rate must be 0 or greater' } });
  try {
    // First rate for a country auto-becomes default
    const { rows: existing } = await pool.query(
      `SELECT id FROM mcogs_country_tax_rates WHERE country_id=$1`, [country_id]
    );
    const isDefault = existing.length === 0;
    const { rows } = await pool.query(
      `INSERT INTO mcogs_country_tax_rates (country_id, name, rate, is_default)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [country_id, name.trim(), rate, isDefault]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create tax rate' } });
  }
});

// PUT /tax-rates/:id
router.put('/:id', async (req, res) => {
  const { name, rate } = req.body;
  if (!name || rate == null)
    return res.status(400).json({ error: { message: 'name and rate are required' } });
  if (Number(rate) < 0)
    return res.status(400).json({ error: { message: 'rate must be 0 or greater' } });
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_country_tax_rates SET name=$1, rate=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [name.trim(), rate, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update tax rate' } });
  }
});

// PATCH /tax-rates/:id/set-default
router.patch('/:id/set-default', async (req, res) => {
  const { country_id } = req.body;
  if (!country_id)
    return res.status(400).json({ error: { message: 'country_id is required' } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE mcogs_country_tax_rates SET is_default=FALSE, updated_at=NOW() WHERE country_id=$1`,
      [country_id]
    );
    const { rows } = await client.query(
      `UPDATE mcogs_country_tax_rates SET is_default=TRUE, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    await client.query('COMMIT');
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to set default tax rate' } });
  } finally {
    client.release();
  }
});

// DELETE /tax-rates/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_country_tax_rates WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete tax rate' } });
  }
});

module.exports = router;
