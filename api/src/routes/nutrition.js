const router = require('express').Router();
const pool   = require('../db/pool');
const https  = require('https');
const http   = require('http');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'MenuCOGS/1.0 (contact@obscurekitty.com)' } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
}

// ── USDA FoodData Central helpers ─────────────────────────────────────────────

function usdaApiKey() {
  return process.env.USDA_API_KEY || 'DEMO_KEY';
}

function normaliseUSDA(food) {
  const get = (name) => {
    const n = food.foodNutrients?.find(n =>
      n.nutrientName?.toLowerCase().includes(name.toLowerCase()) ||
      n.nutrient?.name?.toLowerCase().includes(name.toLowerCase())
    );
    return n ? (n.value ?? n.amount ?? null) : null;
  };

  return {
    source:        'usda',
    source_id:     String(food.fdcId || food.id || ''),
    name:          food.description || food.lowercaseDescription || '',
    brand:         food.brandOwner || food.brandName || null,
    energy_kcal:   get('energy') ?? get('Calories'),
    protein_g:     get('protein'),
    carbs_g:       get('carbohydrate'),
    fat_g:         get('Total lipid') ?? get('fat'),
    fibre_g:       get('fiber') ?? get('Fiber'),
    sugar_g:       get('sugars') ?? get('Sugar'),
    salt_g:        (() => {
      const sodium = get('sodium');
      return sodium != null ? Math.round(sodium * 2.5 * 100) / 100 : null;
    })(),
  };
}

function normaliseOFF(product) {
  const n = product.nutriments || {};
  return {
    source:      'off',
    source_id:   product._id || product.code || '',
    name:        product.product_name || product.product_name_en || '',
    brand:       product.brands || null,
    barcode:     product.code || product._id || null,
    energy_kcal: n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null,
    protein_g:   n['proteins_100g'] ?? n['proteins'] ?? null,
    carbs_g:     n['carbohydrates_100g'] ?? n['carbohydrates'] ?? null,
    fat_g:       n['fat_100g'] ?? n['fat'] ?? null,
    fibre_g:     n['fiber_100g'] ?? n['fiber'] ?? null,
    sugar_g:     n['sugars_100g'] ?? n['sugars'] ?? null,
    salt_g:      n['salt_100g'] ?? n['salt'] ?? null,
    // Raw allergen text from OFF — used as hint, not authoritative
    allergens_text: product.allergens_from_ingredients || product.allergens || null,
  };
}

// ── GET /nutrition/search?q=flour&source=usda|off|both ────────────────────────
router.get('/search', async (req, res) => {
  const q      = req.query.q?.trim();
  const source = req.query.source || 'both';

  if (!q) return res.status(400).json({ error: { message: 'q is required' } });

  try {
    const results = { usda: [], off: [] };

    const tasks = [];

    if (source === 'usda' || source === 'both') {
      const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=10&api_key=${usdaApiKey()}`;
      tasks.push(
        fetchJSON(url)
          .then(data => { results.usda = (data.foods || []).map(normaliseUSDA); })
          .catch(() => { results.usda = []; })
      );
    }

    if (source === 'off' || source === 'both') {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,product_name_en,brands,nutriments,allergens_from_ingredients,allergens`;
      tasks.push(
        fetchJSON(url)
          .then(data => { results.off = (data.products || []).map(normaliseOFF); })
          .catch(() => { results.off = []; })
      );
    }

    await Promise.all(tasks);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Nutrition search failed' } });
  }
});

// ── GET /nutrition/barcode/:code — Open Food Facts barcode lookup ─────────────
router.get('/barcode/:code', async (req, res) => {
  const code = req.params.code.replace(/\D/g, '');
  if (!code) return res.status(400).json({ error: { message: 'Invalid barcode' } });

  try {
    const url  = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_en,brands,nutriments,allergens_from_ingredients,allergens,categories_tags`;
    const data = await fetchJSON(url);

    if (data.status !== 1 || !data.product) {
      return res.status(404).json({ error: { message: 'Product not found' } });
    }

    res.json(normaliseOFF(data.product));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Barcode lookup failed' } });
  }
});

// ── PUT /nutrition/ingredient/:id — save nutrition data to an ingredient ──────
// Body matches the normalised nutrition shape (energy_kcal, protein_g, etc.)
router.put('/ingredient/:id', async (req, res) => {
  const {
    energy_kcal, protein_g, carbs_g, fat_g, fibre_g, sugar_g, salt_g,
    nutrition_source, nutrition_source_id, barcode,
  } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_ingredients
      SET    energy_kcal         = $1,
             protein_g           = $2,
             carbs_g             = $3,
             fat_g               = $4,
             fibre_g             = $5,
             sugar_g             = $6,
             salt_g              = $7,
             nutrition_source    = $8,
             nutrition_source_id = $9,
             nutrition_updated_at = NOW(),
             barcode             = COALESCE($10, barcode),
             updated_at          = NOW()
      WHERE  id = $11
      RETURNING *
    `, [
      energy_kcal ?? null,
      protein_g   ?? null,
      carbs_g     ?? null,
      fat_g       ?? null,
      fibre_g     ?? null,
      sugar_g     ?? null,
      salt_g      ?? null,
      nutrition_source    || 'manual',
      nutrition_source_id || null,
      barcode             || null,
      req.params.id,
    ]);

    if (!rows.length) return res.status(404).json({ error: { message: 'Ingredient not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save nutrition data' } });
  }
});

