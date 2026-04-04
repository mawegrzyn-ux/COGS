const router = require('express').Router();
const pool   = require('../db/pool');

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load all active quotes for every ingredient, keyed by ingredient_id → country_id.
 * Preferred vendor quote wins; cheapest active quote is the fallback.
 * Returns: { [ingredientId]: { [countryId]: { price_per_base_unit, is_preferred } } }
 */
async function loadQuoteLookup() {
  const { rows } = await pool.query(`
    WITH preferred AS (
      SELECT pv.ingredient_id,
             pv.country_id,
             pq.purchase_price,
             pq.qty_in_base_units,
             vc.exchange_rate AS vendor_exchange_rate,
             true AS is_preferred
      FROM   mcogs_ingredient_preferred_vendor pv
      JOIN   mcogs_price_quotes pq ON pq.id  = pv.quote_id
      JOIN   mcogs_vendors      v  ON v.id   = pq.vendor_id
      JOIN   mcogs_countries    vc ON vc.id  = v.country_id
      WHERE  pq.is_active = true
    ),
    fallback AS (
      SELECT DISTINCT ON (pq.ingredient_id, v.country_id)
             pq.ingredient_id,
             v.country_id,
             pq.purchase_price,
             pq.qty_in_base_units,
             vc.exchange_rate AS vendor_exchange_rate,
             false AS is_preferred
      FROM   mcogs_price_quotes pq
      JOIN   mcogs_vendors      v  ON v.id  = pq.vendor_id
      JOIN   mcogs_countries    vc ON vc.id = v.country_id
      WHERE  pq.is_active = true
      ORDER  BY pq.ingredient_id, v.country_id,
                (pq.purchase_price / NULLIF(pq.qty_in_base_units, 0)) ASC
    )
    SELECT * FROM preferred
    UNION ALL
    SELECT f.* FROM fallback f
    WHERE NOT EXISTS (
      SELECT 1 FROM preferred p
      WHERE p.ingredient_id = f.ingredient_id AND p.country_id = f.country_id
    )
  `);
  // Divide by vendor_exchange_rate to normalise from vendor's local currency → USD base.
  // Callers multiply by the target market's exchange_rate to get the correct local display cost.
  const lookup = {};
  for (const q of rows) {
    if (!lookup[q.ingredient_id]) lookup[q.ingredient_id] = {};
    const vendorRate = Math.max(Number(q.vendor_exchange_rate) || 1, 0.000001);
    lookup[q.ingredient_id][q.country_id] = {
      price_per_base_unit: Number(q.qty_in_base_units) > 0
        ? (Number(q.purchase_price) / Number(q.qty_in_base_units)) / vendorRate
        : 0,
      is_preferred: q.is_preferred,
    };
  }
  return lookup;
}

/**
 * Recursively load recipe items for all given recipe IDs, following
 * sub-recipe references (item_type = 'recipe') until no new IDs are found.
 * Also fetches the sub-recipe's yield_qty so calcRecipeCost can portion correctly.
 * Returns: { [recipe_id]: [items...] }
 */
async function loadAllRecipeItemsDeep(topIds) {
  if (!topIds.length) return {};
  const seen  = new Set(topIds.map(Number));
  const queue = [...topIds.map(Number)];
  const allItems = {};

  while (queue.length) {
    const batch = queue.splice(0, queue.length);
    const { rows: riRows } = await pool.query(`
      SELECT ri.*,
             ing.waste_pct,
             ing.base_unit_id,
             sub_r.yield_qty AS sub_recipe_yield_qty
      FROM   mcogs_recipe_items ri
      LEFT JOIN mcogs_ingredients ing  ON ing.id  = ri.ingredient_id
      LEFT JOIN mcogs_recipes     sub_r ON sub_r.id = ri.recipe_item_id
      WHERE  ri.recipe_id = ANY($1::int[])
        AND  ri.variation_id           IS NULL
        AND  ri.pl_variation_id        IS NULL
        AND  ri.market_pl_variation_id IS NULL
    `, [batch]);

    for (const ri of riRows) {
      if (!allItems[ri.recipe_id]) allItems[ri.recipe_id] = [];
      allItems[ri.recipe_id].push(ri);
      if (ri.item_type === 'recipe' && ri.recipe_item_id) {
        const subId = Number(ri.recipe_item_id);
        if (!seen.has(subId)) { seen.add(subId); queue.push(subId); }
      }
    }
  }
  return allItems;
}

/**
 * Load variation items for a set of recipe IDs.
 * Returns: { [recipe_id]: { [country_id]: [items_with_waste_pct...] } }
 */
async function loadVariationItemsMap(recipeIds) {
  if (!recipeIds.length) return {};
  const { rows } = await pool.query(`
    SELECT rv.recipe_id,
           rv.country_id,
           ri.*,
           i.waste_pct,
           sub_r.yield_qty AS sub_recipe_yield_qty
    FROM   mcogs_recipe_variations rv
    JOIN   mcogs_recipe_items ri ON ri.variation_id = rv.id
    LEFT JOIN mcogs_ingredients i     ON i.id     = ri.ingredient_id
    LEFT JOIN mcogs_recipes     sub_r ON sub_r.id = ri.recipe_item_id
    WHERE  rv.recipe_id = ANY($1::int[])
    ORDER  BY rv.recipe_id, rv.country_id, ri.id ASC
  `, [recipeIds]);

  const map = {};
  for (const row of rows) {
    if (!map[row.recipe_id]) map[row.recipe_id] = {};
    if (!map[row.recipe_id][row.country_id]) map[row.recipe_id][row.country_id] = [];
    map[row.recipe_id][row.country_id].push(row);
  }
  return map;
}

/**
 * Load price-level variation items for a set of recipe IDs.
 * Returns: { [recipe_id]: { [price_level_id]: [items_with_waste_pct...] } }
 */
