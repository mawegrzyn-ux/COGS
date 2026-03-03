const router  = require('express').Router();
const { pool } = require('../db');

// GET /country-level-tax
router.get('/', async (req, res) => {
  try {
    const { country_id } = req.query;
    let query = `SELECT * FROM mcogs_country_level_tax`;
    const vals = [];
    if (country_id) { query += ` WHERE country_id=$1`; vals.push(country_id); }
    query += ` ORDER BY country_id ASC, price_level_id ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch country level tax' } });
  }
});

// POST /country-level-tax  (upsert)
// If tax_rate_id is null/empty, removes the mapping
router.post('/', async (req, res) => {
  const { country_id, price_level_id, tax_rate_id } = req.body;
  if (!country_id || !price_level_id)
    return res.status(400).json({ error: { message: 'country_id and price_level_id are required' } });

  try {
    if (!tax_rate_id) {
      // Remove mapping
      await pool.query(
        `DELETE FROM mcogs_country_level_tax WHERE country_id=$1 AND price_level_id=$2`,
        [country_id, price_level_id]
      );
      return res.status(204).send();
    }

    // Upsert
    const { rows } = await pool.query(
      `INSERT INTO mcogs_country_level_tax (country_id, price_level_id, tax_rate_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (country_id, price_level_id)
       DO UPDATE SET tax_rate_id=$3, updated_at=NOW()
       RETURNING *`,
      [country_id, price_level_id, tax_rate_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save country level tax' } });
  }
});

// DELETE /country-level-tax/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_country_level_tax WHERE id=$1`, [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete mapping' } });
  }
});

module.exports = router;
