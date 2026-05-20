const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

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
    logAudit(pool, req, { action: 'create', entity_type: 'location_group', entity_id: rows[0].id, entity_label: rows[0].name });
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
    const { rows: oldRows } = await pool.query(`SELECT * FROM mcogs_location_groups WHERE id=$1`, [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_location_groups SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [name.trim(), description?.trim() || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'location_group', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(oldRows[0], rows[0], ['name', 'description']) });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update location group' } });
  }
});

// DELETE /location-groups/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: old } = await pool.query(`SELECT * FROM mcogs_location_groups WHERE id=$1`, [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_location_groups WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'location_group', entity_id: Number(req.params.id), entity_label: old[0]?.name || `id:${req.params.id}` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete location group' } });
  }
});

module.exports = router;
