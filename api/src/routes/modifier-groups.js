// =============================================================================
// Modifier Groups — global reusable groups with options
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// ─── GET /modifier-groups ─────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT mg.*,
              (SELECT COUNT(*) FROM mcogs_modifier_options WHERE modifier_group_id = mg.id) AS option_count
       FROM   mcogs_modifier_groups mg
       ORDER BY mg.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /modifier-groups/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: groups } = await pool.query(
      'SELECT * FROM mcogs_modifier_groups WHERE id=$1', [req.params.id]
    );
    if (!groups.length) return res.status(404).json({ error: { message: 'Modifier group not found' } });

    const { rows: options } = await pool.query(
      `SELECT mo.*,
              r.name           AS recipe_name,
              r.yield_qty      AS recipe_yield_qty,
              u_r.abbreviation AS recipe_yield_unit_abbr,
              ing.name         AS ingredient_name,
              u_i.abbreviation AS ingredient_unit_abbr
       FROM   mcogs_modifier_options mo
       LEFT JOIN mcogs_recipes     r   ON r.id   = mo.recipe_id
       LEFT JOIN mcogs_units       u_r ON u_r.id = r.yield_unit_id
       LEFT JOIN mcogs_ingredients ing ON ing.id = mo.ingredient_id
       LEFT JOIN mcogs_units       u_i ON u_i.id = ing.base_unit_id
       WHERE  mo.modifier_group_id=$1 ORDER BY mo.sort_order, mo.id`,
      [req.params.id]
    );
    res.json({ ...groups[0], options });
  } catch (err) { next(err); }
});

// ─── POST /modifier-groups ────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, display_name, description, min_select, max_select, allow_repeat_selection } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_modifier_groups (name, display_name, description, min_select, max_select, allow_repeat_selection)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), display_name || null, description || null, min_select ?? 0, max_select ?? 1, allow_repeat_selection ?? false]
    );
    res.status(201).json({ ...rows[0], options: [] });
  } catch (err) { next(err); }
});

