const router  = require('express').Router();
const pool = require('../db/pool');

// ── GET /recipes  (list with item count) ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*,
             u.abbreviation          AS yield_unit_abbr,
             COUNT(ri.id)::int       AS item_count
      FROM   mcogs_recipes r
      LEFT JOIN mcogs_units u        ON u.id = r.yield_unit_id
      LEFT JOIN mcogs_recipe_items ri ON ri.recipe_id = r.id
      GROUP BY r.id, u.abbreviation
      ORDER BY r.name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch recipes' } });
  }
});

// ── GET /recipes/:id  (with full items + COGS per country) ───────────────────
router.get('/:id', async (req, res) => {
  try {
    // Recipe header
    const { rows: [recipe] } = await pool.query(`
      SELECT r.*, u.abbreviation AS yield_unit_abbr
      FROM   mcogs_recipes r
      LEFT JOIN mcogs_units u ON u.id = r.yield_unit_id
      WHERE  r.id = $1
    `, [req.params.id]);
    if (!recipe) return res.status(404).json({ error: { message: 'Recipe not found' } });

    // Recipe items (ingredients + sub-recipes)
    const { rows: items } = await pool.query(`
      SELECT ri.*,
             i.name                           AS ingredient_name,
             i.base_unit_id,
             i.waste_pct,
             i.default_prep_unit,
             ub.abbreviation                  AS base_unit_abbr,
             sr.name                          AS sub_recipe_name,
             sr.yield_qty                     AS sub_recipe_yield_qty
      FROM   mcogs_recipe_items ri
      LEFT JOIN mcogs_ingredients i  ON i.id  = ri.ingredient_id
      LEFT JOIN mcogs_units ub       ON ub.id = i.base_unit_id
      LEFT JOIN mcogs_recipes sr     ON sr.id = ri.recipe_item_id
      WHERE  ri.recipe_id = $1
      ORDER BY ri.id ASC
    `, [req.params.id]);

    // COGS per country — for each ingredient line, find preferred vendor quote
    const { rows: countries } = await pool.query(`
      SELECT c.id, c.name, c.currency_code, c.currency_symbol, c.exchange_rate
      FROM   mcogs_countries c ORDER BY c.name ASC
    `);

    const { rows: quotes } = await pool.query(`
      SELECT pv.ingredient_id,
             pv.country_id,
             pv.vendor_id,
             pv.quote_id,
             pq.purchase_price,
             pq.qty_in_base_units,
             pq.purchase_unit
      FROM   mcogs_ingredient_preferred_vendor pv
      JOIN   mcogs_price_quotes pq ON pq.id = pv.quote_id
      WHERE  pq.is_active = true
    `);

    // Build quote lookup: ingredient_id -> country_id -> {price_per_base_unit}
    const quoteLookup = {};
    for (const q of quotes) {
      if (!quoteLookup[q.ingredient_id]) quoteLookup[q.ingredient_id] = {};
      quoteLookup[q.ingredient_id][q.country_id] = {
        price_per_base_unit: q.qty_in_base_units > 0 ? Number(q.purchase_price) / Number(q.qty_in_base_units) : 0,
        purchase_unit:       q.purchase_unit,
      };
    }

    // Also fetch ANY active quote (not just preferred) for coverage detection
    const { rows: anyQuotes } = await pool.query(`
      SELECT DISTINCT pq.ingredient_id, v.country_id
      FROM   mcogs_price_quotes pq
      JOIN   mcogs_vendors v ON v.id = pq.vendor_id
      WHERE  pq.is_active = true
    `);
    const anyQuoteLookup = {};
    for (const q of anyQuotes) {
      if (!anyQuoteLookup[q.ingredient_id]) anyQuoteLookup[q.ingredient_id] = new Set();
      anyQuoteLookup[q.ingredient_id].add(q.country_id);
    }

    // Calculate COGS per country
    const cogs_by_country = countries.map(country => {
      let total_base = 0;
      let preferredCount = 0;
      let anyQuoteCount  = 0;
      const ingItems = items.filter(i => i.item_type === 'ingredient');
      const lines = items.map(item => {
        if (item.item_type !== 'ingredient') return { ...item, cost: null };
        const q = quoteLookup[item.ingredient_id]?.[country.id];
        const hasAny = anyQuoteLookup[item.ingredient_id]?.has(country.id) ?? false;
        if (q) preferredCount++;
        if (q || hasAny) anyQuoteCount++;
        if (!q) return { ...item, cost: null };
        const base_qty   = Number(item.prep_qty) * Number(item.prep_to_base_conversion);
        const waste_mult = 1 + (Number(item.waste_pct ?? 0) / 100);
        const cost       = base_qty * waste_mult * q.price_per_base_unit;
        total_base += cost;
        return { ...item, cost: Math.round(cost * 10000) / 10000 };
      });
      const total = ingItems.length;
      let coverage;
      if (total === 0)                          coverage = 'fully_preferred';
      else if (preferredCount === total)        coverage = 'fully_preferred';
      else if (anyQuoteCount  === total)        coverage = 'fully_quoted';
      else if (anyQuoteCount  > 0)              coverage = 'partially_quoted';
      else                                      coverage = 'not_quoted';
      const local_rate = Number(country.exchange_rate);
      return {
        country_id:      country.id,
        country_name:    country.name,
        currency_code:   country.currency_code,
        currency_symbol: country.currency_symbol,
        exchange_rate:   local_rate,
        total_cost_base: Math.round(total_base * 10000) / 10000,
        total_cost_local:Math.round(total_base * local_rate * 10000) / 10000,
        cost_per_portion:Math.round((total_base / Number(recipe.yield_qty || 1)) * 10000) / 10000,
        coverage,
        lines,
      };
    });

    res.json({ ...recipe, items, cogs_by_country });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch recipe' } });
  }
});

