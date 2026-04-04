// =============================================================================
// Combos — standalone combo definitions (name, steps, options)
// A Sales Item of item_type='combo' links to a Combo via combo_id,
// the same way item_type='recipe' links via recipe_id.
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// ─── fetchComboFull ───────────────────────────────────────────────────────────

async function fetchComboFull(id, client) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT co.*,
            c.name  AS category_name,
            gr.name AS category_group_name
     FROM   mcogs_combos co
     LEFT JOIN mcogs_categories      c  ON c.id  = co.category_id
     LEFT JOIN mcogs_category_groups gr ON gr.id = c.group_id
     WHERE  co.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const combo = rows[0];

  const { rows: steps } = await db.query(
    `SELECT * FROM mcogs_combo_steps WHERE combo_id = $1 ORDER BY sort_order`,
    [id]
  );

  const stepsWithOptions = await Promise.all(
    steps.map(async step => {
      const { rows: opts } = await db.query(
        `SELECT cso.*,
                r.name   AS recipe_name,
                ing.name AS ingredient_name
         FROM   mcogs_combo_step_options cso
         LEFT JOIN mcogs_recipes     r   ON r.id   = cso.recipe_id
         LEFT JOIN mcogs_ingredients ing ON ing.id = cso.ingredient_id
         WHERE  cso.combo_step_id = $1 ORDER BY cso.sort_order`,
        [step.id]
      );
      const optsWithMods = await Promise.all(
        opts.map(async opt => {
          const { rows: mods } = await db.query(
            `SELECT csomgj.modifier_group_id, csomgj.sort_order,
                    mg.name, mg.min_select, mg.max_select
             FROM   mcogs_combo_step_option_modifier_groups csomgj
             JOIN   mcogs_modifier_groups mg ON mg.id = csomgj.modifier_group_id
             WHERE  csomgj.combo_step_option_id = $1 ORDER BY csomgj.sort_order`,
            [opt.id]
          );
          return { ...opt, modifier_groups: mods };
        })
      );
      return { ...step, options: optsWithMods };
    })
  );

  return { ...combo, steps: stepsWithOptions };
}

// ─── GET /combos ──────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT co.*,
              c.name AS category_name,
              (SELECT COUNT(*) FROM mcogs_combo_steps WHERE combo_id = co.id) AS step_count
       FROM   mcogs_combos co
       LEFT JOIN mcogs_categories c ON c.id = co.category_id
       ORDER  BY co.sort_order, co.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /combos/:id ──────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const combo = await fetchComboFull(req.params.id);
    if (!combo) return res.status(404).json({ error: { message: 'Combo not found' } });
    res.json(combo);
  } catch (err) { next(err); }
});

// ─── POST /combos ─────────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { name, description, category_id, image_url, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combos (name, description, category_id, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), description || null, category_id || null, image_url || null, sort_order || 0]
    );
    res.status(201).json({ ...rows[0], steps: [] });
  } catch (err) { next(err); }
});

// ─── PUT /combos/:id ──────────────────────────────────────────────────────────

router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, category_id, image_url, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combos
       SET name=$1, description=$2, category_id=$3, image_url=$4, sort_order=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name?.trim(), description || null, category_id || null, image_url || null, sort_order || 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Combo not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /combos/:id ───────────────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    // Null out any sales items that link to this combo
    await pool.query(`UPDATE mcogs_sales_items SET combo_id=NULL WHERE combo_id=$1`, [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM mcogs_combos WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Combo not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── Combo steps ──────────────────────────────────────────────────────────────

router.post('/:id/steps', async (req, res, next) => {
  try {
    const { name, description, sort_order, min_select, max_select, allow_repeat } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combo_steps (combo_id, name, description, sort_order, min_select, max_select, allow_repeat)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, name.trim(), description || null, sort_order || 0,
       min_select ?? 1, max_select ?? 1, allow_repeat ?? false]
    );
    res.status(201).json({ ...rows[0], options: [] });
  } catch (err) { next(err); }
});

router.put('/:id/steps/:sid', async (req, res, next) => {
  try {
    const { name, description, sort_order, min_select, max_select, allow_repeat } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combo_steps
       SET name=$1, description=$2, sort_order=$3, min_select=$4, max_select=$5, allow_repeat=$6
       WHERE id=$7 AND combo_id=$8 RETURNING *`,
      [name?.trim(), description || null, sort_order ?? 0,
       min_select ?? 1, max_select ?? 1, allow_repeat ?? false,
       req.params.sid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Step not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/steps/:sid', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_combo_steps WHERE id=$1 AND combo_id=$2',
      [req.params.sid, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Step not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── Combo step options ───────────────────────────────────────────────────────

router.post('/:id/steps/:sid/options', async (req, res, next) => {
  try {
    const { name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order } = req.body;
    if (!name || !item_type) return res.status(400).json({ error: { message: 'name and item_type are required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combo_step_options
         (combo_step_id, name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.sid, name.trim(), item_type,
       recipe_id || null, ingredient_id || null, manual_cost || null, price_addon || 0, sort_order || 0]
    );
    res.status(201).json({ ...rows[0], modifier_groups: [] });
  } catch (err) { next(err); }
});

router.put('/:id/steps/:sid/options/:oid', async (req, res, next) => {
  try {
    const { name, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combo_step_options
       SET name=$1, item_type=$2, recipe_id=$3, ingredient_id=$4, manual_cost=$5, price_addon=$6, sort_order=$7
       WHERE id=$8 AND combo_step_id=$9 RETURNING *`,
      [name?.trim(), item_type, recipe_id || null, ingredient_id || null,
       manual_cost || null, price_addon || 0, sort_order || 0, req.params.oid, req.params.sid]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Option not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/steps/:sid/options/:oid', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_combo_step_options WHERE id=$1 AND combo_step_id=$2',
      [req.params.oid, req.params.sid]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Option not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── PUT /combos/:id/steps/:sid/options/:oid/modifier-groups ─────────────────

router.put('/:id/steps/:sid/options/:oid/modifier-groups', async (req, res, next) => {
  try {
    const { modifier_group_ids } = req.body;
    const ids = Array.isArray(modifier_group_ids) ? modifier_group_ids.map(Number) : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM mcogs_combo_step_option_modifier_groups WHERE combo_step_option_id=$1',
        [req.params.oid]
      );
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `INSERT INTO mcogs_combo_step_option_modifier_groups (combo_step_option_id, modifier_group_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [req.params.oid, ids[i], i]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ updated: true });
  } catch (err) { next(err); }
});

module.exports = router;
