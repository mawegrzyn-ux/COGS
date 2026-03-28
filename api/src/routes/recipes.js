const router  = require('express').Router();
const pool = require('../db/pool');
const { loadAllRecipeItemsDeep } = require('./cogs');

// ── GET /recipes  (list with item count) ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*,
             COALESCE(r.yield_unit_text, u.abbreviation) AS yield_unit_abbr,
             COUNT(ri.id) FILTER (WHERE ri.variation_id IS NULL)::int AS item_count
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

// ── GET /recipes/:id  (with full items + variations + COGS per country) ──────
router.get('/:id', async (req, res) => {
  try {
    // Recipe header
    const { rows: [recipe] } = await pool.query(`
      SELECT r.*, COALESCE(r.yield_unit_text, u.abbreviation) AS yield_unit_abbr
      FROM   mcogs_recipes r
      LEFT JOIN mcogs_units u ON u.id = r.yield_unit_id
      WHERE  r.id = $1
    `, [req.params.id]);
    if (!recipe) return res.status(404).json({ error: { message: 'Recipe not found' } });

    // Global recipe items (variation_id IS NULL)
    const { rows: globalItems } = await pool.query(`
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
      WHERE  ri.recipe_id = $1 AND ri.variation_id IS NULL
      ORDER BY COALESCE(ri.sort_order, ri.id) ASC, ri.id ASC
    `, [req.params.id]);

    // Variations with their items
    const { rows: varRows } = await pool.query(`
      SELECT rv.id          AS var_id,
             rv.country_id,
             c.name         AS country_name,
             ri.id          AS item_id,
             ri.recipe_id,
             ri.item_type,
             ri.ingredient_id,
             ri.recipe_item_id,
             ri.prep_qty,
             ri.prep_unit,
             ri.prep_to_base_conversion,
             ri.created_at  AS item_created_at,
             ri.updated_at  AS item_updated_at,
             i.name         AS ingredient_name,
             i.base_unit_id,
             i.waste_pct,
             i.default_prep_unit,
             ub.abbreviation AS base_unit_abbr,
             sr.name         AS sub_recipe_name,
             sr.yield_qty    AS sub_recipe_yield_qty
      FROM   mcogs_recipe_variations rv
      JOIN   mcogs_countries c ON c.id = rv.country_id
      LEFT JOIN mcogs_recipe_items ri ON ri.variation_id = rv.id
      LEFT JOIN mcogs_ingredients i   ON i.id  = ri.ingredient_id
      LEFT JOIN mcogs_units ub        ON ub.id = i.base_unit_id
      LEFT JOIN mcogs_recipes sr      ON sr.id = ri.recipe_item_id
      WHERE  rv.recipe_id = $1
      ORDER BY rv.id ASC, COALESCE(ri.sort_order, ri.id) ASC NULLS LAST, ri.id ASC NULLS LAST
    `, [req.params.id]);

    // Assemble variations map: var_id → { id, country_id, country_name, items[] }
    const varMap = {};
    for (const row of varRows) {
      if (!varMap[row.var_id]) {
        varMap[row.var_id] = {
          id:           row.var_id,
          country_id:   row.country_id,
          country_name: row.country_name,
          items:        [],
        };
      }
      if (row.item_id) {
        varMap[row.var_id].items.push({
          id:                      row.item_id,
          recipe_id:               row.recipe_id,
          item_type:               row.item_type,
          ingredient_id:           row.ingredient_id,
          recipe_item_id:          row.recipe_item_id,
          prep_qty:                row.prep_qty,
          prep_unit:               row.prep_unit,
          prep_to_base_conversion: row.prep_to_base_conversion,
          ingredient_name:         row.ingredient_name,
          base_unit_abbr:          row.base_unit_abbr,
          sub_recipe_name:         row.sub_recipe_name,
          sub_recipe_yield_qty:    row.sub_recipe_yield_qty,
          waste_pct:               row.waste_pct,
          default_prep_unit:       row.default_prep_unit,
        });
      }
    }
    const variations = Object.values(varMap);
    // Quick lookup by country_id
    const varByCountry = {};
    for (const v of variations) varByCountry[v.country_id] = v;

    // COGS per country
    const { rows: countries } = await pool.query(`
      SELECT c.id, c.name, c.currency_code, c.currency_symbol, c.exchange_rate
      FROM   mcogs_countries c ORDER BY c.name ASC
    `);

    const { rows: quotes } = await pool.query(`
      WITH preferred AS (
        SELECT pv.ingredient_id,
               pv.country_id,
               pq.purchase_price,
               pq.qty_in_base_units,
               pq.purchase_unit,
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
               pq.purchase_unit,
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

    const quoteLookup = {};
    for (const q of quotes) {
      if (!quoteLookup[q.ingredient_id]) quoteLookup[q.ingredient_id] = {};
      const vendorRate = Math.max(Number(q.vendor_exchange_rate) || 1, 0.000001);
      quoteLookup[q.ingredient_id][q.country_id] = {
        price_per_base_unit: q.qty_in_base_units > 0
          ? (Number(q.purchase_price) / Number(q.qty_in_base_units)) / vendorRate
          : 0,
        purchase_unit: q.purchase_unit,
        is_preferred:  q.is_preferred,
      };
    }

    // Load items for every sub-recipe referenced anywhere in this recipe tree
    const subRecipeIds = [
      ...globalItems,
      ...Object.values(varByCountry).flatMap(v => v.items),
    ]
      .filter(i => i.item_type === 'recipe' && i.recipe_item_id)
      .map(i => Number(i.recipe_item_id));
    const allRecipeItemsMap = subRecipeIds.length
      ? await loadAllRecipeItemsDeep(subRecipeIds)
      : {};

    /**
     * Recursively compute per-line costs for a set of recipe items.
     * Returns { lines, total_base, preferredCount, quotedCount, leafCount }
     */
    function buildCostLines(items, countryId) {
      let total_base = 0, preferredCount = 0, quotedCount = 0, leafCount = 0;

      const lines = items.map(item => {
        if (item.item_type === 'ingredient') {
          leafCount++;
          const q = quoteLookup[item.ingredient_id]?.[countryId];
          if (!q) return { ...item, cost: null, quote_is_preferred: null };
          if (q.is_preferred) preferredCount++;
          quotedCount++;
          const base_qty   = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
          const waste_mult = 1 + (Number(item.waste_pct ?? 0) / 100);
          const cost       = base_qty * waste_mult * q.price_per_base_unit;
          total_base += cost;
          return { ...item, cost: Math.round(cost * 10000) / 10000, quote_is_preferred: q.is_preferred };

        } else if (item.item_type === 'recipe' && item.recipe_item_id) {
          leafCount++;
          const subId    = Number(item.recipe_item_id);
          const subItems = allRecipeItemsMap[subId] || [];
          const subYield = Math.max(1, Number(item.sub_recipe_yield_qty || 1));
          const sub = buildCostLines(subItems, countryId);
          const subCostPerPortion = sub.total_base / subYield;
          const usage = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
          const cost  = subCostPerPortion * usage;
          total_base += cost;
          // Coverage: if sub has some preferred, count this line as preferred
          const isPreferred = sub.leafCount > 0 && sub.preferredCount === sub.leafCount;
          const isQuoted    = sub.leafCount > 0 && sub.quotedCount    >  0;
          if (isPreferred) preferredCount++;
          if (isQuoted)    quotedCount++;
          return {
            ...item,
            cost: cost > 0 ? Math.round(cost * 10000) / 10000 : null,
            quote_is_preferred: sub.leafCount > 0 ? isPreferred : null,
          };
        }
        return { ...item, cost: null, quote_is_preferred: null };
      });

      return { lines, total_base, preferredCount, quotedCount, leafCount };
    }

    const cogs_by_country = countries.map(country => {
      // Use variation items for this country if they exist, otherwise global items
      const variation    = varByCountry[country.id];
      const itemsForCost = variation ? variation.items : globalItems;

      const { lines, total_base, preferredCount, quotedCount, leafCount }
        = buildCostLines(itemsForCost, country.id);

      let coverage;
      if (leafCount === 0)                         coverage = 'fully_preferred';
      else if (preferredCount === leafCount)       coverage = 'fully_preferred';
      else if (quotedCount    === leafCount)       coverage = 'fully_quoted';
      else if (quotedCount    > 0)                 coverage = 'partially_quoted';
      else                                         coverage = 'not_quoted';

      const local_rate = Number(country.exchange_rate);
      return {
        country_id:        country.id,
        country_name:      country.name,
        currency_code:     country.currency_code,
        currency_symbol:   country.currency_symbol,
        exchange_rate:     local_rate,
        has_variation:     !!variation,
        variation_id:      variation?.id ?? null,
        total_cost_base:   Math.round(total_base * 10000) / 10000,
        total_cost_local:  Math.round(total_base * local_rate * 10000) / 10000,
        cost_per_portion:  Math.round((total_base / Math.max(1, Number(recipe.yield_qty || 1))) * 10000) / 10000,
        coverage,
        lines,
      };
    });

    res.json({ ...recipe, items: globalItems, variations, cogs_by_country });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch recipe' } });
  }
});

// ── POST /recipes ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, category, description, yield_qty, yield_unit_text } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [r] } = await pool.query(`
      INSERT INTO mcogs_recipes (name, category, description, yield_qty, yield_unit_text)
      VALUES ($1,$2,$3,$4,$5) RETURNING *,
             COALESCE(yield_unit_text) AS yield_unit_abbr
    `, [name.trim(), category?.trim()||null, description?.trim()||null, yield_qty||1, yield_unit_text?.trim()||null]);
    res.status(201).json({ ...r, yield_unit_abbr: r.yield_unit_text || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create recipe' } });
  }
});

// ── PUT /recipes/:id ──────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, category, description, yield_qty, yield_unit_text } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [r] } = await pool.query(`
      UPDATE mcogs_recipes SET name=$1, category=$2, description=$3,
             yield_qty=$4, yield_unit_text=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [name.trim(), category?.trim()||null, description?.trim()||null, yield_qty||1, yield_unit_text?.trim()||null, req.params.id]);
    if (!r) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ ...r, yield_unit_abbr: r.yield_unit_text || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update recipe' } });
  }
});

