const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

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

    logAudit(pool, req, { action: 'update', entity_type: 'allergen_profile', entity_id: ingredientId, entity_label: `Ingredient #${ingredientId}`, context: { allergen_count: allergens.length } });
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
// Supports menus using mcogs_menu_sales_items (new) with fallback to mcogs_menu_items (legacy).
router.get('/menu/:id', async (req, res) => {
  try {
    const menuId = Number(req.params.id);

    const { rows: allAllergens } = await pool.query(
      `SELECT * FROM mcogs_allergens ORDER BY sort_order ASC`
    );

    // ── Load menu items from mcogs_menu_sales_items (new) ─────────────────────
    const { rows: menuItems } = await pool.query(`
      SELECT msi.id,
             COALESCE(si.display_name, si.name) AS display_name,
             si.item_type,
             si.recipe_id,
             si.ingredient_id,
             si.combo_id,
             msi.allergen_notes,
             r.name    AS recipe_name,
             rcat.name AS recipe_category,
             ing.name  AS ingredient_name,
             icat.name AS ingredient_category,
             sicat.name AS si_category
      FROM   mcogs_menu_sales_items msi
      JOIN   mcogs_sales_items      si   ON si.id   = msi.sales_item_id
      LEFT JOIN mcogs_recipes       r    ON r.id    = si.recipe_id
      LEFT JOIN mcogs_categories    rcat ON rcat.id = r.category_id
      LEFT JOIN mcogs_ingredients   ing  ON ing.id  = si.ingredient_id
      LEFT JOIN mcogs_categories    icat ON icat.id = ing.category_id
      LEFT JOIN mcogs_categories    sicat ON sicat.id = si.category_id
      WHERE  msi.menu_id = $1
      ORDER  BY msi.sort_order, msi.id
    `, [menuId]);

    if (!menuItems.length) {
      return res.json({ allergens: allAllergens, items: [] });
    }

    // ── Collect recipe IDs and combo IDs ──────────────────────────────────────
    const recipeIds   = [...new Set(menuItems.filter(i => i.recipe_id).map(i => i.recipe_id))];
    const directIngIds = menuItems.filter(i => i.item_type === 'ingredient' && i.ingredient_id).map(i => i.ingredient_id);
    const comboIds    = [...new Set(menuItems.filter(i => i.combo_id).map(i => i.combo_id))];

    // Recipe → ingredient IDs
    const recipeIngMap = {};
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

    // Combo → ingredient IDs (via combo step options → recipe or ingredient)
    const comboIngMap = {};
    if (comboIds.length) {
      // Step options that are direct ingredients
      const { rows: ciIngRows } = await pool.query(`
        SELECT cs.combo_id, cso.ingredient_id
        FROM   mcogs_combo_steps       cs
        JOIN   mcogs_combo_step_options cso ON cso.combo_step_id = cs.id
        WHERE  cs.combo_id = ANY($1::int[])
          AND  cso.item_type = 'ingredient'
          AND  cso.ingredient_id IS NOT NULL
      `, [comboIds]);
      for (const row of ciIngRows) {
        if (!comboIngMap[row.combo_id]) comboIngMap[row.combo_id] = [];
        comboIngMap[row.combo_id].push(row.ingredient_id);
      }

      // Step options that are recipes → resolve to ingredient IDs
      const { rows: ciRecRows } = await pool.query(`
        SELECT cs.combo_id, cso.recipe_id
        FROM   mcogs_combo_steps       cs
        JOIN   mcogs_combo_step_options cso ON cso.combo_step_id = cs.id
        WHERE  cs.combo_id = ANY($1::int[])
          AND  cso.item_type = 'recipe'
          AND  cso.recipe_id IS NOT NULL
      `, [comboIds]);
      if (ciRecRows.length) {
        const comboRecipeIds = [...new Set(ciRecRows.map(r => r.recipe_id))];
        const { rows: riRows } = await pool.query(`
          SELECT recipe_id, ingredient_id
          FROM   mcogs_recipe_items
          WHERE  recipe_id = ANY($1::int[]) AND item_type = 'ingredient'
        `, [comboRecipeIds]);
        const crIngMap = {};
        for (const ri of riRows) {
          if (!crIngMap[ri.recipe_id]) crIngMap[ri.recipe_id] = [];
          crIngMap[ri.recipe_id].push(ri.ingredient_id);
        }
        for (const row of ciRecRows) {
          if (!comboIngMap[row.combo_id]) comboIngMap[row.combo_id] = [];
          comboIngMap[row.combo_id].push(...(crIngMap[row.recipe_id] || []));
        }
      }
    }

    // All ingredient IDs across all sources
    const allIngIds = [...new Set([
      ...directIngIds,
      ...Object.values(recipeIngMap).flat(),
      ...Object.values(comboIngMap).flat(),
    ])];

    // Load allergen data for all ingredients
    const ingAllergenMap = {};
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
      } else if (mi.item_type === 'recipe' && mi.recipe_id) {
        ingIds = recipeIngMap[mi.recipe_id] || [];
      } else if (mi.item_type === 'combo' && mi.combo_id) {
        ingIds = [...new Set(comboIngMap[mi.combo_id] || [])];
      }
      // manual items have no ingredient link — ingIds stays []

      const agg = aggregateAllergens(ingIds);

      const allergenStatus = {};
      for (const a of allAllergens) {
        const found = Object.values(agg).find(v => v.code === a.code);
        allergenStatus[a.code] = found ? found.status : null;
      }

      const category = mi.item_type === 'ingredient'
        ? (mi.ingredient_category || mi.si_category || null)
        : mi.item_type === 'recipe'
          ? (mi.recipe_category || mi.si_category || null)
          : (mi.si_category || null); // combo, manual

      return {
        menu_item_id:   mi.id,
        display_name:   display,
        item_type:      mi.item_type,
        category,
        allergens:      allergenStatus,
        allergen_notes: mi.allergen_notes ?? null,
      };
    });

    res.json({ allergens: allAllergens, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menu allergen matrix' } });
  }
});

// ── PATCH /allergens/menu-item/:id/notes — save allergen notes on a menu sales item
router.patch('/menu-item/:id/notes', async (req, res) => {
  const { allergen_notes = null } = req.body;
  try {
    await pool.query(
      `UPDATE mcogs_menu_sales_items SET allergen_notes = $1 WHERE id = $2`,
      [allergen_notes || null, Number(req.params.id)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save allergen notes' } });
  }
});

// ── PATCH /allergens/ingredient/:id/notes — save allergen notes on an ingredient
router.patch('/ingredient/:id/notes', async (req, res) => {
  const { allergen_notes = null } = req.body;
  try {
    await pool.query(
      `UPDATE mcogs_ingredients SET allergen_notes = $1, updated_at = NOW() WHERE id = $2`,
      [allergen_notes || null, Number(req.params.id)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save allergen notes' } });
  }
});

module.exports = router;
