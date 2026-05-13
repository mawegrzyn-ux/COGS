// =============================================================================
// Combos — standalone combo definitions (name, steps, options)
// A Sales Item of item_type='combo' links to a Combo via combo_id,
// the same way item_type='recipe' links via recipe_id.
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// BUG-1186 — per-option cost endpoint for the Combos edit view.
// Pulls the minimum set of helpers we need from cogs.js. Variations / price-
// level overrides are intentionally skipped — the Combos tab is not yet
// market-scoped, so we surface base USD cost for a caller-chosen country.
const {
  loadQuoteLookup,
  loadComboData,
  loadAllRecipeItemsDeep,
} = require('./cogs');

// resolveOptionCost is not exported — duplicate the minimum path here to
// avoid a circular export. Same shape, USD base output.
function _optionUnitCost(opt, countryId, quoteLookup, recipeItemsMap) {
  if (opt.item_type === 'manual') return Number(opt.manual_cost || 0);
  if (opt.item_type === 'ingredient' && opt.ingredient_id) {
    const q = quoteLookup[opt.ingredient_id]?.[countryId];
    return q ? q.price_per_base_unit : 0;
  }
  if (opt.item_type === 'recipe' && opt.recipe_id) {
    const items = recipeItemsMap[opt.recipe_id] || [];
    let cost = 0;
    for (const it of items) {
      if (it.item_type === 'ingredient' && it.ingredient_id) {
        const q = quoteLookup[it.ingredient_id]?.[countryId];
        const unit = q ? q.price_per_base_unit : 0;
        cost += unit * Number(it.prep_qty || 0) * (1 + Number(it.waste_pct || 0) / 100);
      } else if (it.item_type === 'recipe' && it.recipe_item_id) {
        const sub = _optionUnitCost(
          { item_type: 'recipe', recipe_id: it.recipe_item_id },
          countryId, quoteLookup, recipeItemsMap
        );
        cost += sub * Number(it.prep_qty || 0);
      }
    }
    const yieldQ = Number(opt.recipe_yield_qty || 1) || 1;
    return cost / yieldQ;
  }
  if (opt.item_type === 'sales_item') {
    const siType = opt.si_item_type;
    const siQty  = Number(opt.si_qty || 1);
    if (siType === 'manual')                                return Number(opt.si_manual_cost || 0) * siQty;
    if (siType === 'ingredient' && opt.si_ingredient_id) {
      const q = quoteLookup[opt.si_ingredient_id]?.[countryId];
      return (q ? q.price_per_base_unit : 0) * siQty;
    }
    if (siType === 'recipe' && opt.si_recipe_id) {
      return _optionUnitCost(
        { item_type: 'recipe', recipe_id: opt.si_recipe_id, recipe_yield_qty: opt.si_recipe_yield_qty || 1 },
        countryId, quoteLookup, recipeItemsMap
      ) * siQty;
    }
    return 0;
  }
  return 0;
}

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
                r.name             AS recipe_name,
                ing.name           AS ingredient_name,
                u.abbreviation     AS ingredient_unit_abbr,
                si.name            AS sales_item_name,
                si.item_type       AS sales_item_type
         FROM   mcogs_combo_step_options cso
         LEFT JOIN mcogs_recipes     r   ON r.id   = cso.recipe_id
         LEFT JOIN mcogs_ingredients ing ON ing.id = cso.ingredient_id
         LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
         LEFT JOIN mcogs_sales_items si  ON si.id  = cso.sales_item_id
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
    logAudit(pool, req, { action: 'create', entity_type: 'combo', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json({ ...rows[0], steps: [] });
  } catch (err) { next(err); }
});

// ─── PUT /combos/:id ──────────────────────────────────────────────────────────

router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, category_id, image_url, sort_order } = req.body;
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_combos WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_combos
       SET name=$1, description=$2, category_id=$3, image_url=$4, sort_order=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name?.trim(), description || null, category_id || null, image_url || null, sort_order || 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Combo not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'combo', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'description', 'category_id']) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /combos/:id ───────────────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_combos WHERE id=$1', [req.params.id]);
    // Null out any sales items that link to this combo
    await pool.query(`UPDATE mcogs_sales_items SET combo_id=NULL WHERE combo_id=$1`, [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM mcogs_combos WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Combo not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'combo', entity_id: old?.id, entity_label: old?.name });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── POST /combos/:id/duplicate ──────────────────────────────────────────────