async function loadPlVariationItemsMap(recipeIds) {
  if (!recipeIds.length) return {};
  const { rows } = await pool.query(`
    SELECT plv.recipe_id,
           plv.price_level_id,
           ri.*,
           i.waste_pct,
           sub_r.yield_qty AS sub_recipe_yield_qty
    FROM   mcogs_recipe_pl_variations plv
    JOIN   mcogs_recipe_items ri ON ri.pl_variation_id = plv.id
    LEFT JOIN mcogs_ingredients i     ON i.id     = ri.ingredient_id
    LEFT JOIN mcogs_recipes     sub_r ON sub_r.id = ri.recipe_item_id
    WHERE  plv.recipe_id = ANY($1::int[])
    ORDER  BY plv.recipe_id, plv.price_level_id, ri.id ASC
  `, [recipeIds]);

  const map = {};
  for (const row of rows) {
    if (!map[row.recipe_id])                    map[row.recipe_id] = {};
    if (!map[row.recipe_id][row.price_level_id]) map[row.recipe_id][row.price_level_id] = [];
    map[row.recipe_id][row.price_level_id].push(row);
  }
  return map;
}

/**
 * Load market+price-level variation items for a set of recipe IDs.
 * Returns: { [recipe_id]: { [country_id]: { [price_level_id]: [items...] } } }
 */
async function loadMarketPlVariationItemsMap(recipeIds) {
  if (!recipeIds.length) return {};
  const { rows } = await pool.query(`
    SELECT mplv.recipe_id,
           mplv.country_id,
           mplv.price_level_id,
           ri.*,
           i.waste_pct,
           sub_r.yield_qty AS sub_recipe_yield_qty
    FROM   mcogs_recipe_market_pl_variations mplv
    JOIN   mcogs_recipe_items ri ON ri.market_pl_variation_id = mplv.id
    LEFT JOIN mcogs_ingredients i     ON i.id     = ri.ingredient_id
    LEFT JOIN mcogs_recipes     sub_r ON sub_r.id = ri.recipe_item_id
    WHERE  mplv.recipe_id = ANY($1::int[])
    ORDER  BY mplv.recipe_id, mplv.country_id, mplv.price_level_id, ri.id ASC
  `, [recipeIds]);

  const map = {};
  for (const row of rows) {
    if (!map[row.recipe_id])                                          map[row.recipe_id] = {};
    if (!map[row.recipe_id][row.country_id])                          map[row.recipe_id][row.country_id] = {};
    if (!map[row.recipe_id][row.country_id][row.price_level_id])      map[row.recipe_id][row.country_id][row.price_level_id] = [];
    map[row.recipe_id][row.country_id][row.price_level_id].push(row);
  }
  return map;
}

/**
 * Calculate cost-per-portion for one recipe in one country.
 * Handles both direct ingredients and sub-recipe items (item_type = 'recipe') recursively.
 * allRecipeItemsMap must include items for every sub-recipe referenced in the tree.
 */
function calcRecipeCost(recipe, globalItems, countryId, quoteLookup, variationMap, allRecipeItemsMap = {}, _visited = null, priceLevelId = null, plVariationMap = {}, marketPlVariationMap = {}) {
  // Guard against circular references (A → B → A). Clone on first call so each
  // top-level invocation gets its own visited set and sibling sub-recipes are
  // allowed to appear more than once at different branches.
  const visited = _visited ? new Set(_visited) : new Set([Number(recipe.id)]);

  // Priority: market+PL > market > PL > global
  const mktPlItems = (priceLevelId && countryId) ? marketPlVariationMap?.[recipe.id]?.[countryId]?.[priceLevelId] : null;
  const mktItems   = variationMap?.[recipe.id]?.[countryId];
  const plItems    = priceLevelId ? plVariationMap?.[recipe.id]?.[priceLevelId] : null;
  const items = (mktPlItems && mktPlItems.length) ? mktPlItems
    : (mktItems && mktItems.length) ? mktItems
    : (plItems  && plItems.length)  ? plItems
    : globalItems;
  let total = 0, preferredCount = 0, quotedCount = 0, leafCount = 0;

  for (const item of items) {
    if (item.item_type === 'ingredient') {
      leafCount++;
      const q = quoteLookup[item.ingredient_id]?.[countryId];
      if (!q) continue;
      if (q.is_preferred) preferredCount++;
      quotedCount++;
      const base_qty   = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
      const waste_mult = 1 + (Number(item.waste_pct ?? 0) / 100);
      total += base_qty * waste_mult * q.price_per_base_unit;

    } else if (item.item_type === 'recipe' && item.recipe_item_id) {
      // Sub-recipe: recursively calculate its cost-per-portion then scale by usage qty
      leafCount++;
      const subId = Number(item.recipe_item_id);

      // Skip this branch if it would create a cycle — treat it as uncosted
      if (visited.has(subId)) continue;

      const subYield  = Number(item.sub_recipe_yield_qty || 1);
      const subItems  = allRecipeItemsMap[subId] || [];
      // Pass visited with the current recipe already in it so the child
      // cannot recurse back up through any ancestor in this branch.
      const subVisited = new Set(visited);
      subVisited.add(subId);
      const subResult = calcRecipeCost(
        { id: subId, yield_qty: subYield },
        subItems,
        countryId,
        quoteLookup,
        variationMap,
        allRecipeItemsMap,
        subVisited,
        priceLevelId,
        plVariationMap,
        marketPlVariationMap,
      );
      const usage = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
      total += subResult.cost * usage;
      // Propagate coverage from sub-recipe
      if (subResult.coverage === 'fully_preferred') preferredCount++;
      if (subResult.coverage !== 'not_quoted')      quotedCount++;
    }
  }

  const n = leafCount;
  let coverage;
  if (n === 0)                    coverage = 'fully_preferred';
  else if (preferredCount === n)  coverage = 'fully_preferred';
  else if (quotedCount    === n)  coverage = 'fully_quoted';
  else if (quotedCount    >  0)   coverage = 'partially_quoted';
  else                            coverage = 'not_quoted';

  const yield_qty = Math.max(1, Number(recipe.yield_qty || 1));
  return { cost: total / yield_qty, coverage };
}

