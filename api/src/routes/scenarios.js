const router = require('express').Router();
const pool   = require('../db/pool');
const { loadQuoteLookup, calcRecipeCost } = require('./cogs');

// Helper: fetch a single scenario with joined name fields
async function fetchScenario(id) {
  const { rows: [row] } = await pool.query(`
    SELECT s.id, s.name, s.menu_id, s.price_level_id,
           s.qty_data, s.price_overrides, s.cost_overrides, s.history,
           s.notes, s.created_at, s.updated_at,
           m.name  AS menu_name,
           pl.name AS price_level_name
    FROM   mcogs_menu_scenarios s
    LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
    LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
    WHERE  s.id = $1
  `, [id]);
  return row || null;
}

// ── GET /scenarios ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.menu_id, s.price_level_id,
             s.qty_data, s.price_overrides, s.cost_overrides, s.history,
             s.notes, s.created_at, s.updated_at,
             m.name  AS menu_name,
             pl.name AS price_level_name
      FROM   mcogs_menu_scenarios s
      LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
      LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
      ORDER BY s.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to list scenarios' } });
  }
});

// ── GET /scenarios/analysis?menu_id=X&scenario_id=Y ─────────────────────────
// Returns every menu item with base cost, effective cost (with overrides), price
// per level, tax rate, and COGS%. Used by the AI to compute scenario changes.
router.get('/analysis', async (req, res) => {
  const menuId     = Number(req.query.menu_id);
  const scenarioId = req.query.scenario_id ? Number(req.query.scenario_id) : null;
  if (!menuId) return res.status(400).json({ error: { message: 'menu_id is required' } });

  try {
    const { rows: [menu] } = await pool.query(`
      SELECT m.id, m.name, m.country_id,
             c.currency_symbol, c.currency_code, c.exchange_rate, c.default_price_level_id
      FROM   mcogs_menus m JOIN mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [menuId]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menu.country_id;

    // Scenario overrides (if requested)
    let scenario = null;
    if (scenarioId) scenario = await fetchScenario(scenarioId);
    const priceOv = scenario?.price_overrides || {};
    const costOv  = scenario?.cost_overrides  || {};

    // Price levels, menu items, level prices
    const [{ rows: levels }, { rows: items }] = await Promise.all([
      pool.query(`SELECT * FROM mcogs_price_levels ORDER BY name`),
      pool.query(`
        SELECT mi.id, mi.display_name, mi.item_type, mi.recipe_id, mi.ingredient_id, mi.qty
        FROM   mcogs_menu_items mi WHERE mi.menu_id = $1 ORDER BY mi.id
      `, [menuId]),
    ]);
    if (!items.length) return res.json({ menu_id: menuId, menu_name: menu.name, items: [], levels: [] });

    const itemIds = items.map(i => i.id);
    const { rows: lpRows } = await pool.query(
      `SELECT * FROM mcogs_menu_item_prices WHERE menu_item_id = ANY($1::int[])`, [itemIds]
    );
    const lpMap = {};
    for (const lp of lpRows) {
      if (!lpMap[lp.menu_item_id]) lpMap[lp.menu_item_id] = {};
      lpMap[lp.menu_item_id][lp.price_level_id] = lp;
    }

    // Recipe + ingredient metadata (names, categories)
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    const ingIds    = [...new Set(items.filter(i => i.ingredient_id).map(i => Number(i.ingredient_id)))];
    const [recipeMap, ingMap, recipeItemsMap] = await Promise.all([
      recipeIds.length
        ? pool.query(`SELECT id, name, category, yield_qty FROM mcogs_recipes WHERE id = ANY($1::int[])`, [recipeIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x])))
        : Promise.resolve({}),
      ingIds.length
        ? pool.query(`SELECT id, name, category FROM mcogs_ingredients WHERE id = ANY($1::int[])`, [ingIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x])))
        : Promise.resolve({}),
      recipeIds.length
        ? pool.query(`
            SELECT ri.*, ing.waste_pct FROM mcogs_recipe_items ri
            LEFT JOIN mcogs_ingredients ing ON ing.id = ri.ingredient_id
            WHERE ri.recipe_id = ANY($1::int[])
          `, [recipeIds]).then(r => {
            const m = {};
            for (const ri of r.rows) { if (!m[ri.recipe_id]) m[ri.recipe_id] = []; m[ri.recipe_id].push(ri); }
            return m;
          })
        : Promise.resolve({}),
    ]);

    // Quote lookup + tax data
    const [quoteLookup, { rows: defTaxRows }, { rows: cltRows }, { rows: taxRows }] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`SELECT country_id, rate, name FROM mcogs_country_tax_rates WHERE is_default = true`),
      pool.query(`
        SELECT clt.country_id, clt.price_level_id, tr.rate, tr.name
        FROM   mcogs_country_level_tax clt JOIN mcogs_country_tax_rates tr ON tr.id = clt.tax_rate_id
      `),
      pool.query(`SELECT id, rate, name FROM mcogs_country_tax_rates`),
    ]);
    const defTaxMap = Object.fromEntries(defTaxRows.map(r => [r.country_id, { rate: Number(r.rate), name: r.name }]));
    const cltMap    = Object.fromEntries(cltRows.map(r => [`${r.country_id}-${r.price_level_id}`, { rate: Number(r.rate), name: r.name }]));
    const taxById   = Object.fromEntries(taxRows.map(r => [r.id, { rate: Number(r.rate), name: r.name }]));

    function getTax(taxRateId, levelId) {
      if (taxRateId && taxById[taxRateId]) return taxById[taxRateId];
      return cltMap[`${countryId}-${levelId}`] || defTaxMap[countryId] || { rate: 0, name: 'No Tax' };
    }

    const outItems = items.map(item => {
      const iType   = item.item_type || 'recipe';
      const qty     = Number(item.qty || 1);
      const recipe  = iType === 'recipe'      ? recipeMap[item.recipe_id]    : null;
      const ing     = iType === 'ingredient'  ? ingMap[item.ingredient_id]   : null;
      const display = item.display_name?.trim() || recipe?.name || ing?.name || '—';
      const category = recipe?.category || ing?.category || '';
      const natKey  = iType === 'recipe' ? `r_${item.recipe_id}` : `i_${item.ingredient_id}`;

      let baseCostUsd = 0;
      if (iType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) baseCostUsd = q.price_per_base_unit * qty;
      } else {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const { cost } = calcRecipeCost(recipe || { id: item.recipe_id, yield_qty: 1 }, rItems, countryId, quoteLookup, {});
        baseCostUsd = cost * qty;
      }

      const costOvVal      = costOv[natKey];
      const effectiveCost  = costOvVal !== undefined ? Number(costOvVal) : baseCostUsd;

      const perLevel = levels.map(level => {
        const lp             = lpMap[item.id]?.[level.id];
        const basePriceUsd   = lp ? Number(lp.sell_price) : 0;
        const priceOvKey     = `${item.id}_l${level.id}`;
        const priceOvVal     = priceOv[priceOvKey];
        const effectivePrice = priceOvVal !== undefined ? Number(priceOvVal) : basePriceUsd;
        const { rate: taxRate, name: taxName } = getTax(lp?.tax_rate_id, level.id);
        const priceNet       = taxRate > 0 ? effectivePrice / (1 + taxRate) : effectivePrice;
        const cogsPct        = priceNet > 0 && effectiveCost > 0
                                 ? Math.round((effectiveCost / priceNet) * 10000) / 100 : null;
        return {
          level_id:            level.id,
          level_name:          level.name,
          price_override_key:  priceOvKey,
          base_price_usd:      Math.round(basePriceUsd   * 1e6) / 1e6,
          effective_price_usd: Math.round(effectivePrice * 1e6) / 1e6,
          is_price_overridden: priceOvKey in priceOv,
          tax_rate:            taxRate,
          tax_name:            taxName,
          price_net_usd:       Math.round(priceNet       * 1e6) / 1e6,
          cogs_pct:            cogsPct,
        };
      });

      return {
        menu_item_id:       item.id,
        nat_key:            natKey,
        display_name:       display,
        category,
        item_type:          iType,
        cost_override_key:  natKey,
        base_cost_usd:      Math.round(baseCostUsd    * 1e6) / 1e6,
        effective_cost_usd: Math.round(effectiveCost  * 1e6) / 1e6,
        is_cost_overridden: natKey in costOv,
        per_level:          perLevel,
      };
    });

    res.json({
      menu_id:         menuId,
      menu_name:       menu.name,
      country_id:      countryId,
      currency_symbol: menu.currency_symbol,
      currency_code:   menu.currency_code,
      exchange_rate:   Number(menu.exchange_rate),
      scenario:        scenario ? { id: scenario.id, name: scenario.name } : null,
      levels:          levels.map(l => ({ id: l.id, name: l.name })),
      note:            'To compute price for target COGS: price_gross_usd = (effective_cost_usd / target_cogs_decimal) * (1 + tax_rate)',
      items:           outItems,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /scenarios/push-prices ──────────────────────────────────────────────
// Write price overrides to mcogs_menu_item_prices (makes them live on the menu).
// Body: { overrides: [{ menu_item_id, price_level_id, sell_price }] }
// sell_price is in USD base (same unit as mcogs_menu_item_prices.sell_price).
router.post('/push-prices', async (req, res) => {
  const { overrides } = req.body;
  if (!Array.isArray(overrides) || !overrides.length) return res.json({ pushed: 0 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { menu_item_id, price_level_id, sell_price } of overrides) {
      await client.query(`
        INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price)
        VALUES ($1, $2, $3)
        ON CONFLICT (menu_item_id, price_level_id)
        DO UPDATE SET sell_price = EXCLUDED.sell_price
      `, [menu_item_id, price_level_id, sell_price]);
    }
    await client.query('COMMIT');
    res.json({ pushed: overrides.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to push prices to menu' } });
  } finally {
    client.release();
  }
});

// ── POST /scenarios ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows: [inserted] } = await pool.query(`
      INSERT INTO mcogs_menu_scenarios
        (name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      name.trim(),
      price_level_id || null,
      JSON.stringify(qty_data         || {}),
      JSON.stringify(price_overrides  || {}),
      JSON.stringify(cost_overrides   || {}),
      JSON.stringify(history          || []),
      notes?.trim() || null,
    ]);
    const row = await fetchScenario(inserted.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save scenario' } });
  }
});

// ── PUT /scenarios/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rowCount } = await pool.query(`
      UPDATE mcogs_menu_scenarios
      SET name=$1, price_level_id=$2, qty_data=$3,
          price_overrides=$4, cost_overrides=$5, history=$6,
          notes=$7, updated_at=NOW()
      WHERE id=$8
    `, [
      name.trim(),
      price_level_id || null,
      JSON.stringify(qty_data         || {}),
      JSON.stringify(price_overrides  || {}),
      JSON.stringify(cost_overrides   || {}),
      JSON.stringify(history          || []),
      notes?.trim() || null,
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Scenario not found' } });
    const row = await fetchScenario(req.params.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update scenario' } });
  }
});

// ── DELETE /scenarios/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_menu_scenarios WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete scenario' } });
  }
});

module.exports = router;
