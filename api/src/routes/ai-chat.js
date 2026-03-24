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
    description: 'Returns menu items with sell prices and COGS% for a specific menu. Automatically uses the market\'s default price level if price_level_id is not supplied. Always prefer calling this without price_level_id first — it will resolve the right level automatically.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id:        { type: 'integer', description: 'Menu ID from list_menus' },
        price_level_id: { type: 'integer', description: 'Optional: specific price level ID. Omit to use the market\'s default price level.' },
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
    description: 'Lists all markets (countries) with id, name, currency_code, currency_symbol, exchange_rate, and default_price_level_id/name.',
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
  // ── Markets (countries) CRUD ──────────────────────────────────────────────────
  {
    name: 'create_market',
    description: 'Creates a new market (country) with currency and exchange rate. Call list_price_levels first to resolve default_price_level_id. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:                  { type: 'string', description: 'Country/market name e.g. "India"' },
        currency_code:         { type: 'string', description: '3-letter ISO code e.g. "INR"' },
        currency_symbol:       { type: 'string', description: 'Symbol e.g. "₹"' },
        exchange_rate:         { type: 'number', description: 'Rate vs USD base (e.g. 83.5 for INR). Use /api/sync-exchange-rates or ask the user.' },
        country_iso:           { type: 'string', description: '2-letter ISO code e.g. "IN" (optional)' },
        default_price_level_id:{ type: 'integer', description: 'ID of default price level from list_price_levels (optional)' },
      },
      required: ['name', 'currency_code', 'currency_symbol', 'exchange_rate'],
    },
  },
  {
    name: 'update_market',
    description: 'Updates an existing market (country). Call list_markets first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:                    { type: 'integer' },
        name:                  { type: 'string' },
        currency_code:         { type: 'string' },
        currency_symbol:       { type: 'string' },
        exchange_rate:         { type: 'number' },
        country_iso:           { type: 'string' },
        default_price_level_id:{ type: 'integer' },
      },
      required: ['id', 'name', 'currency_code', 'currency_symbol', 'exchange_rate'],
    },
  },
  {
    name: 'delete_market',
    description: 'Deletes a market (country). Warn that this will also remove any vendors, menus, and tax rates linked to this market. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'assign_brand_partner',
    description: 'Assigns (or removes) a brand partner from a market. Call list_markets and list_brand_partners to resolve IDs first. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        market_id:        { type: 'integer', description: 'Market (country) ID' },
        brand_partner_id: { type: ['integer', 'null'], description: 'Brand partner ID, or null to unassign' },
      },
      required: ['market_id'],
    },
  },

  // ── Brand Partners CRUD ───────────────────────────────────────────────────────
  {
    name: 'list_brand_partners',
    description: 'Lists all brand partners with id, name, contact, email, phone, notes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_brand_partner',
    description: 'Creates a new brand partner (franchise owner/operator). CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:    { type: 'string' },
        contact: { type: 'string', description: 'Contact person name' },
        email:   { type: 'string' },
        phone:   { type: 'string' },
        notes:   { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_brand_partner',
    description: 'Updates a brand partner. Call list_brand_partners first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'integer' },
        name:    { type: 'string' },
        contact: { type: 'string' },
        email:   { type: 'string' },
        phone:   { type: 'string' },
        notes:   { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_brand_partner',
    description: 'Deletes a brand partner. Warn that it must be unassigned from all markets first. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },

  {
    name: 'start_import',
    description: `Sends a file that the user has already uploaded in this conversation to the Import Wizard for structured review. Use this when:
- The user uploads a spreadsheet and says "import this", "use the import wizard", or similar
- The file contains many ingredients/recipes and the user wants to review before committing
Returns a job URL — share it with the user as a clickable link: /import?job=<id>
Do NOT use this for small single-record requests; use the individual create_* tools instead.`,
    input_schema: {
      type: 'object',
      properties: {
        file_content: { type: 'string', description: 'The full text content of the file as it appears in the conversation (sheet CSV data, plain text, etc.)' },
        filename:     { type: 'string', description: 'Original filename, e.g. "ingredients.xlsx"' },
      },
      required: ['file_content', 'filename'],
    },
  },

  // ── Web search ───────────────────────────────────────────────────────────────
  {
    name: 'search_web',
    description: `Searches the internet for current information. ONLY use this tool when the user EXPLICITLY asks to search the web, look something up online, or asks about current prices/news/data that you could not know. Do NOT use proactively.`,
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Search query' },
        max_results: { type: 'integer', description: 'Max results to return (default 5, max 10)' },
      },
      required: ['query'],
    },
  },

  // ── Category update / delete ──────────────────────────────────────────────────
  {
    name: 'update_category',
    description: 'Updates a category name, group, or sort order. Call list_categories first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'integer' },
        name:       { type: 'string' },
        group_name: { type: 'string' },
        sort_order: { type: 'integer' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_category',
    description: 'Deletes a category. Will fail if ingredients or recipes still reference it — reassign them first. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },

  // ── Tax Rates CRUD ────────────────────────────────────────────────────────────
  {
    name: 'list_tax_rates',
    description: 'Lists all tax rates with id, name, rate (as a decimal e.g. 0.20 for 20%), country_id, country_name, and is_default.',
    input_schema: {
      type: 'object',
      properties: {
        country_id: { type: 'integer', description: 'Optional: filter by market/country' },
      },
      required: [],
    },
  },
  {
    name: 'create_tax_rate',
    description: 'Creates a tax rate for a market. Rate is a decimal (e.g. 0.20 for 20%). The first rate for a country auto-becomes default. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        country_id: { type: 'integer', description: 'Market ID from list_markets' },
        name:       { type: 'string', description: 'e.g. "Standard VAT", "Reduced Rate"' },
        rate:       { type: 'number', description: 'Decimal rate e.g. 0.20 for 20%' },
      },
      required: ['country_id', 'name', 'rate'],
    },
  },
  {
    name: 'update_tax_rate',
    description: 'Updates a tax rate name or rate value. Call list_tax_rates first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'integer' },
        name: { type: 'string' },
        rate: { type: 'number', description: 'Decimal e.g. 0.20 for 20%' },
      },
      required: ['id', 'name', 'rate'],
    },
  },
  {
    name: 'set_default_tax_rate',
    description: 'Sets a tax rate as the default for its country (clears is_default on all other rates for that country). CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'integer', description: 'Tax rate ID to set as default' },
        country_id: { type: 'integer', description: 'The country this rate belongs to' },
      },
      required: ['id', 'country_id'],
    },
  },
  {
    name: 'delete_tax_rate',
    description: 'Deletes a tax rate. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },

  // ── Price Levels CRUD ─────────────────────────────────────────────────────────
  {
    name: 'create_price_level',
    description: 'Creates a new price level (e.g. Eat-in, Takeout, Delivery). Set is_default=true to make it the default. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        description: { type: 'string' },
        is_default:  { type: 'boolean', description: 'If true, clears is_default on all other price levels' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_price_level',
    description: 'Updates a price level. Call list_price_levels first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:          { type: 'integer' },
        name:        { type: 'string' },
        description: { type: 'string' },
        is_default:  { type: 'boolean' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_price_level',
    description: 'Deletes a price level. Will fail if menu item prices reference it. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────────────
  {
    name: 'get_settings',
    description: 'Returns the global app settings JSONB blob (COGS thresholds, default units, etc.).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_settings',
    description: 'Merges a partial settings object into the global settings. Only supply keys you want to change. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        patch: { type: 'object', description: 'Key-value pairs to merge into settings (e.g. { "cogs_thresholds": { "excellent": 25, "acceptable": 35 } })' },
      },
      required: ['patch'],
    },
  },

  // ── HACCP ─────────────────────────────────────────────────────────────────────
  {
    name: 'list_haccp_equipment',
    description: 'Lists HACCP equipment (fridges, freezers, hot-holds etc.) with last logged temp and in-range status.',
    input_schema: {
      type: 'object',
      properties: {
        location_id: { type: 'integer', description: 'Optional: filter by location' },
      },
      required: [],
    },
  },
  {
    name: 'create_haccp_equipment',
    description: 'Registers new equipment in the HACCP log. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:            { type: 'string' },
        type:            { type: 'string', enum: ['fridge', 'freezer', 'hot_hold', 'display', 'other'] },
        location_id:     { type: 'integer', description: 'Location ID from list_locations (optional)' },
        location_desc:   { type: 'string', description: 'Free-text location description (optional)' },
        target_min_temp: { type: 'number', description: 'Min acceptable °C' },
        target_max_temp: { type: 'number', description: 'Max acceptable °C' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'update_haccp_equipment',
    description: 'Updates equipment details or target temp range. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:              { type: 'integer' },
        name:            { type: 'string' },
        type:            { type: 'string', enum: ['fridge', 'freezer', 'hot_hold', 'display', 'other'] },
        location_id:     { type: 'integer' },
        location_desc:   { type: 'string' },
        target_min_temp: { type: 'number' },
        target_max_temp: { type: 'number' },
        is_active:       { type: 'boolean' },
      },
      required: ['id', 'name', 'type'],
    },
  },
  {
    name: 'delete_haccp_equipment',
    description: 'Deletes equipment and all its temperature logs. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'log_temperature',
    description: 'Logs a temperature reading for a piece of equipment. Out-of-range readings require a corrective_action. No confirmation needed for routine logging.',
    input_schema: {
      type: 'object',
      properties: {
        equipment_id:      { type: 'integer', description: 'Equipment ID from list_haccp_equipment' },
        temp_c:            { type: 'number', description: 'Temperature in °C' },
        logged_by:         { type: 'string', description: 'Name of person logging' },
        notes:             { type: 'string' },
        corrective_action: { type: 'string', description: 'Required if temp is outside target range' },
        logged_at:         { type: 'string', description: 'ISO timestamp (defaults to now)' },
      },
      required: ['equipment_id', 'temp_c'],
    },
  },
  {
    name: 'list_temp_logs',
    description: 'Returns temperature log history for a piece of equipment.',
    input_schema: {
      type: 'object',
      properties: {
        equipment_id: { type: 'integer' },
        date_from:    { type: 'string', description: 'ISO date filter (optional)' },
        date_to:      { type: 'string', description: 'ISO date filter (optional)' },
        limit:        { type: 'integer', description: 'Max rows (default 90, max 500)' },
      },
      required: ['equipment_id'],
    },
  },
  {
    name: 'list_ccp_logs',
    description: 'Returns CCP (Critical Control Point) logs for cooking, cooling, or delivery checks.',
    input_schema: {
      type: 'object',
      properties: {
        log_type:    { type: 'string', enum: ['cooking', 'cooling', 'delivery'], description: 'Optional filter' },
        location_id: { type: 'integer', description: 'Optional location filter' },
        recipe_id:   { type: 'integer', description: 'Optional recipe filter' },
        date_from:   { type: 'string' },
        date_to:     { type: 'string' },
        limit:       { type: 'integer', description: 'Default 50' },
      },
      required: [],
    },
  },
  {
    name: 'add_ccp_log',
    description: 'Logs a CCP check (cooking/cooling/delivery temp). No confirmation needed for routine logging.',
    input_schema: {
      type: 'object',
      properties: {
        log_type:          { type: 'string', enum: ['cooking', 'cooling', 'delivery'] },
        item_name:         { type: 'string', description: 'Name of the food item checked' },
        recipe_id:         { type: 'integer', description: 'Optional recipe reference' },
        location_id:       { type: 'integer', description: 'Optional location reference' },
        target_min_temp:   { type: 'number', description: 'Min target °C' },
        target_max_temp:   { type: 'number', description: 'Max target °C' },
        actual_temp:       { type: 'number', description: 'Measured °C' },
        corrective_action: { type: 'string', description: 'Required if out of range' },
        logged_by:         { type: 'string' },
        notes:             { type: 'string' },
        logged_at:         { type: 'string', description: 'ISO timestamp (defaults to now)' },
      },
      required: ['log_type', 'item_name', 'target_min_temp', 'target_max_temp', 'actual_temp'],
    },
  },

  // ── Locations ─────────────────────────────────────────────────────────────────
  {
    name: 'list_locations',
    description: 'Lists store/restaurant locations with market, group, contact details, and active status.',
    input_schema: {
      type: 'object',
      properties: {
        market_id: { type: 'integer', description: 'Optional: filter by market (country)' },
        group_id:  { type: 'integer', description: 'Optional: filter by location group' },
        active:    { type: 'boolean', description: 'Optional: filter by active status' },
      },
      required: [],
    },
  },
  {
    name: 'create_location',
    description: 'Creates a new store/restaurant location. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:          { type: 'string' },
        country_id:    { type: 'integer', description: 'Market ID from list_markets' },
        group_id:      { type: 'integer', description: 'Location group ID from list_location_groups (optional)' },
        address:       { type: 'string' },
        email:         { type: 'string' },
        phone:         { type: 'string' },
        contact_name:  { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        is_active:     { type: 'boolean', description: 'Default true' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_location',
    description: 'Updates a location. Call list_locations to get the ID first. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'integer' },
        name:          { type: 'string' },
        country_id:    { type: 'integer' },
        group_id:      { type: 'integer' },
        address:       { type: 'string' },
        email:         { type: 'string' },
        phone:         { type: 'string' },
        contact_name:  { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        is_active:     { type: 'boolean' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_location',
    description: 'Deletes a location. Warn that this will fail if equipment is still assigned. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_location_groups',
    description: 'Lists location groups (clusters of stores) with location count.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_location_group',
    description: 'Creates a new location group. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_location_group',
    description: 'Updates a location group name or description. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:          { type: 'integer' },
        name:        { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_location_group',
    description: 'Deletes a location group. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
    },
  },

  // ── Allergens ─────────────────────────────────────────────────────────────────
  {
    name: 'list_allergens',
    description: 'Returns the 14 EU/UK FIC regulated allergens with id, name, and code.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_ingredient_allergens',
    description: 'Returns the allergen profile for a single ingredient.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'integer' },
      },
      required: ['ingredient_id'],
    },
  },
  {
    name: 'set_ingredient_allergens',
    description: 'Sets the full allergen profile for an ingredient (replaces any existing entries). Call list_allergens first to get allergen IDs. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'integer' },
        allergens: {
          type: 'array',
          description: 'Full desired allergen state — any allergen not listed will be removed',
          items: {
            type: 'object',
            properties: {
              allergen_id: { type: 'integer' },
              status: { type: 'string', enum: ['contains', 'may_contain', 'free_from'] },
            },
            required: ['allergen_id', 'status'],
          },
        },
      },
      required: ['ingredient_id', 'allergens'],
    },
  },
  {
    name: 'get_menu_allergens',
    description: 'Returns the full allergen matrix for a menu — each menu item with its aggregated allergen status across all ingredients.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'integer', description: 'Menu ID from list_menus' },
      },
      required: ['menu_id'],
    },
  },

  // ── Scenario ─────────────────────────────────────────────────────────────────
  {
    name: 'generate_scenario_mix',
    description: `Generates a sales mix scenario for a menu based on a revenue target and category split, then saves it so the user can load it in the Scenario tab.
Use this when the user asks to "generate a scenario", "model COGS for X revenue", "create a sales mix", or similar.
Steps: fetches menu COGS data, distributes revenue across categories, computes realistic quantities per item (weighted by price point — cheaper items get more units), saves the scenario, and returns a link for the user.
Always call list_menus first to resolve the menu ID. No confirmation needed — this is a read+compute+save operation.`,
    input_schema: {
      type: 'object',
      properties: {
        menu_id:       { type: 'integer', description: 'Menu ID from list_menus' },
        scenario_name: { type: 'string',  description: 'Name for the saved scenario (e.g. "Standard Week", "Christmas Mix")' },
        total_revenue: { type: 'number',  description: 'Target total gross sales revenue in the menu\'s local currency' },
        category_pcts: {
          type: 'object',
          description: 'Revenue split by recipe category as percentages. Keys = exact category names (use get_menu_cogs to see categories), values = percentage (0–100). Must sum to 100.',
          additionalProperties: { type: 'number' },
        },
        price_level_id: {
          type: 'integer',
          description: 'Optional: price level ID to use for pricing. If omitted, uses the first available price level.',
        },
        level_pcts: {
          type: 'object',
          description: 'Optional: split across multiple price levels as percentages. Keys = price level IDs (as strings), values = percentage. Must sum to 100. If provided, computes a weighted average price per item across levels for more accurate quantity estimation.',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['menu_id', 'scenario_name', 'total_revenue', 'category_pcts'],
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
      const { menu_id, price_level_id } = input;
      // Resolve effective price level: use provided or fall back to market default
      const { rows: [menuRow] } = await pool.query(`
        SELECT co.default_price_level_id, pl.name AS default_pl_name
        FROM   mcogs_menus m
        JOIN   mcogs_countries co ON co.id = m.country_id
        LEFT JOIN mcogs_price_levels pl ON pl.id = co.default_price_level_id
        WHERE  m.id = $1
      `, [menu_id]);
      const effectivePlId = price_level_id || menuRow?.default_price_level_id || null;
      // Call the full COGS calculation endpoint internally
      const port = process.env.PORT || 3001;
      const qs   = effectivePlId ? `?price_level_id=${effectivePlId}` : '';
      const resp = await fetch(`http://localhost:${port}/api/cogs/menu/${menu_id}${qs}`);
      if (!resp.ok) return { error: `COGS endpoint returned ${resp.status}` };
      const data = await resp.json();
      if (!data.items?.length) return { error: 'Menu not found or has no items' };
      const plName = effectivePlId
        ? (data.items[0] && menuRow?.default_pl_name) || `price level ${effectivePlId}`
        : 'default price level';
      return {
        currency_symbol: data.currency_symbol,
        currency_code:   data.currency_code,
        price_level:     plName,
        summary:         data.summary,
        items: data.items.map(item => ({
          display_name:     item.display_name,
          item_type:        item.item_type,
          cost_per_portion: item.cost_per_portion,
          sell_price_gross: item.sell_price_gross,
          sell_price_net:   item.sell_price_net,
          tax_rate_pct:     item.tax_rate_pct,
          cogs_pct_net:     item.cogs_pct_net,
          cogs_pct_gross:   item.cogs_pct_gross,
          gp_net:           item.gp_net,
          note: item.sell_price_gross === 0
            ? `No sell price set — add via Menus → PLT tab`
            : item.cost_per_portion === 0
            ? `No vendor price quotes found for this item's ingredients`
            : null,
        })),
      };
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
        SELECT c.id, c.name, c.currency_code, c.currency_symbol, c.exchange_rate,
               c.default_price_level_id, pl.name AS default_price_level_name
        FROM   mcogs_countries c
        LEFT JOIN mcogs_price_levels pl ON pl.id = c.default_price_level_id
        ORDER BY c.name
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

    // ── Markets (countries) CRUD ───────────────────────────────────────────────

    case 'create_market': {
      const { name, currency_code, currency_symbol, exchange_rate,
              country_iso, default_price_level_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      if (!currency_code?.trim()) return { error: 'currency_code is required' };
      if (!currency_symbol?.trim()) return { error: 'currency_symbol is required' };
      if (!(exchange_rate > 0)) return { error: 'exchange_rate must be a positive number' };
      const { rows } = await pool.query(
        `INSERT INTO mcogs_countries
           (name, currency_code, currency_symbol, exchange_rate, country_iso, default_price_level_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          name.trim(),
          currency_code.toUpperCase().trim(),
          currency_symbol.trim(),
          exchange_rate,
          country_iso ? country_iso.toUpperCase().trim() : null,
          default_price_level_id || null,
        ]
      );
      return rows[0];
    }

    case 'update_market': {
      const { id, name, currency_code, currency_symbol, exchange_rate,
              country_iso, default_price_level_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      if (!(exchange_rate > 0)) return { error: 'exchange_rate must be positive' };
      const { rows } = await pool.query(
        `UPDATE mcogs_countries
         SET name=$1, currency_code=$2, currency_symbol=$3, exchange_rate=$4,
             country_iso=$5, default_price_level_id=$6, updated_at=NOW()
         WHERE id=$7 RETURNING *`,
        [
          name.trim(),
          currency_code.toUpperCase().trim(),
          currency_symbol.trim(),
          exchange_rate,
          country_iso ? country_iso.toUpperCase().trim() : null,
          default_price_level_id || null,
          id,
        ]
      );
      if (!rows.length) return { error: 'Market not found' };
      return rows[0];
    }

    case 'delete_market': {
      const { id } = input;
      const { rowCount } = await pool.query(`DELETE FROM mcogs_countries WHERE id=$1`, [id]);
      if (!rowCount) return { error: 'Market not found' };
      return { deleted: true, id };
    }

    case 'assign_brand_partner': {
      const { market_id, brand_partner_id } = input;
      const { rows } = await pool.query(
        `UPDATE mcogs_countries SET brand_partner_id=$1, updated_at=NOW() WHERE id=$2 RETURNING id, name, brand_partner_id`,
        [brand_partner_id ?? null, market_id]
      );
      if (!rows.length) return { error: 'Market not found' };
      return rows[0];
    }

    // ── Brand Partners CRUD ────────────────────────────────────────────────────

    case 'list_brand_partners': {
      const { rows } = await pool.query(
        `SELECT bp.*, COUNT(c.id)::int AS market_count
         FROM mcogs_brand_partners bp
         LEFT JOIN mcogs_countries c ON c.brand_partner_id = bp.id
         GROUP BY bp.id ORDER BY bp.name`
      );
      return rows;
    }

    case 'create_brand_partner': {
      const { name, contact, email, phone, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(
        `INSERT INTO mcogs_brand_partners (name, contact, email, phone, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name.trim(), contact?.trim()||null, email?.trim()||null,
         phone?.trim()||null, notes?.trim()||null]
      );
      return rows[0];
    }

    case 'update_brand_partner': {
      const { id, name, contact, email, phone, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(
        `UPDATE mcogs_brand_partners
         SET name=$1, contact=$2, email=$3, phone=$4, notes=$5, updated_at=NOW()
         WHERE id=$6 RETURNING *`,
        [name.trim(), contact?.trim()||null, email?.trim()||null,
         phone?.trim()||null, notes?.trim()||null, id]
      );
      if (!rows.length) return { error: 'Brand partner not found' };
      return rows[0];
    }

    case 'delete_brand_partner': {
      const { id } = input;
      try {
        const { rowCount } = await pool.query(`DELETE FROM mcogs_brand_partners WHERE id=$1`, [id]);
        if (!rowCount) return { error: 'Brand partner not found' };
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') return { error: 'Brand partner is still assigned to one or more markets — unassign it first using assign_brand_partner.' };
        throw err;
      }
    }

    case 'start_import': {
      const { file_content, filename = 'upload' } = input;
      if (!file_content) return { error: 'file_content is required' };
      const importKey = aiConfig.get('ANTHROPIC_API_KEY');
      if (!importKey) return { error: 'Anthropic API key not configured — add it in Settings → AI.' };
      const { stageFileContent } = require('./import');
      const Anthropic = require('@anthropic-ai/sdk');
      const importClient = new Anthropic({ apiKey: importKey });
      const result = await stageFileContent(importClient, file_content, filename, null);
      const counts = result.staged_data;
      return {
        job_id: result.job_id,
        url: `/import?job=${result.job_id}`,
        summary: {
          vendors:      counts.vendors?.length      || 0,
          ingredients:  counts.ingredients?.length  || 0,
          price_quotes: counts.price_quotes?.length || 0,
          recipes:      counts.recipes?.length      || 0,
        },
      };
    }

    case 'search_web': {
      const { query, max_results = 5 } = input;
      if (!query?.trim()) return { error: 'query is required' };
      const braveKey = aiConfig.get('BRAVE_SEARCH_API_KEY');
      if (braveKey) {
        try {
          const resp = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(max_results, 10)}`,
            { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey } }
          );
          if (!resp.ok) throw new Error(`Brave Search API returned ${resp.status}`);
          const data = await resp.json();
          const hits  = (data.web?.results || []).slice(0, max_results);
          return hits.map(r => ({ title: r.title, url: r.url, description: r.description }));
        } catch (err) {
          return { error: `Search failed: ${err.message}` };
        }
      }
      // Fallback: DuckDuckGo Instant Answer (no key needed, limited coverage)
      try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const resp   = await fetch(ddgUrl, { headers: { 'Accept': 'application/json' } });
        const data   = await resp.json();
        const results = [];
        if (data.AbstractText) {
          results.push({ title: data.Heading || query, url: data.AbstractURL, description: data.AbstractText });
        }
        for (const r of (data.RelatedTopics || []).slice(0, max_results - 1)) {
          if (r.Text && r.FirstURL) results.push({ title: r.Text.split(' - ')[0], url: r.FirstURL, description: r.Text });
        }
        if (!results.length) {
          return { message: `No instant answer found for "${query}". For full web search add a Brave Search API key in Settings → AI → BRAVE_SEARCH_API_KEY.` };
        }
        return results;
      } catch (err) {
        return { error: `Search failed: ${err.message}. Add a Brave Search API key in Settings → AI for reliable web search.` };
      }
    }

    // ── Category update / delete ───────────────────────────────────────────────

    case 'update_category': {
      const { id, name, group_name, sort_order } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_categories SET name=$1, group_name=$2, sort_order=$3, updated_at=NOW()
        WHERE id=$4 RETURNING id, name, type, group_name, sort_order
      `, [name.trim(), group_name?.trim() || 'Unassigned', sort_order ?? 0, id]);
      if (!rows.length) return { error: 'Category not found' };
      return rows[0];
    }

    case 'delete_category': {
      const { id } = input;
      try {
        const { rowCount } = await pool.query(`DELETE FROM mcogs_categories WHERE id=$1`, [id]);
        if (!rowCount) return { error: 'Category not found' };
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') return { error: 'Category is still referenced by ingredients or recipes — reassign them first.' };
        throw err;
      }
    }

    // ── Tax Rates CRUD ─────────────────────────────────────────────────────────

    case 'list_tax_rates': {
      const { country_id } = input;
      const q = country_id
        ? `SELECT t.*, c.name AS country_name FROM mcogs_country_tax_rates t JOIN mcogs_countries c ON c.id = t.country_id WHERE t.country_id=$1 ORDER BY c.name, t.name`
        : `SELECT t.*, c.name AS country_name FROM mcogs_country_tax_rates t JOIN mcogs_countries c ON c.id = t.country_id ORDER BY c.name, t.name`;
      const { rows } = await pool.query(q, country_id ? [country_id] : []);
      return rows;
    }

    case 'create_tax_rate': {
      const { country_id, name, rate } = input;
      if (!name?.trim()) return { error: 'name is required' };
      if (rate == null || rate < 0) return { error: 'rate must be 0 or greater' };
      const { rows: existing } = await pool.query(
        `SELECT id FROM mcogs_country_tax_rates WHERE country_id=$1`, [country_id]
      );
      const isDefault = existing.length === 0;
      const { rows } = await pool.query(
        `INSERT INTO mcogs_country_tax_rates (country_id, name, rate, is_default) VALUES ($1,$2,$3,$4) RETURNING *`,
        [country_id, name.trim(), rate, isDefault]
      );
      return rows[0];
    }

    case 'update_tax_rate': {
      const { id, name, rate } = input;
      if (!name?.trim()) return { error: 'name is required' };
      if (rate == null || rate < 0) return { error: 'rate must be 0 or greater' };
      const { rows } = await pool.query(
        `UPDATE mcogs_country_tax_rates SET name=$1, rate=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [name.trim(), rate, id]
      );
      if (!rows.length) return { error: 'Tax rate not found' };
      return rows[0];
    }

    case 'set_default_tax_rate': {
      const { id, country_id } = input;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE mcogs_country_tax_rates SET is_default=FALSE, updated_at=NOW() WHERE country_id=$1`, [country_id]
        );
        const { rows } = await client.query(
          `UPDATE mcogs_country_tax_rates SET is_default=TRUE, updated_at=NOW() WHERE id=$1 RETURNING *`, [id]
        );
        await client.query('COMMIT');
        if (!rows.length) return { error: 'Tax rate not found' };
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    case 'delete_tax_rate': {
      const { id } = input;
      const { rowCount } = await pool.query(`DELETE FROM mcogs_country_tax_rates WHERE id=$1`, [id]);
      if (!rowCount) return { error: 'Tax rate not found' };
      return { deleted: true, id };
    }

    // ── Price Levels CRUD ──────────────────────────────────────────────────────

    case 'create_price_level': {
      const { name, description, is_default } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (is_default) await client.query(`UPDATE mcogs_price_levels SET is_default=FALSE, updated_at=NOW()`);
        const { rows } = await client.query(
          `INSERT INTO mcogs_price_levels (name, description, is_default) VALUES ($1,$2,$3) RETURNING *`,
          [name.trim(), description?.trim() || null, !!is_default]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    case 'update_price_level': {
      const { id, name, description, is_default } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (is_default) {
          await client.query(`UPDATE mcogs_price_levels SET is_default=FALSE, updated_at=NOW() WHERE id!=$1`, [id]);
        }
        const { rows } = await client.query(
          `UPDATE mcogs_price_levels SET name=$1, description=$2, is_default=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
          [name.trim(), description?.trim() || null, !!is_default, id]
        );
        await client.query('COMMIT');
        if (!rows.length) return { error: 'Price level not found' };
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    case 'delete_price_level': {
      const { id } = input;
      try {
        const { rowCount } = await pool.query(`DELETE FROM mcogs_price_levels WHERE id=$1`, [id]);
        if (!rowCount) return { error: 'Price level not found' };
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') return { error: 'Price level is referenced by menu item prices — remove those entries first.' };
        throw err;
      }
    }

    // ── Settings ───────────────────────────────────────────────────────────────

    case 'get_settings': {
      const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id=1`);
      return rows[0]?.data || {};
    }

    case 'update_settings': {
      const { patch } = input;
      if (!patch || typeof patch !== 'object') return { error: 'patch must be an object' };
      const { rows } = await pool.query(
        `INSERT INTO mcogs_settings (id, data) VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = mcogs_settings.data || $1::jsonb, updated_at=NOW()
         RETURNING data`,
        [JSON.stringify(patch)]
      );
      return rows[0].data;
    }

    // ── HACCP ──────────────────────────────────────────────────────────────────

    case 'list_haccp_equipment': {
      const { location_id } = input;
      const vals = [];
      let where = '';
      if (location_id) { where = `AND e.location_id = $1`; vals.push(location_id); }
      const { rows } = await pool.query(`
        SELECT e.*, loc.name AS location_name,
               COUNT(tl.id)::int AS log_count,
               MAX(tl.logged_at) AS last_logged_at,
               (SELECT l2.temp_c   FROM mcogs_equipment_temp_logs l2 WHERE l2.equipment_id=e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_temp_c,
               (SELECT l2.in_range FROM mcogs_equipment_temp_logs l2 WHERE l2.equipment_id=e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_in_range
        FROM   mcogs_equipment e
        LEFT JOIN mcogs_locations loc ON loc.id = e.location_id
        LEFT JOIN mcogs_equipment_temp_logs tl ON tl.equipment_id = e.id
        WHERE 1=1 ${where}
        GROUP BY e.id, loc.name ORDER BY e.name ASC
      `, vals);
      return rows;
    }

    case 'create_haccp_equipment': {
      const { name, type, location_id, location_desc, target_min_temp, target_max_temp } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
      if (!validTypes.includes(type)) return { error: `type must be one of: ${validTypes.join(', ')}` };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_equipment (name, type, location_id, location_desc, target_min_temp, target_max_temp)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [name.trim(), type, location_id||null, location_desc?.trim()||null, target_min_temp??null, target_max_temp??null]);
      return rows[0];
    }

    case 'update_haccp_equipment': {
      const { id, name, type, location_id, location_desc, target_min_temp, target_max_temp, is_active } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
      if (!validTypes.includes(type)) return { error: `type must be one of: ${validTypes.join(', ')}` };
      const { rows } = await pool.query(`
        UPDATE mcogs_equipment
        SET name=$1, type=$2, location_id=$3, location_desc=$4,
            target_min_temp=$5, target_max_temp=$6, is_active=$7, updated_at=NOW()
        WHERE id=$8 RETURNING *
      `, [name.trim(), type, location_id||null, location_desc?.trim()||null,
          target_min_temp??null, target_max_temp??null, is_active!==false, id]);
      if (!rows.length) return { error: 'Equipment not found' };
      return rows[0];
    }

    case 'delete_haccp_equipment': {
      const { id } = input;
      const { rowCount } = await pool.query(`DELETE FROM mcogs_equipment WHERE id=$1`, [id]);
      if (!rowCount) return { error: 'Equipment not found' };
      return { deleted: true, id };
    }

    case 'log_temperature': {
      const { equipment_id, temp_c, logged_by, notes, corrective_action, logged_at } = input;
      const { rows: [eq] } = await pool.query(
        `SELECT target_min_temp, target_max_temp FROM mcogs_equipment WHERE id=$1`, [equipment_id]
      );
      if (!eq) return { error: 'Equipment not found' };
      const t = Number(temp_c);
      const inRange = (eq.target_min_temp == null || t >= Number(eq.target_min_temp)) &&
                      (eq.target_max_temp == null || t <= Number(eq.target_max_temp));
      if (!inRange && !corrective_action?.trim()) {
        return { error: `Temperature ${t}°C is outside target range (${eq.target_min_temp}–${eq.target_max_temp}°C) — corrective_action is required.` };
      }
      const { rows } = await pool.query(`
        INSERT INTO mcogs_equipment_temp_logs
          (equipment_id, temp_c, in_range, corrective_action, logged_by, notes, logged_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [equipment_id, t, inRange, corrective_action?.trim()||null,
          logged_by?.trim()||null, notes?.trim()||null, logged_at||new Date().toISOString()]);
      return rows[0];
    }

    case 'list_temp_logs': {
      const { equipment_id, date_from, date_to, limit = 90 } = input;
      const vals = [equipment_id];
      let q = `SELECT * FROM mcogs_equipment_temp_logs WHERE equipment_id=$1`;
      let p = 2;
      if (date_from) { q += ` AND logged_at >= $${p++}`; vals.push(date_from); }
      if (date_to)   { q += ` AND logged_at <= $${p++}`; vals.push(date_to); }
      q += ` ORDER BY logged_at DESC LIMIT $${p}`;
      vals.push(Math.min(Number(limit)||90, 500));
      const { rows } = await pool.query(q, vals);
      return rows;
    }

    case 'list_ccp_logs': {
      const { log_type, location_id, recipe_id, date_from, date_to, limit = 50 } = input;
      const conditions = [];
      const vals = [];
      let p = 1;
      if (log_type)    { conditions.push(`cl.log_type=$${p++}`);    vals.push(log_type); }
      if (recipe_id)   { conditions.push(`cl.recipe_id=$${p++}`);   vals.push(recipe_id); }
      if (location_id) { conditions.push(`cl.location_id=$${p++}`); vals.push(location_id); }
      if (date_from)   { conditions.push(`cl.logged_at>=$${p++}`);  vals.push(date_from); }
      if (date_to)     { conditions.push(`cl.logged_at<=$${p++}`);  vals.push(date_to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      vals.push(Math.min(Number(limit)||50, 500));
      const { rows } = await pool.query(`
        SELECT cl.*, r.name AS recipe_name
        FROM   mcogs_ccp_logs cl LEFT JOIN mcogs_recipes r ON r.id=cl.recipe_id
        ${where}
        ORDER BY cl.logged_at DESC LIMIT $${p}
      `, vals);
      return rows;
    }

    case 'add_ccp_log': {
      const { log_type, item_name, recipe_id, location_id,
              target_min_temp, target_max_temp, actual_temp,
              corrective_action, logged_by, notes, logged_at } = input;
      const validTypes = ['cooking', 'cooling', 'delivery'];
      if (!validTypes.includes(log_type)) return { error: `log_type must be one of: ${validTypes.join(', ')}` };
      if (!item_name?.trim()) return { error: 'item_name is required' };
      const t = Number(actual_temp);
      const inRange = t >= Number(target_min_temp) && t <= Number(target_max_temp);
      if (!inRange && !corrective_action?.trim()) {
        return { error: `Temperature ${t}°C is outside target (${target_min_temp}–${target_max_temp}°C) — corrective_action is required.` };
      }
      const { rows } = await pool.query(`
        INSERT INTO mcogs_ccp_logs
          (log_type, recipe_id, item_name, target_min_temp, target_max_temp, actual_temp,
           in_range, corrective_action, logged_by, notes, logged_at, location_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
      `, [log_type, recipe_id||null, item_name.trim(), target_min_temp, target_max_temp, t,
          inRange, corrective_action?.trim()||null, logged_by?.trim()||null,
          notes?.trim()||null, logged_at||new Date().toISOString(), location_id||null]);
      return rows[0];
    }

    // ── Locations ──────────────────────────────────────────────────────────────

    case 'list_locations': {
      const { market_id, group_id, active } = input;
      const conditions = [];
      const vals = [];
      let p = 1;
      if (market_id)       { conditions.push(`l.country_id=$${p++}`); vals.push(market_id); }
      if (group_id)        { conditions.push(`l.group_id=$${p++}`);   vals.push(group_id); }
      if (active === true)  conditions.push(`l.is_active=TRUE`);
      if (active === false) conditions.push(`l.is_active=FALSE`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`
        SELECT l.*, c.name AS market_name, g.name AS group_name
        FROM   mcogs_locations l
        LEFT JOIN mcogs_countries c ON c.id = l.country_id
        LEFT JOIN mcogs_location_groups g ON g.id = l.group_id
        ${where}
        ORDER BY l.name ASC
      `, vals);
      return rows;
    }

    case 'create_location': {
      const { name, country_id, group_id, address, email, phone,
              contact_name, contact_email, contact_phone, is_active } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_locations
          (name, country_id, group_id, address, email, phone, contact_name, contact_email, contact_phone, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
      `, [
        name.trim(), country_id||null, group_id||null,
        address?.trim()||null, email?.trim()||null, phone?.trim()||null,
        contact_name?.trim()||null, contact_email?.trim()||null, contact_phone?.trim()||null,
        is_active !== false,
      ]);
      return rows[0];
    }

    case 'update_location': {
      const { id, name, country_id, group_id, address, email, phone,
              contact_name, contact_email, contact_phone, is_active } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_locations
        SET name=$1, country_id=$2, group_id=$3, address=$4, email=$5, phone=$6,
            contact_name=$7, contact_email=$8, contact_phone=$9, is_active=$10, updated_at=NOW()
        WHERE id=$11 RETURNING *
      `, [
        name.trim(), country_id||null, group_id||null,
        address?.trim()||null, email?.trim()||null, phone?.trim()||null,
        contact_name?.trim()||null, contact_email?.trim()||null, contact_phone?.trim()||null,
        is_active !== false, id,
      ]);
      if (!rows.length) return { error: 'Location not found' };
      return rows[0];
    }

    case 'delete_location': {
      const { id } = input;
      try {
        const { rowCount } = await pool.query(`DELETE FROM mcogs_locations WHERE id=$1`, [id]);
        if (!rowCount) return { error: 'Location not found' };
        return { deleted: true, id };
      } catch (err) {
        if (err.code === '23503') return { error: 'Cannot delete location that has equipment assigned — remove the equipment first.' };
        throw err;
      }
    }

    case 'list_location_groups': {
      const { rows } = await pool.query(`
        SELECT g.*, COUNT(l.id)::int AS location_count
        FROM mcogs_location_groups g
        LEFT JOIN mcogs_locations l ON l.group_id = g.id
        GROUP BY g.id ORDER BY g.name ASC
      `);
      return rows;
    }

    case 'create_location_group': {
      const { name, description } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(
        `INSERT INTO mcogs_location_groups (name, description) VALUES ($1,$2) RETURNING *`,
        [name.trim(), description?.trim()||null]
      );
      return rows[0];
    }

    case 'update_location_group': {
      const { id, name, description } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(
        `UPDATE mcogs_location_groups SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [name.trim(), description?.trim()||null, id]
      );
      if (!rows.length) return { error: 'Location group not found' };
      return rows[0];
    }

    case 'delete_location_group': {
      const { id } = input;
      const { rowCount } = await pool.query(`DELETE FROM mcogs_location_groups WHERE id=$1`, [id]);
      if (!rowCount) return { error: 'Location group not found' };
      return { deleted: true, id };
    }

    // ── Allergens ──────────────────────────────────────────────────────────────

    case 'list_allergens': {
      const { rows } = await pool.query(`SELECT * FROM mcogs_allergens ORDER BY sort_order ASC`);
      return rows;
    }

    case 'get_ingredient_allergens': {
      const { ingredient_id } = input;
      const { rows } = await pool.query(`
        SELECT ia.allergen_id, ia.status, a.name, a.code, a.sort_order
        FROM   mcogs_ingredient_allergens ia
        JOIN   mcogs_allergens a ON a.id = ia.allergen_id
        WHERE  ia.ingredient_id = $1
        ORDER BY a.sort_order ASC
      `, [ingredient_id]);
      return rows;
    }

    case 'set_ingredient_allergens': {
      const { ingredient_id, allergens } = input;
      if (!Array.isArray(allergens)) return { error: 'allergens must be an array' };
      const valid = ['contains', 'may_contain', 'free_from'];
      for (const a of allergens) {
        if (!a.allergen_id) return { error: 'Each allergen entry must have allergen_id' };
        if (!valid.includes(a.status)) return { error: `Invalid status "${a.status}" — must be contains, may_contain, or free_from` };
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM mcogs_ingredient_allergens WHERE ingredient_id=$1`, [ingredient_id]);
        for (const a of allergens) {
          await client.query(
            `INSERT INTO mcogs_ingredient_allergens (ingredient_id, allergen_id, status) VALUES ($1,$2,$3)`,
            [ingredient_id, a.allergen_id, a.status]
          );
        }
        await client.query('COMMIT');
        const { rows } = await pool.query(`
          SELECT ia.allergen_id, ia.status, a.name, a.code
          FROM   mcogs_ingredient_allergens ia
          JOIN   mcogs_allergens a ON a.id = ia.allergen_id
          WHERE  ia.ingredient_id=$1 ORDER BY a.sort_order ASC
        `, [ingredient_id]);
        return rows;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    case 'get_menu_allergens': {
      const { menu_id } = input;
      // Reuse the same logic as GET /allergens/menu/:id
      const { rows: allAllergens } = await pool.query(`SELECT * FROM mcogs_allergens ORDER BY sort_order ASC`);
      const { rows: menuItems } = await pool.query(`
        SELECT mi.id, mi.display_name, mi.item_type, mi.recipe_id, mi.ingredient_id
        FROM   mcogs_menu_items mi WHERE mi.menu_id=$1 ORDER BY mi.sort_order ASC
      `, [menu_id]);
      if (!menuItems.length) return { allergens: allAllergens, items: [] };

      const recipeIds    = [...new Set(menuItems.filter(i => i.recipe_id).map(i => i.recipe_id))];
      const directIngIds = menuItems.filter(i => i.ingredient_id).map(i => i.ingredient_id);

      let recipeIngMap = {};
      if (recipeIds.length) {
        const { rows: riRows } = await pool.query(`
          SELECT recipe_id, ingredient_id FROM mcogs_recipe_items
          WHERE recipe_id = ANY($1::int[]) AND item_type='ingredient'
        `, [recipeIds]);
        for (const ri of riRows) {
          if (!recipeIngMap[ri.recipe_id]) recipeIngMap[ri.recipe_id] = [];
          recipeIngMap[ri.recipe_id].push(ri.ingredient_id);
        }
      }

      const allIngIds = [...new Set([...directIngIds, ...Object.values(recipeIngMap).flat()])];
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
      const items = menuItems.map(mi => {
        let ingIds = mi.item_type === 'ingredient' && mi.ingredient_id
          ? [mi.ingredient_id]
          : (recipeIngMap[mi.recipe_id] || []);
        const agg = {};
        for (const ingId of ingIds) {
          for (const [allergenId, { status, code }] of Object.entries(ingAllergenMap[ingId] || {})) {
            if (!agg[allergenId] || rank[status] > rank[agg[allergenId].status]) {
              agg[allergenId] = { status, code };
            }
          }
        }
        const allergenStatus = {};
        for (const a of allAllergens) {
          const found = Object.values(agg).find(v => v.code === a.code);
          allergenStatus[a.code] = found ? found.status : null;
        }
        return { menu_item_id: mi.id, display_name: mi.display_name, item_type: mi.item_type, allergens: allergenStatus };
      });
      return { allergens: allAllergens, items };
    }

    case 'generate_scenario_mix': {
      const { menu_id, scenario_name, total_revenue, category_pcts, price_level_id, level_pcts } = input;
      if (!menu_id)       return { error: 'menu_id is required — call list_menus first' };
      if (!scenario_name) return { error: 'scenario_name is required' };
      if (!total_revenue || total_revenue <= 0) return { error: 'total_revenue must be a positive number' };
      if (!category_pcts || typeof category_pcts !== 'object') return { error: 'category_pcts is required' };

      const catTotal = Object.values(category_pcts).reduce((s, v) => s + Number(v), 0);
      if (Math.abs(catTotal - 100) > 1) return { error: `category_pcts must sum to 100 (got ${catTotal.toFixed(1)})` };

      const port = process.env.PORT || 3001;
      const baseUrl = `http://localhost:${port}/api`;

      // ── Fetch price levels if multi-level mode requested ─────────────────
      let levelWeights = {}; // { levelId: pct }
      const activeLevelIds = [];

      if (level_pcts && Object.keys(level_pcts).length > 0) {
        const lvlTotal = Object.values(level_pcts).reduce((s, v) => s + Number(v), 0);
        if (Math.abs(lvlTotal - 100) > 1) return { error: `level_pcts must sum to 100 (got ${lvlTotal.toFixed(1)})` };
        for (const [id, pct] of Object.entries(level_pcts)) {
          if (Number(pct) > 0) { levelWeights[id] = Number(pct); activeLevelIds.push(Number(id)); }
        }
      } else if (price_level_id) {
        levelWeights[price_level_id] = 100;
        activeLevelIds.push(price_level_id);
      } else {
        // Fall back to the default/first price level
        const { rows: levels } = await pool.query(
          `SELECT id FROM mcogs_price_levels ORDER BY is_default DESC, id ASC LIMIT 1`
        );
        if (levels.length) { levelWeights[levels[0].id] = 100; activeLevelIds.push(levels[0].id); }
      }

      // ── Fetch COGS per level ─────────────────────────────────────────────
      // effectivePrices[menu_item_id] = weighted average gross price
      const effectivePrices = {};
      const itemMeta = {};  // menu_item_id → { display_name, category, item_type, recipe_id, ingredient_id }

      const levelDataArr = await Promise.all(
        activeLevelIds.map(async lid => {
          const resp = await fetch(`${baseUrl}/cogs/menu/${menu_id}?price_level_id=${lid}`);
          if (!resp.ok) throw new Error(`COGS fetch failed for level ${lid}: ${resp.status}`);
          return { lid, data: await resp.json() };
        })
      );

      for (const { lid, data } of levelDataArr) {
        const pct = (levelWeights[lid] ?? 0) / 100;
        for (const item of (data.items || [])) {
          if (!itemMeta[item.menu_item_id]) {
            itemMeta[item.menu_item_id] = {
              display_name:  item.display_name,
              category:      item.category || 'Uncategorised',
              item_type:     item.item_type,
              recipe_id:     item.recipe_id,
              ingredient_id: item.ingredient_id,
            };
            effectivePrices[item.menu_item_id] = 0;
          }
          effectivePrices[item.menu_item_id] += (item.sell_price_gross || 0) * pct;
        }
      }

      if (!Object.keys(itemMeta).length) return { error: `No COGS data found for menu ${menu_id}. Ensure prices are set.` };

      // ── Group items by category ──────────────────────────────────────────
      const catItems = {};
      for (const [miId, meta] of Object.entries(itemMeta)) {
        const cat = meta.category;
        if (!catItems[cat]) catItems[cat] = [];
        catItems[cat].push({ miId: Number(miId), ...meta });
      }

      // Warn about unknown categories (in category_pcts but not in menu)
      const unknownCats = Object.keys(category_pcts).filter(c => !catItems[c]);
      if (unknownCats.length) {
        const available = Object.keys(catItems).join(', ');
        return { error: `Category not found in menu: ${unknownCats.join(', ')}. Available categories: ${available}` };
      }

      // ── Compute quantities ────────────────────────────────────────────────
      // qty_data keyed by natural key: "r_{recipe_id}" or "i_{ingredient_id}"
      const qty_data = {};
      const breakdown = [];

      for (const [cat, pct] of Object.entries(category_pcts)) {
        const catRevenue = total_revenue * Number(pct) / 100;
        const items = catItems[cat] || [];
        const pricedItems = items.filter(it => effectivePrices[it.miId] > 0);
        if (!pricedItems.length) continue;

        // Equal revenue share per item within category; qty = revenue / price
        const revenuePerItem = catRevenue / pricedItems.length;
        const catQtys = [];
        for (const item of pricedItems) {
          const price = effectivePrices[item.miId];
          const qty   = Math.max(1, Math.round(revenuePerItem / price));
          const key   = item.item_type === 'recipe'
            ? `r_${item.recipe_id}`
            : `i_${item.ingredient_id}`;
          qty_data[key] = qty;
          catQtys.push({ name: item.display_name, qty, price: price.toFixed(2) });
        }
        breakdown.push({ category: cat, pct, revenue: catRevenue.toFixed(2), items: catQtys });
      }

      // ── Save scenario ─────────────────────────────────────────────────────
      const { rows: [saved] } = await pool.query(`
        INSERT INTO mcogs_menu_scenarios (name, price_level_id, qty_data, notes)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name
      `, [
        scenario_name.trim(),
        activeLevelIds.length === 1 ? activeLevelIds[0] : null,
        JSON.stringify(qty_data),
        `Auto-generated by McFry — target revenue: ${total_revenue}`,
      ]);

      const totalItems = Object.keys(qty_data).length;
      return {
        scenario_id:   saved.id,
        scenario_name: saved.name,
        total_items:   totalItems,
        url:           '/menus',
        message:       `Scenario "${saved.name}" saved with ${totalItems} items. Go to **Menus → Scenario tab** and select it from the Scenario dropdown to review.`,
        breakdown,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context, helpContext) {
  const page = context?.currentPage || 'unknown';
  return `You are McFry — an AI assistant embedded in the COGS Manager platform, a tool for restaurant franchise operators to manage menu cost-of-goods (COGS).

Your name is McFry. When users greet you or ask your name, introduce yourself as McFry.

You can both READ and WRITE to the database — you are a full sysadmin assistant with the ability to create, update, and delete records across all entities.

## CONFIRMATION RULES (mandatory — no exceptions)
- Before ANY create, update, or delete tool call: describe exactly what you are about to do and ask "Shall I proceed?"
- Wait for explicit user confirmation (yes/ok/proceed/confirm) before executing write operations
- For BATCH operations (>3 records from a CSV or list): describe the full import plan once, ask once, then execute all records after confirmation
- delete_menu: ALWAYS warn "This will also delete all menu items and prices for this menu" before confirming
- delete_market: warn that associated vendors, menus, and tax rates will also be removed
- delete_ingredient / delete_vendor: warn that FK dependencies may block deletion; offer to resolve them first
- delete_location: warn if equipment is assigned — it must be removed first
- set_ingredient_allergens: this REPLACES the full allergen profile — warn the user if they have existing entries
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
You have 74 tools covering: dashboard stats, ingredients, vendors, price quotes, preferred vendors, recipes, recipe items, menus, menu items, menu item prices, categories (full CRUD), units, price levels (full CRUD), tax rates (full CRUD), markets (full CRUD), brand partners (full CRUD + assign), settings (read/update), HACCP equipment + temp logs + CCP logs, locations + location groups, allergens (list/read/write/menu matrix), feedback, **start_import**, and **search_web** (only when explicitly asked).

## BULK FILE IMPORT (start_import tool)
When the user uploads a spreadsheet/CSV with many rows AND wants to import it:
1. Call start_import with the file content text and filename
2. It stages the data for review and returns a job URL
3. Reply: "I've staged your file for import. **[Open Import Wizard](/import?job=<id>)** to review [N] ingredients, [N] recipes etc. before confirming."
4. Do NOT individually call create_ingredient/create_vendor etc. for bulk imports — use start_import

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

  const { message, context = {}, history = [], sessionId, userEmail, userSub } = req.body;
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
    `INSERT INTO mcogs_ai_chat_log
       (user_message, response, tools_called, context, tokens_in, tokens_out, error, user_email, user_sub, session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [message, responseText, JSON.stringify(toolsCalled), JSON.stringify(context),
     tokensIn, tokensOut, errorMsg,
     userEmail || null, userSub || null, sessionId || null]
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

// ── GET /ai-chat/sessions — list sessions for a user ─────────────────────────
// Returns sessions grouped by session_id, newest first.
// Query params: user_sub (required), limit (default 30)

router.get('/sessions', async (req, res) => {
  const { user_sub, limit = 30 } = req.query;
  if (!user_sub) return res.status(400).json({ error: { message: 'user_sub is required' } });
  try {
    const { rows } = await pool.query(`
      SELECT
        session_id,
        MIN(created_at)                                         AS started_at,
        MAX(created_at)                                         AS last_active_at,
        COUNT(*)::int                                           AS turns,
        (array_agg(user_message ORDER BY created_at ASC))[1]   AS first_message,
        (array_agg(user_message ORDER BY created_at DESC))[1]  AS last_message
      FROM mcogs_ai_chat_log
      WHERE user_sub = $1 AND session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT $2
    `, [user_sub, parseInt(limit, 10)]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch sessions' } });
  }
});

// ── GET /ai-chat/sessions/:session_id — load all turns in a session ───────────
// Returns rows ordered by created_at ASC so the frontend can reconstruct the
// message array as alternating user/assistant bubbles.

router.get('/sessions/:session_id', async (req, res) => {
  const { session_id } = req.params;
  const { user_sub }   = req.query;
  if (!user_sub) return res.status(400).json({ error: { message: 'user_sub is required' } });
  try {
    const { rows } = await pool.query(`
      SELECT id, created_at, user_message, response, tools_called, tokens_in, tokens_out
      FROM mcogs_ai_chat_log
      WHERE session_id = $1 AND user_sub = $2
      ORDER BY created_at ASC
    `, [session_id, user_sub]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch session' } });
  }
});

module.exports = { router, TOOLS, executeTool, buildSystemPrompt };
