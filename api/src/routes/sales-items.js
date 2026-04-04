// =============================================================================
// Sales Items — catalog CRUD + market visibility + default prices + combo/modifier sub-routes
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fetchFull(id, client) {
  const db = client || pool;

  const { rows: items } = await db.query(
    `SELECT si.*,
            r.name  AS recipe_name,
            ing.name AS ingredient_name
     FROM   mcogs_sales_items si
     LEFT JOIN mcogs_recipes     r   ON r.id   = si.recipe_id
     LEFT JOIN mcogs_ingredients ing ON ing.id = si.ingredient_id
     WHERE  si.id = $1`,
    [id]
  );
  if (!items.length) return null;
  const item = items[0];

  const [markets, prices, simgs, steps] = await Promise.all([
    db.query(`SELECT sim.country_id, sim.is_active, c.name AS country_name
              FROM   mcogs_sales_item_markets sim
              JOIN   mcogs_countries c ON c.id = sim.country_id
              WHERE  sim.sales_item_id = $1 ORDER BY c.name`, [id]),
    db.query(`SELECT sip.*, pl.name AS price_level_name
              FROM   mcogs_sales_item_prices sip
              JOIN   mcogs_price_levels pl ON pl.id = sip.price_level_id
              WHERE  sip.sales_item_id = $1 ORDER BY pl.id`, [id]),
    db.query(`SELECT simgj.modifier_group_id, simgj.sort_order,
                     mg.name, mg.description, mg.min_select, mg.max_select
              FROM   mcogs_sales_item_modifier_groups simgj
              JOIN   mcogs_modifier_groups mg ON mg.id = simgj.modifier_group_id
              WHERE  simgj.sales_item_id = $1 ORDER BY simgj.sort_order`, [id]),
    db.query(`SELECT * FROM mcogs_combo_steps WHERE sales_item_id = $1 ORDER BY sort_order`, [id]),
  ]);

  // Fetch options + their modifier groups for each step
  const stepsWithOptions = await Promise.all(
    steps.rows.map(async step => {
      const { rows: opts } = await db.query(
        `SELECT cso.*,
                r.name  AS recipe_name,
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

  return {
    ...item,
    markets:         markets.rows,
    prices:          prices.rows,
    modifier_groups: simgs.rows,
    steps:           stepsWithOptions,
  };
}

// ─── GET /sales-items ────────────────────────────────────────────────────────
// ?country_id=X  — filter to items active in that country
// ?include_inactive=true — return all regardless of market
router.get('/', async (req, res, next) => {
  try {
    const { country_id, include_inactive } = req.query;

    let sql = `
      SELECT si.*,
             r.name   AS recipe_name,
             ing.name AS ingredient_name,
             (SELECT COUNT(*) FROM mcogs_sales_item_modifier_groups WHERE sales_item_id = si.id) AS modifier_group_count,
             (SELECT COUNT(*) FROM mcogs_combo_steps WHERE sales_item_id = si.id) AS step_count
      FROM   mcogs_sales_items si
      LEFT JOIN mcogs_recipes     r   ON r.id   = si.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = si.ingredient_id
    `;
    const params = [];

    if (country_id && include_inactive !== 'true') {
      // Only return items with no market rows OR active row for this country
      sql += `
        WHERE NOT EXISTS (
          SELECT 1 FROM mcogs_sales_item_markets sim
          WHERE sim.sales_item_id = si.id
        ) OR EXISTS (
          SELECT 1 FROM mcogs_sales_item_markets sim
          WHERE sim.sales_item_id = si.id
            AND sim.country_id = $1
            AND sim.is_active = TRUE
        )
      `;
      params.push(country_id);
    }

    sql += ' ORDER BY si.sort_order, si.name';

    const { rows } = await pool.query(sql, params);

    // Attach active markets list for each item
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const { rows: markets } = await pool.query(
        `SELECT sim.sales_item_id, sim.country_id, sim.is_active, c.name AS country_name
         FROM   mcogs_sales_item_markets sim
         JOIN   mcogs_countries c ON c.id = sim.country_id
         WHERE  sim.sales_item_id = ANY($1)`,
        [ids]
      );
      const marketMap = {};
      for (const m of markets) {
        if (!marketMap[m.sales_item_id]) marketMap[m.sales_item_id] = [];
        marketMap[m.sales_item_id].push(m);
      }
      for (const row of rows) {
        row.markets = marketMap[row.id] || [];
      }
    }

    res.json(rows);
  } catch (err) { next(err); }
});

// ─── GET /sales-items/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const item = await fetchFull(req.params.id);
    if (!item) return res.status(404).json({ error: { message: 'Sales item not found' } });
    res.json(item);
  } catch (err) { next(err); }
});

// ─── POST /sales-items ────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { item_type, name, category, description, recipe_id, ingredient_id, manual_cost, image_url, sort_order } = req.body;
    if (!item_type || !name) return res.status(400).json({ error: { message: 'item_type and name are required' } });
    if (!['recipe','ingredient','manual','combo'].includes(item_type)) {
      return res.status(400).json({ error: { message: 'item_type must be recipe, ingredient, manual, or combo' } });
    }

    const { rows } = await pool.query(
      `INSERT INTO mcogs_sales_items (item_type, name, category, description, recipe_id, ingredient_id, manual_cost, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [item_type, name.trim(), category || null, description || null,
       recipe_id || null, ingredient_id || null, manual_cost || null, image_url || null, sort_order || 0]
    );
    const full = await fetchFull(rows[0].id);
    res.status(201).json(full);
  } catch (err) { next(err); }
});

// ─── PUT /sales-items/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { name, category, description, recipe_id, ingredient_id, manual_cost, image_url, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_sales_items
       SET name=$1, category=$2, description=$3, recipe_id=$4, ingredient_id=$5,
           manual_cost=$6, image_url=$7, sort_order=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name?.trim(), category || null, description || null,
       recipe_id || null, ingredient_id || null, manual_cost || null,
       image_url || null, sort_order || 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Sales item not found' } });
    const full = await fetchFull(rows[0].id);
    res.json(full);
  } catch (err) { next(err); }
});