// ── PATCH /recipes/:id/items/reorder — persist manual drag-and-drop order ─────
router.patch('/:id/items/reorder', async (req, res) => {
  const { order } = req.body; // array of recipe_item ids in new order
  if (!Array.isArray(order) || !order.length) {
    return res.status(400).json({ error: { message: 'order must be a non-empty array of IDs' } });
  }
  const client = await require('../db/pool').connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE mcogs_recipe_items SET sort_order=$1 WHERE id=$2 AND recipe_id=$3`,
        [i, order[i], req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to reorder items' } });
  } finally {
    client.release();
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
      WHERE id=$4 AND recipe_id=$5 AND variation_id IS NULL RETURNING *
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
    await pool.query(`DELETE FROM mcogs_recipe_items WHERE id=$1 AND recipe_id=$2 AND variation_id IS NULL`, [req.params.itemId, req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete item' } });
  }
});

// ── POST /recipes/:id/variations ──────────────────────────────────────────────
// Body: { country_id, copy_global?: boolean }
router.post('/:id/variations', async (req, res) => {
  const { country_id, copy_global } = req.body;
  if (!country_id) return res.status(400).json({ error: { message: 'country_id is required' } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [v] } = await client.query(`
      INSERT INTO mcogs_recipe_variations (recipe_id, country_id)
      VALUES ($1, $2) RETURNING *
    `, [req.params.id, country_id]);

    if (copy_global) {
      const { rows: globalItems } = await client.query(
        `SELECT * FROM mcogs_recipe_items WHERE recipe_id = $1 AND variation_id IS NULL ORDER BY id ASC`,
        [req.params.id]
      );
      for (const item of globalItems) {
        await client.query(`
          INSERT INTO mcogs_recipe_items
            (recipe_id, variation_id, item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [item.recipe_id, v.id, item.item_type, item.ingredient_id, item.recipe_item_id,
            item.prep_qty, item.prep_unit, item.prep_to_base_conversion]);
      }
    }
    await client.query('COMMIT');
    res.json(v);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: { message: 'A variation already exists for this country' } });
    res.status(500).json({ error: { message: 'Failed to create variation' } });
  } finally {
    client.release();
  }
});