router.post('/:id/duplicate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const src = await fetchComboFull(req.params.id);
    if (!src) return res.status(404).json({ error: { message: 'Combo not found' } });

    await client.query('BEGIN');

    // Create new combo
    const { rows: [newCombo] } = await client.query(
      `INSERT INTO mcogs_combos (name, description, category_id, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [`${src.name} (Copy)`, src.description || null, src.category_id || null,
       src.image_url || null, src.sort_order || 0]
    );

    // Duplicate each step + its options
    for (const step of src.steps || []) {
      const { rows: [newStep] } = await client.query(
        `INSERT INTO mcogs_combo_steps
           (combo_id, name, description, sort_order, min_select, max_select, allow_repeat, auto_select)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [newCombo.id, step.name, step.description || null, step.sort_order || 0,
         step.min_select ?? 1, step.max_select ?? 1,
         step.allow_repeat ?? false, step.auto_select ?? false]
      );

      for (const opt of step.options || []) {
        const { rows: [newOpt] } = await client.query(
          `INSERT INTO mcogs_combo_step_options
             (combo_step_id, name, item_type, recipe_id, ingredient_id, sales_item_id,
              manual_cost, price_addon, qty, sort_order, image_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [newStep.id, opt.name, opt.item_type,
           opt.recipe_id || null, opt.ingredient_id || null, opt.sales_item_id || null,
           opt.manual_cost || null, opt.price_addon || 0, opt.qty ?? 1, opt.sort_order || 0,
           opt.image_url || null]
        );

        // Copy modifier group assignments
        for (const mg of opt.modifier_groups || []) {
          await client.query(
            `INSERT INTO mcogs_combo_step_option_modifier_groups
               (combo_step_option_id, modifier_group_id, sort_order)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [newOpt.id, mg.modifier_group_id, mg.sort_order || 0]
          );
        }
      }
    }

    await client.query('COMMIT');
    const full = await fetchComboFull(newCombo.id);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── Combo steps ──────────────────────────────────────────────────────────────

router.post('/:id/steps', async (req, res, next) => {
  try {
    const { name, display_name, description, sort_order, min_select, max_select, allow_repeat, auto_select } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combo_steps (combo_id, name, display_name, description, sort_order, min_select, max_select, allow_repeat, auto_select)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, name.trim(), display_name || null, description || null, sort_order || 0,
       min_select ?? 1, max_select ?? 1, allow_repeat ?? false, auto_select ?? false]
    );
    logAudit(pool, req, { action: 'create', entity_type: 'combo_step', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json({ ...rows[0], options: [] });
  } catch (err) { next(err); }
});

