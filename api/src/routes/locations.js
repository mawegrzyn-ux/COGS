const router = require('express').Router();
const pool   = require('../db/pool');

// GET /locations?market_id=&group_id=&active=
router.get('/', async (req, res) => {
  try {
    const { market_id, group_id, active } = req.query;
    let query = `
      SELECT l.*,
             c.name        AS market_name,
             c.country_iso AS market_iso,
             c.currency_code,
             g.name        AS group_name
      FROM   mcogs_locations l
      LEFT JOIN mcogs_countries       c ON c.id = l.country_id
      LEFT JOIN mcogs_location_groups g ON g.id = l.group_id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (market_id)       { query += ` AND l.country_id = $${p++}`;   vals.push(market_id); }
    if (group_id)        { query += ` AND l.group_id = $${p++}`;     vals.push(group_id); }
    if (active === 'true')  query += ` AND l.is_active = TRUE`;
    if (active === 'false') query += ` AND l.is_active = FALSE`;
    query += ` ORDER BY l.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch locations' } });
  }
});

// GET /locations/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.*,
             c.name        AS market_name,
             c.country_iso AS market_iso,
             c.currency_code,
             g.name        AS group_name
      FROM   mcogs_locations l
      LEFT JOIN mcogs_countries       c ON c.id = l.country_id
      LEFT JOIN mcogs_location_groups g ON g.id = l.group_id
      WHERE  l.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch location' } });
  }
});

// POST /locations
router.post('/', async (req, res) => {
  const {
    name, country_id, group_id,
    address, email, phone,
    contact_name, contact_email, contact_phone,
    is_active,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_locations
        (name, country_id, group_id, address, email, phone,
         contact_name, contact_email, contact_phone, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      name.trim(),
      country_id   || null,
      group_id     || null,
      address?.trim()       || null,
      email?.trim()         || null,
      phone?.trim()         || null,
      contact_name?.trim()  || null,
      contact_email?.trim() || null,
      contact_phone?.trim() || null,
      is_active !== false,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create location' } });
  }
});

// PUT /locations/:id
router.put('/:id', async (req, res) => {
  const {
    name, country_id, group_id,
    address, email, phone,
    contact_name, contact_email, contact_phone,
    is_active,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_locations
      SET    name=$1, country_id=$2, group_id=$3, address=$4, email=$5, phone=$6,
             contact_name=$7, contact_email=$8, contact_phone=$9, is_active=$10,
             updated_at=NOW()
      WHERE  id=$11
      RETURNING *
    `, [
      name.trim(),
      country_id   || null,
      group_id     || null,
      address?.trim()       || null,
      email?.trim()         || null,
      phone?.trim()         || null,
      contact_name?.trim()  || null,
      contact_email?.trim() || null,
      contact_phone?.trim() || null,
      is_active !== false,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update location' } });
  }
});

// DELETE /locations/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_locations WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: { message: 'Cannot delete location that has equipment assigned. Remove equipment first.' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete location' } });
  }
});

module.exports = router;