// ── DELETE /recipes/:id/variations/:varId ─────────────────────────────────────
router.delete('/:id/variations/:varId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM mcogs_recipe_variations WHERE id=$1 AND recipe_id=$2`,
      [req.params.varId, req.params.id]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete variation' } });
  }
});

// ── POST /recipes/:id/variations/:varId/items ─────────────────────────────────
router.post('/:id/variations/:varId/items', async (req, res) => {
  const { item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion } = req.body;
  if (!['ingredient','recipe'].includes(item_type))
    return res.status(400).json({ error: { message: 'item_type must be ingredient or recipe' } });
  if (!prep_qty || Number(prep_qty) <= 0)
    return res.status(400).json({ error: { message: 'prep_qty must be positive' } });
  try {
    const { rows: [item] } = await pool.query(`
      INSERT INTO mcogs_recipe_items
        (recipe_id, variation_id, item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.params.id, req.params.varId, item_type, ingredient_id||null, recipe_item_id||null,
        prep_qty, prep_unit?.trim()||null, prep_to_base_conversion||1]);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add variation item' } });
  }
});

// ── PUT /recipes/:id/variations/:varId/items/:itemId ──────────────────────────
router.put('/:id/variations/:varId/items/:itemId', async (req, res) => {
  const { prep_qty, prep_unit, prep_to_base_conversion } = req.body;
  try {
    const { rows: [item] } = await pool.query(`
      UPDATE mcogs_recipe_items SET prep_qty=$1, prep_unit=$2, prep_to_base_conversion=$3, updated_at=NOW()
      WHERE id=$4 AND recipe_id=$5 AND variation_id=$6 RETURNING *
    `, [prep_qty, prep_unit?.trim()||null, prep_to_base_conversion||1,
        req.params.itemId, req.params.id, req.params.varId]);
    if (!item) return res.status(404).json({ error: { message: 'Variation item not found' } });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update variation item' } });
  }
});

// ── DELETE /recipes/:id/variations/:varId/items/:itemId ───────────────────────
router.delete('/:id/variations/:varId/items/:itemId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM mcogs_recipe_items WHERE id=$1 AND recipe_id=$2 AND variation_id=$3`,
      [req.params.itemId, req.params.id, req.params.varId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete variation item' } });
  }
});

// ── POST /recipes/:id/variations/:varId/copy-to-global ────────────────────────
// Replaces all global items on this recipe with the variation's items (in a transaction).
router.post('/:id/variations/:varId/copy-to-global', async (req, res) => {
  const recipeId = req.params.id;
  const varId    = req.params.varId;
  const client   = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify the variation belongs to this recipe
    const { rows: [variation] } = await client.query(
      `SELECT * FROM mcogs_recipe_variations WHERE id=$1 AND recipe_id=$2`,
      [varId, recipeId]
    );
    if (!variation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Variation not found' } });
    }

    // Load variation items
    const { rows: varItems } = await client.query(
      `SELECT * FROM mcogs_recipe_items WHERE variation_id=$1 ORDER BY id ASC`,
      [varId]
    );

    // Delete existing global items
    await client.query(
      `DELETE FROM mcogs_recipe_items WHERE recipe_id=$1 AND variation_id IS NULL`,
      [recipeId]
    );

    // Insert variation items as new global items (variation_id = NULL)
    for (const item of varItems) {
      await client.query(`
        INSERT INTO mcogs_recipe_items
          (recipe_id, variation_id, item_type, ingredient_id, recipe_item_id,
           prep_qty, prep_unit, prep_to_base_conversion)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
      `, [
        recipeId,
        item.item_type,
        item.ingredient_id   || null,
        item.recipe_item_id  || null,
        item.prep_qty,
        item.prep_unit       || null,
        item.prep_to_base_conversion || 1,
      ]);
    }

    await client.query('COMMIT');
    res.json({ copied: varItems.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to copy variation to global' } });
  } finally {
    client.release();
  }
});

module.exports = router;
