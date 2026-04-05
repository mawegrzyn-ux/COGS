// =============================================================================
// Combo Templates — save and load combo step configurations as reusable templates
// GET    /combo-templates          list all (with step count)
// GET    /combo-templates/:id      full template with steps + options
// POST   /combo-templates          { name, description?, combo_id } — save from a combo
// POST   /combo-templates/:id/apply { combo_id } — replace combo's steps with template
// DELETE /combo-templates/:id      delete template
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// ─── GET /combo-templates ─────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    let sql = `
      SELECT ct.*,
             (SELECT COUNT(*)::int FROM mcogs_combo_template_steps WHERE template_id = ct.id) AS step_count
      FROM   mcogs_combo_templates ct
    `;
    const vals = [];
    if (q?.trim()) { sql += ` WHERE ct.name ILIKE $1`; vals.push(`%${q.trim()}%`); }
    sql += ` ORDER BY ct.created_at DESC`;
    const { rows } = await pool.query(sql, vals);
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /combo-templates/:id ─────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ct.*,
              (SELECT COUNT(*)::int FROM mcogs_combo_template_steps WHERE template_id = ct.id) AS step_count
       FROM   mcogs_combo_templates ct WHERE ct.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Template not found' } });
    const template = rows[0];

    const { rows: steps } = await pool.query(
      `SELECT * FROM mcogs_combo_template_steps WHERE template_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );

    const stepsWithOpts = await Promise.all(steps.map(async step => {
      const { rows: opts } = await pool.query(
        `SELECT ctso.*,
                r.name         AS recipe_name,
                ing.name       AS ingredient_name,
                u.abbreviation AS ingredient_unit_abbr,
                si.name        AS sales_item_name,
                si.item_type   AS sales_item_type
         FROM   mcogs_combo_template_step_options ctso
         LEFT JOIN mcogs_recipes     r   ON r.id   = ctso.recipe_id
         LEFT JOIN mcogs_ingredients ing ON ing.id = ctso.ingredient_id
         LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
         LEFT JOIN mcogs_sales_items si  ON si.id  = ctso.sales_item_id
         WHERE  ctso.template_step_id = $1 ORDER BY ctso.sort_order`,
        [step.id]
      );
      return { ...step, options: opts };
    }));

    res.json({ ...template, steps: stepsWithOpts });
  } catch (err) { next(err); }
});

// ─── POST /combo-templates — save from a combo's current steps ────────────────

router.post('/', async (req, res, next) => {
  const { name, description, combo_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  if (!combo_id)     return res.status(400).json({ error: { message: 'combo_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the template record
    const { rows: [tmpl] } = await client.query(
      `INSERT INTO mcogs_combo_templates (name, description) VALUES ($1, $2) RETURNING *`,
      [name.trim(), description?.trim() || null]
    );

    // Fetch the source combo's steps
    const { rows: steps } = await client.query(
      `SELECT * FROM mcogs_combo_steps WHERE combo_id = $1 ORDER BY sort_order`,
      [combo_id]
    );

    let stepCount = 0;
    for (const step of steps) {
      const { rows: [ts] } = await client.query(
        `INSERT INTO mcogs_combo_template_steps
           (template_id, name, description, sort_order, min_select, max_select, allow_repeat, auto_select)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tmpl.id, step.name, step.description, step.sort_order,
         step.min_select ?? 1, step.max_select ?? 1,
         step.allow_repeat ?? false, step.auto_select ?? false]
      );

      const { rows: opts } = await client.query(
        `SELECT * FROM mcogs_combo_step_options WHERE combo_step_id = $1 ORDER BY sort_order`,
        [step.id]
      );

      for (const opt of opts) {
        await client.query(
          `INSERT INTO mcogs_combo_template_step_options
             (template_step_id, name, item_type, recipe_id, ingredient_id, sales_item_id, manual_cost, price_addon, qty, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ts.id, opt.name, opt.item_type,
           opt.recipe_id || null, opt.ingredient_id || null, opt.sales_item_id || null,
           opt.manual_cost || null, opt.price_addon ?? 0, opt.qty ?? 1, opt.sort_order ?? 0]
        );
      }
      stepCount++;
    }

    await client.query('COMMIT');
    res.status(201).json({ ...tmpl, step_count: stepCount });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /combo-templates/:id/apply — replace a combo's steps ───────────────

router.post('/:id/apply', async (req, res, next) => {
  const { combo_id } = req.body;
  if (!combo_id) return res.status(400).json({ error: { message: 'combo_id is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify template exists
    const { rows } = await client.query(
      `SELECT id FROM mcogs_combo_templates WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Template not found' } });

    // Delete existing steps (cascades to step options + modifier group links)
    await client.query(`DELETE FROM mcogs_combo_steps WHERE combo_id = $1`, [combo_id]);

    // Fetch template steps + options
    const { rows: steps } = await client.query(
      `SELECT * FROM mcogs_combo_template_steps WHERE template_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );

    for (const step of steps) {
      const { rows: [ns] } = await client.query(
        `INSERT INTO mcogs_combo_steps
           (combo_id, name, description, sort_order, min_select, max_select, allow_repeat, auto_select)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [combo_id, step.name, step.description, step.sort_order,
         step.min_select, step.max_select, step.allow_repeat, step.auto_select]
      );

      const { rows: opts } = await client.query(
        `SELECT * FROM mcogs_combo_template_step_options WHERE template_step_id = $1 ORDER BY sort_order`,
        [step.id]
      );

      for (const opt of opts) {
        await client.query(
          `INSERT INTO mcogs_combo_step_options
             (combo_step_id, name, item_type, recipe_id, ingredient_id, sales_item_id, manual_cost, price_addon, qty, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ns.id, opt.name, opt.item_type,
           opt.recipe_id || null, opt.ingredient_id || null, opt.sales_item_id || null,
           opt.manual_cost || null, opt.price_addon ?? 0, opt.qty ?? 1, opt.sort_order ?? 0]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ applied: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── DELETE /combo-templates/:id ─────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_combo_templates WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Template not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
