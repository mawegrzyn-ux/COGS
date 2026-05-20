const router    = require('express').Router();
const pool      = require('../db/pool');
const Anthropic = require('@anthropic-ai/sdk');
const { logAudit, diffFields } = require('../helpers/audit');
const aiConfig  = require('../helpers/aiConfig');
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
        ? pool.query(`SELECT r.id, r.name, cat.name AS category, r.yield_qty FROM mcogs_recipes r LEFT JOIN mcogs_categories cat ON cat.id = r.category_id WHERE r.id = ANY($1::int[])`, [recipeIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x])))
        : Promise.resolve({}),
      ingIds.length
        ? pool.query(`SELECT i.id, i.name, cat.name AS category FROM mcogs_ingredients i LEFT JOIN mcogs_categories cat ON cat.id = i.category_id WHERE i.id = ANY($1::int[])`, [ingIds])
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
// Write price overrides to mcogs_menu_sales_item_prices (makes them live on the menu).
// Body: { overrides: [{ menu_sales_item_id, price_level_id, sell_price }] }
// sell_price is in USD base.
router.post('/push-prices', async (req, res) => {
  const { overrides } = req.body;
  if (!Array.isArray(overrides) || !overrides.length) return res.json({ pushed: 0 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { menu_sales_item_id, price_level_id, sell_price } of overrides) {
      await client.query(`
        INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price)
        VALUES ($1, $2, $3)
        ON CONFLICT (menu_sales_item_id, price_level_id)
        DO UPDATE SET sell_price = EXCLUDED.sell_price
      `, [menu_sales_item_id, price_level_id, sell_price]);
    }
    await client.query('COMMIT');
    logAudit(pool, req, { action: 'update', entity_type: 'scenario', entity_id: null, entity_label: 'push prices to menu', context: { items_pushed: overrides.length } });
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
  const { name, menu_id, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows: [inserted] } = await pool.query(`
      INSERT INTO mcogs_menu_scenarios
        (name, menu_id, price_level_id, qty_data, price_overrides, cost_overrides, history, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      name.trim(),
      menu_id || null,
      price_level_id || null,
      JSON.stringify(qty_data         || {}),
      JSON.stringify(price_overrides  || {}),
      JSON.stringify(cost_overrides   || {}),
      JSON.stringify(history          || []),
      notes?.trim() || null,
    ]);
    const row = await fetchScenario(inserted.id);
    logAudit(pool, req, { action: 'create', entity_type: 'scenario', entity_id: inserted.id, entity_label: name.trim() });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save scenario' } });
  }
});

// ── PUT /scenarios/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, menu_id, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rowCount } = await pool.query(`
      UPDATE mcogs_menu_scenarios
      SET name=$1, menu_id=$2, price_level_id=$3, qty_data=$4,
          price_overrides=$5, cost_overrides=$6, history=$7,
          notes=$8, updated_at=NOW()
      WHERE id=$9
    `, [
      name.trim(),
      menu_id || null,
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
    logAudit(pool, req, { action: 'update', entity_type: 'scenario', entity_id: Number(req.params.id), entity_label: name.trim() });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update scenario' } });
  }
});

// ── DELETE /scenarios/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_menu_scenarios WHERE id=$1', [req.params.id]);
    await pool.query(`DELETE FROM mcogs_menu_scenarios WHERE id=$1`, [req.params.id]);
    logAudit(pool, req, { action: 'delete', entity_type: 'scenario', entity_id: Number(req.params.id), entity_label: old?.name || `Scenario #${req.params.id}` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete scenario' } });
  }
});

// ── POST /scenarios/smart — AI-powered scenario analysis ────────────────────
// Accepts a natural language prompt, loads the current menu data, calls Claude
// Haiku for analysis, and returns structured price change proposals.
router.post('/smart', async (req, res) => {
  const { menu_id, scenario_id, price_level_id, prompt } = req.body;
  if (!menu_id) return res.status(400).json({ error: { message: 'menu_id is required' } });
  if (!prompt?.trim()) return res.status(400).json({ error: { message: 'prompt is required' } });

  try {
    // 1. Load current menu + country data
    const { rows: [menu] } = await pool.query(`
      SELECT m.*, c.currency_code, c.currency_symbol, c.exchange_rate, c.name AS country_name
      FROM mcogs_menus m JOIN mcogs_countries c ON c.id = m.country_id
      WHERE m.id = $1
    `, [menu_id]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    // 2. Load menu sales items, price levels, and per-item prices
    const { rows: items } = await pool.query(`
      SELECT msi.id AS menu_item_id, si.name, si.item_type,
             COALESCE(si.display_name, si.name) AS display_name,
             cat.name AS category,
             si.recipe_id, si.ingredient_id, si.manual_cost,
             r.yield_qty
      FROM mcogs_menu_sales_items msi
      JOIN mcogs_sales_items si ON si.id = msi.sales_item_id
      LEFT JOIN mcogs_categories cat ON cat.id = si.category_id
      LEFT JOIN mcogs_recipes r ON r.id = si.recipe_id
      WHERE msi.menu_id = $1
      ORDER BY msi.sort_order, msi.id
    `, [menu_id]);

    const { rows: levels } = await pool.query('SELECT id, name FROM mcogs_price_levels ORDER BY name');

    const msiIds = items.map(i => i.menu_item_id);
    const { rows: prices } = msiIds.length ? await pool.query(`
      SELECT msip.menu_sales_item_id, msip.price_level_id, msip.sell_price,
             pl.name AS level_name
      FROM mcogs_menu_sales_item_prices msip
      JOIN mcogs_price_levels pl ON pl.id = msip.price_level_id
      WHERE msip.menu_sales_item_id = ANY($1::int[])
    `, [msiIds]) : { rows: [] };

    // 3. Load scenario overrides if scenario_id provided
    let scenarioOverrides = {};
    if (scenario_id) {
      const { rows: [sc] } = await pool.query(
        'SELECT price_overrides FROM mcogs_menu_scenarios WHERE id = $1', [scenario_id]
      );
      if (sc?.price_overrides) scenarioOverrides = sc.price_overrides;
    }

    // 4. Build concise data structure for AI context
    const priceMap = {};
    for (const p of prices) {
      if (!priceMap[p.menu_sales_item_id]) priceMap[p.menu_sales_item_id] = {};
      priceMap[p.menu_sales_item_id][p.price_level_id] = {
        sell_price: Number(p.sell_price),
        level_name: p.level_name,
      };
    }

    // Load cost data via COGS module
    const exchangeRate = Number(menu.exchange_rate) || 1;
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    let quoteLookup = {}, recipeItemsMap = {};
    try {
      const { loadAllRecipeItemsDeep } = require('./cogs');
      [quoteLookup, recipeItemsMap] = await Promise.all([
        loadQuoteLookup(),
        loadAllRecipeItemsDeep(recipeIds),
      ]);
    } catch { /* silent — costs will be 0 */ }

    // NOTE: sell_price in mcogs_menu_sales_item_prices is stored in the menu's
    // local currency context (not USD). Do NOT multiply by exchange_rate.
    // The dispRate conversion is handled by the frontend when displaying.
    const menuData = {
      menu_name: menu.name,
      currency: menu.currency_code,
      country: menu.country_name,
      price_levels: levels.map(l => ({ id: l.id, name: l.name })),
      items: items.map(item => {
        const itemPrices = priceMap[item.menu_item_id] || {};
        const perLevel = {};
        for (const [lid, data] of Object.entries(itemPrices)) {
          const ovKey = `${item.menu_item_id}_l${lid}`;
          const ovPrice = scenarioOverrides[ovKey];
          const currentPrice = ovPrice != null ? Number(ovPrice) : data.sell_price;
          perLevel[lid] = {
            level_name: data.level_name,
            current_price: Math.round(currentPrice * 100) / 100,
            is_overridden: ovPrice != null,
          };
        }
        // Calculate cost per portion in local currency
        let costLocal = 0;
        try {
          if (item.item_type === 'recipe' && item.recipe_id) {
            const rItems = recipeItemsMap[item.recipe_id] || [];
            const recipe = { id: item.recipe_id, yield_qty: item.yield_qty || 1 };
            const { cost } = calcRecipeCost(recipe, rItems, menu.country_id, quoteLookup, {}, recipeItemsMap);
            costLocal = Math.round(cost * exchangeRate * 100) / 100;
          } else if (item.item_type === 'ingredient' && item.ingredient_id) {
            const q = quoteLookup[item.ingredient_id]?.[menu.country_id];
            if (q) costLocal = Math.round(q.price_per_base_unit * exchangeRate * 100) / 100;
          } else if (item.item_type === 'manual') {
            costLocal = Math.round(Number(item.manual_cost || 0) * exchangeRate * 100) / 100;
          }
        } catch { /* silent */ }

        return {
          menu_item_id: item.menu_item_id,
          name: item.display_name || item.name,
          category: item.category || 'Uncategorised',
          item_type: item.item_type,
          cost: costLocal,
          prices: perLevel,
        };
      }),
    };

    // 5. Build restricted system prompt
    const systemPrompt = `You are a menu pricing analyst for "${menu.name}" (${menu.currency_code}). You can propose changes to sell prices AND cost assumptions for menu items.

STRICT RULES:
- You can ONLY suggest changes to sell prices or cost assumptions for the items listed below
- You CANNOT modify price quotes, ingredients, recipes, vendors, stock, or any other data
- You CANNOT perform searches, file operations, or any actions outside scenario analysis
- If the user asks for anything other than pricing/cost scenario analysis, respond ONLY with: {"error": "I can only help with menu pricing scenarios. Try asking something like: increase all prices by 5%, increase chicken cost by 3%, or set wings to 28% COGS target."}
- You MUST respond with ONLY valid JSON — no markdown, no explanation outside the JSON
- All values are in ${menu.currency_code}
- Each item has a "cost" field (current cost per portion) and per-level "current_price" fields
- COGS% = cost / (price / (1 + tax_rate)) × 100. When targeting a COGS%, solve for price.

Response format:
{
  "summary": "Brief description of changes proposed",
  "changes": [
    {
      "menu_item_id": 123,
      "level_id": 1,
      "field": "price",
      "item_name": "Chicken Wings",
      "level_name": "Dine In",
      "old_value": 10.50,
      "new_value": 10.82,
      "reason": "3% increase applied"
    }
  ]
}

The "field" must be "price" (for sell price changes) or "cost" (for cost assumption changes).
For cost changes, use level_id: null and omit level_name.

If no changes are needed: {"summary": "No changes needed", "changes": []}

Current menu data (prices in ${menu.currency_code}):
${JSON.stringify(menuData, null, 2)}`;

    // 6. Obtain Anthropic client
    const apiKey = aiConfig.get('ANTHROPIC_API_KEY');
    if (!apiKey) return res.status(503).json({ error: { message: 'AI is not configured. Set an Anthropic API key in Settings → AI.' } });
    const anthropic = new Anthropic({ apiKey });

    // 7. Call Claude Haiku (single response, no tools, no streaming)
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt.trim() }],
    });

    // 8. Parse the structured response
    const text = response.content?.[0]?.text || '';
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || text);
    } catch {
      parsed = { summary: 'Could not parse AI response', changes: [], raw: text };
    }

    // 9. Log the AI call to mcogs_ai_chat_log
    try {
      await pool.query(`
        INSERT INTO mcogs_ai_chat_log (user_sub, messages, tools_called, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        req.user?.sub || null,
        JSON.stringify([{ role: 'user', content: prompt }, { role: 'assistant', content: text }]),
        JSON.stringify(['smart_scenario']),
        response.usage?.input_tokens || 0,
        response.usage?.output_tokens || 0,
      ]);
    } catch { /* silent — don't fail the response if logging fails */ }

    res.json(parsed);
  } catch (err) {
    console.error('[smart-scenario]', err);
    res.status(500).json({ error: { message: 'Failed to analyse scenario' } });
  }
});

module.exports = router;
