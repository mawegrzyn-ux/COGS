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
            r.name   AS recipe_name,
            ing.name AS ingredient_name,
            co.name  AS combo_name,
            c.name   AS category_name,
            gr.name  AS category_group_name
     FROM   mcogs_sales_items si
     LEFT JOIN mcogs_recipes           r   ON r.id   = si.recipe_id
     LEFT JOIN mcogs_ingredients       ing ON ing.id = si.ingredient_id
     LEFT JOIN mcogs_combos            co  ON co.id  = si.combo_id
     LEFT JOIN mcogs_categories        c   ON c.id   = si.category_id
     LEFT JOIN mcogs_category_groups   gr  ON gr.id  = c.group_id
     WHERE  si.id = $1`,
    [id]
  );
  if (!items.length) return null;
  const item = items[0];

  const [markets, prices, simgs] = await Promise.all([
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
  ]);

  return {
    ...item,
    markets:         markets.rows,
    prices:          prices.rows,
    modifier_groups: simgs.rows,
  };
}

// ─── GET /sales-items ────────────────────────────────────────────────────────
// ?country_id=X       — filter to items active in that country
// ?include_inactive=true — return all regardless of market
// ?recipe_id=X        — filter to items whose recipe_id matches
router.get('/', async (req, res, next) => {
  try {
    const { country_id, include_inactive, recipe_id } = req.query;

    let sql = `
      SELECT si.*,
             r.name   AS recipe_name,
             ing.name AS ingredient_name,
             co.name  AS combo_name,
             c.name   AS category_name,
             gr.name  AS category_group_name,
             (SELECT COUNT(*) FROM mcogs_sales_item_modifier_groups WHERE sales_item_id = si.id) AS modifier_group_count,
             (SELECT COUNT(*) FROM mcogs_combo_steps WHERE combo_id = si.combo_id) AS step_count
      FROM   mcogs_sales_items si
      LEFT JOIN mcogs_recipes           r   ON r.id   = si.recipe_id
      LEFT JOIN mcogs_ingredients       ing ON ing.id = si.ingredient_id
      LEFT JOIN mcogs_combos            co  ON co.id  = si.combo_id
      LEFT JOIN mcogs_categories        c   ON c.id   = si.category_id
      LEFT JOIN mcogs_category_groups   gr  ON gr.id  = c.group_id
    `;
    const params = [];
    const conditions = [];

    if (recipe_id) {
      params.push(recipe_id);
      conditions.push(`si.recipe_id = $${params.length}`);
    }

    if (country_id && include_inactive !== 'true') {
      params.push(country_id);
      const p = params.length;
      conditions.push(
        `(NOT EXISTS (SELECT 1 FROM mcogs_sales_item_markets sim WHERE sim.sales_item_id = si.id)` +
        ` OR EXISTS (SELECT 1 FROM mcogs_sales_item_markets sim WHERE sim.sales_item_id = si.id AND sim.country_id = $${p} AND sim.is_active = TRUE))`
      );
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
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
    const { item_type, name, display_name, category_id, description, recipe_id, ingredient_id, combo_id, manual_cost, image_url, sort_order } = req.body;
    if (!item_type || !name) return res.status(400).json({ error: { message: 'item_type and name are required' } });
    if (!['recipe','ingredient','manual','combo'].includes(item_type)) {
      return res.status(400).json({ error: { message: 'item_type must be recipe, ingredient, manual, or combo' } });
    }

    const { rows } = await pool.query(
      `INSERT INTO mcogs_sales_items (item_type, name, display_name, category_id, description, recipe_id, ingredient_id, combo_id, manual_cost, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [item_type, name.trim(), display_name?.trim() || null, category_id || null, description || null,
       recipe_id || null, ingredient_id || null, combo_id || null,
       manual_cost || null, image_url || null, sort_order || 0]
    );
    const full = await fetchFull(rows[0].id);
    res.status(201).json(full);
  } catch (err) { next(err); }
});

// ─── PUT /sales-items/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { name, display_name, category_id, description, recipe_id, ingredient_id, combo_id, manual_cost, image_url, sort_order } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_sales_items
       SET name=$1, display_name=$2, category_id=$3, description=$4, recipe_id=$5, ingredient_id=$6, combo_id=$7,
           manual_cost=$8, image_url=$9, sort_order=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name?.trim(), display_name?.trim() || null, category_id || null, description || null,
       recipe_id || null, ingredient_id || null, combo_id || null,
       manual_cost || null, image_url || null, sort_order || 0, req.params.id]
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

module.exports = router;
