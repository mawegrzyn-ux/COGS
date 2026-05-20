const router = require('express').Router()
const pool   = require('../db/pool')
const { logAudit, diffFields } = require('../helpers/audit')
const { getLangContext, setContentLanguage } = require('../helpers/translate')

// GET /categories
//   ?for_ingredients=true   filter to ingredient-scoped categories
//   ?for_recipes=true        filter to recipe-scoped categories
//   ?for_sales_items=true    filter to sales-item-scoped categories
//   (multiple flags may be combined with OR: ?for_recipes=true&for_sales_items=true)
router.get('/', async (req, res) => {
  try {
    const { for_ingredients, for_recipes, for_sales_items } = req.query
    const conditions = []
    if (for_ingredients === 'true') conditions.push('c.for_ingredients = TRUE')
    if (for_recipes     === 'true') conditions.push('c.for_recipes = TRUE')
    if (for_sales_items === 'true') conditions.push('c.for_sales_items = TRUE')

    const where = conditions.length ? `WHERE (${conditions.join(' OR ')})` : ''

    const { lang, active, params } = getLangContext(req)
    const cName = active ? `COALESCE(c.translations->$1->>'name', c.name)` : `c.name`

    const { rows } = await pool.query(`
      SELECT c.id, ${cName} AS name, c.sort_order,
             c.for_ingredients, c.for_recipes, c.for_sales_items,
             c.group_id, c.translations,
             g.name AS group_name
      FROM mcogs_categories c
      LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      ${where}
      ORDER BY g.name ASC NULLS LAST, c.sort_order ASC, name ASC
    `, params)
    setContentLanguage(res, req)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch categories' } })
  }
})

// POST /categories/reorder — bulk update group_id + sort_order for drag-drop.
// Body: [ { id, group_id: number|null, sort_order: integer }, ... ]
//
// Wrapped in a single transaction so a partial failure rolls back — prevents
// the list appearing half-reordered if one row errors.
router.post('/reorder', async (req, res) => {
  const updates = Array.isArray(req.body) ? req.body : []
  if (!updates.length) return res.json({ ok: true, updated: 0 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const u of updates) {
      const id = Number(u.id)
      if (!Number.isFinite(id)) continue
      const groupId   = u.group_id == null ? null : Number(u.group_id)
      const sortOrder = Number.isFinite(Number(u.sort_order)) ? Number(u.sort_order) : 0
      await client.query(
        `UPDATE mcogs_categories SET group_id = $1, sort_order = $2, updated_at = NOW() WHERE id = $3`,
        [groupId, sortOrder, id]
      )
    }
    await client.query('COMMIT')
    logAudit(pool, req, { action: 'update', entity_type: 'category', entity_id: 0, entity_label: 'reorder', context: { count: updates.length } })
    res.json({ ok: true, updated: updates.length })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[categories/reorder]', err)
    res.status(500).json({ error: { message: 'Failed to reorder categories' } })
  } finally {
    client.release()
  }
})

// POST /categories
router.post('/', async (req, res) => {
  const { name, group_id, for_ingredients = false, for_recipes = false, for_sales_items = false, sort_order = 0 } = req.body
  if (!name?.trim())
    return res.status(400).json({ error: { message: 'name is required' } })
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_categories (name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), group_id || null, !!for_ingredients, !!for_recipes, !!for_sales_items, sort_order]
    )
    // Return with group_name joined
    const { rows: full } = await pool.query(`
      SELECT c.*, g.name AS group_name
      FROM mcogs_categories c LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE c.id = $1`, [rows[0].id])
    logAudit(pool, req, { action: 'create', entity_type: 'category', entity_id: rows[0].id, entity_label: rows[0].name })
    res.status(201).json(full[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to create category' } })
  }
})

// PUT /categories/:id
router.put('/:id', async (req, res) => {
  const { name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order } = req.body
  if (!name?.trim())
    return res.status(400).json({ error: { message: 'name is required' } })
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_categories WHERE id=$1', [req.params.id])
    const { rows } = await pool.query(
      `UPDATE mcogs_categories
       SET name=$1, group_id=$2, for_ingredients=$3, for_recipes=$4, for_sales_items=$5,
           sort_order=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [name.trim(), group_id || null, !!for_ingredients, !!for_recipes, !!for_sales_items,
       sort_order ?? 0, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } })
    const { rows: full } = await pool.query(`
      SELECT c.*, g.name AS group_name
      FROM mcogs_categories c LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE c.id = $1`, [rows[0].id])
    logAudit(pool, req, { action: 'update', entity_type: 'category', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'group_id', 'for_ingredients', 'for_recipes', 'for_sales_items']) })
    res.json(full[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to update category' } })
  }
})

// DELETE /categories/:id
// ON DELETE SET NULL on category_id FKs means ingredients/recipes/sales_items become uncategorised automatically
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_categories WHERE id=$1', [req.params.id])
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_categories WHERE id=$1`, [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } })
    logAudit(pool, req, { action: 'delete', entity_type: 'category', entity_id: old?.id, entity_label: old?.name })
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to delete category' } })
  }
})

module.exports = router
