const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')

// GET /category-groups — list all groups with category count
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.id, g.name, g.sort_order,
             COUNT(c.id)::int AS category_count
      FROM mcogs_category_groups g
      LEFT JOIN mcogs_categories c ON c.group_id = g.id
      GROUP BY g.id
      ORDER BY g.sort_order ASC, g.name ASC
    `)
    res.json(rows)
  } catch (err) {
    console.error('GET /category-groups', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /category-groups — create
router.post('/', async (req, res) => {
  const { name, sort_order = 0 } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_category_groups (name, sort_order)
       VALUES ($1, $2) RETURNING *`,
      [name.trim(), sort_order]
    )
    res.status(201).json({ ...rows[0], category_count: 0 })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists.' })
    console.error('POST /category-groups', err)
    res.status(500).json({ error: err.message })
  }
})

// PUT /category-groups/:id — rename / reorder
router.put('/:id', async (req, res) => {
  const { name, sort_order } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_category_groups
       SET name=$1, sort_order=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [name.trim(), sort_order ?? 0, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    // Re-fetch with count
    const { rows: full } = await pool.query(`
      SELECT g.*, COUNT(c.id)::int AS category_count
      FROM mcogs_category_groups g
      LEFT JOIN mcogs_categories c ON c.group_id = g.id
      WHERE g.id = $1 GROUP BY g.id`, [rows[0].id])
    res.json(full[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists.' })
    console.error('PUT /category-groups/:id', err)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /category-groups/:id — removes group; categories become ungrouped (group_id = NULL via FK)
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_category_groups WHERE id=$1`, [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('DELETE /category-groups/:id', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
