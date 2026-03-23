// =============================================================================
// COGS AI Chat — SSE streaming endpoint powered by Claude Haiku 4.5
// POST /api/ai-chat        — send a message, receive SSE stream
// GET  /api/ai-chat-log    — paginated chat history
// =============================================================================

const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const rag       = require('../helpers/rag');
const aiConfig  = require('../helpers/aiConfig');
const { agenticStream } = require('../helpers/agenticStream');

// Client is created per-request so it always picks up the latest key
function getClient() {
  const key = aiConfig.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  // ── Read / Lookup (existing) ─────────────────────────────────────────────────
  {
    name: 'get_dashboard_stats',
    description: 'Returns high-level counts: total ingredients, recipes, menus, vendors, markets, price quote coverage.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_ingredients',
    description: 'Lists all ingredients with id, name, category, waste_pct, and base unit. Use before write operations to find IDs.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name filter (case-insensitive partial match)' },
      },
      required: [],
    },
  },
  {
    name: 'get_ingredient',
    description: 'Returns full details for a single ingredient including allergens and price quotes.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ingredient ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_recipes',
    description: 'Lists all recipes with id, name, and description.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name filter' },
      },
      required: [],
    },
  },
  {
    name: 'get_recipe',
    description: 'Returns a recipe with all its ingredient lines and their costs per country.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Recipe ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_menus',
    description: 'Lists all menus with id, name, and market (country).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_menu_cogs',
    description: 'Returns menu items with sell prices and COGS for a specific menu.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'integer', description: 'Menu ID' },
      },
      required: ['menu_id'],
    },
  },
  {
    name: 'get_feedback',
    description: 'Returns feedback tickets from the feedback table, filterable by type and status.',
    input_schema: {
      type: 'object',
      properties: {
        type:   { type: 'string', enum: ['bug', 'feature', 'general'] },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
        limit:  { type: 'integer', description: 'Max rows to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'submit_feedback',
    description: 'Submits a bug report, feature request, or general feedback. No confirmation required.',
    input_schema: {
      type: 'object',
      properties: {
        type:        { type: 'string', enum: ['bug', 'feature', 'general'] },
        title:       { type: 'string' },
        description: { type: 'string' },
        page:        { type: 'string', description: 'Which page/section the feedback relates to' },
      },
      required: ['type', 'title'],
    },
  },

  // ── New Lookup / Read ────────────────────────────────────────────────────────
  {
    name: 'list_vendors',
    description: 'Lists all vendors with id, name, and country. Call this to resolve vendor names to IDs before write operations.',
    input_schema: {
      type: 'object',
      properties: {
        country_id: { type: 'integer', description: 'Optional: filter by country ID' },
      },
      required: [],
    },
  },
  {
    name: 'list_markets',
    description: 'Lists all markets (countries) with id, name, currency_code, currency_symbol, and exchange_rate.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_categories',
    description: 'Lists all categories with id, name, type (ingredient/recipe), and group_name.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['ingredient', 'recipe'], description: 'Optional: filter by category type' },
      },
      required: [],
    },
  },
  {
    name: 'list_units',
    description: 'Lists all measurement units with id, name, abbreviation, and type. Call before creating ingredients or recipes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_price_levels',
    description: 'Lists all price levels (e.g. Eat-in, Takeout, Delivery) with id, name, and is_default.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_price_quotes',
    description: 'Lists price quotes with vendor name, ingredient name, purchase price, and computed price per base unit.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'integer', description: 'Optional: filter by ingredient' },
        vendor_id:     { type: 'integer', description: 'Optional: filter by vendor' },
        is_active:     { type: 'boolean', description: 'Optional: filter active/inactive quotes' },
      },
      required: [],
    },
  },

  // ── Create ───────────────────────────────────────────────────────────────────
  {
    name: 'create_ingredient',
    description: 'Creates a new ingredient. If the category name does not exist it will be auto-created. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:                         { type: 'string' },
        category:                     { type: 'string', description: 'Category name (auto-created if missing)' },
        base_unit_id:                 { type: 'integer', description: 'ID from list_units' },
        waste_pct:                    { type: 'number', description: 'Waste percentage 0-100' },
        default_prep_unit:            { type: 'string' },
        default_prep_to_base_conversion: { type: 'number', description: 'Conversion factor (default 1)' },
        notes:                        { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_vendor',
    description: 'Creates a new vendor/supplier. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:       { type: 'string' },
        country_id: { type: 'integer', description: 'Market/country ID from list_markets' },
        contact:    { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        notes:      { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_price_quote',
    description: 'Creates a new price quote linking an ingredient to a vendor. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id:     { type: 'integer' },
        vendor_id:         { type: 'integer' },
        purchase_price:    { type: 'number', description: 'Price paid for the purchase quantity' },
        qty_in_base_units: { type: 'number', description: 'How many base units does the purchase quantity represent' },
        purchase_unit:     { type: 'string', description: 'Description of the purchase unit (e.g. "5kg bag")' },
        is_active:         { type: 'boolean', description: 'Default true' },
        vendor_product_code: { type: 'string' },
      },
      required: ['ingredient_id', 'vendor_id', 'purchase_price', 'qty_in_base_units'],
    },
  },
  {
    name: 'set_preferred_vendor',
    description: 'Sets (or replaces) the preferred vendor+quote for an ingredient in a specific market. One record per ingredient×country. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'integer' },
        country_id:    { type: 'integer' },
        vendor_id:     { type: 'integer' },
        quote_id:      { type: 'integer' },
      },
      required: ['ingredient_id', 'country_id', 'vendor_id', 'quote_id'],
    },
  },
  {
    name: 'create_recipe',
    description: 'Creates a new recipe. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:          { type: 'string' },
        category:      { type: 'string' },
        description:   { type: 'string' },
        yield_qty:     { type: 'number' },
        yield_unit_id: { type: 'integer', description: 'Unit ID from list_units' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_recipe_item',
    description: 'Adds an ingredient or sub-recipe line to a recipe. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        recipe_id:               { type: 'integer' },
        item_type:               { type: 'string', enum: ['ingredient', 'recipe'] },
        ingredient_id:           { type: 'integer', description: 'Required when item_type = ingredient' },
        recipe_item_id:          { type: 'integer', description: 'Required when item_type = recipe (sub-recipe ID)' },
        prep_qty:                { type: 'number' },
        prep_unit:               { type: 'string' },
        prep_to_base_conversion: { type: 'number', description: 'Conversion factor (default 1)' },
      },
      required: ['recipe_id', 'item_type', 'prep_qty'],
    },
  },
  {
    name: 'create_menu',
    description: 'Creates a new menu for a specific market/country. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        country_id:  { type: 'integer', description: 'Market ID from list_markets' },
        description: { type: 'string' },
      },
      required: ['name', 'country_id'],
    },
  },
  {
    name: 'add_menu_item',
    description: 'Adds a recipe or ingredient line to a menu. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id:       { type: 'integer' },
        item_type:     { type: 'string', enum: ['recipe', 'ingredient'] },
        display_name:  { type: 'string' },
        recipe_id:     { type: 'integer', description: 'Required when item_type = recipe' },
        ingredient_id: { type: 'integer', description: 'Required when item_type = ingredient' },
        qty:           { type: 'number', description: 'Default 1' },
        sell_price:    { type: 'number', description: 'Default sell price in USD base' },
      },
      required: ['menu_id', 'item_type', 'display_name'],
    },
  },
  {
    name: 'set_menu_item_price',
    description: 'Upserts the sell price for a menu item at a specific price level. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        menu_item_id:   { type: 'integer' },
        price_level_id: { type: 'integer', description: 'From list_price_levels' },
        sell_price:     { type: 'number' },
        tax_rate_id:    { type: 'integer', description: 'Optional tax rate ID' },
      },
      required: ['menu_item_id', 'price_level_id', 'sell_price'],
    },
  },
  {
    name: 'create_category',
    description: 'Creates a new ingredient or recipe category. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:       { type: 'string' },
        type:       { type: 'string', enum: ['ingredient', 'recipe'] },
        group_name: { type: 'string' },
        sort_order: { type: 'integer' },
      },
      required: ['name', 'type'],
    },
  },

  // ── Update ───────────────────────────────────────────────────────────────────
  {
    name: 'update_ingredient',
    description: 'Updates an existing ingredient. Only supply fields you want to change (plus id and name). CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:                           { type: 'integer' },
        name:                         { type: 'string' },
        category:                     { type: 'string' },
        base_unit_id:                 { type: 'integer' },
        waste_pct:                    { type: 'number' },
        default_prep_unit:            { type: 'string' },
        default_prep_to_base_conversion: { type: 'number' },
        notes:                        { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'update_vendor',
    description: 'Updates an existing vendor. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'integer' },
        name:       { type: 'string' },
        country_id: { type: 'integer' },
        contact:    { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        notes:      { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'update_price_quote',
    description: 'Updates a price quote. Fetches existing row first so you only need to supply the fields that change. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:                { type: 'integer' },
        purchase_price:    { type: 'number' },
        qty_in_base_units: { type: 'number' },
        purchase_unit:     { type: 'string' },
        is_active:         { type: 'boolean' },
        vendor_product_code: { type: 'string' },
      },
      required: ['id', 'purchase_price', 'qty_in_base_units'],
    },
  },
  {
    name: 'update_recipe',
    description: 'Updates an existing recipe header (not its items). CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'integer' },
        name:          { type: 'string' },
        category:      { type: 'string' },
        description:   { type: 'string' },
        yield_qty:     { type: 'number' },
        yield_unit_id: { type: 'integer' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'update_recipe_item',
    description: 'Updates the qty/unit/conversion of a recipe line item. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        recipe_id:               { type: 'integer' },
        item_id:                 { type: 'integer', description: 'ID of the mcogs_recipe_items row' },
        prep_qty:                { type: 'number' },
        prep_unit:               { type: 'string' },
        prep_to_base_conversion: { type: 'number' },
      },
      required: ['recipe_id', 'item_id', 'prep_qty'],
    },
  },

  // ── Delete ───────────────────────────────────────────────────────────────────
  {
    name: 'delete_ingredient',
    description: 'Deletes an ingredient. Will fail with a FK error if price quotes or recipe usage exist — resolve those first. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_vendor',
    description: 'Deletes a vendor. Will fail with a FK error if price quotes exist — remove quotes first. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_price_quote',
    description: 'Deletes a price quote. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_recipe_item',
    description: 'Removes one ingredient/sub-recipe line from a recipe. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'integer' },
        item_id:   { type: 'integer', description: 'ID of the mcogs_recipe_items row' },
      },
      required: ['recipe_id', 'item_id'],
    },
  },
  {
    name: 'delete_menu',
    description: 'Deletes a menu AND all its items and prices (cascade). Always warn the user about cascade deletion before calling. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

// Helper: ensure category name exists in mcogs_categories (mirrors ingredients.js)
async function ensureCategory(name, type = 'ingredient') {
  if (!name) return;
  const { rows } = await pool.query(
    `SELECT id FROM mcogs_categories WHERE name = $1 AND type = $2 LIMIT 1`,
    [name.trim(), type]
  );
  if (!rows.length) {
    await pool.query(
      `INSERT INTO mcogs_categories (name, type, group_name) VALUES ($1, $2, 'Unassigned')`,
      [name.trim(), type]
    );
  }
}

async function executeTool(name, input) {
  switch (name) {

    // ── Read / Lookup (existing) ───────────────────────────────────────────────

    case 'get_dashboard_stats': {
      const queries = [
        pool.query('SELECT COUNT(*) FROM mcogs_ingredients'),
        pool.query('SELECT COUNT(*) FROM mcogs_recipes'),
        pool.query('SELECT COUNT(*) FROM mcogs_menus'),
        pool.query('SELECT COUNT(*) FROM mcogs_vendors'),
        pool.query('SELECT COUNT(*) FROM mcogs_countries'),
        pool.query('SELECT COUNT(*) FROM mcogs_price_quotes'),
        pool.query('SELECT COUNT(*) FROM mcogs_ingredients WHERE id IN (SELECT ingredient_id FROM mcogs_price_quotes)'),
      ];
      const [ing, rec, men, ven, mkt, pq, covIng] = await Promise.all(queries);
      const total   = parseInt(ing.rows[0].count, 10);
      const covered = parseInt(covIng.rows[0].count, 10);
      return {
        ingredients:        total,
        recipes:            parseInt(rec.rows[0].count, 10),
        menus:              parseInt(men.rows[0].count, 10),
        vendors:            parseInt(ven.rows[0].count, 10),
        markets:            parseInt(mkt.rows[0].count, 10),
        price_quotes:       parseInt(pq.rows[0].count, 10),
        quote_coverage_pct: total ? Math.round((covered / total) * 100) : 0,
      };
    }

    case 'list_ingredients': {
      const { search } = input;
      const q = search
        ? `SELECT id, name, category, waste_pct, base_unit_id FROM mcogs_ingredients WHERE name ILIKE $1 ORDER BY name LIMIT 100`
        : `SELECT id, name, category, waste_pct, base_unit_id FROM mcogs_ingredients ORDER BY name LIMIT 100`;
      const { rows } = await pool.query(q, search ? [`%${search}%`] : []);
      return rows;
    }

    case 'get_ingredient': {
      const { id } = input;
      const [ing, quotes, allergens] = await Promise.all([
        pool.query(`
          SELECT i.*, u.name as base_unit_name, u.abbreviation as base_unit_abbr
          FROM mcogs_ingredients i
          LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
          WHERE i.id = $1`, [id]),
        pool.query(`
          SELECT pq.*, v.name as vendor_name, co.name as country_name, co.currency_symbol
          FROM mcogs_price_quotes pq
          JOIN mcogs_vendors v ON v.id = pq.vendor_id
          LEFT JOIN mcogs_countries co ON co.id = v.country_id
          WHERE pq.ingredient_id = $1 ORDER BY v.name`, [id]),
        pool.query(`
          SELECT a.name, a.code, ia.status
          FROM mcogs_ingredient_allergens ia
          JOIN mcogs_allergens a ON a.id = ia.allergen_id
          WHERE ia.ingredient_id = $1`, [id]),
      ]);
      if (!ing.rows.length) return { error: 'Ingredient not found' };
      return { ...ing.rows[0], price_quotes: quotes.rows, allergens: allergens.rows };
    }

    case 'list_recipes': {
      const { search } = input;
      const q = search
        ? `SELECT id, name, description FROM mcogs_recipes WHERE name ILIKE $1 ORDER BY name LIMIT 100`
        : `SELECT id, name, description FROM mcogs_recipes ORDER BY name LIMIT 100`;
      const { rows } = await pool.query(q, search ? [`%${search}%`] : []);
      return rows;
    }

    case 'get_recipe': {
      const { id } = input;
      const [rec, items] = await Promise.all([
        pool.query(`
          SELECT r.*, u.abbreviation as yield_unit_abbr
          FROM mcogs_recipes r
          LEFT JOIN mcogs_units u ON u.id = r.yield_unit_id
          WHERE r.id = $1`, [id]),
        pool.query(`
          SELECT ri.*, i.name as ingredient_name, u.abbreviation as unit_abbr,
                 sr.name as sub_recipe_name
          FROM mcogs_recipe_items ri
          LEFT JOIN mcogs_ingredients i ON i.id = ri.ingredient_id
          LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
          LEFT JOIN mcogs_recipes sr ON sr.id = ri.recipe_item_id
          WHERE ri.recipe_id = $1
          ORDER BY ri.id ASC`, [id]),
      ]);
      if (!rec.rows.length) return { error: 'Recipe not found' };
      return { ...rec.rows[0], items: items.rows };
    }

    case 'list_menus': {
      const { rows } = await pool.query(`
        SELECT m.id, m.name, c.name as market, c.currency_symbol
        FROM mcogs_menus m LEFT JOIN mcogs_countries c ON c.id = m.country_id
        ORDER BY c.name, m.name
      `);
      return rows;
    }

    case 'get_menu_cogs': {
      const { menu_id } = input;
      const { rows } = await pool.query(`
        SELECT mi.id, mi.display_name, mi.sell_price, mi.qty,
               r.name as recipe_name, i.name as ingredient_name,
               co.currency_symbol, co.name as market
        FROM mcogs_menu_items mi
        LEFT JOIN mcogs_menus m ON m.id = mi.menu_id
        LEFT JOIN mcogs_countries co ON co.id = m.country_id
        LEFT JOIN mcogs_recipes r ON r.id = mi.recipe_id
        LEFT JOIN mcogs_ingredients i ON i.id = mi.ingredient_id
        WHERE mi.menu_id = $1
        ORDER BY mi.display_name
      `, [menu_id]);
      return rows;
    }

    case 'get_feedback': {
      const { type, status, limit = 20 } = input;
      const conditions = [];
      const vals = [];
      if (type)   conditions.push(`type = $${vals.push(type)}`);
      if (status) conditions.push(`status = $${vals.push(status)}`);
      vals.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM mcogs_feedback ${where} ORDER BY created_at DESC LIMIT $${vals.length}`,
        vals
      );
      return rows;
    }

    case 'submit_feedback': {
      const { type = 'general', title, description, page } = input;
      const { rows } = await pool.query(
        `INSERT INTO mcogs_feedback (type, title, description, page) VALUES ($1,$2,$3,$4) RETURNING *`,
        [type, title, description || null, page || null]
      );
      return rows[0];
    }

    // ── New Lookup / Read ──────────────────────────────────────────────────────

    case 'list_vendors': {
      const { country_id } = input;
      const q = country_id
        ? `SELECT v.id, v.name, c.name as country_name, c.currency_symbol FROM mcogs_vendors v LEFT JOIN mcogs_countries c ON c.id = v.country_id WHERE v.country_id = $1 ORDER BY v.name`
        : `SELECT v.id, v.name, c.name as country_name, c.currency_symbol FROM mcogs_vendors v LEFT JOIN mcogs_countries c ON c.id = v.country_id ORDER BY v.name`;
      const { rows } = await pool.query(q, country_id ? [country_id] : []);
      return rows;
    }

    case 'list_markets': {
      const { rows } = await pool.query(`
        SELECT id, name, currency_code, currency_symbol, exchange_rate
        FROM mcogs_countries ORDER BY name
      `);
      return rows;
    }

    case 'list_categories': {
      const { type } = input;
      const q = type
        ? `SELECT id, name, type, group_name, sort_order FROM mcogs_categories WHERE type = $1 ORDER BY name`
        : `SELECT id, name, type, group_name, sort_order FROM mcogs_categories ORDER BY type, name`;
      const { rows } = await pool.query(q, type ? [type] : []);
      return rows;
    }

    case 'list_units': {
      const { rows } = await pool.query(`
        SELECT id, name, abbreviation, type FROM mcogs_units ORDER BY type, name
      `);
      return rows;
    }

    case 'list_price_levels': {
      const { rows } = await pool.query(`
        SELECT id, name, description, is_default FROM mcogs_price_levels ORDER BY name
      `);
      return rows;
    }

    case 'list_price_quotes': {
      const { ingredient_id, vendor_id, is_active } = input;
      const conditions = [];
      const vals = [];
      if (ingredient_id !== undefined) conditions.push(`pq.ingredient_id = $${vals.push(ingredient_id)}`);
      if (vendor_id     !== undefined) conditions.push(`pq.vendor_id = $${vals.push(vendor_id)}`);
      if (is_active     !== undefined) conditions.push(`pq.is_active = $${vals.push(is_active)}`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`
        SELECT pq.id, pq.ingredient_id, pq.vendor_id,
               i.name as ingredient_name, v.name as vendor_name,
               pq.purchase_price, pq.qty_in_base_units, pq.purchase_unit,
               pq.is_active, pq.vendor_product_code,
               ROUND((pq.purchase_price / NULLIF(pq.qty_in_base_units, 0))::numeric, 4) as price_per_base_unit
        FROM mcogs_price_quotes pq
        JOIN mcogs_ingredients i ON i.id = pq.ingredient_id
        JOIN mcogs_vendors v ON v.id = pq.vendor_id
        ${where}
        ORDER BY i.name, v.name
        LIMIT 200
      `, vals);
      return rows;
    }

    // ── Ingredient CRUD ────────────────────────────────────────────────────────

    case 'create_ingredient': {
      const { name, category, base_unit_id, waste_pct, default_prep_unit,
              default_prep_to_base_conversion, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      await ensureCategory(category, 'ingredient');
      const { rows } = await pool.query(`
        INSERT INTO mcogs_ingredients
          (name, category, base_unit_id, waste_pct, default_prep_unit, default_prep_to_base_conversion, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, category, waste_pct
      `, [
        name.trim(),
        category?.trim()                  || null,
        base_unit_id                      || null,
        waste_pct                         ?? 0,
        default_prep_unit?.trim()         || null,
        default_prep_to_base_conversion   ?? 1,
        notes?.trim()                     || null,
      ]);
      return rows[0];
    }

    case 'update_ingredient': {
      const { id, name, category, base_unit_id, waste_pct, default_prep_unit,
              default_prep_to_base_conversion, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      await ensureCategory(category, 'ingredient');
      const { rows } = await pool.query(`
        UPDATE mcogs_ingredients SET
          name = $1, category = $2, base_unit_id = $3, waste_pct = $4,
          default_prep_unit = $5, default_prep_to_base_conversion = $6, notes = $7
        WHERE id = $8 RETURNING id, name, category, waste_pct
      `, [
        name.trim(),
        category?.trim()                  || null,
        base_unit_id                      || null,
        waste_pct                         ?? 0,
        default_prep_unit?.trim()         || null,
        default_prep_to_base_conversion   ?? 1,
        notes?.trim()                     || null,
        id,
      ]);
      if (!rows.length) return { error: 'Ingredient not found' };
      return rows[0];
    }

    case 'delete_ingredient': {
      const { id } = input;
      try {
        await pool.query(`DELETE FROM mcogs_ingredients WHERE id = $1`, [id]);
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') {
          return { error: 'FK violation — this ingredient is referenced by price quotes or recipes. Remove those first, then delete.' };
        }
        throw err;
      }
    }

    // ── Vendor CRUD ────────────────────────────────────────────────────────────

    case 'create_vendor': {
      const { name, country_id, contact, email, phone, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_vendors (name, country_id, contact, email, phone, notes)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name
      `, [
        name.trim(),
        country_id  || null,
        contact?.trim() || null,
        email?.trim()   || null,
        phone?.trim()   || null,
        notes?.trim()   || null,
      ]);
      return rows[0];
    }

    case 'update_vendor': {
      const { id, name, country_id, contact, email, phone, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_vendors SET name=$1, country_id=$2, contact=$3, email=$4, phone=$5, notes=$6
        WHERE id=$7 RETURNING id, name
      `, [
        name.trim(),
        country_id  || null,
        contact?.trim() || null,
        email?.trim()   || null,
        phone?.trim()   || null,
        notes?.trim()   || null,
        id,
      ]);
      if (!rows.length) return { error: 'Vendor not found' };
      return rows[0];
    }

    case 'delete_vendor': {
      const { id } = input;
      try {
        await pool.query(`DELETE FROM mcogs_vendors WHERE id = $1`, [id]);
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') {
          return { error: 'FK violation — this vendor has price quotes. Remove the quotes first, then delete the vendor.' };
        }
        throw err;
      }
    }

    // ── Price Quote CRUD ───────────────────────────────────────────────────────

    case 'create_price_quote': {
      const { ingredient_id, vendor_id, purchase_price, qty_in_base_units,
              purchase_unit, is_active = true, vendor_product_code } = input;
      const { rows } = await pool.query(`
        INSERT INTO mcogs_price_quotes
          (ingredient_id, vendor_id, purchase_price, qty_in_base_units, purchase_unit, is_active, vendor_product_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, ingredient_id, vendor_id, purchase_price, qty_in_base_units, is_active
      `, [ingredient_id, vendor_id, purchase_price, qty_in_base_units,
          purchase_unit || null, is_active, vendor_product_code || null]);
      return rows[0];
    }

    case 'update_price_quote': {
      // Fetch existing row first so caller only needs to supply changed fields
      const existing = await pool.query(`SELECT * FROM mcogs_price_quotes WHERE id = $1`, [input.id]);
      if (!existing.rows.length) return { error: 'Price quote not found' };
      const row = existing.rows[0];
      const { rows } = await pool.query(`
        UPDATE mcogs_price_quotes SET
          purchase_price    = $1,
          qty_in_base_units = $2,
          purchase_unit     = $3,
          is_active         = $4,
          vendor_product_code = $5
        WHERE id = $6
        RETURNING id, ingredient_id, vendor_id, purchase_price, qty_in_base_units, is_active
      `, [
        input.purchase_price    ?? row.purchase_price,
        input.qty_in_base_units ?? row.qty_in_base_units,
        input.purchase_unit     !== undefined ? input.purchase_unit    : row.purchase_unit,
        input.is_active         !== undefined ? input.is_active        : row.is_active,
        input.vendor_product_code !== undefined ? input.vendor_product_code : row.vendor_product_code,
        input.id,
      ]);
      return rows[0];
    }

    case 'delete_price_quote': {
      const { id } = input;
      await pool.query(`DELETE FROM mcogs_price_quotes WHERE id = $1`, [id]);
      return { deleted: true, id };
    }

    case 'set_preferred_vendor': {
      const { ingredient_id, country_id, vendor_id, quote_id } = input;
      const { rows } = await pool.query(`
        INSERT INTO mcogs_ingredient_preferred_vendor
          (ingredient_id, country_id, vendor_id, quote_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (ingredient_id, country_id)
        DO UPDATE SET vendor_id = EXCLUDED.vendor_id, quote_id = EXCLUDED.quote_id
        RETURNING *
      `, [ingredient_id, country_id, vendor_id, quote_id]);
      return rows[0];
    }

    // ── Recipe CRUD ────────────────────────────────────────────────────────────

    case 'create_recipe': {
      const { name, category, description, yield_qty, yield_unit_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_recipes (name, category, description, yield_qty, yield_unit_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id, name, category
      `, [
        name.trim(),
        category?.trim()    || null,
        description?.trim() || null,
        yield_qty           || null,
        yield_unit_id       || null,
      ]);
      return rows[0];
    }

    case 'update_recipe': {
      const { id, name, category, description, yield_qty, yield_unit_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_recipes SET name=$1, category=$2, description=$3, yield_qty=$4, yield_unit_id=$5
        WHERE id=$6 RETURNING id, name, category
      `, [
        name.trim(),
        category?.trim()    || null,
        description?.trim() || null,
        yield_qty           || null,
        yield_unit_id       || null,
        id,
      ]);
      if (!rows.length) return { error: 'Recipe not found' };
      return rows[0];
    }

    case 'add_recipe_item': {
      const { recipe_id, item_type, ingredient_id, recipe_item_id,
              prep_qty, prep_unit, prep_to_base_conversion = 1 } = input;
      const { rows } = await pool.query(`
        INSERT INTO mcogs_recipe_items
          (recipe_id, item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, recipe_id, item_type, prep_qty
      `, [
        recipe_id,
        item_type,
        item_type === 'ingredient' ? (ingredient_id || null) : null,
        item_type === 'recipe'     ? (recipe_item_id || null) : null,
        prep_qty,
        prep_unit   || null,
        prep_to_base_conversion,
      ]);
      return rows[0];
    }

    case 'update_recipe_item': {
      const { recipe_id, item_id, prep_qty, prep_unit, prep_to_base_conversion } = input;
      const { rows } = await pool.query(`
        UPDATE mcogs_recipe_items
        SET prep_qty=$1, prep_unit=$2, prep_to_base_conversion=$3
        WHERE id=$4 AND recipe_id=$5
        RETURNING id, recipe_id, prep_qty, prep_unit
      `, [
        prep_qty,
        prep_unit               || null,
        prep_to_base_conversion ?? 1,
        item_id,
        recipe_id,
      ]);
      if (!rows.length) return { error: 'Recipe item not found' };
      return rows[0];
    }

    case 'delete_recipe_item': {
      const { recipe_id, item_id } = input;
      const result = await pool.query(
        `DELETE FROM mcogs_recipe_items WHERE id=$1 AND recipe_id=$2`, [item_id, recipe_id]
      );
      return { deleted: result.rowCount > 0, item_id, recipe_id };
    }

    // ── Menu CRUD ──────────────────────────────────────────────────────────────

    case 'create_menu': {
      const { name, country_id, description } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_menus (name, country_id, description)
        VALUES ($1,$2,$3) RETURNING id, name
      `, [name.trim(), country_id, description?.trim() || null]);
      return rows[0];
    }

    case 'delete_menu': {
      const { id } = input;
      // mcogs_menu_items and mcogs_menu_item_prices cascade on menu delete
      await pool.query(`DELETE FROM mcogs_menus WHERE id = $1`, [id]);
      return { deleted: true, id };
    }

    case 'add_menu_item': {
      const { menu_id, item_type, display_name, recipe_id, ingredient_id,
              qty = 1, sell_price = 0 } = input;
      const { rows } = await pool.query(`
        INSERT INTO mcogs_menu_items
          (menu_id, item_type, display_name, recipe_id, ingredient_id, qty, sell_price)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, menu_id, display_name, item_type
      `, [
        menu_id,
        item_type,
        display_name?.trim() || '',
        item_type === 'recipe'     ? (recipe_id     || null) : null,
        item_type === 'ingredient' ? (ingredient_id || null) : null,
        qty,
        sell_price,
      ]);
      return rows[0];
    }

    case 'set_menu_item_price': {
      const { menu_item_id, price_level_id, sell_price, tax_rate_id } = input;
      const { rows } = await pool.query(`
        INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price, tax_rate_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (menu_item_id, price_level_id)
        DO UPDATE SET sell_price = EXCLUDED.sell_price, tax_rate_id = EXCLUDED.tax_rate_id
        RETURNING id, menu_item_id, price_level_id, sell_price
      `, [menu_item_id, price_level_id, sell_price, tax_rate_id || null]);
      return rows[0];
    }

    // ── Category CRUD ──────────────────────────────────────────────────────────

    case 'create_category': {
      const { name, type, group_name, sort_order } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_categories (name, type, group_name, sort_order)
        VALUES ($1,$2,$3,$4) RETURNING id, name, type, group_name
      `, [
        name.trim(),
        type,
        group_name?.trim() || 'Unassigned',
        sort_order         || 0,
      ]);
      return rows[0];
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context, helpContext) {
  const page = context?.currentPage || 'unknown';
  return `You are the COGS Assistant — an AI helper embedded in the COGS Manager platform, a tool for restaurant franchise operators to manage menu cost-of-goods (COGS).

You can both READ and WRITE to the database — you are a full sysadmin assistant with the ability to create, update, and delete records across all entities.

## CONFIRMATION RULES (mandatory — no exceptions)
- Before ANY create, update, or delete tool call: describe exactly what you are about to do and ask "Shall I proceed?"
- Wait for explicit user confirmation (yes/ok/proceed/confirm) before executing write operations
- For BATCH operations (>3 records from a CSV or list): describe the full import plan once, ask once, then execute all records after confirmation
- delete_menu: ALWAYS warn "This will also delete all menu items and prices for this menu" before confirming
- delete_ingredient / delete_vendor: warn that FK dependencies may block deletion; offer to resolve them first
- Never chain confirmations — one confirm per distinct action or batch

## WORKFLOW
1. Always call list_* tools first to resolve names → IDs before any write operation. Never guess IDs.
2. To add an ingredient to a recipe: list_ingredients → get ID → add_recipe_item
3. To set a preferred vendor: list_vendors + list_price_quotes → set_preferred_vendor
4. For new ingredients without a category, use create_category first or let create_ingredient auto-create it

## FILE UPLOADS (when images or CSV text is provided)
- CSV: parse all rows, summarise the full import plan (count, fields, sample rows), confirm once, then create records
- Image (invoice / label / recipe card): describe all fields you can read, confirm extraction, then create records
- Never create records from a file without user confirmation

## TOOLS AVAILABLE
You have 35 tools covering: dashboard stats, ingredients, vendors, price quotes, preferred vendors, recipes, recipe items, menus, menu items, menu item prices, categories, units, price levels, markets, and feedback.

Be concise and practical. For numbers include currency symbols and units. Format data as readable lists or tables where appropriate.

${helpContext ? `## Relevant COGS Documentation\n\n${helpContext}` : ''}

## Current Context
- Active page: ${page}`.trim();
}

// ── POST /ai-chat ─────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const anthropic = getClient();
  if (!anthropic) {
    return res.status(503).json({ error: { message: 'Anthropic API key is not configured. Add it in Settings → AI.' } });
  }

  const { message, context = {}, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: { message: 'message is required' } });

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // RAG — retrieve relevant help context
  const helpContext  = await rag.retrieve(message);
  const systemPrompt = buildSystemPrompt(context, helpContext);

  // Build messages array (enforce max 20 history items)
  const messages = [
    ...history.slice(-20),
    { role: 'user', content: message.trim() },
  ];

  const { responseText, toolsCalled, tokensIn, tokensOut, errorMsg } =
    await agenticStream({ anthropic, systemPrompt, messages, tools: TOOLS, executeTool, res });

  // Log to DB (best-effort)
  pool.query(
    `INSERT INTO mcogs_ai_chat_log (user_message, response, tools_called, context, tokens_in, tokens_out, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [message, responseText, JSON.stringify(toolsCalled), JSON.stringify(context), tokensIn, tokensOut, errorMsg]
  ).catch(e => console.error('[ai-chat] log error:', e.message));
});

// ── GET /ai-chat-log ──────────────────────────────────────────────────────────

router.get('/log', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const offset = (page - 1) * limit;
  try {
    const [rows, total] = await Promise.all([
      pool.query(
        `SELECT * FROM mcogs_ai_chat_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM mcogs_ai_chat_log`),
    ]);
    res.json({ logs: rows.rows, total: parseInt(total.rows[0].count, 10), page });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch chat log' } });
  }
});

module.exports = { router, TOOLS, executeTool, buildSystemPrompt };