// ── POST /recipes ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, category, description, yield_qty, yield_unit_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [r] } = await pool.query(`
      INSERT INTO mcogs_recipes (name, category, description, yield_qty, yield_unit_id)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [name.trim(), category?.trim()||null, description?.trim()||null, yield_qty||1, yield_unit_id||null]);
    res.status(201).json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create recipe' } });
  }
});

// ── PUT /recipes/:id ──────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, category, description, yield_qty, yield_unit_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [r] } = await pool.query(`
      UPDATE mcogs_recipes SET name=$1, category=$2, description=$3,
             yield_qty=$4, yield_unit_id=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [name.trim(), category?.trim()||null, description?.trim()||null, yield_qty||1, yield_unit_id||null, req.params.id]);
    if (!r) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update recipe' } });
  }
});

// ── DELETE /recipes/:id ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_recipes WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete recipe' } });
  }
});

// ── POST /recipes/:id/items ───────────────────────────────────────────────────
router.post('/:id/items', async (req, res) => {
  const { item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion } = req.body;
  if (!['ingredient','recipe'].includes(item_type))
    return res.status(400).json({ error: { message: 'item_type must be ingredient or recipe' } });
  if (!prep_qty || Number(prep_qty) <= 0)
    return res.status(400).json({ error: { message: 'prep_qty must be positive' } });
  try {
    const { rows: [item] } = await pool.query(`
      INSERT INTO mcogs_recipe_items
        (recipe_id, item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [req.params.id, item_type, ingredient_id||null, recipe_item_id||null,
        prep_qty, prep_unit?.trim()||null, prep_to_base_conversion||1]);
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add item' } });
  }
});

// ── PUT /recipes/:id/items/:itemId ────────────────────────────────────────────
router.put('/:id/items/:itemId', async (req, res) => {
  const { prep_qty, prep_unit, prep_to_base_conversion } = req.body;
  try {
    const { rows: [item] } = await pool.query(`
      UPDATE mcogs_recipe_items SET prep_qty=$1, prep_unit=$2, prep_to_base_conversion=$3, updated_at=NOW()
      WHERE id=$4 AND recipe_id=$5 RETURNING *
    `, [prep_qty, prep_unit?.trim()||null, prep_to_base_conversion||1, req.params.itemId, req.params.id]);
    if (!item) return res.status(404).json({ error: { message: 'Item not found' } });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update item' } });
  }
});

// ── DELETE /recipes/:id/items/:itemId ─────────────────────────────────────────
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_recipe_items WHERE id=$1 AND recipe_id=$2`, [req.params.itemId, req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete item' } });
  }
});

module.exports = router;
