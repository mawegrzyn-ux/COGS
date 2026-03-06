const router = require('express').Router();
const pool   = require('../db/pool');

// GET /location-groups
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, COUNT(l.id)::int AS location_count
      FROM   mcogs_location_groups g
      LEFT JOIN mcogs_locations l ON l.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch location groups' } });
  }
});

// POST /location-groups
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_location_groups (name, description) VALUES ($1, $2) RETURNING *`,
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create location group' } });
  }
});

// PUT /location-groups/:id
router.put('/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_location_groups SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [name.trim(), description?.trim() || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update location group' } });
  }
});

// DELETE /location-groups/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_location_groups WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete location group' } });
  }
});

module.exports = router;