// ─── PUT /modifier-groups/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { name, display_name, description, min_select, max_select, allow_repeat_selection } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_modifier_groups SET name=$1, display_name=$2, description=$3, min_select=$4, max_select=$5, allow_repeat_selection=$6
       WHERE id=$7 RETURNING *`,
      [name?.trim(), display_name || null, description || null, min_select ?? 0, max_select ?? 1, allow_repeat_selection ?? false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Modifier group not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /modifier-groups/:id ──────────────────────────────────────────────
// Returns 409 if referenced in any junction table unless ?force=true
router.delete('/:id', async (req, res, next) => {
  try {
    const force = req.query.force === 'true';

    if (!force) {
      // Check for references in junction tables
      const { rows: siRefs } = await pool.query(
        `SELECT si.name FROM mcogs_sales_item_modifier_groups simgj
         JOIN   mcogs_sales_items si ON si.id = simgj.sales_item_id
         WHERE  simgj.modifier_group_id=$1 LIMIT 5`,
        [req.params.id]
      );
      const { rows: optRefs } = await pool.query(
        `SELECT si.name FROM mcogs_combo_step_option_modifier_groups csomgj
         JOIN   mcogs_combo_steps cs ON cs.id = (SELECT combo_step_id FROM mcogs_combo_step_options WHERE id = csomgj.combo_step_option_id)
         JOIN   mcogs_sales_items si ON si.id = cs.sales_item_id
         WHERE  csomgj.modifier_group_id=$1 LIMIT 5`,
        [req.params.id]
      );
      const refs = [...siRefs, ...optRefs].map(r => r.name);
      if (refs.length) {
        return res.status(409).json({
          error: {
            message: `Modifier group is used by ${refs.length} Sales Item(s): ${refs.join(', ')}. Use ?force=true to remove all assignments.`,
            referenced_by: refs,
          },
        });
      }
    }

    // Remove junction rows if force
    await pool.query('DELETE FROM mcogs_sales_item_modifier_groups WHERE modifier_group_id=$1', [req.params.id]);
    await pool.query('DELETE FROM mcogs_combo_step_option_modifier_groups WHERE modifier_group_id=$1', [req.params.id]);

    const { rowCount } = await pool.query('DELETE FROM mcogs_modifier_groups WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Modifier group not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── POST /modifier-groups/:id/duplicate ──────────────────────────────────────
router.post('/:id/duplicate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clone the group header
    const { rows: src } = await client.query(
      'SELECT * FROM mcogs_modifier_groups WHERE id=$1', [req.params.id]
    );
    if (!src.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Modifier group not found' } }); }

    const { rows: newGroup } = await client.query(
      `INSERT INTO mcogs_modifier_groups (name, description, min_select, max_select, allow_repeat_selection)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [`${src[0].name} (copy)`, src[0].description, src[0].min_select, src[0].max_select, src[0].allow_repeat_selection ?? false]
    );
    const newId = newGroup[0].id;

    // Clone all options
    const { rows: opts } = await client.query(
      'SELECT * FROM mcogs_modifier_options WHERE modifier_group_id=$1 ORDER BY sort_order, id',
      [req.params.id]
    );
    for (const opt of opts) {
      await client.query(
        `INSERT INTO mcogs_modifier_options
           (modifier_group_id, name, display_name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order, qty, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [newId, opt.name, opt.display_name, opt.item_type, opt.recipe_id, opt.ingredient_id,
         opt.manual_cost, opt.price_addon, opt.sort_order, opt.qty ?? 1, opt.image_url || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...newGroup[0], option_count: opts.length });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ─── Options CRUD ─────────────────────────────────────────────────────────────

// GET /:id/options — list all options for a group (used by frontend on expand)
router.get('/:id/options', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT mo.*,
              r.name           AS recipe_name,
              r.yield_qty      AS recipe_yield_qty,
              u_r.abbreviation AS recipe_yield_unit_abbr,
              ing.name         AS ingredient_name,
              u_i.abbreviation AS ingredient_unit_abbr
       FROM   mcogs_modifier_options mo
       LEFT JOIN mcogs_recipes     r   ON r.id   = mo.recipe_id
       LEFT JOIN mcogs_units       u_r ON u_r.id = r.yield_unit_id
       LEFT JOIN mcogs_ingredients ing ON ing.id = mo.ingredient_id
       LEFT JOIN mcogs_units       u_i ON u_i.id = ing.base_unit_id
       WHERE  mo.modifier_group_id = $1 ORDER BY mo.sort_order, mo.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/options', async (req, res, next) => {
  try {
    const { name, display_name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order, qty, image_url } = req.body;
    if (!name || !item_type) return res.status(400).json({ error: { message: 'name and item_type are required' } });
    if (!['recipe','ingredient','manual'].includes(item_type)) {
      return res.status(400).json({ error: { message: 'item_type must be recipe, ingredient, or manual' } });
    }
    const { rows } = await pool.query(
      `INSERT INTO mcogs_modifier_options
         (modifier_group_id, name, display_name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order, qty, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.id, name.trim(), display_name || null, item_type,
       recipe_id || null, ingredient_id || null, manual_cost || null, price_addon || 0, sort_order || 0, qty ?? 1, image_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/options/:oid', async (req, res, next) => {
  try {
    const { name, display_name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order, qty, image_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_modifier_options
       SET name=$1, display_name=$2, item_type=$3, recipe_id=$4, ingredient_id=$5, manual_cost=$6, price_addon=$7, sort_order=$8, qty=$9, image_url=$10
       WHERE id=$11 AND modifier_group_id=$12 RETURNING *`,
      [name?.trim(), display_name || null, item_type, recipe_id || null, ingredient_id || null,
       manual_cost || null, price_addon || 0, sort_order || 0, qty ?? 1, image_url || null, req.params.oid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Option not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/options/:oid', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_modifier_options WHERE id=$1 AND modifier_group_id=$2',
      [req.params.oid, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Option not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
