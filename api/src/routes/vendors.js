const router = require('express').Router();
const pool   = require('../db/pool');

// GET /vendors?country_id=
router.get('/', async (req, res) => {
  try {
    const { country_id } = req.query;
    let query = `
      SELECT v.*, c.name as country_name, c.currency_code, c.currency_symbol
      FROM mcogs_vendors v
      LEFT JOIN mcogs_countries c ON c.id = v.country_id
    `;
    const vals = [];
    if (country_id) { query += ` WHERE v.country_id = $1`; vals.push(country_id); }
    query += ` ORDER BY v.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch vendors' } });
  }
});

// GET /vendors/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*, c.name as country_name, c.currency_code, c.currency_symbol
      FROM mcogs_vendors v
      LEFT JOIN mcogs_countries c ON c.id = v.country_id
      WHERE v.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch vendor' } });
  }
});

// POST /vendors
router.post('/', async (req, res) => {
  const { name, country_id, contact, email, phone, notes } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_vendors (name, country_id, contact, email, phone, notes)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [name.trim(), country_id || null, contact?.trim() || null, email?.trim() || null, phone?.trim() || null, notes?.trim() || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create vendor' } });
  }
});

// PUT /vendors/:id
router.put('/:id', async (req, res) => {
  const { name, country_id, contact, email, phone, notes } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_vendors
      SET name=$1, country_id=$2, contact=$3, email=$4, phone=$5, notes=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [name.trim(), country_id || null, contact?.trim() || null, email?.trim() || null, phone?.trim() || null, notes?.trim() || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update vendor' } });
  }
});

// DELETE /vendors/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_vendors WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).send();
  } catch (err) {
    // FK violation — vendor has price quotes
    if (err.code === '23503') {
      return res.status(409).json({ error: { message: 'Cannot delete vendor with existing price quotes. Remove quotes first.' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete vendor' } });
  }
});

module.exports = router;
