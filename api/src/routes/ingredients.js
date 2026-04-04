const router = require('express').Router()
const pool   = require('../db/pool')

// GET /ingredients?category_id=
router.get('/', async (req, res) => {
  try {
    const { category_id } = req.query
    let query = `
      SELECT i.*,
             u.name          AS base_unit_name,
             u.abbreviation  AS base_unit_abbr,
             c.name          AS category_name,
             g.name          AS category_group_name,
             COUNT(DISTINCT pq.id)                              AS quote_count,
             COUNT(DISTINCT CASE WHEN pq.is_active THEN pq.id END) AS active_quote_count
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units             u  ON u.id = i.base_unit_id
      LEFT JOIN mcogs_categories        c  ON c.id = i.category_id
      LEFT JOIN mcogs_category_groups   g  ON g.id = c.group_id
      LEFT JOIN mcogs_price_quotes      pq ON pq.ingredient_id = i.id
    `
    const vals = []
    if (category_id) { query += ` WHERE i.category_id = $1`; vals.push(category_id) }
    query += ` GROUP BY i.id, u.name, u.abbreviation, c.name, g.name ORDER BY i.name ASC`
    const { rows } = await pool.query(query, vals)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch ingredients' } })
  }
})

// GET /ingredients/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*,
             u.name          AS base_unit_name,
             u.abbreviation  AS base_unit_abbr,
             c.name          AS category_name,
             g.name          AS category_group_name
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units           u ON u.id = i.base_unit_id
      LEFT JOIN mcogs_categories      c ON c.id = i.category_id
      LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE i.id = $1
    `, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch ingredient' } })
  }
})

// POST /ingredients
router.post('/', async (req, res) => {
  const { name, category_id, base_unit_id, default_prep_unit, default_prep_to_base_conversion, notes, image_url, waste_pct } = req.body
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } })
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_ingredients
        (name, category_id, base_unit_id, default_prep_unit, default_prep_to_base_conversion, notes, image_url, waste_pct)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [
      name.trim(),
      category_id                     || null,
      base_unit_id                    || null,
      default_prep_unit?.trim()       || null,
      default_prep_to_base_conversion || 1,
      notes?.trim()                   || null,
      image_url?.trim()               || null,
      waste_pct                       || 0,
    ])
    // Return with category info joined
    const { rows: full } = await pool.query(`
      SELECT i.*, u.name AS base_unit_name, u.abbreviation AS base_unit_abbr,
             c.name AS category_name, g.name AS category_group_name
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      LEFT JOIN mcogs_categories c ON c.id = i.category_id
      LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE i.id = $1`, [rows[0].id])
    res.status(201).json(full[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to create ingredient' } })
  }
})

// PUT /ingredients/:id
router.put('/:id', async (req, res) => {
  const { name, category_id, base_unit_id, default_prep_unit, default_prep_to_base_conversion, notes, image_url, waste_pct } = req.body
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } })
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_ingredients
      SET name=$1, category_id=$2, base_unit_id=$3, default_prep_unit=$4,
          default_prep_to_base_conversion=$5, notes=$6, image_url=$7, waste_pct=$8, updated_at=NOW()
      WHERE id=$9 RETURNING *
    `, [
      name.trim(),
      category_id                     || null,
      base_unit_id                    || null,
      default_prep_unit?.trim()       || null,
      default_prep_to_base_conversion || 1,
      notes?.trim()                   || null,
      image_url?.trim()               || null,
      waste_pct                       || 0,
      req.params.id,
    ])
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } })
    const { rows: full } = await pool.query(`
      SELECT i.*, u.name AS base_unit_name, u.abbreviation AS base_unit_abbr,
             c.name AS category_name, g.name AS category_group_name
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
      LEFT JOIN mcogs_categories c ON c.id = i.category_id
      LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE i.id = $1`, [rows[0].id])
    res.json(full[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to update ingredient' } })
  }
})

// DELETE /ingredients/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_ingredients WHERE id=$1`, [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } })
    res.status(204).send()
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: { message: 'Cannot delete ingredient with existing price quotes or recipe usage. Remove those first.' } })
    }
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to delete ingredient' } })
  }
})

module.exports = router