// ── PUT /nutrition/ingredient/:id/dietary-flags — save dietary flags ──────────
// Body: { vegan: bool, vegetarian: bool, halal: bool, kosher: bool, gluten_free: bool, dairy_free: bool }
router.put('/ingredient/:id/dietary-flags', async (req, res) => {
  const allowed = ['vegan', 'vegetarian', 'halal', 'kosher', 'gluten_free', 'dairy_free'];
  const flags   = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) flags[key] = Boolean(req.body[key]);
  }

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_ingredients
      SET dietary_flags = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, dietary_flags
    `, [JSON.stringify(flags), req.params.id]);

    if (!rows.length) return res.status(404).json({ error: { message: 'Ingredient not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save dietary flags' } });
  }
});

// ── GET /nutrition/report/menu/:menu_id — per-portion nutrition for a menu ────
router.get('/report/menu/:menu_id', async (req, res) => {
  try {
    const { rows: items } = await pool.query(`
      SELECT mi.id AS menu_item_id, mi.display_name, mi.item_type, mi.qty,
             mi.recipe_id, mi.ingredient_id,
             r.name AS recipe_name, r.yield_qty,
             ing.name AS ingredient_name,
             ing.energy_kcal, ing.protein_g, ing.carbs_g, ing.fat_g,
             ing.fibre_g, ing.sugar_g, ing.salt_g
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      WHERE  mi.menu_id = $1
      ORDER BY mi.sort_order ASC
    `, [req.params.menu_id]);

    if (!items.length) return res.json([]);

    // For recipe items, sum nutrition from ingredient lines
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => i.recipe_id))];
    const recipeNutritionMap = {};

    if (recipeIds.length) {
      const { rows: riRows } = await pool.query(`
        SELECT ri.recipe_id, ri.prep_qty, ri.prep_to_base_conversion,
               ing.energy_kcal, ing.protein_g, ing.carbs_g, ing.fat_g,
               ing.fibre_g, ing.sugar_g, ing.salt_g, ing.waste_pct
        FROM   mcogs_recipe_items ri
        JOIN   mcogs_ingredients  ing ON ing.id = ri.ingredient_id
        WHERE  ri.recipe_id = ANY($1::int[]) AND ri.item_type = 'ingredient'
      `, [recipeIds]);

      for (const ri of riRows) {
        if (!recipeNutritionMap[ri.recipe_id]) {
          recipeNutritionMap[ri.recipe_id] = { energy_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, sugar_g: 0, salt_g: 0, complete: true };
        }
        const rn = recipeNutritionMap[ri.recipe_id];

        if (ri.energy_kcal == null) { rn.complete = false; continue; }

        // base qty in grams (nutrition is per 100g)
        const baseQty   = Number(ri.prep_qty) * Number(ri.prep_to_base_conversion);
        const wasteMult = 1 + (Number(ri.waste_pct || 0) / 100);
        const grams     = baseQty * wasteMult;
        const factor    = grams / 100;

        rn.energy_kcal += Number(ri.energy_kcal) * factor;
        rn.protein_g   += Number(ri.protein_g   || 0) * factor;
        rn.carbs_g     += Number(ri.carbs_g     || 0) * factor;
        rn.fat_g       += Number(ri.fat_g       || 0) * factor;
        rn.fibre_g     += Number(ri.fibre_g     || 0) * factor;
        rn.sugar_g     += Number(ri.sugar_g     || 0) * factor;
        rn.salt_g      += Number(ri.salt_g      || 0) * factor;
      }

      // Divide by yield_qty to get per-portion
      for (const item of items.filter(i => i.recipe_id)) {
        const rn = recipeNutritionMap[item.recipe_id];
        if (!rn) continue;
        const yieldQty = Math.max(1, Number(item.yield_qty || 1));
        for (const key of ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugar_g', 'salt_g']) {
          rn[key] = Math.round((rn[key] / yieldQty) * 100) / 100;
        }
      }
    }

    const result = items.map(item => {
      const display = item.display_name?.trim() || item.recipe_name || item.ingredient_name || '—';

      let nutrition = null;
      if (item.item_type === 'ingredient' && item.ingredient_id) {
        if (item.energy_kcal != null) {
          nutrition = {
            energy_kcal: Number(item.energy_kcal),
            protein_g:   Number(item.protein_g  || 0),
            carbs_g:     Number(item.carbs_g    || 0),
            fat_g:       Number(item.fat_g      || 0),
            fibre_g:     Number(item.fibre_g    || 0),
            sugar_g:     Number(item.sugar_g    || 0),
            salt_g:      Number(item.salt_g     || 0),
            complete:    true,
          };
        }
      } else if (item.recipe_id) {
        nutrition = recipeNutritionMap[item.recipe_id] || null;
      }

      return { menu_item_id: item.menu_item_id, display_name: display, item_type: item.item_type, nutrition };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate nutrition report' } });
  }
});

module.exports = router;
