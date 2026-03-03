const router = require('express').Router();
const pool   = require('../db/pool');

// GET /categories?type=ingredient|recipe
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    let query = `SELECT * FROM mcogs_categories`;
    const vals = [];
    if (type) { query += ` WHERE type = $1`; vals.push(type); }
    query += ` ORDER BY group_name ASC, sort_order ASC, name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch categories' } });
  }
});

// POST /categories
router.post('/', async (req, res) => {
  const { name, type, group_name, sort_order } = req.body;
  if (!name || !type)
    return res.status(400).json({ error: { message: 'name and type are required' } });
  if (!['ingredient', 'recipe'].includes(type))
    return res.status(400).json({ error: { message: 'type must be ingredient or recipe' } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_categories (name, type, group_name, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), type, group_name?.trim() || 'Unassigned', sort_order ?? 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create category' } });
  }
});

// PUT /categories/:id
router.put('/:id', async (req, res) => {
  const { name, group_name, sort_order } = req.body;
  if (!name)
    return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_categories
       SET name=$1, group_name=$2, sort_order=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [name.trim(), group_name?.trim() || 'Unassigned', sort_order ?? 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update category' } });
  }
});

// DELETE /categories/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_categories WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete category' } });
  }
});

module.exports = router;
