// =============================================================================
// Menu Sales Items — link between menus and the Sales Items catalog
// Prices auto-copied from SI defaults on add; per-menu overrides tracked separately
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');
const {
  loadQuoteLookup, loadAllRecipeItemsDeep,
  loadVariationItemsMap, loadPlVariationItemsMap, loadMarketPlVariationItemsMap,
} = require('./cogs');

// Resolve cost for one modifier/combo-step option in USD base.
// Mirrors resolveOptionCost() in cogs.js but is duplicated here to avoid
// exporting a private symbol. Returns cost per unit (qty applied by caller).
function _optionUnitCost(opt, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId) {
  const calcRecipeCost = require('./cogs').calcRecipeCost;
  if (opt.item_type === 'manual') return Number(opt.manual_cost || 0);
  if (opt.item_type === 'ingredient') {
    const q = quoteLookup[opt.ingredient_id]?.[countryId];
    return q ? q.price_per_base_unit : 0;
  }
  if (opt.item_type === 'recipe' && opt.recipe_id) {
    const rItems = recipeItemsMap[opt.recipe_id] || [];
    const { cost } = calcRecipeCost(
      { id: opt.recipe_id, yield_qty: opt.recipe_yield_qty || 1 },
      rItems, countryId, quoteLookup, variationMap, recipeItemsMap, null,
      priceLevelId, plVariationMap, marketPlVariationMap
    );
    return cost;
  }
  return 0;
}

// ─── helper: full row with prices + override flags ───────────────────────────
async function fetchRow(id, client) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT msi.*,
            si.name       AS sales_item_name,
            si.item_type,
            si.image_url  AS si_image_url,
            cat.name      AS category
     FROM   mcogs_menu_sales_items msi
     JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
     LEFT JOIN mcogs_categories cat ON cat.id = si.category_id
     WHERE  msi.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];

  // Attach per-menu prices with override flag
  const { rows: prices } = await db.query(
    `SELECT msip.*,
            pl.name AS price_level_name,
            sip.sell_price AS default_price,
            (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
     FROM   mcogs_menu_sales_item_prices msip
     JOIN   mcogs_price_levels pl ON pl.id = msip.price_level_id
     LEFT JOIN mcogs_sales_item_prices sip
               ON sip.sales_item_id = $2 AND sip.price_level_id = msip.price_level_id
     WHERE  msip.menu_sales_item_id = $1
     ORDER  BY pl.id`,
    [id, row.sales_item_id]
  );
  return { ...row, prices };
}

// ─── GET /menu-sales-items?menu_id=X ─────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { menu_id } = req.query;
    if (!menu_id) return res.status(400).json({ error: { message: 'menu_id is required' } });

    const { rows: items } = await pool.query(
      `SELECT msi.*,
              si.name      AS sales_item_name,
              si.item_type,
              si.image_url AS si_image_url,
              cat.name     AS category
       FROM   mcogs_menu_sales_items msi
       JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
       LEFT JOIN mcogs_categories cat ON cat.id = si.category_id
       WHERE  msi.menu_id = $1
       ORDER  BY msi.sort_order, msi.id`,
      [menu_id]
    );

    if (!items.length) return res.json([]);

    // Batch-load prices + override flags
    const msiIds    = items.map(r => r.id);
    const siIds     = items.map(r => r.sales_item_id);

    const { rows: prices } = await pool.query(
      `SELECT msip.*,
              pl.name AS price_level_name,
              sip.sell_price AS default_price,
              (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
       FROM   mcogs_menu_sales_item_prices msip
       JOIN   mcogs_price_levels pl ON pl.id = msip.price_level_id
       LEFT JOIN mcogs_sales_item_prices sip
                 ON sip.sales_item_id = (
                   SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id = msip.menu_sales_item_id
                 ) AND sip.price_level_id = msip.price_level_id
       WHERE  msip.menu_sales_item_id = ANY($1)
       ORDER  BY msip.menu_sales_item_id, pl.id`,
      [msiIds]
    );

    const priceMap = {};
    for (const p of prices) {
      if (!priceMap[p.menu_sales_item_id]) priceMap[p.menu_sales_item_id] = [];
      priceMap[p.menu_sales_item_id].push(p);
    }

    const result = items.map(item => ({
      ...item,
      prices: priceMap[item.id] || [],
      has_price_override: (priceMap[item.id] || []).some(p => p.is_overridden),
    }));

    // Suppress unused variable warning
    void siIds;

    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /menu-sales-items ───────────────────────────────────────────────────
