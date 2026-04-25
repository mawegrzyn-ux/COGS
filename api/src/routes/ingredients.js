const router = require('express').Router()
const pool   = require('../db/pool')
const { logAudit, diffFields } = require('../helpers/audit')

// GET /ingredients/stats — lightweight counts for header badges (no auth needed beyond the route guard)
router.get('/stats', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM mcogs_ingredients)                              AS ingredient_count,
        (SELECT COUNT(*)::int FROM mcogs_price_quotes WHERE is_active = true)      AS active_quote_count,
        (SELECT COUNT(*)::int FROM mcogs_vendors)                                  AS vendor_count,
        (SELECT COUNT(DISTINCT country_id)::int FROM mcogs_vendors)                AS country_count
    `)
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch inventory stats' } })
  }
})

// GET /ingredients/unquoted-in-recipes?menu_id=<id>
// Returns ingredients used in recipes that have NO active price quotes.
// Optional menu_id filter restricts to ingredients used in recipes that the
// menu serves (via mcogs_menu_sales_items → mcogs_sales_items.recipe_id).
// Combo recipes within sales items aren't traversed in v1 — direct recipe-type
// sales items only.
router.get('/unquoted-in-recipes', async (req, res) => {
  try {
    const { menu_id } = req.query
    const lang = req.language && req.language !== 'en' ? req.language : null
    const iName  = lang ? `COALESCE(i.translations->$2->>'name', i.name)` : `i.name`
    const cName  = lang ? `COALESCE(cat.translations->$2->>'name', cat.name)` : `cat.name`
    const rName  = lang ? `COALESCE(r.translations->$2->>'name', r.name)` : `r.name`

    // Bind params: $1 = menu_id (or null sentinel — handled via WHERE), $2 = lang (only when lang)
    // Build WHERE for the menu filter dynamically so the query stays simple
    // when no menu is selected.
    const params = []
    let paramIdx = 1
    let menuFilter = ''
    if (menu_id) {
      params.push(Number(menu_id))
      menuFilter = `AND r.id IN (
        SELECT si.recipe_id
        FROM   mcogs_menu_sales_items msi
        JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
        WHERE  msi.menu_id = $${paramIdx} AND si.recipe_id IS NOT NULL
      )`
      paramIdx++
    }
    if (lang) params.push(lang)

    const sql = `
      SELECT i.id,
             ${iName} AS name,
             u.abbreviation AS base_unit_abbr,
             ${cName} AS category_name,
             COUNT(DISTINCT r.id)::int AS recipe_count,
             ARRAY_AGG(DISTINCT ${rName} ORDER BY ${rName}) AS used_in_recipes
      FROM   mcogs_ingredients i
      JOIN   mcogs_recipe_items ri ON ri.ingredient_id = i.id AND ri.item_type = 'ingredient'
      JOIN   mcogs_recipes r ON r.id = ri.recipe_id
      LEFT JOIN mcogs_units      u   ON u.id  = i.base_unit_id
      LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
      WHERE NOT EXISTS (
        SELECT 1 FROM mcogs_price_quotes pq
        WHERE  pq.ingredient_id = i.id AND pq.is_active = TRUE
      )
      ${menuFilter}
      GROUP BY i.id, i.name, i.translations, u.abbreviation, cat.name, cat.translations
      ORDER BY ${iName} ASC
    `
    const { rows } = await pool.query(sql, params)
    if (lang) res.setHeader('Content-Language', lang)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch unquoted ingredients in recipes' } })
  }
})

// GET /ingredients?category_id=
// Returns ingredient name + category name resolved via translations JSONB when
// the request language (req.language) is non-English. Base column is the
// fallback if no translation exists.
router.get('/', async (req, res) => {
  try {
    const { category_id } = req.query
    const lang = req.language && req.language !== 'en' ? req.language : null

    // Build translation-aware SELECT expressions. When lang is null, skip the
    // COALESCE and use the base column directly — cheaper on the hot path.
    const iName = lang ? `COALESCE(i.translations->$LANG->>'name', i.name)` : `i.name`
    const iNotes = lang ? `COALESCE(i.translations->$LANG->>'notes', i.notes)` : `i.notes`
    const cName = lang ? `COALESCE(c.translations->$LANG->>'name', c.name)` : `c.name`

    const vals = []
    if (lang) vals.push(lang)
    let whereIdx = null
    if (category_id) { vals.push(category_id); whereIdx = vals.length }

    // Assemble the query with numbered placeholders
    const langIdx = lang ? 1 : null
    const substitutePlaceholders = (sql) => sql.replace(/\$LANG/g, `$${langIdx}`)

    let query = substitutePlaceholders(`
      SELECT i.id, ${iName} AS name, ${iNotes} AS notes,
             i.category_id, i.base_unit_id, i.waste_pct,
             i.default_prep_unit, i.default_prep_to_base_conversion,
             i.image_url, i.allergen_notes,
             i.translations,
             i.created_at, i.updated_at,
             u.name        AS base_unit_name,
             u.abbreviation AS base_unit_abbr,
             ${cName}       AS category_name,
             g.name         AS category_group_name,
             pq_stats.quote_count,
             pq_stats.active_quote_count
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units           u  ON u.id  = i.base_unit_id
      LEFT JOIN mcogs_categories      c  ON c.id  = i.category_id
      LEFT JOIN mcogs_category_groups g  ON g.id  = c.group_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int                                    AS quote_count,
               COUNT(*) FILTER (WHERE is_active = true)::int   AS active_quote_count
        FROM   mcogs_price_quotes
        WHERE  ingredient_id = i.id
      ) pq_stats ON true
    `)
    if (whereIdx) query += ` WHERE i.category_id = $${whereIdx}`
    query += ` ORDER BY name ASC`
    const { rows } = await pool.query(query, vals)
    if (lang) res.setHeader('Content-Language', lang)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to fetch ingredients' } })
  }
})

// GET /ingredients/:id
router.get('/:id', async (req, res) => {
  try {
    const lang = req.language && req.language !== 'en' ? req.language : null
    const iName = lang ? `COALESCE(i.translations->$2->>'name', i.name)` : `i.name`
    const iNotes = lang ? `COALESCE(i.translations->$2->>'notes', i.notes)` : `i.notes`
    const cName = lang ? `COALESCE(c.translations->$2->>'name', c.name)` : `c.name`

    const vals = [req.params.id]
    if (lang) vals.push(lang)

    const { rows } = await pool.query(`
      SELECT i.id, ${iName} AS name, ${iNotes} AS notes,
             i.category_id, i.base_unit_id, i.waste_pct,
             i.default_prep_unit, i.default_prep_to_base_conversion,
             i.image_url, i.allergen_notes,
             i.translations,
             i.created_at, i.updated_at,
             u.name          AS base_unit_name,
             u.abbreviation  AS base_unit_abbr,
             ${cName}        AS category_name,
             g.name          AS category_group_name
      FROM mcogs_ingredients i
      LEFT JOIN mcogs_units           u ON u.id = i.base_unit_id
      LEFT JOIN mcogs_categories      c ON c.id = i.category_id
      LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
      WHERE i.id = $1
    `, vals)
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } })
    if (lang) res.setHeader('Content-Language', lang)
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
    await logAudit(pool, req, {
      action: 'create', entity_type: 'ingredient', entity_id: full[0].id,
      entity_label: full[0].name,
      field_changes: { name: { old: null, new: full[0].name }, category: { old: null, new: full[0].category_name || null }, waste_pct: { old: null, new: full[0].waste_pct } },
      context: { source: 'manual' },
    })
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
    // Snapshot before update
    const { rows: [oldRow] } = await pool.query('SELECT * FROM mcogs_ingredients WHERE id=$1', [req.params.id])
    if (!oldRow) return res.status(404).json({ error: { message: 'Not found' } })

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

    const changes = diffFields(oldRow, rows[0], [
      'name', 'category_id', 'base_unit_id', 'default_prep_unit',
      'default_prep_to_base_conversion', 'waste_pct', 'image_url',
    ])
    if (changes) {
      await logAudit(pool, req, {
        action: 'update', entity_type: 'ingredient', entity_id: parseInt(req.params.id),
        entity_label: rows[0].name,
        field_changes: changes,
        context: { source: 'manual' },
      })
    }

    res.json(full[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: { message: 'Failed to update ingredient' } })
  }
})

// DELETE /ingredients/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT id, name FROM mcogs_ingredients WHERE id=$1', [req.params.id])
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_ingredients WHERE id=$1`, [req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } })

    if (old) {
      await logAudit(pool, req, {
        action: 'delete', entity_type: 'ingredient', entity_id: old.id,
        entity_label: old.name,
        context: { source: 'manual' },
      })
    }
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
