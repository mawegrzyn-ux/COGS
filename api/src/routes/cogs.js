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
 * Load variation items for a set of recipe IDs.
 * Returns: { [recipe_id]: { [country_id]: [items_with_waste_pct...] } }
 */
async function loadVariationItemsMap(recipeIds) {
  if (!recipeIds.length) return {};
  const { rows } = await pool.query(`
    SELECT rv.recipe_id,
           rv.country_id,
           ri.*,
           i.waste_pct
    FROM   mcogs_recipe_variations rv
    JOIN   mcogs_recipe_items ri ON ri.variation_id = rv.id
    LEFT JOIN mcogs_ingredients i ON i.id = ri.ingredient_id
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
 * Calculate cost-per-portion for one recipe in one country.
 * If variationMap contains items for this recipe+country, those are used instead of globalItems.
 */
function calcRecipeCost(recipe, globalItems, countryId, quoteLookup, variationMap) {
  const items = variationMap?.[recipe.id]?.[countryId] || globalItems;
  const ingItems = items.filter(i => i.item_type === 'ingredient');
  let total = 0, preferredCount = 0, quotedCount = 0;

  for (const item of ingItems) {
    const q = quoteLookup[item.ingredient_id]?.[countryId];
    if (!q) continue;
    if (q.is_preferred) preferredCount++;
    quotedCount++;
    const base_qty   = Number(item.prep_qty) * Number(item.prep_to_base_conversion);
    const waste_mult = 1 + (Number(item.waste_pct ?? 0) / 100);
    total += base_qty * waste_mult * q.price_per_base_unit;
  }

  const n = ingItems.length;
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
             r.category     AS recipe_category,
             r.yield_qty,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr,
             ri_items.item_count
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes r     ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units u       ON u.id   = ing.base_unit_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS item_count
        FROM   mcogs_recipe_items WHERE recipe_id = r.id
      ) ri_items ON true
      WHERE  mi.menu_id = $1
      ORDER BY mi.id ASC
    `, [menuId]);

    // Recipe items for every recipe referenced on this menu
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    let recipeItemsMap = {};
    if (recipeIds.length) {
      const { rows: riRows } = await pool.query(`
        SELECT ri.*, ing.waste_pct, ing.base_unit_id
        FROM   mcogs_recipe_items ri
        LEFT JOIN mcogs_ingredients ing ON ing.id = ri.ingredient_id
        WHERE  ri.recipe_id = ANY($1::int[])
      `, [recipeIds]);
      for (const ri of riRows) {
        if (!recipeItemsMap[ri.recipe_id]) recipeItemsMap[ri.recipe_id] = [];
        recipeItemsMap[ri.recipe_id].push(ri);
      }
    }

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

    const variationMap = await loadVariationItemsMap(recipeIds);

    const taxRateCache = {};
    const outItems = [];
    let totalCost = 0, totalSellNet = 0, totalSellGross = 0;

    for (const item of items) {
      const itemType  = item.item_type || 'recipe';
      const qty       = Number(item.qty || 1);
      const display   = item.display_name?.trim() ||
                        (itemType === 'ingredient' ? item.ingredient_name : item.recipe_name) || '—';

      // Cost per portion — calcRecipeCost returns USD base; convert to local currency
      let cpp = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cpp = q.price_per_base_unit * qty;
      } else {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const recipe = { id: item.recipe_id, yield_qty: item.yield_qty || 1 };
        const { cost } = calcRecipeCost(recipe, rItems, countryId, quoteLookup, variationMap);
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
             r.category     AS recipe_category,
             r.yield_qty,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr,
             m.name         AS menu_name
      FROM   mcogs_menu_items mi
      JOIN   mcogs_menus m      ON m.id   = mi.menu_id
      LEFT JOIN mcogs_recipes r     ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units u       ON u.id   = ing.base_unit_id
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

    // Recipe items for every recipe
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    const recipeItemsMap = {};
    if (recipeIds.length) {
      const { rows: riRows } = await pool.query(`
        SELECT ri.*, ing.waste_pct
        FROM   mcogs_recipe_items ri
        LEFT JOIN mcogs_ingredients ing ON ing.id = ri.ingredient_id
        WHERE  ri.recipe_id = ANY($1::int[])
      `, [recipeIds]);
      for (const ri of riRows) {
        if (!recipeItemsMap[ri.recipe_id]) recipeItemsMap[ri.recipe_id] = [];
        recipeItemsMap[ri.recipe_id].push(ri);
      }
    }

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

    const variationMap = await loadVariationItemsMap(recipeIds);

    const report = items.map(item => {
      const itemType = item.item_type || 'recipe';
      const display  = item.display_name?.trim() ||
                       (itemType === 'ingredient' ? item.ingredient_name : item.recipe_name) || '—';
      const qty      = Number(item.qty || 1);

      // Cost per portion — calcRecipeCost returns USD base; convert to local currency
      let cpp = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cpp = q.price_per_base_unit * qty;
      } else {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const { cost } = calcRecipeCost({ id: item.recipe_id, yield_qty: item.yield_qty || 1 }, rItems, countryId, quoteLookup, variationMap);
        cpp = cost * qty;
      }
      cpp = Math.round(cpp * Number(country.exchange_rate) * 10000) / 10000;

      // Helper: resolve effective tax rate for a price level
      function getEffectiveTax(taxRateId, levelId) {
        if (taxRateId && taxById[taxRateId]) return taxById[taxRateId];
        const clt = cltMap[`${countryId}-${levelId}`];
        if (clt) return clt;
        return defaultTaxMap[countryId] || { rate: 0, name: 'No Tax' };
      }

      // Build per-level prices
      const rowLevels = {};
      for (const level of levels) {
        const lid = level.id;
        const lp  = lpMap[item.id]?.[lid];
        if (!lp) {
          rowLevels[lid] = { set: false, gross: null, net: null, cogs_pct: null, gp_net: null };
          continue;
        }
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
        };
      }

      return {
        menu_item_id: item.id,
        display_name: display,
        item_type:    itemType,
        menu_name:    item.menu_name || '',
        category:     item.recipe_category || '',
        cost:         cpp,
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
        SELECT DISTINCT r.id, r.name AS recipe_name, r.category, r.yield_qty
        FROM   mcogs_recipes r
        JOIN   mcogs_menu_items mi ON mi.recipe_id = r.id
        ORDER BY r.name
      `),
      pool.query(`SELECT country_id, rate FROM mcogs_country_tax_rates WHERE is_default = true`),
      loadQuoteLookup(),
    ]);

    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = Number(r.rate);

    // Recipe items for all referenced recipes
    const recipeIds = recipes.map(r => r.id);
    const recipeItemsMap = {};
    if (recipeIds.length) {
      const { rows: riRows } = await pool.query(`
        SELECT ri.*, ing.waste_pct
        FROM   mcogs_recipe_items ri
        LEFT JOIN mcogs_ingredients ing ON ing.id = ri.ingredient_id
        WHERE  ri.recipe_id = ANY($1::int[])
      `, [recipeIds]);
      for (const ri of riRows) {
        if (!recipeItemsMap[ri.recipe_id]) recipeItemsMap[ri.recipe_id] = [];
        recipeItemsMap[ri.recipe_id].push(ri);
      }
    }

    // All menu items for these recipes (across all menus/countries)
    const { rows: menuItemRows } = await pool.query(`
      SELECT mi.id AS menu_item_id, mi.recipe_id, mi.sell_price, mi.tax_rate_id, mi.qty,
             m.country_id
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
          row.countries[cid] = { on_menu: false };
          continue;
        }

        const { cost } = calcRecipeCost(recipe, rItems, cid, quoteLookup, variationMap);
        const cppLocal = cost * Number(country.exchange_rate); // USD base → local currency
        const defaultRate = defaultTaxMap[cid] || 0;

        const grosses = [], nets = [];
        for (const mi of itemsInCountry) {
          let gross     = Number(mi.sell_price || 0);
          let taxRateId = mi.tax_rate_id;
          if (priceLevelId) {
            const lp = levelPriceMap[mi.menu_item_id];
            if (lp) { gross = Number(lp.sell_price); if (lp.tax_rate_id) taxRateId = lp.tax_rate_id; }
          }
          const rate = taxRateId && taxById[taxRateId] !== undefined ? taxById[taxRateId] : defaultRate;
          const net  = rate > 0 ? gross / (1 + rate) : gross;
          grosses.push(gross);
          nets.push(net);
        }

        const avgGross = grosses.reduce((a, b) => a + b, 0) / grosses.length;
        const avgNet   = nets.reduce((a, b) => a + b, 0) / nets.length;
        const cogsPct  = avgNet > 0 && cppLocal > 0 ? Math.round((cppLocal / avgNet) * 10000) / 100 : null;

        const miIds = itemsInCountry.map(mi => mi.menu_item_id);
        row.countries[cid] = {
          on_menu:      true,
          sell_gross:   Math.round(avgGross  * 10000) / 10000,
          sell_net:     Math.round(avgNet    * 10000) / 10000,
          cost:         Math.round(cppLocal  * 10000) / 10000,
          cogs_pct:     cogsPct,
          count:        itemsInCountry.length,
          menu_item_id: miIds.length === 1 ? miIds[0] : null,
          rate:         Number(country.exchange_rate),
        };
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

module.exports = router;