// Validates market visibility, inserts row, copies default prices in same transaction
router.post('/', async (req, res, next) => {
  try {
    const { menu_id, sales_item_id, qty, sort_order } = req.body;
    if (!menu_id || !sales_item_id) {
      return res.status(400).json({ error: { message: 'menu_id and sales_item_id are required' } });
    }

    // Verify Sales Item exists and check market visibility
    const { rows: siRows } = await pool.query(
      'SELECT * FROM mcogs_sales_items WHERE id=$1', [sales_item_id]
    );
    if (!siRows.length) return res.status(404).json({ error: { message: 'Sales item not found' } });

    const { rows: menuRows } = await pool.query(
      'SELECT country_id FROM mcogs_menus WHERE id=$1', [menu_id]
    );
    if (!menuRows.length) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menuRows[0].country_id;

    // Check: if the SI has any market rows for this country, it must be active
    const { rows: marketRows } = await pool.query(
      `SELECT is_active FROM mcogs_sales_item_markets
       WHERE sales_item_id=$1 AND country_id=$2`,
      [sales_item_id, countryId]
    );
    if (marketRows.length && !marketRows[0].is_active) {
      return res.status(400).json({
        error: { message: 'This Sales Item is not active in the menu\'s market' }
      });
    }

    const client = await pool.connect();
    let newMsi;
    try {
      await client.query('BEGIN');

      const { rows: inserted } = await client.query(
        `INSERT INTO mcogs_menu_sales_items (menu_id, sales_item_id, qty, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (menu_id, sales_item_id) DO UPDATE SET qty=$3, sort_order=$4
         RETURNING *`,
        [menu_id, sales_item_id, qty || 1, sort_order || 0]
      );
      newMsi = inserted[0];

      // Copy default prices from mcogs_sales_item_prices (if not already present)
      await client.query(
        `INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price, tax_rate_id)
         SELECT $1, sip.price_level_id, sip.sell_price, sip.tax_rate_id
         FROM   mcogs_sales_item_prices sip
         WHERE  sip.sales_item_id = $2
         ON CONFLICT (menu_sales_item_id, price_level_id) DO NOTHING`,
        [newMsi.id, sales_item_id]
      );

      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const full = await fetchRow(newMsi.id);
    logAudit(pool, req, { action: 'create', entity_type: 'menu_sales_item', entity_id: newMsi.id, entity_label: `SI #${sales_item_id} on menu #${menu_id}` });
    res.status(201).json(full);
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id ────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { qty, sort_order, allergen_notes } = req.body;
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_menu_sales_items SET qty=$1, sort_order=$2, allergen_notes=$3
       WHERE id=$4 RETURNING *`,
      [qty || 1, sort_order || 0, allergen_notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'menu_sales_item', entity_id: rows[0].id, entity_label: `MSI #${rows[0].id}`, field_changes: diffFields(old, rows[0], ['sales_item_id', 'sort_order', 'qty', 'allergen_notes']) });
    const full = await fetchRow(rows[0].id);
    res.json(full);
  } catch (err) { next(err); }
});

// ─── DELETE /menu-sales-items/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'menu_sales_item', entity_id: old?.id, entity_label: `MSI #${req.params.id}` });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id/prices ─────────────────────────────────────────
// Upsert a single price level override
router.put('/:id/prices', async (req, res, next) => {
  try {
    const { price_level_id, sell_price, tax_rate_id } = req.body;
    if (!price_level_id) return res.status(400).json({ error: { message: 'price_level_id is required' } });

    await pool.query(
      `INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price, tax_rate_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (menu_sales_item_id, price_level_id)
       DO UPDATE SET sell_price=$3, tax_rate_id=$4`,
      [req.params.id, price_level_id, sell_price ?? 0, tax_rate_id || null]
    );

    const full = await fetchRow(req.params.id);
    if (!full) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    res.json(full);
  } catch (err) { next(err); }
});

// ─── GET /menu-sales-items/:id/price-diff ─────────────────────────────────────
// Returns per price level: default vs menu price + is_overridden flag
router.get('/:id/price-diff', async (req, res, next) => {
  try {
    const { rows: msiRows } = await pool.query(
      'SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]
    );
    if (!msiRows.length) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    const siId = msiRows[0].sales_item_id;

    const { rows } = await pool.query(
      `SELECT pl.id AS price_level_id,
              pl.name AS price_level_name,
              sip.sell_price AS default_price,
              msip.sell_price AS menu_price,
              (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
       FROM   mcogs_price_levels pl
       LEFT JOIN mcogs_sales_item_prices sip
                 ON sip.sales_item_id = $1 AND sip.price_level_id = pl.id
       LEFT JOIN mcogs_menu_sales_item_prices msip
                 ON msip.menu_sales_item_id = $2 AND msip.price_level_id = pl.id
       ORDER  BY pl.id`,
      [siId, req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── Helpers: load sub-price structure ────────────────────────────────────────

async function loadModifierGroupsForItem(salesItemId, msiId, costCtx) {
  const { rows: mgRows } = await pool.query(
    `SELECT mg.id AS modifier_group_id, mg.name, mg.display_name, mg.min_select, mg.max_select, mg.allow_repeat_selection, mg.default_auto_show, simgj.auto_show
     FROM   mcogs_sales_item_modifier_groups simgj
     JOIN   mcogs_modifier_groups mg ON mg.id = simgj.modifier_group_id
     WHERE  simgj.sales_item_id = $1
     ORDER  BY simgj.sort_order, mg.name`,
    [salesItemId]
  );
  if (!mgRows.length) return [];

  const mgIds = mgRows.map(r => r.modifier_group_id);
  // Pull qty + linked recipe yield so we can compute per-option cost.
  const { rows: optRows } = await pool.query(
    `SELECT mo.id, mo.modifier_group_id, mo.name, mo.display_name, mo.item_type,
            mo.recipe_id, mo.ingredient_id, mo.manual_cost, mo.qty,
            r.yield_qty AS recipe_yield_qty
     FROM   mcogs_modifier_options mo
     LEFT JOIN mcogs_recipes r ON r.id = mo.recipe_id
     WHERE  mo.modifier_group_id = ANY($1)
     ORDER  BY mo.sort_order, mo.id`,
    [mgIds]
  );

  const optIds = optRows.map(o => o.id);
  const priceMap = {};
  if (optIds.length) {
    const { rows: pr } = await pool.query(
      `SELECT modifier_option_id, price_level_id, sell_price
       FROM   mcogs_menu_modifier_option_prices
       WHERE  menu_sales_item_id = $1 AND modifier_option_id = ANY($2)`,
      [msiId, optIds]
    );
    for (const p of pr) {
      if (!priceMap[p.modifier_option_id]) priceMap[p.modifier_option_id] = {};
      priceMap[p.modifier_option_id][p.price_level_id] = Number(p.sell_price);
    }
  }

  // Compute per-option cost (USD base × exchange_rate = market currency).
  // qty multiplier is applied here so the figure reflects the actual amount
  // consumed per selection (e.g. 50 g sauce vs 100 g).
  const computeCost = (o) => {
    if (!costCtx) return 0;
    const unit = _optionUnitCost(o, costCtx.countryId, costCtx.quoteLookup, costCtx.recipeItemsMap, costCtx.variationMap, costCtx.plVariationMap, costCtx.marketPlVariationMap, costCtx.priceLevelId);
    const qty = Number(o.qty || 1);
    return unit * qty * (costCtx.exchangeRate || 1);
  };

  const optByMg = {};
  for (const o of optRows) {
    if (!optByMg[o.modifier_group_id]) optByMg[o.modifier_group_id] = [];
    const cost = computeCost(o);
    optByMg[o.modifier_group_id].push({
      id: o.id, name: o.name, display_name: o.display_name || null,
      item_type: o.item_type, qty: Number(o.qty || 1),
      cost,
      prices: priceMap[o.id] || {},
    });
  }
  return mgRows.map(mg => {
    const opts = optByMg[mg.modifier_group_id] || [];
    const costs = opts.map(o => o.cost || 0);
    const avg_cost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    const min_cost = costs.length ? Math.min(...costs) : 0;
    const max_cost = costs.length ? Math.max(...costs) : 0;
    return {
      modifier_group_id: mg.modifier_group_id,
      name: mg.name,
      display_name: mg.display_name || null,
      min_select: mg.min_select,
      max_select: mg.max_select,
      allow_repeat_selection: mg.allow_repeat_selection || false,
      auto_show: mg.auto_show != null ? mg.auto_show : (mg.default_auto_show ?? true),
      avg_cost, min_cost, max_cost,
      options: opts,
    };
  });
}

async function loadComboStructure(comboId, msiId, costCtx) {
  const { rows: steps } = await pool.query(
    `SELECT id, name, sort_order, min_select, max_select, auto_select
     FROM   mcogs_combo_steps WHERE combo_id = $1 ORDER BY sort_order`, [comboId]
  );
  if (!steps.length) return [];

  const stepIds = steps.map(s => s.id);
  const { rows: opts } = await pool.query(
    `SELECT cso.id, cso.combo_step_id, cso.name, cso.display_name, cso.item_type,
            cso.recipe_id, cso.ingredient_id, cso.manual_cost,
            r.yield_qty AS recipe_yield_qty
     FROM   mcogs_combo_step_options cso
     LEFT JOIN mcogs_recipes r ON r.id = cso.recipe_id
     WHERE  cso.combo_step_id = ANY($1) ORDER BY cso.sort_order`, [stepIds]
  );

  const optIds = opts.map(o => o.id);
  const priceMap = {};
  if (optIds.length) {
    const { rows: pr } = await pool.query(
      `SELECT combo_step_option_id, price_level_id, sell_price
       FROM   mcogs_menu_combo_option_prices
       WHERE  menu_sales_item_id = $1 AND combo_step_option_id = ANY($2)`,
      [msiId, optIds]
    );
    for (const p of pr) {
      if (!priceMap[p.combo_step_option_id]) priceMap[p.combo_step_option_id] = {};
      priceMap[p.combo_step_option_id][p.price_level_id] = Number(p.sell_price);
    }
  }

  const computeOptCost = (o) => {
    if (!costCtx) return 0;
    const unit = _optionUnitCost(o, costCtx.countryId, costCtx.quoteLookup, costCtx.recipeItemsMap, costCtx.variationMap, costCtx.plVariationMap, costCtx.marketPlVariationMap, costCtx.priceLevelId);
    // Combo step options have no qty column — treat as qty=1.
    return unit * (costCtx.exchangeRate || 1);
  };

  // Load modifier groups for each combo step option
  const optModMap = {};
  if (optIds.length) {
    const { rows: csomgRows } = await pool.query(
      `SELECT csomg.combo_step_option_id, mg.id AS modifier_group_id, mg.name, mg.display_name, mg.min_select, mg.max_select, mg.allow_repeat_selection, mg.default_auto_show, csomg.auto_show
       FROM   mcogs_combo_step_option_modifier_groups csomg
       JOIN   mcogs_modifier_groups mg ON mg.id = csomg.modifier_group_id
       WHERE  csomg.combo_step_option_id = ANY($1) ORDER BY csomg.sort_order, mg.name`, [optIds]
    );
    const optMgIds = [...new Set(csomgRows.map(r => r.modifier_group_id))];
    if (optMgIds.length) {
      const { rows: modOptRows } = await pool.query(
        `SELECT mo.id, mo.modifier_group_id, mo.name, mo.display_name, mo.item_type,
                mo.recipe_id, mo.ingredient_id, mo.manual_cost, mo.qty,
                r.yield_qty AS recipe_yield_qty
         FROM   mcogs_modifier_options mo
         LEFT JOIN mcogs_recipes r ON r.id = mo.recipe_id
         WHERE  mo.modifier_group_id = ANY($1) ORDER BY mo.sort_order`, [optMgIds]
      );
      const modOptIds = modOptRows.map(o => o.id);
      const modPriceMap = {};
      if (modOptIds.length) {
        const { rows: mpr } = await pool.query(
          `SELECT modifier_option_id, price_level_id, sell_price
           FROM   mcogs_menu_modifier_option_prices
           WHERE  menu_sales_item_id = $1 AND modifier_option_id = ANY($2)`,
          [msiId, modOptIds]
        );
        for (const p of mpr) {
          if (!modPriceMap[p.modifier_option_id]) modPriceMap[p.modifier_option_id] = {};
          modPriceMap[p.modifier_option_id][p.price_level_id] = Number(p.sell_price);
        }
      }
      const computeModCost = (o) => {
        if (!costCtx) return 0;
        const unit = _optionUnitCost(o, costCtx.countryId, costCtx.quoteLookup, costCtx.recipeItemsMap, costCtx.variationMap, costCtx.plVariationMap, costCtx.marketPlVariationMap, costCtx.priceLevelId);
        const qty = Number(o.qty || 1);
        return unit * qty * (costCtx.exchangeRate || 1);
      };
      const modOptByMg = {};
      for (const o of modOptRows) {
        if (!modOptByMg[o.modifier_group_id]) modOptByMg[o.modifier_group_id] = [];
        modOptByMg[o.modifier_group_id].push({
          id: o.id, name: o.name, display_name: o.display_name || null,
          item_type: o.item_type, qty: Number(o.qty || 1),
          cost: computeModCost(o),
          prices: modPriceMap[o.id] || {},
        });
      }
      for (const r of csomgRows) {
        if (!optModMap[r.combo_step_option_id]) optModMap[r.combo_step_option_id] = [];
        const groupOpts = modOptByMg[r.modifier_group_id] || [];
        const costs = groupOpts.map(o => o.cost || 0);
        const avg_cost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
        const min_cost = costs.length ? Math.min(...costs) : 0;
        const max_cost = costs.length ? Math.max(...costs) : 0;
        optModMap[r.combo_step_option_id].push({
          modifier_group_id: r.modifier_group_id, name: r.name, display_name: r.display_name || null,
          min_select: r.min_select, max_select: r.max_select, allow_repeat_selection: r.allow_repeat_selection || false,
          auto_show: r.auto_show != null ? r.auto_show : (r.default_auto_show ?? true),
          avg_cost, min_cost, max_cost,
          options: groupOpts,
        });
      }
    }
  }

  const optByStep = {};
  for (const o of opts) {
    if (!optByStep[o.combo_step_id]) optByStep[o.combo_step_id] = [];
    optByStep[o.combo_step_id].push({
      id: o.id, name: o.name, display_name: o.display_name || null, item_type: o.item_type,
      cost: computeOptCost(o),
      prices: priceMap[o.id] || {},
      modifier_groups: optModMap[o.id] || [],
    });
  }
  // Per-step avg/min/max cost = average of its options (matches calcComboCost
  // semantics: 1 option = fixed cost, N options = avg cost).
  return steps.map(s => {
    const stepOpts = optByStep[s.id] || [];
    const costs = stepOpts.map(o => o.cost || 0);
    const avg_cost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    const min_cost = costs.length ? Math.min(...costs) : 0;
    const max_cost = costs.length ? Math.max(...costs) : 0;
    return {
      id: s.id, name: s.name, sort_order: s.sort_order,
      min_select: s.min_select, max_select: s.max_select, auto_select: s.auto_select ?? false,
      avg_cost, min_cost, max_cost,
      options: stepOpts,
    };
  });
}

// ─── GET /menu-sales-items/:id/sub-prices ─────────────────────────────────────
// Returns combo steps/options structure + modifier groups/options with menu-level
// prices AND per-option cost (in market currency) so the Menu Engineer can show
// a cost figure next to each modifier/combo option.
router.get('/:id/sub-prices', async (req, res, next) => {
  try {
    const msiId = Number(req.params.id);
    const priceLevelId = req.query.price_level_id ? Number(req.query.price_level_id) : null;
    const { rows: msiRows } = await pool.query(
      `SELECT msi.id, msi.sales_item_id, msi.menu_id,
              si.item_type, si.combo_id,
              m.country_id, c.exchange_rate,
              (SELECT COUNT(*) FROM mcogs_sales_item_modifier_groups WHERE sales_item_id = si.id) AS modifier_group_count
       FROM   mcogs_menu_sales_items msi
       JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
       JOIN   mcogs_menus m ON m.id = msi.menu_id
       JOIN   mcogs_countries c ON c.id = m.country_id
       WHERE  msi.id = $1`, [msiId]
    );
    if (!msiRows.length) return res.status(404).json({ error: { message: 'Not found' } });
    const msi = msiRows[0];

    // Build cost-resolution context once. Recipe-typed options need the deep
    // recipe items map + market/PL variation overrides — same data the COGS
    // engine pulls. Failures here shouldn't block the structural response, so
    // wrap in try/catch and fall back to costCtx=null (cost=0 in the output).
    let costCtx = null;
    try {
      const [quoteLookup, recipeIds] = await Promise.all([
        loadQuoteLookup(),
        // Collect recipe ids referenced by this item's modifier/combo options
        // so loadAllRecipeItemsDeep can pull their full ingredient trees.
        (async () => {
          const ids = new Set();
          if (Number(msi.modifier_group_count) > 0) {
            const { rows } = await pool.query(
              `SELECT DISTINCT mo.recipe_id
               FROM   mcogs_modifier_options mo
               JOIN   mcogs_sales_item_modifier_groups simg ON simg.modifier_group_id = mo.modifier_group_id
               WHERE  simg.sales_item_id = $1 AND mo.recipe_id IS NOT NULL`, [msi.sales_item_id]
            );
            for (const r of rows) if (r.recipe_id) ids.add(r.recipe_id);
          }
          if (msi.item_type === 'combo' && msi.combo_id) {
            const { rows } = await pool.query(
              `SELECT DISTINCT cso.recipe_id
               FROM   mcogs_combo_step_options cso
               JOIN   mcogs_combo_steps cs ON cs.id = cso.combo_step_id
               WHERE  cs.combo_id = $1 AND cso.recipe_id IS NOT NULL
               UNION
               SELECT DISTINCT mo.recipe_id
               FROM   mcogs_modifier_options mo
               JOIN   mcogs_combo_step_option_modifier_groups csomg ON csomg.modifier_group_id = mo.modifier_group_id
               JOIN   mcogs_combo_step_options cso ON cso.id = csomg.combo_step_option_id
               JOIN   mcogs_combo_steps cs ON cs.id = cso.combo_step_id
               WHERE  cs.combo_id = $1 AND mo.recipe_id IS NOT NULL`, [msi.combo_id]
            );
            for (const r of rows) if (r.recipe_id) ids.add(r.recipe_id);
          }
          return [...ids];
        })(),
      ]);
      const [recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap] = await Promise.all([
        loadAllRecipeItemsDeep(recipeIds),
        loadVariationItemsMap(recipeIds),
        loadPlVariationItemsMap(recipeIds),
        loadMarketPlVariationItemsMap(recipeIds),
      ]);
      costCtx = {
        countryId:    msi.country_id,
        exchangeRate: Number(msi.exchange_rate || 1),
        priceLevelId,
        quoteLookup,
        recipeItemsMap,
        variationMap,
        plVariationMap,
        marketPlVariationMap,
      };
    } catch (err) {
      console.warn('[sub-prices] cost context load failed:', err.message);
    }

    const [modifierGroups, comboSteps] = await Promise.all([
      Number(msi.modifier_group_count) > 0
        ? loadModifierGroupsForItem(msi.sales_item_id, msiId, costCtx)
        : Promise.resolve([]),
      msi.item_type === 'combo' && msi.combo_id
        ? loadComboStructure(msi.combo_id, msiId, costCtx)
        : Promise.resolve([]),
    ]);

    res.json({ item_type: msi.item_type, combo_steps: comboSteps, modifier_groups: modifierGroups });
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id/combo-option-price ─────────────────────────────
router.put('/:id/combo-option-price', async (req, res, next) => {
  try {
    const { combo_step_option_id, price_level_id, sell_price } = req.body;
    if (!combo_step_option_id || !price_level_id) {
      return res.status(400).json({ error: { message: 'combo_step_option_id and price_level_id are required' } });
    }
    await pool.query(
      `INSERT INTO mcogs_menu_combo_option_prices (menu_sales_item_id, combo_step_option_id, price_level_id, sell_price)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (menu_sales_item_id, combo_step_option_id, price_level_id)
       DO UPDATE SET sell_price = $4`,
      [req.params.id, combo_step_option_id, price_level_id, sell_price ?? 0]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id/modifier-option-price ─────────────────────────
router.put('/:id/modifier-option-price', async (req, res, next) => {
  try {
    const { modifier_option_id, price_level_id, sell_price } = req.body;
    if (!modifier_option_id || !price_level_id) {
      return res.status(400).json({ error: { message: 'modifier_option_id and price_level_id are required' } });
    }
    await pool.query(
      `INSERT INTO mcogs_menu_modifier_option_prices (menu_sales_item_id, modifier_option_id, price_level_id, sell_price)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (menu_sales_item_id, modifier_option_id, price_level_id)
       DO UPDATE SET sell_price = $4`,
      [req.params.id, modifier_option_id, price_level_id, sell_price ?? 0]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