// ─── DELETE /sales-items/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM mcogs_sales_items WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Sales item not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── PUT /sales-items/:id/markets ─────────────────────────────────────────────
// body: { country_ids: [1, 2, 3] }  — sets is_active=true for listed, false for others
router.put('/:id/markets', async (req, res, next) => {
  try {
    const { country_ids } = req.body;
    const ids = Array.isArray(country_ids) ? country_ids.map(Number) : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Set existing rows to inactive
      await client.query(
        `UPDATE mcogs_sales_item_markets SET is_active=FALSE WHERE sales_item_id=$1`,
        [req.params.id]
      );
      // Upsert active rows
      for (const cid of ids) {
        await client.query(
          `INSERT INTO mcogs_sales_item_markets (sales_item_id, country_id, is_active)
           VALUES ($1,$2,TRUE)
           ON CONFLICT (sales_item_id, country_id) DO UPDATE SET is_active=TRUE`,
          [req.params.id, cid]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const { rows } = await pool.query(
      `SELECT sim.country_id, sim.is_active, c.name AS country_name
       FROM   mcogs_sales_item_markets sim
       JOIN   mcogs_countries c ON c.id = sim.country_id
       WHERE  sim.sales_item_id=$1 ORDER BY c.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── PUT /sales-items/:id/prices ──────────────────────────────────────────────
// body: { prices: [{ price_level_id, sell_price, tax_rate_id }] }
router.put('/:id/prices', async (req, res, next) => {
  try {
    const { prices } = req.body;
    if (!Array.isArray(prices)) return res.status(400).json({ error: { message: 'prices must be an array' } });
    for (const p of prices) {
      await pool.query(
        `INSERT INTO mcogs_sales_item_prices (sales_item_id, price_level_id, sell_price, tax_rate_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (sales_item_id, price_level_id)
         DO UPDATE SET sell_price=$3, tax_rate_id=$4`,
        [req.params.id, p.price_level_id, p.sell_price ?? 0, p.tax_rate_id || null]
      );
    }
    const { rows } = await pool.query(
      `SELECT sip.*, pl.name AS price_level_name
       FROM   mcogs_sales_item_prices sip
       JOIN   mcogs_price_levels pl ON pl.id = sip.price_level_id
       WHERE  sip.sales_item_id=$1 ORDER BY pl.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── PUT /sales-items/:id/modifier-groups ─────────────────────────────────────
// body: { modifier_group_ids: [1, 2] } — full replace
router.put('/:id/modifier-groups', async (req, res, next) => {
  try {
    const { modifier_group_ids } = req.body;
    const ids = Array.isArray(modifier_group_ids) ? modifier_group_ids.map(Number) : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM mcogs_sales_item_modifier_groups WHERE sales_item_id=$1', [req.params.id]);
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `INSERT INTO mcogs_sales_item_modifier_groups (sales_item_id, modifier_group_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [req.params.id, ids[i], i]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ─── Combo steps ──────────────────────────────────────────────────────────────

router.post('/:id/steps', async (req, res, next) => {
  try {
    const { name, description, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_combo_steps (sales_item_id, name, description, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, name.trim(), description || null, sort_order || 0]
    );
    res.status(201).json({ ...rows[0], options: [] });
  } catch (err) { next(err); }
});

router.put('/:id/steps/:sid', async (req, res, next) => {
  try {
    const { name, description, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_combo_steps SET name=$1, description=$2, sort_order=$3
       WHERE id=$4 AND sales_item_id=$5 RETURNING *`,
      [name?.trim(), description || null, sort_order ?? 0, req.params.sid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Step not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/steps/:sid', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_combo_steps WHERE id=$1 AND sales_item_id=$2',
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

// ─── PUT /sales-items/:id/steps/:sid/options/:oid/modifier-groups ─────────────
// body: { modifier_group_ids: [...] } — full replace
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