router.put('/:id/steps/:sid', async (req, res, next) => {
  try {
    const { name, display_name, description, sort_order, min_select, max_select, allow_repeat, auto_select } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combo_steps
       SET name=$1, display_name=$2, description=$3, sort_order=$4, min_select=$5, max_select=$6, allow_repeat=$7, auto_select=$8
       WHERE id=$9 AND combo_id=$10 RETURNING *`,
      [name?.trim(), display_name || null, description || null, sort_order ?? 0,
       min_select ?? 1, max_select ?? 1, allow_repeat ?? false, auto_select ?? false,
       req.params.sid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Step not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'combo_step', entity_id: rows[0].id, entity_label: rows[0].name });
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
    logAudit(pool, req, { action: 'delete', entity_type: 'combo_step', entity_id: Number(req.params.sid), entity_label: `Step #${req.params.sid}` });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── POST /combos/:id/steps/:sid/duplicate ────────────────────────────────────

router.post('/:id/steps/:sid/duplicate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows: [src] } = await pool.query(
      'SELECT * FROM mcogs_combo_steps WHERE id=$1 AND combo_id=$2',
      [req.params.sid, req.params.id]
    );
    if (!src) return res.status(404).json({ error: { message: 'Step not found' } });

    const { rows: srcOpts } = await pool.query(
      'SELECT * FROM mcogs_combo_step_options WHERE combo_step_id=$1 ORDER BY sort_order',
      [req.params.sid]
    );
    const { rows: [{ next_order }] } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM mcogs_combo_steps WHERE combo_id=$1`,
      [req.params.id]
    );

    await client.query('BEGIN');
    const { rows: [newStep] } = await client.query(
      `INSERT INTO mcogs_combo_steps
         (combo_id, name, display_name, description, sort_order, min_select, max_select, allow_repeat, auto_select)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, `${src.name} (Copy)`, src.display_name || null, src.description || null,
       next_order, src.min_select ?? 1, src.max_select ?? 1, src.allow_repeat ?? false, src.auto_select ?? false]
    );

    for (const opt of srcOpts) {
      const { rows: [newOpt] } = await client.query(
        `INSERT INTO mcogs_combo_step_options
           (combo_step_id, name, display_name, item_type, recipe_id, ingredient_id, sales_item_id,
            manual_cost, price_addon, qty, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [newStep.id, opt.name, opt.display_name || null, opt.item_type,
         opt.recipe_id || null, opt.ingredient_id || null, opt.sales_item_id || null,
         opt.manual_cost || null, opt.price_addon || 0, opt.qty ?? 1, opt.sort_order || 0]
      );
      const { rows: mgs } = await client.query(
        'SELECT * FROM mcogs_combo_step_option_modifier_groups WHERE combo_step_option_id=$1',
        [opt.id]
      );
      for (const mg of mgs) {
        await client.query(
          `INSERT INTO mcogs_combo_step_option_modifier_groups (combo_step_option_id, modifier_group_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [newOpt.id, mg.modifier_group_id, mg.sort_order || 0]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...newStep, options: srcOpts });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── Combo step options ───────────────────────────────────────────────────────

router.post('/:id/steps/:sid/options', async (req, res, next) => {
  try {
    const { name, display_name, item_type, recipe_id, ingredient_id, sales_item_id, manual_cost, price_addon, qty, sort_order, image_url } = req.body;
    if (!name || !item_type) return res.status(400).json({ error: { message: 'name and item_type are required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combo_step_options
         (combo_step_id, name, display_name, item_type, recipe_id, ingredient_id, sales_item_id, manual_cost, price_addon, qty, sort_order, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.params.sid, name.trim(), display_name || null, item_type,
       recipe_id || null, ingredient_id || null, sales_item_id || null,
       manual_cost || null, price_addon || 0, qty ?? 1, sort_order || 0,
       image_url || null]
    );
    logAudit(pool, req, { action: 'create', entity_type: 'combo_step_option', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json({ ...rows[0], modifier_groups: [] });
  } catch (err) { next(err); }
});

router.put('/:id/steps/:sid/options/:oid', async (req, res, next) => {
  try {
    const { name, display_name, item_type, recipe_id, ingredient_id, sales_item_id, manual_cost, price_addon, qty, sort_order, image_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combo_step_options
       SET name=$1, display_name=$2, item_type=$3, recipe_id=$4, ingredient_id=$5, sales_item_id=$6,
           manual_cost=$7, price_addon=$8, qty=$9, sort_order=$10, image_url=$11
       WHERE id=$12 AND combo_step_id=$13 RETURNING *`,
      [name?.trim(), display_name || null, item_type, recipe_id || null, ingredient_id || null, sales_item_id || null,
       manual_cost || null, price_addon || 0, qty ?? 1, sort_order || 0,
       image_url || null,
       req.params.oid, req.params.sid]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Option not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'combo_step_option', entity_id: rows[0].id, entity_label: rows[0].name });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── POST /combos/:id/steps/reorder ──────────────────────────────────────────
// BACK-2835 — drag-drop reorder for combo steps. Body: { order: [step_id, ...] }
// Updates sort_order for every step in the combo in a single transaction.
// Idempotent — re-sending the same order is a no-op. Returns the new count.
router.post('/:id/steps/reorder', async (req, res, next) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: { message: 'order must be a non-empty array of step ids' } });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE mcogs_combo_steps SET sort_order = $1 WHERE id = $2 AND combo_id = $3`,
        [i, order[i], req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: order.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /combos/:id/costs ───────────────────────────────────────────────────
// BUG-1186 — per-option cost summary for the Combos edit view.
//
// The Combos edit tab is not menu-bound (the combo isn't yet wrapped in a
// menu-sales-item), so we don't have variations / price-level overrides.
// Caller passes ?country_id=X to pick which vendor pricing to apply; if
// omitted we use the first country in the table.
//
// Returns: {
//   country: { id, name, code, symbol, rate },
//   options: { [combo_step_option_id]: { base_cost, modifier_adder, total_cost } }
// }
// All values are in market currency (already multiplied through by the
// country's exchange rate against USD base).
router.get('/:id/costs', async (req, res, next) => {
  try {
    const comboId = Number(req.params.id);

    // Resolve country
    let countryId = Number(req.query.country_id) || null;
    let country;
    if (countryId) {
      const { rows } = await pool.query(
        'SELECT id, name, currency_code AS code, currency_symbol AS symbol, exchange_rate AS rate FROM mcogs_countries WHERE id = $1',
        [countryId]
      );
      country = rows[0];
    } else {
      const { rows } = await pool.query(
        'SELECT id, name, currency_code AS code, currency_symbol AS symbol, exchange_rate AS rate FROM mcogs_countries ORDER BY id LIMIT 1'
      );
      country = rows[0];
      countryId = country?.id || null;
    }
    if (!country) return res.json({ country: null, options: {} });

    // Load the combo's step + option tree (mod_options included)
    const comboMap = await loadComboData([comboId]);
    const steps = comboMap[comboId] || [];

    // Vendor pricing + recipe items for everything referenced
    const quoteLookup = await loadQuoteLookup();
    const recipeIds = new Set();
    for (const step of steps) {
      for (const opt of step.options || []) {
        if (opt.item_type === 'recipe' && opt.recipe_id) recipeIds.add(opt.recipe_id);
        if (opt.item_type === 'sales_item' && opt.si_recipe_id) recipeIds.add(opt.si_recipe_id);
        for (const mo of opt.mod_options || []) {
          if (mo.item_type === 'recipe' && mo.recipe_id) recipeIds.add(mo.recipe_id);
        }
      }
    }
    const recipeItemsMap = recipeIds.size ? await loadAllRecipeItemsDeep([...recipeIds]) : {};

    const rate = Number(country.rate) || 1;
    const out = {};

    for (const step of steps) {
      for (const opt of step.options || []) {
        const baseUsd = _optionUnitCost(opt, countryId, quoteLookup, recipeItemsMap);

        // Modifier adder: full × min_select × M (M=1, multiplier toggle not
        // applicable in this context). For each attached group:
        //   avg(options) × min_select
        let adderUsd = 0;
        if ((opt.mod_options || []).length) {
          const byGroup = {};
          for (const mo of opt.mod_options) {
            (byGroup[mo.modifier_group_id] ??= []).push(mo);
          }
          // Fetch min_select per modifier group referenced
          const groupIds = Object.keys(byGroup).map(Number);
          let mgMins = {};
          if (groupIds.length) {
            const { rows } = await pool.query(
              'SELECT id, min_select FROM mcogs_modifier_groups WHERE id = ANY($1::int[])',
              [groupIds]
            );
            mgMins = Object.fromEntries(rows.map(r => [r.id, Number(r.min_select) || 0]));
          }
          for (const gid of groupIds) {
            const opts = byGroup[gid];
            if (!opts.length) continue;
            const minSel = mgMins[gid] || 0;
            if (!minSel) continue;
            const costs = opts.map(o => {
              const u = _optionUnitCost(o, countryId, quoteLookup, recipeItemsMap);
              return u * Number(o.qty || 1);
            });
            const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
            adderUsd += avg * minSel;
          }
        }

        out[opt.id] = {
          base_cost:       Math.round(baseUsd * rate * 10000) / 10000,
          modifier_adder:  Math.round(adderUsd * rate * 10000) / 10000,
          total_cost:      Math.round((baseUsd + adderUsd) * rate * 10000) / 10000,
        };
      }
    }

    res.json({ country, options: out });
  } catch (err) { next(err); }
});

// ─── POST /combos/:id/steps/:sid/options/reorder ─────────────────────────────
// BACK-2587 — drag-drop reorder. Body: { order: [option_id, ...] }
router.post('/:id/steps/:sid/options/reorder', async (req, res, next) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: { message: 'order must be a non-empty array of option ids' } });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE mcogs_combo_step_options SET sort_order = $1 WHERE id = $2 AND combo_step_id = $3`,
        [i, order[i], req.params.sid]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: order.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.delete('/:id/steps/:sid/options/:oid', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_combo_step_options WHERE id=$1 AND combo_step_id=$2',
      [req.params.oid, req.params.sid]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Option not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'combo_step_option', entity_id: Number(req.params.oid), entity_label: `Option #${req.params.oid}` });
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