/**
 * Resolve the effective tax rate for a menu item in a given country + price level.
 * Priority: explicit tax_rate_id on item → country_level_tax for (country, level) → country default → 0
 */
async function resolveItemTax(taxRateId, countryId, priceLevelId, defaultTaxMap, taxRateCache) {
  // Explicit override
  if (taxRateId) {
    if (!taxRateCache[taxRateId]) {
      const { rows: [r] } = await pool.query(
        `SELECT rate, name FROM mcogs_country_tax_rates WHERE id = $1`, [taxRateId]
      );
      taxRateCache[taxRateId] = r || { rate: 0, name: 'Unknown' };
    }
    return { rate: Number(taxRateCache[taxRateId].rate), name: taxRateCache[taxRateId].name };
  }
  // country_level_tax default for this level
  if (priceLevelId && countryId) {
    const { rows: [clt] } = await pool.query(`
      SELECT tr.rate, tr.name
      FROM   mcogs_country_level_tax clt
      JOIN   mcogs_country_tax_rates tr ON tr.id = clt.tax_rate_id
      WHERE  clt.country_id = $1 AND clt.price_level_id = $2
      LIMIT 1
    `, [countryId, priceLevelId]);
    if (clt) return { rate: Number(clt.rate), name: clt.name };
  }
  // Country default
  return defaultTaxMap[countryId] || { rate: 0, name: 'No Tax' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /cogs/menu/:menu_id
//  Optional query: ?price_level_id=X
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/menu/:menu_id', async (req, res) => {
  const menuId       = Number(req.params.menu_id);
  const priceLevelId = req.query.price_level_id ? Number(req.query.price_level_id) : null;

  try {
    // Menu + country
    const { rows: [menu] } = await pool.query(`
      SELECT m.*, c.currency_symbol, c.currency_code, c.exchange_rate
      FROM   mcogs_menus m
      JOIN   mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [menuId]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menu.country_id;

    // All items on this menu
    const { rows: items } = await pool.query(`
      SELECT mi.*,
             r.name         AS recipe_name,
             cat.name       AS recipe_category,
             r.yield_qty,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr,
             ri_items.item_count
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes         r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_categories      cat ON cat.id = r.category_id
      LEFT JOIN mcogs_ingredients     ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units           u   ON u.id   = ing.base_unit_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_recipe_items WHERE recipe_id = r.id
      ) ri_items ON true
      WHERE  mi.menu_id = $1
      ORDER BY mi.id ASC
    `, [menuId]);

    // Recipe items for every recipe referenced on this menu (deep — includes sub-recipes)
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    const recipeItemsMap = await loadAllRecipeItemsDeep(recipeIds);

    // Quote lookup & country default taxes
    const [quoteLookup, { rows: defaultTaxRows }] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`
        SELECT country_id, rate, name
        FROM   mcogs_country_tax_rates
        WHERE  is_default = true
      `),
    ]);
    const defaultTaxMap = {};
    for (const r of defaultTaxRows) {
      defaultTaxMap[r.country_id] = { rate: Number(r.rate), name: r.name };
    }

    // Price level prices if requested
    let levelPriceMap = {};
    if (priceLevelId && items.length) {
      const itemIds = items.map(i => i.id);
      const { rows: lpRows } = await pool.query(`
        SELECT * FROM mcogs_menu_item_prices
        WHERE  menu_item_id = ANY($1::int[]) AND price_level_id = $2
      `, [itemIds, priceLevelId]);
      for (const lp of lpRows) levelPriceMap[lp.menu_item_id] = lp;
    }

    const [variationMap, plVariationMap] = await Promise.all([
      loadVariationItemsMap(recipeIds),
      loadPlVariationItemsMap(recipeIds),
    ]);

    const taxRateCache = {};
    const outItems = [];
    let totalCost = 0, totalSellNet = 0, totalSellGross = 0;

    for (const item of items) {
      const itemType  = item.item_type || 'recipe';
      const qty       = Number(item.qty || 1);
      const display   = item.display_name?.trim() ||
                        (itemType === 'ingredient' ? item.ingredient_name : item.recipe_name) || '—';

      // Cost per portion — calcRecipeCost returns USD base; convert to local currency
      // Uses PL variant items for this price level if they exist, otherwise market variant / global
      let cpp = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cpp = q.price_per_base_unit * qty;
      } else {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const recipe = { id: item.recipe_id, yield_qty: item.yield_qty || 1 };
        const { cost } = calcRecipeCost(recipe, rItems, countryId, quoteLookup, variationMap, recipeItemsMap, null, priceLevelId, plVariationMap);
        cpp = cost * qty;
      }
      cpp = Math.round(cpp * Number(menu.exchange_rate) * 10000) / 10000;

      // Resolve sell price
      const lp = levelPriceMap[item.id];
      let sellGross    = 0;
      let useTaxRateId = item.tax_rate_id;
      if (priceLevelId && lp) {
        sellGross = Number(lp.sell_price);
        if (lp.tax_rate_id) useTaxRateId = lp.tax_rate_id;
      } else {
        sellGross = Number(item.sell_price || 0);
      }

      // Resolve tax
      const { rate: taxRate, name: taxName } = await resolveItemTax(
        useTaxRateId, countryId, priceLevelId, defaultTaxMap, taxRateCache
      );

      const sellNet  = taxRate > 0 ? sellGross / (1 + taxRate) : sellGross;
      const gpNet    = Math.round((sellNet  - cpp) * 10000) / 10000;
      const gpGross  = Math.round((sellGross - cpp) * 10000) / 10000;
      const cogsPctNet   = sellNet   > 0 ? Math.round((cpp / sellNet)   * 10000) / 100 : 0;
      const cogsPctGross = sellGross > 0 ? Math.round((cpp / sellGross) * 10000) / 100 : 0;

      totalCost      += cpp;
      totalSellNet   += Math.round(sellNet   * 10000) / 10000;
      totalSellGross += Math.round(sellGross * 10000) / 10000;

      outItems.push({
        menu_item_id:    item.id,
        item_type:       itemType,
        recipe_id:       item.recipe_id    || null,
        ingredient_id:   item.ingredient_id || null,
        display_name:    display,
        recipe_name:     display,
        category:        item.recipe_category || '',
        qty,
        base_unit_abbr:  item.base_unit_abbr || '',
        cost_per_portion: cpp,
        sell_price_gross: Math.round(sellGross * 10000) / 10000,
        sell_price_net:   Math.round(sellNet   * 10000) / 10000,
        tax_rate:         taxRate,
        tax_rate_pct:     Math.round(taxRate * 10000) / 100,
        tax_name:         taxName,
        tax_rate_id:      useTaxRateId || null,
        gp_net:           gpNet,
        gp_gross:         gpGross,
        cogs_pct_net:     cogsPctNet,
        cogs_pct_gross:   cogsPctGross,
      });
    }

    res.json({
      menu_id:         menuId,
      currency_code:   menu.currency_code   || '',
      currency_symbol: menu.currency_symbol || '',
      exchange_rate:   Number(menu.exchange_rate) || 1,
      items: outItems,
      summary: {
        total_cost:         Math.round(totalCost      * 10000) / 10000,
        total_sell_net:     Math.round(totalSellNet   * 10000) / 10000,
        total_sell_gross:   Math.round(totalSellGross * 10000) / 10000,
        avg_cogs_pct_net:   totalSellNet   > 0 ? Math.round((totalCost / totalSellNet)   * 10000) / 100 : 0,
        avg_cogs_pct_gross: totalSellGross > 0 ? Math.round((totalCost / totalSellGross) * 10000) / 100 : 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to calculate menu COGS' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /cogs/report/price-levels?country_id=X
//  All menu items in a country × all price levels with gross/net/COGS%
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/report/price-levels', async (req, res) => {
  const countryId = Number(req.query.country_id);
  if (!countryId) return res.status(400).json({ error: { message: 'country_id is required' } });

  try {
    const { rows: [country] } = await pool.query(
      `SELECT * FROM mcogs_countries WHERE id = $1`, [countryId]
    );
    if (!country) return res.status(404).json({ error: { message: 'Country not found' } });

    const { rows: levels } = await pool.query(
      `SELECT * FROM mcogs_price_levels ORDER BY name`
    );

    // All menu items in this country's menus
    const { rows: items } = await pool.query(`
      SELECT mi.*,
             r.name         AS recipe_name,
             cat.name       AS recipe_category,
             r.yield_qty,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr,
             m.name         AS menu_name
      FROM   mcogs_menu_items mi
      JOIN   mcogs_menus          m   ON m.id   = mi.menu_id
      LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_categories  cat ON cat.id = r.category_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  m.country_id = $1
      ORDER BY COALESCE(NULLIF(mi.display_name,''), r.name, ing.name) ASC
    `, [countryId]);

    if (!items.length) {
      return res.json({ country: formatCountry(country), levels: levels.map(formatLevel), items: [] });
    }

    // All level prices for these items in one query
    const itemIds = items.map(i => i.id);
    const { rows: lpRows } = await pool.query(`
      SELECT * FROM mcogs_menu_item_prices WHERE menu_item_id = ANY($1::int[])
    `, [itemIds]);
    const lpMap = {};  // menu_item_id → price_level_id → row
    for (const lp of lpRows) {
      if (!lpMap[lp.menu_item_id]) lpMap[lp.menu_item_id] = {};
      lpMap[lp.menu_item_id][lp.price_level_id] = lp;
    }

    // Recipe items for every recipe (deep — includes sub-recipes)
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    const recipeItemsMap = await loadAllRecipeItemsDeep(recipeIds);

    // Quote lookup, default taxes, country_level_tax
    const [quoteLookup, { rows: defaultTaxRows }, { rows: cltRows }, { rows: taxRateRows }] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`SELECT country_id, rate, name FROM mcogs_country_tax_rates WHERE is_default = true`),
      pool.query(`
        SELECT clt.country_id, clt.price_level_id, tr.rate, tr.name
        FROM   mcogs_country_level_tax clt
        JOIN   mcogs_country_tax_rates tr ON tr.id = clt.tax_rate_id
      `),
      pool.query(`SELECT id, rate, name FROM mcogs_country_tax_rates`),
    ]);
    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = { rate: Number(r.rate), name: r.name };
    const cltMap = {};  // country_id-level_id → { rate, name }
    for (const r of cltRows) cltMap[`${r.country_id}-${r.price_level_id}`] = { rate: Number(r.rate), name: r.name };
    const taxById = {};
    for (const r of taxRateRows) taxById[r.id] = { rate: Number(r.rate), name: r.name };

    const [variationMap, plVariationMap] = await Promise.all([
      loadVariationItemsMap(recipeIds),
      loadPlVariationItemsMap(recipeIds),
    ]);

    const report = items.map(item => {
      const itemType = item.item_type || 'recipe';
      const display  = item.display_name?.trim() ||
                       (itemType === 'ingredient' ? item.ingredient_name : item.recipe_name) || '—';
      const qty      = Number(item.qty || 1);
      const exRate   = Number(country.exchange_rate);

      // Helper: compute cost-per-portion for a specific price level.
      // For ingredients: cost is the same regardless of price level.
      // For recipes: uses PL variant items if they exist for this level, else market/global.
      function getCppForLevel(levelId) {
        if (itemType === 'ingredient') {
          const q = quoteLookup[item.ingredient_id]?.[countryId];
          return q ? Math.round(q.price_per_base_unit * qty * exRate * 10000) / 10000 : 0;
        }
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const { cost } = calcRecipeCost(
          { id: item.recipe_id, yield_qty: item.yield_qty || 1 },
          rItems, countryId, quoteLookup, variationMap, recipeItemsMap,
          null, levelId, plVariationMap,
        );
        return Math.round(cost * qty * exRate * 10000) / 10000;
      }

      // Base cost (no price level — used for the top-level `cost` field and as fallback)
      const baseCpp = getCppForLevel(null);

      // Helper: resolve effective tax rate for a price level
      function getEffectiveTax(taxRateId, levelId) {
        if (taxRateId && taxById[taxRateId]) return taxById[taxRateId];
        const clt = cltMap[`${countryId}-${levelId}`];
        if (clt) return clt;
        return defaultTaxMap[countryId] || { rate: 0, name: 'No Tax' };
      }

      // Build per-level prices — each level gets its own cpp (may differ when PL variant exists)
      const rowLevels = {};
      for (const level of levels) {
        const lid = level.id;
        const lp  = lpMap[item.id]?.[lid];
        if (!lp) {
          rowLevels[lid] = { set: false, gross: null, net: null, cogs_pct: null, gp_net: null };
          continue;
        }
        const cpp   = getCppForLevel(lid);
        const gross = Number(lp.sell_price);
        const { rate: taxRate } = getEffectiveTax(lp.tax_rate_id, lid);
        const net     = taxRate > 0 ? gross / (1 + taxRate) : gross;
        const cogsPct = net > 0 && cpp > 0 ? Math.round((cpp / net) * 10000) / 100 : null;
        rowLevels[lid] = {
          set:      true,
          gross:    Math.round(gross * 10000) / 10000,
          net:      Math.round(net   * 10000) / 10000,
          cogs_pct: cogsPct,
          gp_net:   Math.round((net - cpp) * 10000) / 10000,
          lp_id:    lp.id,
          cost:     cpp,   // per-level cost (may differ from baseCpp when PL variant exists)
        };
      }

      return {
        menu_item_id: item.id,
        display_name: display,
        item_type:    itemType,
        menu_name:    item.menu_name || '',
        category:     item.recipe_category || '',
        cost:         baseCpp,
        levels:       rowLevels,
      };
    });

    res.json({
      country: formatCountry(country),
      levels:  levels.map(formatLevel),
      items:   report,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate price level report' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /cogs/report/menu-prices
//  Recipes × countries: sell prices (gross + net) + COGS%
//  Optional: ?price_level_id=X
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/report/menu-prices', async (req, res) => {
  const priceLevelId = req.query.price_level_id ? Number(req.query.price_level_id) : null;

  try {
    const [
      { rows: countries },
      { rows: priceLevels },
      { rows: recipes },
      { rows: defaultTaxRows },
      quoteLookup,
    ] = await Promise.all([
      pool.query(`SELECT * FROM mcogs_countries ORDER BY name`),
      pool.query(`SELECT * FROM mcogs_price_levels ORDER BY name`),
      pool.query(`
        SELECT DISTINCT r.id, r.name AS recipe_name, cat.name AS category, r.yield_qty
        FROM   mcogs_recipes r
        LEFT JOIN mcogs_categories cat ON cat.id = r.category_id
        JOIN   mcogs_menu_items mi ON mi.recipe_id = r.id
        ORDER BY r.name
      `),
      pool.query(`SELECT country_id, rate FROM mcogs_country_tax_rates WHERE is_default = true`),
      loadQuoteLookup(),
    ]);

    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = Number(r.rate);

    // Recipe items for all referenced recipes (deep — includes sub-recipes)
    const recipeIds = recipes.map(r => r.id);
    const recipeItemsMap = await loadAllRecipeItemsDeep(recipeIds);

    // All menu items for these recipes (across all menus/countries)
    const { rows: menuItemRows } = await pool.query(`
      SELECT mi.id AS menu_item_id, mi.recipe_id, mi.sell_price, mi.tax_rate_id, mi.qty,
             m.country_id, m.id AS menu_id, m.name AS menu_name
      FROM   mcogs_menu_items mi
      JOIN   mcogs_menus m ON m.id = mi.menu_id
      WHERE  mi.recipe_id = ANY($1::int[])
    `, [recipeIds]);

    // Level prices if needed
    let levelPriceMap = {};  // menu_item_id → sell_price
    if (priceLevelId) {
      const miIds = menuItemRows.map(r => r.menu_item_id);
      if (miIds.length) {
        const { rows: lpRows } = await pool.query(`
          SELECT menu_item_id, sell_price, tax_rate_id
          FROM   mcogs_menu_item_prices
          WHERE  menu_item_id = ANY($1::int[]) AND price_level_id = $2
        `, [miIds, priceLevelId]);
        for (const lp of lpRows) levelPriceMap[lp.menu_item_id] = lp;
      }
    }

    // Settings for base currency
    const { rows: [settings] } = await pool.query(
      `SELECT value FROM mcogs_settings WHERE key = 'base_currency' LIMIT 1`
    ).catch(() => ({ rows: [null] }));
    const baseCurrency = settings?.value ? JSON.parse(settings.value) : { code: 'USD', symbol: '$', name: 'US Dollar' };

    // Pre-load all tax rates referenced by menu items (avoids await inside map)
    const allTaxRateIds = [...new Set([
      ...menuItemRows.map(r => r.tax_rate_id),
      ...Object.values(levelPriceMap).map(lp => lp.tax_rate_id),
    ].filter(Boolean))];
    const taxById = {};
    if (allTaxRateIds.length) {
      const { rows: taxRows } = await pool.query(
        `SELECT id, rate FROM mcogs_country_tax_rates WHERE id = ANY($1::int[])`, [allTaxRateIds]
      );
      for (const t of taxRows) taxById[t.id] = Number(t.rate);
    }

    const variationMap = await loadVariationItemsMap(recipeIds);

    // Build report
    const report = recipes.map(recipe => {
      const recipeId = recipe.id;
      const rItems   = recipeItemsMap[recipeId] || [];
      const row      = {
        recipe_id:   recipeId,
        recipe_name: recipe.recipe_name,
        category:    recipe.category || '',
        countries:   {},
      };

      for (const country of countries) {
        const cid = country.id;
        const itemsInCountry = menuItemRows.filter(
          mi => Number(mi.recipe_id) === recipeId && Number(mi.country_id) === cid
        );
        if (!itemsInCountry.length) {
          row.countries[cid] = [];
          continue;
        }

        const { cost } = calcRecipeCost(recipe, rItems, cid, quoteLookup, variationMap, recipeItemsMap);
        const cppLocal = cost * Number(country.exchange_rate); // USD base → local currency
        const defaultRate = defaultTaxMap[cid] || 0;

        row.countries[cid] = itemsInCountry.map(mi => {
          let gross     = Number(mi.sell_price || 0);
          let taxRateId = mi.tax_rate_id;
          if (priceLevelId) {
            const lp = levelPriceMap[mi.menu_item_id];
            if (lp) { gross = Number(lp.sell_price); if (lp.tax_rate_id) taxRateId = lp.tax_rate_id; }
          }
          const rate    = taxRateId && taxById[taxRateId] !== undefined ? taxById[taxRateId] : defaultRate;
          const net     = rate > 0 ? gross / (1 + rate) : gross;
          const cogsPct = net > 0 && cppLocal > 0 ? Math.round((cppLocal / net) * 10000) / 100 : null;
          return {
            on_menu:      true,
            menu_id:      mi.menu_id,
            menu_name:    mi.menu_name,
            sell_gross:   Math.round(gross   * 10000) / 10000,
            sell_net:     Math.round(net     * 10000) / 10000,
            cost:         Math.round(cppLocal * 10000) / 10000,
            cogs_pct:     cogsPct,
            menu_item_id: mi.menu_item_id,
            rate:         Number(country.exchange_rate),
          };
        });
      }
      return row;
    });

    res.json({
      recipes:       report,
      countries:     countries.map(c => ({
        id:     c.id,
        name:   c.name,
        code:   c.currency_code,
        symbol: c.currency_symbol,
        rate:   Number(c.exchange_rate),
      })),
      price_levels:  priceLevels.map(formatLevel),
      base_currency: baseCurrency,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate menu price report' } });
  }
});

// ── Formatters ────────────────────────────────────────────────────────────────
function formatCountry(c) {
  return { id: c.id, name: c.name, symbol: c.currency_symbol, code: c.currency_code, rate: Number(c.exchange_rate) };
}
function formatLevel(l) {
  return { id: l.id, name: l.name, sort_order: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /cogs/menu-sales/:menu_id
//  COGS for menus using the Sales Items system (item_type: recipe/ingredient/manual/combo)
//  Optional query: ?price_level_id=X
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Batch-load combo steps, options, and modifier groups for a set of combo Sales Item IDs.
 * Returns: { [sales_item_id]: { steps: [{ ...step, options: [{ ...opt, modifier_groups: [...] }] }] } }
 */
async function loadComboData(comboIds) {
  if (!comboIds.length) return {};

  const { rows: steps } = await pool.query(
    `SELECT * FROM mcogs_combo_steps WHERE sales_item_id = ANY($1::int[]) ORDER BY sales_item_id, sort_order`,
    [comboIds]
  );
  if (!steps.length) return {};

  const stepIds = steps.map(s => s.id);
  const [optsResult, modsResult] = await Promise.all([
    pool.query(
      `SELECT cso.*,
              r.yield_qty AS recipe_yield_qty
       FROM   mcogs_combo_step_options cso
       LEFT JOIN mcogs_recipes r ON r.id = cso.recipe_id
       WHERE  cso.combo_step_id = ANY($1::int[])
       ORDER BY cso.combo_step_id, cso.sort_order`,
      [stepIds]
    ),
    pool.query(
      `SELECT csomgj.combo_step_option_id,
              csomgj.modifier_group_id,
              mo.id AS option_id,
              mo.item_type,
              mo.recipe_id,
              mo.ingredient_id,
              mo.manual_cost,
              r.yield_qty AS recipe_yield_qty
       FROM   mcogs_combo_step_option_modifier_groups csomgj
       JOIN   mcogs_modifier_options mo ON mo.modifier_group_id = csomgj.modifier_group_id
       LEFT JOIN mcogs_recipes r ON r.id = mo.recipe_id
       WHERE  csomgj.combo_step_option_id = ANY($1::int[])`,
      [stepIds] // reuse stepIds — no options without steps
    ),
  ]);

  // Map: step_option_id → [modifier options]
  const modMap = {};
  for (const m of modsResult.rows) {
    if (!modMap[m.combo_step_option_id]) modMap[m.combo_step_option_id] = [];
    modMap[m.combo_step_option_id].push(m);
  }

  // Map: step_id → [options with modifier options]
  const optMap = {};
  for (const opt of optsResult.rows) {
    if (!optMap[opt.combo_step_id]) optMap[opt.combo_step_id] = [];
    optMap[opt.combo_step_id].push({ ...opt, mod_options: modMap[opt.id] || [] });
  }

  // Map: sales_item_id → steps with options
  const result = {};
  for (const step of steps) {
    if (!result[step.sales_item_id]) result[step.sales_item_id] = [];
    result[step.sales_item_id].push({ ...step, options: optMap[step.id] || [] });
  }
  return result;
}

/**
 * Resolve cost for a single option (recipe/ingredient/manual).
 * Returns cost in USD base (caller applies exchange rate).
 */
function resolveOptionCost(opt, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId) {
  if (opt.item_type === 'manual') {
    return Number(opt.manual_cost || 0);
  }
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

/**
 * Calculate cost for a combo Sales Item.
 * Step with 1 option = fixed cost. Step with N options = avg cost.
 * Each option can have modifier groups; their options also avg.
 * Returns cost in USD base (per portion, before exchange_rate).
 */
function calcComboCost(steps, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId) {
  let total = 0;
  for (const step of steps) {
    const opts = step.options || [];
    if (!opts.length) continue;

    let stepCost = 0;
    for (const opt of opts) {
      let optCost = resolveOptionCost(opt, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId);

      // Add avg modifier group cost for this option
      if (opt.mod_options && opt.mod_options.length) {
        // Group by modifier_group_id to avg per group
        const groupMap = {};
        for (const mo of opt.mod_options) {
          if (!groupMap[mo.modifier_group_id]) groupMap[mo.modifier_group_id] = [];
          groupMap[mo.modifier_group_id].push(mo);
        }
        for (const groupOpts of Object.values(groupMap)) {
          const costs = groupOpts.map(mo => resolveOptionCost(mo, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId));
          const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
          optCost += avg;
        }
      }

      stepCost += optCost;
    }
    // Average across options in this step (1 option = that option's cost directly)
    total += stepCost / opts.length;
  }
  return total;
}

router.get('/menu-sales/:menu_id', async (req, res) => {
  const menuId       = Number(req.params.menu_id);
  const priceLevelId = req.query.price_level_id ? Number(req.query.price_level_id) : null;

  try {
    const { rows: [menu] } = await pool.query(`
      SELECT m.*, c.currency_symbol, c.currency_code, c.exchange_rate
      FROM   mcogs_menus m
      JOIN   mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [menuId]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menu.country_id;

    // All menu-sales-items for this menu
    const { rows: items } = await pool.query(`
      SELECT msi.*,
             si.name       AS sales_item_name,
             si.item_type,
             cat.name      AS category,
             si.recipe_id,
             si.ingredient_id,
             si.manual_cost,
             r.yield_qty,
             r.name        AS recipe_name,
             ing.name      AS ingredient_name,
             u.abbreviation AS base_unit_abbr
      FROM   mcogs_menu_sales_items msi
      JOIN   mcogs_sales_items       si  ON si.id   = msi.sales_item_id
      LEFT JOIN mcogs_categories     cat ON cat.id  = si.category_id
      LEFT JOIN mcogs_recipes        r   ON r.id    = si.recipe_id
      LEFT JOIN mcogs_ingredients    ing ON ing.id  = si.ingredient_id
      LEFT JOIN mcogs_units          u   ON u.id    = ing.base_unit_id
      WHERE  msi.menu_id = $1
      ORDER BY msi.sort_order, msi.id
    `, [menuId]);

    if (!items.length) {
      return res.json({
        menu_id: menuId, currency_code: menu.currency_code, currency_symbol: menu.currency_symbol,
        exchange_rate: Number(menu.exchange_rate), items: [],
        summary: { total_cost: 0, total_sell_net: 0, total_sell_gross: 0, avg_cogs_pct_net: 0, avg_cogs_pct_gross: 0 },
      });
    }

    // Preload recipe items deep (for recipe + combo-step-option recipe types)
    const recipeIds = [...new Set(items
      .filter(i => i.item_type === 'recipe' && i.recipe_id)
      .map(i => Number(i.recipe_id)))
    ];

    // Combo items need step → option → recipe IDs too — defer after loadComboData
    const comboIds = items.filter(i => i.item_type === 'combo').map(i => Number(i.sales_item_id));

    const [quoteLookup, { rows: defaultTaxRows }, comboData] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`SELECT country_id, rate, name FROM mcogs_country_tax_rates WHERE is_default = true`),
      loadComboData(comboIds),
    ]);

    // Collect all recipe IDs from combo options too
    for (const steps of Object.values(comboData)) {
      for (const step of steps) {
        for (const opt of step.options || []) {
          if (opt.item_type === 'recipe' && opt.recipe_id) recipeIds.push(Number(opt.recipe_id));
          for (const mo of opt.mod_options || []) {
            if (mo.item_type === 'recipe' && mo.recipe_id) recipeIds.push(Number(mo.recipe_id));
          }
        }
      }
    }
    const uniqueRecipeIds = [...new Set(recipeIds)];

    const [recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap] = await Promise.all([
      loadAllRecipeItemsDeep(uniqueRecipeIds),
      loadVariationItemsMap(uniqueRecipeIds),
      loadPlVariationItemsMap(uniqueRecipeIds),
      loadMarketPlVariationItemsMap(uniqueRecipeIds),
    ]);

    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = { rate: Number(r.rate), name: r.name };

    // Per-menu price overrides
    const msiIds = items.map(i => i.id);
    let priceMap = {};
    if (msiIds.length) {
      const priceQuery = priceLevelId
        ? await pool.query(
            `SELECT msip.*, (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
             FROM   mcogs_menu_sales_item_prices msip
             LEFT JOIN mcogs_sales_item_prices sip
                       ON sip.sales_item_id = (SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id = msip.menu_sales_item_id)
                          AND sip.price_level_id = msip.price_level_id
             WHERE  msip.menu_sales_item_id = ANY($1::int[]) AND msip.price_level_id = $2`,
            [msiIds, priceLevelId]
          )
        : await pool.query(
            `SELECT msip.*, (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
             FROM   mcogs_menu_sales_item_prices msip
             LEFT JOIN mcogs_sales_item_prices sip
                       ON sip.sales_item_id = (SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id = msip.menu_sales_item_id)
                          AND sip.price_level_id = msip.price_level_id
             WHERE  msip.menu_sales_item_id = ANY($1::int[])`,
            [msiIds]
          );
      for (const p of priceQuery.rows) {
        if (!priceMap[p.menu_sales_item_id]) priceMap[p.menu_sales_item_id] = {};
        priceMap[p.menu_sales_item_id][p.price_level_id] = p;
      }
    }

    const taxRateCache = {};
    const outItems = [];
    let totalCost = 0, totalSellNet = 0, totalSellGross = 0;
    const exchRate = Number(menu.exchange_rate) || 1;

    for (const item of items) {
      const itemType = item.item_type;
      const qty      = Number(item.qty || 1);
      const siId     = item.sales_item_id;
      const display  = item.sales_item_name || '—';

      // Cost per portion (USD base → local)
      let cppUsd = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cppUsd = q.price_per_base_unit * qty;
      } else if (itemType === 'manual') {
        cppUsd = Number(item.manual_cost || 0) * qty;
      } else if (itemType === 'recipe') {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const recipe = { id: item.recipe_id, yield_qty: item.yield_qty || 1 };
        const { cost } = calcRecipeCost(recipe, rItems, countryId, quoteLookup, variationMap, recipeItemsMap, null, priceLevelId, plVariationMap, marketPlVariationMap);
        cppUsd = cost * qty;
      } else if (itemType === 'combo') {
        const steps = comboData[siId] || [];
        cppUsd = calcComboCost(steps, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, priceLevelId) * qty;
      }
      const cpp = Math.round(cppUsd * exchRate * 10000) / 10000;

      // Sell price
      const itemPrices = priceMap[item.id] || {};
      let sellGross = 0;
      let useTaxRateId = null;
      let isOverridden = false;
      if (priceLevelId && itemPrices[priceLevelId]) {
        const lp = itemPrices[priceLevelId];
        sellGross    = Number(lp.sell_price || 0);
        useTaxRateId = lp.tax_rate_id || null;
        isOverridden = !!lp.is_overridden;
      } else if (!priceLevelId) {
        // Use first price level available
        const first = Object.values(itemPrices)[0];
        if (first) { sellGross = Number(first.sell_price || 0); useTaxRateId = first.tax_rate_id || null; isOverridden = !!first.is_overridden; }
      }

      const { rate: taxRate, name: taxName } = await resolveItemTax(useTaxRateId, countryId, priceLevelId, defaultTaxMap, taxRateCache);
      const sellNet      = taxRate > 0 ? sellGross / (1 + taxRate) : sellGross;
      const gpNet        = Math.round((sellNet   - cpp) * 10000) / 10000;
      const gpGross      = Math.round((sellGross - cpp) * 10000) / 10000;
      const cogsPctNet   = sellNet   > 0 ? Math.round((cpp / sellNet)   * 10000) / 100 : 0;
      const cogsPctGross = sellGross > 0 ? Math.round((cpp / sellGross) * 10000) / 100 : 0;

      totalCost      += cpp;
      totalSellNet   += Math.round(sellNet   * 10000) / 10000;
      totalSellGross += Math.round(sellGross * 10000) / 10000;

      outItems.push({
        menu_item_id:       item.id,   // alias — used by ScenarioTool price-override keys
        menu_sales_item_id: item.id,
        sales_item_id:      siId,
        item_type:          itemType,
        recipe_id:          item.recipe_id    || null,
        ingredient_id:      item.ingredient_id || null,
        display_name:       display,
        recipe_name:        display,
        category:           item.category || '',
        qty,
        base_unit_abbr:     item.base_unit_abbr || '',
        cost_per_portion:   cpp,
        sell_price_gross:   Math.round(sellGross * 10000) / 10000,
        sell_price_net:     Math.round(sellNet   * 10000) / 10000,
        tax_rate:           taxRate,
        tax_rate_pct:       Math.round(taxRate * 10000) / 100,
        tax_name:           taxName,
        tax_rate_id:        useTaxRateId || null,
        gp_net:             gpNet,
        gp_gross:           gpGross,
        cogs_pct_net:       cogsPctNet,
        cogs_pct_gross:     cogsPctGross,
        is_price_overridden: isOverridden,
      });
    }

    res.json({
      menu_id:         menuId,
      currency_code:   menu.currency_code   || '',
      currency_symbol: menu.currency_symbol || '',
      exchange_rate:   exchRate,
      items: outItems,
      summary: {
        total_cost:         Math.round(totalCost      * 10000) / 10000,
        total_sell_net:     Math.round(totalSellNet   * 10000) / 10000,
        total_sell_gross:   Math.round(totalSellGross * 10000) / 10000,
        avg_cogs_pct_net:   totalSellNet   > 0 ? Math.round((totalCost / totalSellNet)   * 10000) / 100 : 0,
        avg_cogs_pct_gross: totalSellGross > 0 ? Math.round((totalCost / totalSellGross) * 10000) / 100 : 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to calculate Sales Items COGS' } });
  }
});

module.exports = { router, loadQuoteLookup, calcRecipeCost, loadAllRecipeItemsDeep, loadVariationItemsMap, loadPlVariationItemsMap, loadMarketPlVariationItemsMap };
