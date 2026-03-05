const router = require('express').Router();
const pool   = require('../db/pool');

// ── GET /allergens — all 14 reference allergens ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_allergens ORDER BY sort_order ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch allergens' } });
  }
});

// ── GET /allergens/ingredients — all allergen assignments (batch) ─────────────
// Returns flat array: [{ ingredient_id, allergen_id, status, code }]
router.get('/ingredients', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ia.ingredient_id, ia.allergen_id, ia.status, a.code
      FROM   mcogs_ingredient_allergens ia
      JOIN   mcogs_allergens a ON a.id = ia.allergen_id
      ORDER  BY ia.ingredient_id, a.sort_order ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch all ingredient allergens' } });
  }
});

// ── GET /allergens/ingredient/:id — allergens set on one ingredient ───────────
router.get('/ingredient/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ia.allergen_id, ia.status, a.name, a.code, a.sort_order
      FROM   mcogs_ingredient_allergens ia
      JOIN   mcogs_allergens a ON a.id = ia.allergen_id
      WHERE  ia.ingredient_id = $1
      ORDER BY a.sort_order ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch ingredient allergens' } });
  }
});

// ── PUT /allergens/ingredient/:id — bulk replace allergens for one ingredient ─
// Body: { allergens: [{ allergen_id: number, status: 'contains'|'may_contain'|'free_from' }] }
// Sends the full desired state; any not in the list are deleted.
router.put('/ingredient/:id', async (req, res) => {
  const ingredientId = Number(req.params.id);
  const { allergens = [] } = req.body;

  if (!Array.isArray(allergens)) {
    return res.status(400).json({ error: { message: 'allergens must be an array' } });
  }

  const validStatuses = ['contains', 'may_contain', 'free_from'];
  for (const a of allergens) {
    if (!a.allergen_id) return res.status(400).json({ error: { message: 'Each allergen must have allergen_id' } });
    if (!validStatuses.includes(a.status)) return res.status(400).json({ error: { message: `Invalid status: ${a.status}` } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all existing allergens for this ingredient
    await client.query(
      `DELETE FROM mcogs_ingredient_allergens WHERE ingredient_id = $1`,
      [ingredientId]
    );

    // Insert new set
    for (const a of allergens) {
      await client.query(`
        INSERT INTO mcogs_ingredient_allergens (ingredient_id, allergen_id, status)
        VALUES ($1, $2, $3)
      `, [ingredientId, a.allergen_id, a.status]);
    }

    await client.query('COMMIT');

    // Return updated list
    const { rows } = await pool.query(`
      SELECT ia.allergen_id, ia.status, a.name, a.code, a.sort_order
      FROM   mcogs_ingredient_allergens ia
      JOIN   mcogs_allergens a ON a.id = ia.allergen_id
      WHERE  ia.ingredient_id = $1
      ORDER BY a.sort_order ASC
    `, [ingredientId]);

    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update ingredient allergens' } });
  } finally {
    client.release();
  }
});

// ── GET /allergens/recipe/:id — derived allergens for a recipe ────────────────
// Aggregates allergen status from all ingredient lines recursively (1 level deep).
// contains wins > may_contain wins > free_from (absence = not assessed)
router.get('/recipe/:id', async (req, res) => {
  try {
    // Fetch all ingredient-type recipe items for this recipe
    const { rows: items } = await pool.query(`
      SELECT ri.ingredient_id
      FROM   mcogs_recipe_items ri
      WHERE  ri.recipe_id = $1 AND ri.item_type = 'ingredient'
    `, [req.params.id]);

    if (!items.length) return res.json([]);

    const ingredientIds = items.map(i => i.ingredient_id).filter(Boolean);

    // Get all allergens for these ingredients
    const { rows: allergenRows } = await pool.query(`
      SELECT ia.allergen_id, ia.status, a.name, a.code, a.sort_order
      FROM   mcogs_ingredient_allergens ia
      JOIN   mcogs_allergens a ON a.id = ia.allergen_id
      WHERE  ia.ingredient_id = ANY($1::int[])
    `, [ingredientIds]);

    // Aggregate: contains > may_contain > free_from
    const rank = { contains: 3, may_contain: 2, free_from: 1 };
    const agg  = {};
    for (const row of allergenRows) {
      const existing = agg[row.allergen_id];
      if (!existing || rank[row.status] > rank[existing.status]) {
        agg[row.allergen_id] = row;
      }
    }

    const result = Object.values(agg).sort((a, b) => a.sort_order - b.sort_order);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch recipe allergens' } });
  }
});

// ── GET /allergens/menu/:id — allergen matrix for a whole menu ─────────────────
// Returns: { allergens: [...], items: [{ menu_item_id, display_name, allergens: { [code]: status|null } }] }
router.get('/menu/:id', async (req, res) => {
  try {
    const { rows: allAllergens } = await pool.query(
      `SELECT * FROM mcogs_allergens ORDER BY sort_order ASC`
    );

    // All items on this menu
    const { rows: menuItems } = await pool.query(`
      SELECT mi.id, mi.display_name, mi.item_type, mi.recipe_id, mi.ingredient_id,
             r.name AS recipe_name, r.category AS recipe_category,
             ing.name AS ingredient_name, ing.category AS ingredient_category
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      WHERE  mi.menu_id = $1
      ORDER BY mi.sort_order ASC
    `, [req.params.id]);

    if (!menuItems.length) {
      return res.json({ allergens: allAllergens, items: [] });
    }

    // Collect all ingredient IDs (direct + via recipes)
    const recipeIds     = [...new Set(menuItems.filter(i => i.recipe_id).map(i => i.recipe_id))];
    const directIngIds  = menuItems.filter(i => i.ingredient_id).map(i => i.ingredient_id);

    // Recipe → ingredient ids
    let recipeIngMap = {};
    if (recipeIds.length) {
      const { rows: riRows } = await pool.query(`
        SELECT recipe_id, ingredient_id
        FROM   mcogs_recipe_items
        WHERE  recipe_id = ANY($1::int[]) AND item_type = 'ingredient'
      `, [recipeIds]);
      for (const ri of riRows) {
        if (!recipeIngMap[ri.recipe_id]) recipeIngMap[ri.recipe_id] = [];
        recipeIngMap[ri.recipe_id].push(ri.ingredient_id);
      }
    }

    // All ingredient IDs in scope
    const allIngIds = [...new Set([
      ...directIngIds,
      ...Object.values(recipeIngMap).flat(),
    ])];

    // Load all allergen data for these ingredients
    let ingAllergenMap = {};
    if (allIngIds.length) {
      const { rows: iaRows } = await pool.query(`
        SELECT ia.ingredient_id, ia.allergen_id, ia.status, a.code
        FROM   mcogs_ingredient_allergens ia
        JOIN   mcogs_allergens a ON a.id = ia.allergen_id
        WHERE  ia.ingredient_id = ANY($1::int[])
      `, [allIngIds]);
      for (const ia of iaRows) {
        if (!ingAllergenMap[ia.ingredient_id]) ingAllergenMap[ia.ingredient_id] = {};
        ingAllergenMap[ia.ingredient_id][ia.allergen_id] = { status: ia.status, code: ia.code };
      }
    }

    const rank = { contains: 3, may_contain: 2, free_from: 1 };

    function aggregateAllergens(ingIds) {
      const agg = {};
      for (const ingId of ingIds) {
        const map = ingAllergenMap[ingId] || {};
        for (const [allergenId, { status, code }] of Object.entries(map)) {
          if (!agg[allergenId] || rank[status] > rank[agg[allergenId].status]) {
            agg[allergenId] = { status, code };
          }
        }
      }
      return agg;
    }

    const items = menuItems.map(mi => {
      const display = mi.display_name?.trim() || mi.recipe_name || mi.ingredient_name || '—';
      let ingIds = [];
      if (mi.item_type === 'ingredient' && mi.ingredient_id) {
        ingIds = [mi.ingredient_id];
      } else if (mi.recipe_id) {
        ingIds = recipeIngMap[mi.recipe_id] || [];
      }

      const agg = aggregateAllergens(ingIds);

      // Build allergen map keyed by allergen code
      const allergenStatus = {};
      for (const a of allAllergens) {
        const found = Object.values(agg).find(v => v.code === a.code);
        allergenStatus[a.code] = found ? found.status : null;
      }

      const category = mi.item_type === 'ingredient'
        ? (mi.ingredient_category || null)
        : (mi.recipe_category || null);

      return { menu_item_id: mi.id, display_name: display, item_type: mi.item_type, category, allergens: allergenStatus };
    });

    res.json({ allergens: allAllergens, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menu allergen matrix' } });
  }
});

module.exports = router;
