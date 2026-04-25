// =============================================================================
// COGS AI Chat — SSE streaming endpoint powered by Claude Haiku 4.5
// POST /api/ai-chat           — send a message, receive SSE stream
// GET  /api/ai-chat/log       — paginated chat history
// GET  /api/ai-chat/sessions  — sessions for a user
// GET  /api/ai-chat/usage     — token consumption + estimated cost summary
// =============================================================================

const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const XLSX      = require('xlsx');
const pool      = require('../db/pool');
const localPool = require('../db/local-pool');
const rag       = require('../helpers/rag');
const aiConfig  = require('../helpers/aiConfig');
const { agenticStream } = require('../helpers/agenticStream');
const github    = require('../helpers/github');
const { INTERNAL_SERVICE_KEY } = require('../middleware/auth');

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
  // ── Menu Engineer / Scenario tools ──────────────────────────────────────────
  {
    name: 'list_scenarios',
    description: 'Lists all saved Menu Engineer scenarios with id, name, linked menu, price level, and last updated.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'integer', description: 'Optional: filter by menu ID' },
      },
      required: [],
    },
  },
  {
    name: 'get_scenario_analysis',
    description: `Returns the full Menu Engineer analysis for a menu: every item's base cost (USD), effective cost (USD, with scenario override if any), price per price-level (USD), tax rate, and COGS%.
Use this before computing any scenario changes.
Key fields per item:
  - nat_key / cost_override_key: e.g. "r_5" or "i_12" — use as cost override key
  - menu_item_id: integer — use with level_id to build price override key
  - per_level[].price_override_key: "{menu_item_id}_l{level_id}" — use as price override key
  - per_level[].tax_rate: decimal (e.g. 0.2 = 20% tax)
To compute price for a target COGS%: price_gross_usd = (effective_cost_usd / target_cogs_decimal) * (1 + tax_rate)
All costs and prices are in USD base.`,
    input_schema: {
      type: 'object',
      properties: {
        menu_id:     { type: 'integer', description: 'Menu ID from list_menus' },
        scenario_id: { type: 'integer', description: 'Optional: apply this scenario\'s overrides to the analysis' },
      },
      required: ['menu_id'],
    },
  },
  {
    name: 'save_scenario',
    description: `Creates a new Menu Engineer scenario or updates an existing one with price and/or cost overrides.
All values are in USD base.
Price override keys: "{menu_item_id}_l{level_id}" (from get_scenario_analysis per_level[].price_override_key).
Cost override keys: nat_key e.g. "r_{recipe_id}" or "i_{ingredient_id}" (from get_scenario_analysis cost_override_key).
When updating, new overrides are merged on top of existing ones (existing keys not in the new map are preserved).
Set a value to null to remove that override.
CONFIRMATION REQUIRED before calling.`,
    input_schema: {
      type: 'object',
      properties: {
        scenario_id:     { type: 'integer', description: 'Update this scenario (omit to create new)' },
        menu_id:         { type: 'integer', description: 'Menu ID — required when creating a new scenario' },
        name:            { type: 'string',  description: 'Scenario name' },
        price_level_id:  { type: 'integer', description: 'Optional: pin scenario to a specific price level' },
        price_overrides: { type: 'object',  description: 'Price overrides in USD: { "{menu_item_id}_l{level_id}": price_gross_usd }. Null value removes override.' },
        cost_overrides:  { type: 'object',  description: 'Cost overrides in USD: { "r_{id}" | "i_{id}": cost_usd }. Null value removes override.' },
        note:            { type: 'string',  description: 'Summary of changes made (stored in scenario history)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'push_scenario_prices',
    description: 'Pushes all price overrides from a scenario directly to the live menu (upserts mcogs_menu_item_prices). This makes the scenario prices permanent and visible in the PLT. CONFIRMATION REQUIRED — warn the user this overwrites live menu prices and cannot be undone from here.',
    input_schema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'ID of the scenario to push prices from' },
      },
      required: ['scenario_id'],
    },
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
    description: 'Submits a bug report, feature request, or general feedback. No confirmation required. If there is a screenshot or image in the current conversation, include it as screenshot_base64 and screenshot_filename so it is saved with the ticket.',
    input_schema: {
      type: 'object',
      properties: {
        type:                { type: 'string', enum: ['bug', 'feature', 'general'] },
        title:               { type: 'string' },
        description:         { type: 'string' },
        page:                { type: 'string', description: 'Which page/section the feedback relates to' },
        screenshot_base64:   { type: 'string', description: 'Base64-encoded screenshot or image attached to this conversation. Include if an image is present.' },
        screenshot_filename: { type: 'string', description: 'Filename for the attachment, e.g. "screenshot.jpg"' },
      },
      required: ['type', 'title'],
    },
  },
  {
    name: 'update_feedback_status',
    description: 'Updates the status of a feedback ticket. Call get_feedback first to get the ticket ID. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:     { type: 'integer', description: 'Ticket ID to update' },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved'], description: 'New status' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'delete_feedback',
    description: 'Permanently deletes a feedback ticket by ID. This cannot be undone. Call get_feedback first to confirm the correct ticket. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ticket ID to delete' },
      },
      required: ['id'],
    },
  },

  // ── Bugs & Backlog ──────────────────────────────────────────────────────────
  {
    name: 'list_bugs',
    description: 'Returns bug tickets from the bugs log, filterable by status, priority, and severity.',
    input_schema: {
      type: 'object',
      properties: {
        status:   { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'] },
        priority: { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        severity: { type: 'string', enum: ['critical', 'major', 'minor', 'trivial'] },
        search:   { type: 'string', description: 'Search in summary/description' },
        limit:    { type: 'integer', description: 'Max rows (default 30)' },
      },
      required: [],
    },
  },
  {
    name: 'create_bug',
    description: 'Logs a new bug report. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        summary:              { type: 'string', description: 'Short bug title' },
        description:          { type: 'string', description: 'Detailed description' },
        priority:             { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        severity:             { type: 'string', enum: ['critical', 'major', 'minor', 'trivial'] },
        page:                 { type: 'string', description: 'Which page/module is affected' },
        steps_to_reproduce:   { type: 'string' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_bug_status',
    description: 'Updates the status of a bug. Only developers can change bug status. Call list_bugs first to get the ID. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'integer', description: 'Bug ID' },
        status:     { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'] },
        resolution: { type: 'string', description: 'Resolution notes (optional)' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'list_backlog',
    description: 'Returns backlog items (stories, tasks, epics), filterable by status, priority, and type. Use get_backlog_stats first if you only need counts — list_backlog returns full rows and is slow over large result sets.',
    input_schema: {
      type: 'object',
      properties: {
        status:    { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'wont_do'] },
        priority:  { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        item_type: { type: 'string', enum: ['story', 'task', 'epic', 'improvement'] },
        search:    { type: 'string', description: 'Search in summary/description' },
        limit:     { type: 'integer', description: 'Max rows (default 50, max 500)' },
      },
      required: [],
    },
  },
  {
    name: 'get_backlog_stats',
    description: 'Returns total counts of backlog items grouped by status, priority, and item_type. Cheap and fast — use this for "how many?" questions instead of list_backlog. Always returns the entire table aggregated.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_backlog_item',
    description: 'Creates a new backlog item (story, task, epic, or improvement). CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        summary:             { type: 'string', description: 'Short title' },
        description:         { type: 'string', description: 'Detailed description' },
        item_type:           { type: 'string', enum: ['story', 'task', 'epic', 'improvement'] },
        priority:            { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        acceptance_criteria: { type: 'string' },
        story_points:        { type: 'integer' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_backlog_status',
    description: 'Updates the status of a backlog item. Only developers can change status. Call list_backlog first to get the ID. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:     { type: 'integer', description: 'Backlog item ID' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'wont_do'] },
      },
      required: ['id', 'status'],
    },
  },

  // ── Bugs & Backlog — Edit + Comments ──────────────────────────────────────
  {
    name: 'edit_bug',
    description: 'Edits bug fields (not status). Only the original reporter or a developer can edit. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:                   { type: 'integer', description: 'Bug ID' },
        summary:              { type: 'string' },
        description:          { type: 'string' },
        priority:             { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        severity:             { type: 'string', enum: ['critical', 'major', 'minor', 'trivial'] },
        page:                 { type: 'string' },
        steps_to_reproduce:   { type: 'string' },
        resolution:           { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'edit_backlog_item',
    description: 'Edits backlog item fields (not status). Only the original requester or a developer can edit. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        id:                   { type: 'integer', description: 'Backlog item ID' },
        summary:              { type: 'string' },
        description:          { type: 'string' },
        item_type:            { type: 'string', enum: ['story', 'task', 'epic', 'improvement'] },
        priority:             { type: 'string', enum: ['highest', 'high', 'medium', 'low', 'lowest'] },
        acceptance_criteria:  { type: 'string' },
        story_points:         { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Posts a comment on a bug or backlog item. Anyone can comment. No confirmation required.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: ['bug', 'backlog'], description: 'Type of item to comment on' },
        entity_id:   { type: 'integer', description: 'Bug or backlog item ID' },
        comment:     { type: 'string', description: 'Comment text' },
        parent_id:   { type: 'integer', description: 'Optional: ID of parent comment to reply to' },
      },
      required: ['entity_type', 'entity_id', 'comment'],
    },
  },
  {
    name: 'list_comments',
    description: 'Lists all comments on a bug or backlog item.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: ['bug', 'backlog'] },
        entity_id:   { type: 'integer', description: 'Bug or backlog item ID' },
      },
      required: ['entity_type', 'entity_id'],
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
    description: 'Lists all categories with id, name, group_name, and scope flags (for_ingredients, for_recipes, for_sales_items). Filter by scope to get only relevant categories.',
    input_schema: {
      type: 'object',
      properties: {
        for_ingredients: { type: 'boolean', description: 'Filter to categories usable for ingredients' },
        for_recipes:     { type: 'boolean', description: 'Filter to categories usable for recipes' },
        for_sales_items: { type: 'boolean', description: 'Filter to categories usable for sales items' },
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
    description: 'Creates a new ingredient. Call list_categories first to get category_id. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:                         { type: 'string' },
        category_id:                  { type: 'integer', description: 'Category ID from list_categories (for_ingredients=true)' },
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
        category_id:   { type: 'integer', description: 'Category ID from list_categories (for_recipes=true)' },
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
    description: 'Creates a new category with scope flags. Call list_categories first to check if it already exists. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name:            { type: 'string' },
        group_id:        { type: 'integer', description: 'Optional category group ID' },
        for_ingredients: { type: 'boolean', description: 'Available for inventory ingredients' },
        for_recipes:     { type: 'boolean', description: 'Available for recipes' },
        for_sales_items: { type: 'boolean', description: 'Available for sales items / menu catalog' },
        sort_order:      { type: 'integer' },
      },
      required: ['name'],
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
        category_id:                  { type: 'integer', description: 'Category ID from list_categories (for_ingredients=true)' },
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
        category_id:   { type: 'integer', description: 'Category ID from list_categories (for_recipes=true)' },
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
    description: `Stages a file the user has already uploaded in this conversation so they can finish the import manually in the Import Wizard. Use this when:
- The user uploads a spreadsheet and says "import this", "stage this", "use the import wizard", or similar
- The file contains many ingredients/recipes and the user wants to review before committing
The job is persisted with the current user's email so it appears in their "Continue a staged import" panel on the Import page, and can be resumed later via list_import_jobs.
Returns a job URL — share it with the user as a clickable link: /import?job=<id>
Do NOT use this for small single-record requests; use the individual create_* tools instead. Do NOT execute the import yourself — the user reviews and commits in the wizard.`,
    input_schema: {
      type: 'object',
      properties: {
        file_content: { type: 'string', description: 'The full text content of the file as it appears in the conversation (sheet CSV data, plain text, etc.)' },
        filename:     { type: 'string', description: 'Original filename, e.g. "ingredients.xlsx"' },
      },
      required: ['file_content', 'filename'],
    },
  },

  {
    name: 'list_import_jobs',
    description: `Lists the user's staged import jobs — use this when the user asks "what have I got pending?", "show me my staged imports", "did I leave anything unfinished?", or wants to resume an earlier import. Returns one row per job with counts and a clickable URL (/import?job=<id>) for the user to open in the Import Wizard. Defaults to the current user's non-terminal jobs (staging, ready, failed); pass status explicitly to broaden (e.g. include 'done' for history).`,
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'array',
          items: { type: 'string', enum: ['staging', 'ready', 'importing', 'done', 'failed'] },
          description: 'Which statuses to return. Default: ["staging","ready","failed"].',
        },
        mine: {
          type: 'boolean',
          description: 'If true (default), filter to jobs staged by the current user. Set false to see everyone\u2019s jobs (admin use).',
        },
        limit: { type: 'integer', description: 'Max rows (default 20, max 100).' },
      },
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
    description: 'Updates a category name, group, scope flags, or sort order. Call list_categories first to get the ID. CONFIRMATION REQUIRED.',
    input_schema: {
      type: 'object',
      properties: {
        id:              { type: 'integer' },
        name:            { type: 'string' },
        group_id:        { type: 'integer', description: 'Category group ID (null to clear)' },
        for_ingredients: { type: 'boolean' },
        for_recipes:     { type: 'boolean' },
        for_sales_items: { type: 'boolean' },
        sort_order:      { type: 'integer' },
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

  // ── GitHub ────────────────────────────────────────────────────────────────────
  {
    name: 'github_list_files',
    description: 'Lists files and directories at a path in the GitHub repository. Uses the configured default repo (Settings → AI → GitHub Repo) unless overridden.',
    input_schema: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Directory path to list (default: repo root "")' },
        ref:   { type: 'string', description: 'Branch, tag, or commit SHA (default: repo default branch)' },
        repo:  { type: 'string', description: 'Override repo as "owner/repo" (uses configured default if omitted)' },
      },
      required: [],
    },
  },
  {
    name: 'github_read_file',
    description: 'Reads the full content of a file from the GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, e.g. "api/src/routes/ai-chat.js"' },
        ref:  { type: 'string', description: 'Branch, tag, or commit SHA (default: repo default branch)' },
        repo: { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'github_search_code',
    description: 'Searches code in the GitHub repository using GitHub code search. Returns matching file paths.',
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Search query, e.g. "executeTool" or "function loadUser"' },
        max_results: { type: 'integer', description: 'Max results to return (default 10, max 30)' },
        repo:        { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_create_or_update_file',
    description: 'Creates or updates a single file in a GitHub repository branch. ALWAYS create or use a feature branch — NEVER write directly to main. CONFIRMATION REQUIRED — state the file path, branch, and change summary before calling.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path in the repo, e.g. "api/src/routes/ai-chat.js"' },
        content: { type: 'string', description: 'Full new file content (UTF-8 string)' },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Branch to commit to — must NOT be main/master' },
        sha:     { type: 'string', description: 'Current file SHA (required when updating an existing file — get from github_read_file)' },
        repo:    { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['path', 'content', 'message', 'branch'],
    },
  },
  {
    name: 'github_create_branch',
    description: 'Creates a new branch in the GitHub repository. CONFIRMATION REQUIRED before calling.',
    input_schema: {
      type: 'object',
      properties: {
        branch:      { type: 'string', description: 'New branch name, e.g. "pepper/fix-typo"' },
        from_branch: { type: 'string', description: 'Source branch to branch from (default: "main")' },
        repo:        { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['branch'],
    },
  },
  {
    name: 'github_list_prs',
    description: 'Lists open (or closed) pull requests in the GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        state:       { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state filter (default: "open")' },
        max_results: { type: 'integer', description: 'Max PRs to return (default 10)' },
        repo:        { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: [],
    },
  },
  {
    name: 'github_get_pr_diff',
    description: 'Returns the diff/patch for a pull request. Large diffs are truncated at 8,000 characters.',
    input_schema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'Pull request number' },
        repo:      { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['pr_number'],
    },
  },
  {
    name: 'github_create_pr',
    description: 'Creates a pull request in the GitHub repository. CONFIRMATION REQUIRED — state the title, head branch, and base branch before calling.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR title' },
        body:  { type: 'string', description: 'PR description (markdown supported)' },
        head:  { type: 'string', description: 'Source branch (the branch with your changes)' },
        base:  { type: 'string', description: 'Target branch to merge into (default: "main")' },
        repo:  { type: 'string', description: 'Override repo as "owner/repo"' },
      },
      required: ['title', 'head'],
    },
  },

  // ── Excel Export ─────────────────────────────────────────────────────────────
  {
    name: 'export_to_excel',
    description: `Generates an Excel workbook (.xlsx) and triggers a browser download for the user.
Automatically respects the user's market scope — data is filtered to only the markets/countries the user has access to.
Use when the user asks to "export", "download", "get a spreadsheet", "export to Excel", or similar.
Datasets: "ingredients" (all ingredients + units + waste%), "price_quotes" (vendor quotes per market), "recipes" (recipe items), "menus" (menu items + prices), "full_export" (all four sheets combined).
Returns a summary of what was exported; the file downloads automatically in the browser.`,
    input_schema: {
      type: 'object',
      properties: {
        dataset: {
          type: 'string',
          enum: ['ingredients', 'price_quotes', 'recipes', 'menus', 'full_export'],
          description: 'Which data to export. "full_export" includes all four as separate sheets.',
        },
        country_id: {
          type: 'integer',
          description: 'Optional: restrict to a specific market/country ID. Must be within the user\'s allowed countries.',
        },
        filename: {
          type: 'string',
          description: 'Optional: custom filename without extension (e.g. "my-cogs-export"). Defaults to "cogs-export-{dataset}-{date}".',
        },
      },
      required: ['dataset'],
    },
  },
  {
    name: 'save_to_media_library',
    description: `Saves an image URL that is already accessible (e.g. a screenshot or uploaded image from this conversation) into the Media Library so the user can find it later in Settings → Media Library.
Use when the user says "save this to the library", "add to media library", "keep this screenshot", etc.
Requires: url (the image URL to save). Optional: filename, category_id, form_key.
Returns the saved media item with its id and thumb_url.`,
    input_schema: {
      type: 'object',
      properties: {
        url:         { type: 'string',  description: 'The image URL to register in the library. Must be publicly accessible.' },
        filename:    { type: 'string',  description: 'Optional display filename. Defaults to the URL basename.' },
        category_id: { type: 'integer', description: 'Optional category ID to file it under.' },
        form_key:    { type: 'string',  description: 'Optional form scope (e.g. "ingredient", "recipe"). Defaults to "shared".' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_media_library',
    description: `Lists items in the Media Library. Use when the user asks to "show me the media library", "what images do we have", "find images of X", etc.
Supports optional filters: category_id, form_key, search query.
Returns items with their urls and metadata.`,
    input_schema: {
      type: 'object',
      properties: {
        q:           { type: 'string',  description: 'Search by filename.' },
        category_id: { type: 'integer', description: 'Filter by category ID.' },
        form_key:    { type: 'string',  description: 'Filter by form scope.' },
      },
    },
  },

  // ── Memory tools ────────────────────────────────────────────────────────────
  {
    name: 'save_memory_note',
    description: 'Save a note that will persist across all future conversations. Use when the user says "remember this", "always do X", "note that...", or similar requests to store a preference or fact.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The note to save. Should be a concise, self-contained statement.' },
      },
      required: ['note'],
    },
  },
  {
    name: 'list_memory_notes',
    description: 'List all pinned memory notes for the current user. Use when the user asks "what do you remember?" or "show my notes".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_memory_note',
    description: 'Delete a specific pinned memory note by ID. Use when the user asks to forget something or remove a note.',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'integer', description: 'The ID of the note to delete' },
      },
      required: ['note_id'],
    },
  },

  // ── Audit Log (read-only) ─────────────────────────────────────────────────
  {
    name: 'query_audit_log',
    description: 'Search the audit log for recent changes. Returns who changed what, when, and the old/new field values. Use when user asks about change history, who did something, or what happened recently.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', description: 'Filter by type: ingredient, recipe, price_quote, purchase_order, goods_received, stocktake, waste, stock_level' },
        entity_id:   { type: 'integer', description: 'Filter by specific entity ID' },
        user_email:  { type: 'string', description: 'Filter by user email (partial match)' },
        action:      { type: 'string', description: 'Filter by action: create, update, delete, status_change, confirm, approve, reverse' },
        from:        { type: 'string', description: 'Start date (ISO format, e.g. 2026-04-01)' },
        to:          { type: 'string', description: 'End date (ISO format)' },
        search:      { type: 'string', description: 'Search in entity label (item name)' },
        limit:       { type: 'integer', description: 'Max results (default 20, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_entity_audit_history',
    description: 'Get the full change history for a specific entity (e.g. a specific ingredient or recipe). Shows all changes over time with old/new field values.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', description: 'Entity type (e.g. ingredient, recipe, price_quote)' },
        entity_id:   { type: 'integer', description: 'Entity ID' },
      },
      required: ['entity_type', 'entity_id'],
    },
  },
  {
    name: 'get_audit_stats',
    description: 'Get audit log summary statistics: total changes, breakdown by action/entity type, most active users. Use for activity overviews or "what happened this week" questions.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date (ISO format)' },
        to:   { type: 'string', description: 'End date (ISO format)' },
      },
      required: [],
    },
  },

  // ── FAQ Knowledge Base ────────────────────────────────────────────────────
  {
    name: 'search_faq',
    description: 'Search the FAQ knowledge base for answers to common questions about COGS Manager features. Use when the user asks a how-to question, needs help, or wants to know how something works. Check FAQ first before giving a general answer.',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'Search query (keywords or natural question)' },
        category: { type: 'string', description: 'Optional category filter (e.g. "Recipes", "Menus & COGS", "Stock Manager")' },
      },
      required: ['query'],
    },
  },

  // ── Change Log ────────────────────────────────────────────────────────────
  {
    name: 'get_changelog',
    description: 'Get the project change log — shows what was added, changed, fixed, or removed in each session/release. Use when user asks "what changed recently?", "what\'s new?", or "show me the changelog".',
    input_schema: {
      type: 'object',
      properties: {
        version: { type: 'string', description: 'Optional: specific version/date to look up (e.g. "2026-04-14")' },
        limit:   { type: 'integer', description: 'Max entries to return (default 5)' },
      },
      required: [],
    },
  },

  // ── QSC Audits ────────────────────────────────────────────────────────────
  {
    name: 'list_audits',
    description: 'List QSC (Quality/Service/Cleanliness) audits performed at restaurant locations. Use when the user asks about recent audits, audit scores, or audit history for a location. Returns audit key, type (external/internal), location, status, score, and rating.',
    input_schema: {
      type: 'object',
      properties: {
        audit_type:  { type: 'string', enum: ['external', 'internal'], description: 'Filter by type' },
        status:      { type: 'string', enum: ['in_progress', 'completed', 'cancelled'], description: 'Filter by status' },
        location_id: { type: 'integer', description: 'Filter to one location' },
        limit:       { type: 'integer', description: 'Max rows (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_audit_report',
    description: 'Get the full scored report for one QSC audit — overall score and rating, department/category breakdowns, critical findings, list of non-compliant items with comments and photos, and repeat findings. Use when the user asks "how did audit X go?", "show me the last audit for location Y", or wants remediation suggestions.',
    input_schema: {
      type: 'object',
      properties: {
        audit_id: { type: 'integer', description: 'Primary key id of the audit' },
        audit_key:{ type: 'string',  description: 'Audit key (e.g. AUD-1001)' },
      },
      required: [],
    },
  },
  {
    name: 'list_qsc_questions',
    description: 'Query the QSC question bank (150 Wingstop audit questions). Filter by department, category, risk level, or text search. Use when the user asks "show me all Critical First Priority questions", "what do we check for in Personal Hygiene?", or "which questions mention walk-in coolers?".',
    input_schema: {
      type: 'object',
      properties: {
        department: { type: 'string', enum: ['Food Safety', 'Brand Standards'], description: 'Filter by department' },
        category:   { type: 'string', description: 'Filter by category (e.g. "Temperature Control", "Dining Room")' },
        risk_level: { type: 'string', description: 'Filter by risk level (e.g. "Critical First Priority", "First Priority", "Second Priority", "Third Priority", "Information Only")' },
        search:     { type: 'string', description: 'Text search on code or title' },
        limit:      { type: 'integer', description: 'Max rows (default 25, max 100)' },
      },
      required: [],
    },
  },
  {
    name: 'get_qsc_question',
    description: 'Get the full detail for one QSC question by its code (e.g. A101, DR201). Returns title, full policy text, risk level, points, repeat points, auto-unacceptable flag, photo-required flag, temperature-input flag, and cross-referenced codes.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Question code (e.g. "A101")' },
      },
      required: ['code'],
    },
  },
  {
    name: 'list_audit_templates',
    description: 'List the saved audit templates (7 system + any custom). Each template is a named subset of question codes used for internal ad-hoc audits (e.g. "Line Check Peak", "Walk-in & Cold Hold"). Use when the user asks "what templates are available?" or "what does the Line Check template cover?".',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_audit_nc_trends',
    description: 'Aggregate non-compliance trends across completed audits — returns the most frequently failed question codes with their NC count and points deducted. Use when the user asks "which codes fail most often?", "what are our recurring issues?", or wants remediation priorities.',
    input_schema: {
      type: 'object',
      properties: {
        location_id: { type: 'integer', description: 'Optional: limit to one location' },
        audit_type:  { type: 'string', enum: ['external', 'internal'], description: 'Optional: limit to one audit type' },
        from:        { type: 'string', description: 'Optional: only audits completed on or after this date (ISO format)' },
        to:          { type: 'string', description: 'Optional: only audits completed on or before this date (ISO format)' },
        limit:       { type: 'integer', description: 'Top N codes to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_location_audit_history',
    description: 'Get the audit timeline for one location — a chronological list of every audit plus a running average score and rating distribution. Use when the user asks "show me the audit history for location X" or wants to see a location\'s trajectory over time.',
    input_schema: {
      type: 'object',
      properties: {
        location_id: { type: 'integer', description: 'Location primary key id' },
        limit:       { type: 'integer', description: 'Max audits to return (default 10)' },
      },
      required: ['location_id'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

// Helper: ensure category name exists in mcogs_categories (mirrors ingredients.js)

async function executeTool(name, input, send = null, userCtx = {}) {
  // Translation helpers — when the user has a non-English language, every read
  // tool that returns entity name/description should resolve via COALESCE so
  // Pepper sees the translated string and can quote it back naturally.
  const _lang = userCtx?.language && userCtx.language !== 'en' ? userCtx.language : null;
  const _tSel = (alias, field, paramIdx) =>
    _lang ? `COALESCE(${alias}.translations->$${paramIdx}->>'${field}', ${alias}.${field})`
          : `${alias}.${field}`;

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
      // Language-aware: when _lang is set, $1 is lang and $2 is the search term
      const params = _lang ? [_lang] : [];
      let where = '';
      if (search) { params.push(`%${search}%`); where = `WHERE i.name ILIKE $${params.length}`; }
      const iName = _lang ? `COALESCE(i.translations->$1->>'name', i.name)` : `i.name`;
      const catName = _lang ? `COALESCE(cat.translations->$1->>'name', cat.name)` : `cat.name`;
      const { rows } = await pool.query(
        `SELECT i.id, ${iName} AS name, ${catName} AS category, i.waste_pct, i.base_unit_id
         FROM mcogs_ingredients i
         LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
         ${where} ORDER BY name LIMIT 100`,
        params
      );
      return rows;
    }

    case 'get_ingredient': {
      const { id } = input;
      const iSel = _lang ? `COALESCE(i.translations->$2->>'name', i.name) AS name, COALESCE(i.translations->$2->>'notes', i.notes) AS notes` : `i.name, i.notes`;
      const vSel = _lang ? `COALESCE(v.translations->$2->>'name', v.name) AS vendor_name` : `v.name AS vendor_name`;
      const ingArgs = _lang ? [id, _lang] : [id];
      const [ing, quotes, allergens] = await Promise.all([
        pool.query(`
          SELECT i.id, ${iSel}, i.category_id, i.base_unit_id, i.waste_pct,
                 i.default_prep_unit, i.default_prep_to_base_conversion,
                 i.image_url, i.allergen_notes, i.translations,
                 u.name as base_unit_name, u.abbreviation as base_unit_abbr
          FROM mcogs_ingredients i
          LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
          WHERE i.id = $1`, ingArgs),
        pool.query(`
          SELECT pq.*, ${vSel}, co.name as country_name, co.currency_symbol
          FROM mcogs_price_quotes pq
          JOIN mcogs_vendors v ON v.id = pq.vendor_id
          LEFT JOIN mcogs_countries co ON co.id = v.country_id
          WHERE pq.ingredient_id = $1 ORDER BY v.name`, ingArgs),
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
      const params = _lang ? [_lang] : [];
      let where = '';
      if (search) { params.push(`%${search}%`); where = `WHERE r.name ILIKE $${params.length}`; }
      const rName = _lang ? `COALESCE(r.translations->$1->>'name', r.name)` : `r.name`;
      const rDesc = _lang ? `COALESCE(r.translations->$1->>'description', r.description)` : `r.description`;
      const { rows } = await pool.query(
        `SELECT r.id, ${rName} AS name, ${rDesc} AS description FROM mcogs_recipes r ${where} ORDER BY name LIMIT 100`,
        params
      );
      return rows;
    }

    case 'get_recipe': {
      const { id } = input;
      const rArgs = _lang ? [id, _lang] : [id];
      const rName = _tSel('r', 'name', 2);
      const rDesc = _tSel('r', 'description', 2);
      const iName = _tSel('i', 'name', 2);
      const srName = _tSel('sr', 'name', 2);
      const [rec, items] = await Promise.all([
        pool.query(`
          SELECT r.id, ${rName} AS name, ${rDesc} AS description,
                 r.category_id, r.yield_qty, r.yield_unit_id, r.yield_unit_text,
                 r.translations,
                 u.abbreviation as yield_unit_abbr
          FROM mcogs_recipes r
          LEFT JOIN mcogs_units u ON u.id = r.yield_unit_id
          WHERE r.id = $1`, rArgs),
        pool.query(`
          SELECT ri.*, ${iName} as ingredient_name, u.abbreviation as unit_abbr,
                 ${srName} as sub_recipe_name
          FROM mcogs_recipe_items ri
          LEFT JOIN mcogs_ingredients i ON i.id = ri.ingredient_id
          LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
          LEFT JOIN mcogs_recipes sr ON sr.id = ri.recipe_item_id
          WHERE ri.recipe_id = $1
          ORDER BY ri.id ASC`, rArgs),
      ]);
      if (!rec.rows.length) return { error: 'Recipe not found' };
      return { ...rec.rows[0], items: items.rows };
    }

    case 'list_menus': {
      const mName = _tSel('m', 'name', 1);
      const { rows } = await pool.query(`
        SELECT m.id, ${mName} AS name, c.name as market, c.currency_symbol
        FROM mcogs_menus m LEFT JOIN mcogs_countries c ON c.id = m.country_id
        ORDER BY c.name, name
      `, _lang ? [_lang] : []);
      return rows;
    }

    // ── Menu Engineer / Scenario tools ────────────────────────────────────────

    case 'list_scenarios': {
      const { menu_id } = input;
      const q = menu_id
        ? `SELECT s.id, s.name, s.menu_id, s.price_level_id, s.notes, s.updated_at,
                  m.name AS menu_name, pl.name AS price_level_name
           FROM   mcogs_menu_scenarios s
           LEFT JOIN mcogs_menus m ON m.id = s.menu_id
           LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
           WHERE  s.menu_id = $1 ORDER BY s.updated_at DESC`
        : `SELECT s.id, s.name, s.menu_id, s.price_level_id, s.notes, s.updated_at,
                  m.name AS menu_name, pl.name AS price_level_name
           FROM   mcogs_menu_scenarios s
           LEFT JOIN mcogs_menus m ON m.id = s.menu_id
           LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
           ORDER BY s.updated_at DESC`;
      const { rows } = await pool.query(q, menu_id ? [menu_id] : []);
      return rows;
    }

    case 'get_scenario_analysis': {
      const { menu_id, scenario_id } = input;
      const port = process.env.PORT || 3001;
      const qs   = scenario_id ? `?menu_id=${menu_id}&scenario_id=${scenario_id}` : `?menu_id=${menu_id}`;
      const resp = await fetch(`http://localhost:${port}/api/scenarios/analysis${qs}`, {
        headers: { 'x-internal-service': INTERNAL_SERVICE_KEY },
      });
      if (!resp.ok) return { error: `Analysis endpoint returned ${resp.status}` };
      return await resp.json();
    }

    case 'save_scenario': {
      const { scenario_id, menu_id, name, price_level_id, price_overrides, cost_overrides, note } = input;
      const histEntry = { ts: new Date().toISOString(), action: 'ai_edit', detail: note || 'AI applied changes' };

      if (scenario_id) {
        // Load existing to merge overrides
        const { rows: [existing] } = await pool.query(`
          SELECT price_overrides, cost_overrides, history, name, price_level_id
          FROM   mcogs_menu_scenarios WHERE id = $1
        `, [scenario_id]);
        if (!existing) return { error: 'Scenario not found' };

        // Merge: apply new on top of existing; null values remove the key
        const merged = (base, updates) => {
          const out = { ...(base || {}) };
          for (const [k, v] of Object.entries(updates || {})) {
            if (v === null) delete out[k]; else out[k] = v;
          }
          return out;
        };
        const newPrices  = merged(existing.price_overrides, price_overrides);
        const newCosts   = merged(existing.cost_overrides,  cost_overrides);
        const newHistory = [...(existing.history || []), histEntry];

        await pool.query(`
          UPDATE mcogs_menu_scenarios
          SET name=$1, price_level_id=$2, price_overrides=$3, cost_overrides=$4, history=$5, updated_at=NOW()
          WHERE id=$6
        `, [
          name || existing.name,
          price_level_id ?? existing.price_level_id,
          JSON.stringify(newPrices),
          JSON.stringify(newCosts),
          JSON.stringify(newHistory),
          scenario_id,
        ]);
        return {
          scenario_id,
          name: name || existing.name,
          price_overrides_count: Object.keys(newPrices).length,
          cost_overrides_count:  Object.keys(newCosts).length,
          saved: true,
        };
      } else {
        if (!menu_id) return { error: 'menu_id is required when creating a new scenario' };
        if (!name?.trim()) return { error: 'name is required' };
        const { rows: [row] } = await pool.query(`
          INSERT INTO mcogs_menu_scenarios (name, menu_id, price_level_id, price_overrides, cost_overrides, history)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name
        `, [
          name.trim(),
          menu_id,
          price_level_id || null,
          JSON.stringify(price_overrides || {}),
          JSON.stringify(cost_overrides  || {}),
          JSON.stringify([histEntry]),
        ]);
        return {
          scenario_id:           row.id,
          name:                  row.name,
          price_overrides_count: Object.keys(price_overrides || {}).length,
          cost_overrides_count:  Object.keys(cost_overrides  || {}).length,
          saved: true,
        };
      }
    }

    case 'push_scenario_prices': {
      const { scenario_id } = input;
      const { rows: [sc] } = await pool.query(
        `SELECT price_overrides FROM mcogs_menu_scenarios WHERE id = $1`, [scenario_id]
      );
      if (!sc) return { error: 'Scenario not found' };

      const overrides = Object.entries(sc.price_overrides || {})
        .map(([key, val]) => {
          // key format: "{menu_item_id}_l{level_id}"
          const under = key.lastIndexOf('_l');
          if (under < 0) return null;
          return {
            menu_item_id:   Number(key.slice(0, under)),
            price_level_id: Number(key.slice(under + 2)),
            sell_price:     Number(val),
          };
        })
        .filter(o => o && o.sell_price > 0 && o.menu_item_id && o.price_level_id);

      if (!overrides.length) return { pushed: 0, message: 'No price overrides to push' };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const { menu_item_id, price_level_id, sell_price } of overrides) {
          await client.query(`
            INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price)
            VALUES ($1, $2, $3)
            ON CONFLICT (menu_item_id, price_level_id) DO UPDATE SET sell_price = EXCLUDED.sell_price
          `, [menu_item_id, price_level_id, sell_price]);
        }
        await client.query('COMMIT');
        return { pushed: overrides.length, message: `${overrides.length} price${overrides.length > 1 ? 's' : ''} pushed to live menu` };
      } catch (err) {
        await client.query('ROLLBACK');
        return { error: err.message };
      } finally {
        client.release();
      }
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
      const resp = await fetch(`http://localhost:${port}/api/cogs/menu-sales/${menu_id}${qs}`, {
        headers: { 'x-internal-service': INTERNAL_SERVICE_KEY },
      });
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
            ? `No sell price set — add via Menus → Menu Builder (set sell prices per price level on the item)`
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
      const { type = 'general', title, description, page, screenshot_base64, screenshot_filename } = input;
      const attachments = screenshot_base64
        ? [{ filename: screenshot_filename || 'screenshot.jpg', data_base64: screenshot_base64, content_type: 'image/jpeg' }]
        : [];
      const { rows } = await pool.query(
        `INSERT INTO mcogs_feedback (type, title, description, page, attachments) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [type, title, description || null, page || null, JSON.stringify(attachments)]
      );
      return rows[0];
    }

    case 'update_feedback_status': {
      const { id, status } = input;
      const validStatuses = ['open', 'in_progress', 'resolved'];
      if (!validStatuses.includes(status)) return { error: `status must be one of: ${validStatuses.join(', ')}` };
      const { rows } = await pool.query(
        `UPDATE mcogs_feedback SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, id]
      );
      if (!rows.length) return { error: `Ticket #${id} not found` };
      return rows[0];
    }

    case 'delete_feedback': {
      const { id } = input;
      const { rows } = await pool.query(
        `DELETE FROM mcogs_feedback WHERE id=$1 RETURNING id`,
        [id]
      );
      if (!rows.length) return { error: `Ticket #${id} not found` };
      return { deleted: rows[0].id };
    }

    // ── Bugs & Backlog (local DB) ────────────────────────────────────────────

    case 'list_bugs': {
      const { status, priority, severity, search, limit = 30 } = input;
      const conditions = [];
      const vals = [];
      if (status)   conditions.push(`status = $${vals.push(status)}`);
      if (priority) conditions.push(`priority = $${vals.push(priority)}`);
      if (severity) conditions.push(`severity = $${vals.push(severity)}`);
      if (search)   conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      vals.push(Math.min(parseInt(limit, 10) || 30, 100));
      const { rows } = await localPool.query(
        `SELECT id, key, summary, priority, status, severity, reported_by_email, assigned_to, page, created_at, updated_at FROM mcogs_bugs ${where} ORDER BY created_at DESC LIMIT $${vals.length}`,
        vals
      );
      return rows.length ? rows : 'No bugs found.';
    }

    case 'create_bug': {
      const { summary, description, priority, severity, page, steps_to_reproduce } = input;
      if (!summary?.trim()) return { error: 'summary is required' };
      const keyRes = await localPool.query(`SELECT nextval('mcogs_bug_number_seq')::int AS num`);
      const key = `BUG-${keyRes.rows[0].num}`;
      const { rows } = await localPool.query(`
        INSERT INTO mcogs_bugs (key, summary, description, priority, severity, reported_by, reported_by_email, page, steps_to_reproduce)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, key, summary, priority, severity, status
      `, [key, summary.trim(), description?.trim() || null, priority || 'medium', severity || 'minor',
          userCtx.sub || null, userCtx.email || null, page?.trim() || null, steps_to_reproduce?.trim() || null]);
      return rows[0];
    }

    case 'update_bug_status': {
      const { id, status, resolution } = input;
      const bugAccess = userCtx.permissions?.bugs || 'none';
      if (bugAccess !== 'write') return { error: 'You need bugs:write permission to update bugs.' };
      if (!userCtx.is_dev) return { error: 'Only developers can change bug status.' };
      const sets = [`status = $1`, `updated_at = NOW()`];
      const vals = [status];
      if (resolution) { sets.push(`resolution = $${vals.push(resolution.trim())}`); }
      vals.push(id);
      const { rows } = await localPool.query(
        `UPDATE mcogs_bugs SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, key, status, resolution`,
        vals
      );
      if (!rows.length) return { error: `Bug #${id} not found` };
      return rows[0];
    }

    case 'list_backlog': {
      const { status, priority, item_type, search, limit = 50 } = input;
      const conditions = [];
      const vals = [];
      if (status)    conditions.push(`status = $${vals.push(status)}`);
      if (priority)  conditions.push(`priority = $${vals.push(priority)}`);
      if (item_type) conditions.push(`item_type = $${vals.push(item_type)}`);
      if (search)    conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const cap = Math.min(parseInt(limit, 10) || 50, 500);
      // Cheap COUNT(*) so Pepper can tell whether the LIMIT is truncating the
      // result — the previous version silently capped at 30 rows with no signal.
      const { rows: [totalRow] } = await localPool.query(
        `SELECT COUNT(*)::int AS total FROM mcogs_backlog ${where}`, vals
      );
      vals.push(cap);
      // Drop description from the default SELECT — keeps payload small for
      // listing/counting. Callers that need it can use update_backlog_status
      // or hit the REST API directly.
      const { rows } = await localPool.query(
        `SELECT id, key, summary, item_type, priority, status, story_points, sprint, sort_order, created_at FROM mcogs_backlog ${where} ORDER BY sort_order ASC, created_at DESC LIMIT $${vals.length}`,
        vals
      );
      const total = totalRow?.total ?? rows.length;
      if (rows.length === 0) return 'No backlog items found.';
      return { total, returned: rows.length, truncated: rows.length < total, rows };
    }

    case 'get_backlog_stats': {
      const { rows: byStatus }   = await localPool.query(`SELECT status,    COUNT(*)::int AS count FROM mcogs_backlog GROUP BY status    ORDER BY count DESC`);
      const { rows: byPriority } = await localPool.query(`SELECT priority,  COUNT(*)::int AS count FROM mcogs_backlog GROUP BY priority  ORDER BY count DESC`);
      const { rows: byType }     = await localPool.query(`SELECT item_type, COUNT(*)::int AS count FROM mcogs_backlog GROUP BY item_type ORDER BY count DESC`);
      const { rows: [{ total }] } = await localPool.query(`SELECT COUNT(*)::int AS total FROM mcogs_backlog`);
      return { total, by_status: byStatus, by_priority: byPriority, by_item_type: byType };
    }

    case 'create_backlog_item': {
      const { summary, description, item_type, priority, acceptance_criteria, story_points } = input;
      if (!summary?.trim()) return { error: 'summary is required' };
      const keyRes = await localPool.query(`SELECT nextval('mcogs_backlog_number_seq')::int AS num`);
      const key = `BACK-${keyRes.rows[0].num}`;
      const maxSort = await localPool.query(`SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next FROM mcogs_backlog`);
      const { rows } = await localPool.query(`
        INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, requested_by, requested_by_email, acceptance_criteria, story_points, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, key, summary, item_type, priority, status
      `, [key, summary.trim(), description?.trim() || null, item_type || 'story', priority || 'medium',
          userCtx.sub || null, userCtx.email || null, acceptance_criteria?.trim() || null, story_points || null, maxSort.rows[0].next]);
      return rows[0];
    }

    case 'update_backlog_status': {
      const { id, status } = input;
      const blAccess = userCtx.permissions?.backlog || 'none';
      if (blAccess !== 'write') return { error: 'You need backlog:write permission to update backlog items.' };
      if (!userCtx.is_dev) return { error: 'Only developers can change backlog status.' };
      const { rows } = await localPool.query(
        `UPDATE mcogs_backlog SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, key, status`,
        [status, id]
      );
      if (!rows.length) return { error: `Backlog item #${id} not found` };
      return rows[0];
    }

    // ── Bugs & Backlog — Edit + Comments ────────────────────────────────────

    case 'edit_bug': {
      const { id, summary, description, priority, severity, page, steps_to_reproduce, resolution } = input;
      const bug = await localPool.query(`SELECT reported_by FROM mcogs_bugs WHERE id = $1`, [id]);
      if (!bug.rows.length) return { error: `Bug #${id} not found` };
      const isAuthor = bug.rows[0].reported_by && bug.rows[0].reported_by === userCtx.sub;
      if (!isAuthor && !userCtx.is_dev) return { error: 'Only the original reporter or a developer can edit this bug.' };
      const sets = ['updated_at = NOW()'];
      const vals = [];
      if (summary)              sets.push(`summary = $${vals.push(summary.trim())}`);
      if (description)          sets.push(`description = $${vals.push(description.trim())}`);
      if (priority)             sets.push(`priority = $${vals.push(priority)}`);
      if (severity)             sets.push(`severity = $${vals.push(severity)}`);
      if (page !== undefined)   sets.push(`page = $${vals.push(page.trim())}`);
      if (steps_to_reproduce)   sets.push(`steps_to_reproduce = $${vals.push(steps_to_reproduce.trim())}`);
      if (resolution)           sets.push(`resolution = $${vals.push(resolution.trim())}`);
      if (vals.length === 0) return { error: 'No fields to update' };
      vals.push(id);
      const { rows } = await localPool.query(
        `UPDATE mcogs_bugs SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, key, summary, priority, severity, status`,
        vals
      );
      return rows[0];
    }

    case 'edit_backlog_item': {
      const { id, summary, description, item_type, priority, acceptance_criteria, story_points } = input;
      const bl = await localPool.query(`SELECT requested_by FROM mcogs_backlog WHERE id = $1`, [id]);
      if (!bl.rows.length) return { error: `Backlog item #${id} not found` };
      const isAuthor = bl.rows[0].requested_by && bl.rows[0].requested_by === userCtx.sub;
      if (!isAuthor && !userCtx.is_dev) return { error: 'Only the original requester or a developer can edit this item.' };
      const sets = ['updated_at = NOW()'];
      const vals = [];
      if (summary)              sets.push(`summary = $${vals.push(summary.trim())}`);
      if (description)          sets.push(`description = $${vals.push(description.trim())}`);
      if (item_type)            sets.push(`item_type = $${vals.push(item_type)}`);
      if (priority)             sets.push(`priority = $${vals.push(priority)}`);
      if (acceptance_criteria)  sets.push(`acceptance_criteria = $${vals.push(acceptance_criteria.trim())}`);
      if (story_points !== undefined) sets.push(`story_points = $${vals.push(story_points)}`);
      if (vals.length === 0) return { error: 'No fields to update' };
      vals.push(id);
      const { rows } = await localPool.query(
        `UPDATE mcogs_backlog SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, key, summary, item_type, priority, status`,
        vals
      );
      return rows[0];
    }

    case 'add_comment': {
      const { entity_type, entity_id, comment, parent_id } = input;
      if (!comment?.trim()) return { error: 'comment text is required' };
      const table = entity_type === 'bug' ? 'mcogs_bugs' : 'mcogs_backlog';
      const check = await localPool.query(`SELECT id FROM ${table} WHERE id = $1`, [entity_id]);
      if (!check.rows.length) return { error: `${entity_type} #${entity_id} not found` };
      if (parent_id) {
        const pCheck = await localPool.query(
          `SELECT id FROM mcogs_item_comments WHERE id = $1 AND entity_type = $2 AND entity_id = $3`,
          [parent_id, entity_type, entity_id]
        );
        if (!pCheck.rows.length) return { error: 'Parent comment not found' };
      }
      const { rows } = await localPool.query(`
        INSERT INTO mcogs_item_comments (entity_type, entity_id, user_sub, user_email, user_name, comment, parent_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, user_name, comment, created_at
      `, [entity_type, entity_id, userCtx.sub || null, userCtx.email || null,
          userCtx.name || userCtx.email || 'Pepper', comment.trim(), parent_id || null]);
      return rows[0];
    }

    case 'list_comments': {
      const { entity_type, entity_id } = input;
      const { rows } = await localPool.query(
        `SELECT id, user_name, comment, parent_id, created_at FROM mcogs_item_comments WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at ASC`,
        [entity_type, entity_id]
      );
      return rows.length ? rows : 'No comments found.';
    }

    // ── New Lookup / Read ──────────────────────────────────────────────────────

    case 'list_vendors': {
      const { country_id } = input;
      const params = _lang ? [_lang] : [];
      let where = '';
      if (country_id) { params.push(country_id); where = `WHERE v.country_id = $${params.length}`; }
      const vName = _tSel('v', 'name', 1);
      const { rows } = await pool.query(
        `SELECT v.id, ${vName} AS name, c.name as country_name, c.currency_symbol
         FROM mcogs_vendors v LEFT JOIN mcogs_countries c ON c.id = v.country_id ${where} ORDER BY name`,
        params
      );
      return rows;
    }

    case 'list_markets': {
      // Country names are intentionally not translated (they're proper nouns,
      // stored in English by design). Price-level name IS translatable.
      const plName = _tSel('pl', 'name', 1);
      const { rows } = await pool.query(`
        SELECT c.id, c.name, c.currency_code, c.currency_symbol, c.exchange_rate,
               c.default_price_level_id, ${plName} AS default_price_level_name,
               c.default_language_code
        FROM   mcogs_countries c
        LEFT JOIN mcogs_price_levels pl ON pl.id = c.default_price_level_id
        ORDER BY c.name
      `, _lang ? [_lang] : []);
      return rows;
    }

    case 'list_categories': {
      const { for_ingredients, for_recipes, for_sales_items } = input;
      const conditions = [];
      if (for_ingredients) conditions.push('c.for_ingredients = true');
      if (for_recipes)     conditions.push('c.for_recipes = true');
      if (for_sales_items) conditions.push('c.for_sales_items = true');
      const where = conditions.length ? `WHERE (${conditions.join(' OR ')})` : '';
      const cName = _tSel('c', 'name', 1);
      const { rows } = await pool.query(`
        SELECT c.id, ${cName} AS name, c.sort_order, c.for_ingredients, c.for_recipes, c.for_sales_items,
               c.group_id, g.name AS group_name
        FROM mcogs_categories c
        LEFT JOIN mcogs_category_groups g ON g.id = c.group_id
        ${where}
        ORDER BY name
      `, _lang ? [_lang] : []);
      return rows;
    }

    case 'list_units': {
      const { rows } = await pool.query(`
        SELECT id, name, abbreviation, type FROM mcogs_units ORDER BY type, name
      `);
      return rows;
    }

    case 'list_price_levels': {
      const plName = _tSel('pl', 'name', 1);
      const { rows } = await pool.query(`
        SELECT pl.id, ${plName} AS name, pl.description, pl.is_default
        FROM mcogs_price_levels pl ORDER BY name
      `, _lang ? [_lang] : []);
      return rows;
    }

    case 'list_price_quotes': {
      const { ingredient_id, vendor_id, is_active } = input;
      const vals = _lang ? [_lang] : [];
      const conditions = [];
      if (ingredient_id !== undefined) conditions.push(`pq.ingredient_id = $${vals.push(ingredient_id)}`);
      if (vendor_id     !== undefined) conditions.push(`pq.vendor_id = $${vals.push(vendor_id)}`);
      if (is_active     !== undefined) conditions.push(`pq.is_active = $${vals.push(is_active)}`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const iName = _tSel('i', 'name', 1);
      const vName = _tSel('v', 'name', 1);
      const { rows } = await pool.query(`
        SELECT pq.id, pq.ingredient_id, pq.vendor_id,
               ${iName} as ingredient_name, ${vName} as vendor_name,
               pq.purchase_price, pq.qty_in_base_units, pq.purchase_unit,
               pq.is_active, pq.vendor_product_code,
               ROUND((pq.purchase_price / NULLIF(pq.qty_in_base_units, 0))::numeric, 4) as price_per_base_unit
        FROM mcogs_price_quotes pq
        JOIN mcogs_ingredients i ON i.id = pq.ingredient_id
        JOIN mcogs_vendors v ON v.id = pq.vendor_id
        ${where}
        ORDER BY ingredient_name, vendor_name
        LIMIT 200
      `, vals);
      return rows;
    }

    // ── Ingredient CRUD ────────────────────────────────────────────────────────

    case 'create_ingredient': {
      const { name, category_id, base_unit_id, waste_pct, default_prep_unit,
              default_prep_to_base_conversion, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_ingredients
          (name, category_id, base_unit_id, waste_pct, default_prep_unit, default_prep_to_base_conversion, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, category_id, waste_pct
      `, [
        name.trim(),
        category_id                       || null,
        base_unit_id                      || null,
        waste_pct                         ?? 0,
        default_prep_unit?.trim()         || null,
        default_prep_to_base_conversion   ?? 1,
        notes?.trim()                     || null,
      ]);
      return rows[0];
    }

    case 'update_ingredient': {
      const { id, name, category_id, base_unit_id, waste_pct, default_prep_unit,
              default_prep_to_base_conversion, notes } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_ingredients SET
          name = $1, category_id = $2, base_unit_id = $3, waste_pct = $4,
          default_prep_unit = $5, default_prep_to_base_conversion = $6, notes = $7
        WHERE id = $8 RETURNING id, name, category_id, waste_pct
      `, [
        name.trim(),
        category_id                       || null,
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
      const { name, category_id, description, yield_qty, yield_unit_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_recipes (name, category_id, description, yield_qty, yield_unit_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id, name, category_id
      `, [
        name.trim(),
        category_id         || null,
        description?.trim() || null,
        yield_qty           || null,
        yield_unit_id       || null,
      ]);
      return rows[0];
    }

    case 'update_recipe': {
      const { id, name, category_id, description, yield_qty, yield_unit_id } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_recipes SET name=$1, category_id=$2, description=$3, yield_qty=$4, yield_unit_id=$5
        WHERE id=$6 RETURNING id, name, category_id
      `, [
        name.trim(),
        category_id         || null,
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
      const { name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        INSERT INTO mcogs_categories (name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, group_id, for_ingredients, for_recipes, for_sales_items
      `, [
        name.trim(),
        group_id        || null,
        for_ingredients || false,
        for_recipes     || false,
        for_sales_items || false,
        sort_order      || 0,
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
      // Attribute the job to the current user so it shows up in their
      // "Continue a staged import" list on the Import page.
      const userEmail = userCtx?.email || null;
      const result = await stageFileContent(importClient, file_content, filename, userEmail);
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

    case 'list_import_jobs': {
      // List recent import jobs the user can resume manually. Defaults to
      // the current user's pending (non-terminal) jobs, matching what the
      // Import page's "Continue a staged import" panel shows.
      const { status, mine = true, limit = 20 } = input || {};
      const userEmail = userCtx?.email || null;
      const allowed   = ['staging', 'ready', 'importing', 'done', 'failed'];
      const statuses  = Array.isArray(status) && status.length
        ? status.filter(s => allowed.includes(s))
        : ['staging', 'ready', 'failed'];
      if (!statuses.length) return [];

      const cap    = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const params = [statuses, cap];
      let where    = `status = ANY($1::text[])`;
      if (mine && userEmail) {
        params.push(userEmail);
        where += ` AND user_email = $${params.length}`;
      }

      const { rows } = await pool.query(`
        SELECT id, user_email, source_file, status, created_at, updated_at,
               COALESCE(jsonb_array_length(staged_data -> 'ingredients'),  0) AS ingredient_count,
               COALESCE(jsonb_array_length(staged_data -> 'vendors'),      0) AS vendor_count,
               COALESCE(jsonb_array_length(staged_data -> 'price_quotes'), 0) AS quote_count,
               COALESCE(jsonb_array_length(staged_data -> 'recipes'),      0) AS recipe_count,
               COALESCE(jsonb_array_length(staged_data -> 'menus'),        0) AS menu_count
        FROM   mcogs_import_jobs
        WHERE  ${where}
        ORDER  BY created_at DESC
        LIMIT  $2
      `, params);

      return rows.map(r => ({
        ...r,
        url: `/import?job=${r.id}`,
      }));
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
      const { id, name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order } = input;
      if (!name?.trim()) return { error: 'name is required' };
      const { rows } = await pool.query(`
        UPDATE mcogs_categories
        SET name=$1, group_id=$2, for_ingredients=$3, for_recipes=$4, for_sales_items=$5, sort_order=$6, updated_at=NOW()
        WHERE id=$7 RETURNING id, name, group_id, for_ingredients, for_recipes, for_sales_items, sort_order
      `, [name.trim(), group_id || null, for_ingredients || false, for_recipes || false, for_sales_items || false, sort_order ?? 0, id]);
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
        `Auto-generated by Pepper — target revenue: ${total_revenue}`,
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

    // ── GitHub ─────────────────────────────────────────────────────────────────

    case 'github_list_files': {
      try {
        return await github.listFiles({ path: input.path, ref: input.ref, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_read_file': {
      try {
        return await github.readFile({ path: input.path, ref: input.ref, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_search_code': {
      try {
        return await github.searchCode({ query: input.query, max_results: input.max_results, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_create_or_update_file': {
      const { path, content, message, branch, sha, repo } = input;
      if (!branch) return { error: 'branch is required' };
      if (/^(main|master)$/i.test(branch.trim())) {
        return { error: 'Direct writes to main/master are not permitted — please use a feature branch.' };
      }
      try {
        return await github.createOrUpdateFile({ path, content, message, branch, sha, repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_create_branch': {
      try {
        return await github.createBranch({ branch: input.branch, from_branch: input.from_branch, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_list_prs': {
      try {
        return await github.listPRs({ state: input.state, max_results: input.max_results, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_get_pr_diff': {
      try {
        return await github.getPRDiff({ pr_number: input.pr_number, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'github_create_pr': {
      try {
        return await github.createPR({ title: input.title, body: input.body, head: input.head, base: input.base, repo: input.repo });
      } catch (err) {
        return { error: err.message };
      }
    }

    // ── Excel Export ───────────────────────────────────────────────────────────

    case 'export_to_excel': {
      try {
        const { dataset = 'full_export', country_id, filename: customFilename } = input;
        const allowedCountries = userCtx.allowedCountries ?? null; // null = unrestricted

        // Validate requested country is within scope
        if (country_id && allowedCountries && !allowedCountries.includes(Number(country_id))) {
          return { error: `You do not have access to country ID ${country_id}.` };
        }

        // Effective country filter: specific country > user scope > all
        const countryFilter = country_id ? [Number(country_id)] : allowedCountries;

        const wb     = XLSX.utils.book_new();
        const sheets = [];
        let totalRows = 0;

        function addSheet(sheetName, rows) {
          if (!rows.length) return;
          const ws = XLSX.utils.json_to_sheet(rows);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          sheets.push(sheetName);
          totalRows += rows.length;
        }

        // ── Ingredients ──────────────────────────────────────────────────────
        if (dataset === 'ingredients' || dataset === 'full_export') {
          const { rows } = await pool.query(`
            SELECT
              i.name                             AS "Ingredient",
              i.category                         AS "Category",
              u.name                             AS "Base Unit",
              u.abbreviation                     AS "Unit Abbr",
              i.waste_pct                        AS "Waste %",
              i.default_prep_unit                AS "Prep Unit",
              i.default_prep_to_base_conversion  AS "Prep→Base Conv.",
              i.notes                            AS "Notes"
            FROM mcogs_ingredients i
            LEFT JOIN mcogs_units u ON u.id = i.base_unit_id
            ORDER BY i.category, i.name
          `);
          addSheet('Ingredients', rows);
        }

        // ── Price Quotes ─────────────────────────────────────────────────────
        if (dataset === 'price_quotes' || dataset === 'full_export') {
          const params = [];
          let whereClause = 'WHERE pq.is_active = true';
          if (countryFilter) {
            params.push(countryFilter);
            whereClause += ` AND v.country_id = ANY($${params.length})`;
          }
          const { rows } = await pool.query(`
            SELECT
              i.name                                             AS "Ingredient",
              v.name                                             AS "Vendor",
              c.name                                             AS "Market",
              c.currency_symbol                                  AS "Currency",
              pq.purchase_price                                  AS "Purchase Price",
              pq.qty_in_base_units                               AS "Qty in Base Units",
              pq.purchase_unit                                   AS "Purchase Unit",
              pq.vendor_product_code                             AS "Product Code",
              CASE WHEN pv.quote_id = pq.id THEN 'Yes' ELSE 'No' END AS "Preferred"
            FROM mcogs_price_quotes pq
            JOIN mcogs_ingredients i   ON i.id  = pq.ingredient_id
            JOIN mcogs_vendors v       ON v.id  = pq.vendor_id
            LEFT JOIN mcogs_countries c ON c.id = v.country_id
            LEFT JOIN mcogs_ingredient_preferred_vendor pv
              ON  pv.ingredient_id = pq.ingredient_id
              AND pv.country_id    = v.country_id
              AND pv.quote_id      = pq.id
            ${whereClause}
            ORDER BY i.name, c.name, v.name
          `, params);
          addSheet('Price Quotes', rows);
        }

        // ── Recipes ──────────────────────────────────────────────────────────
        if (dataset === 'recipes' || dataset === 'full_export') {
          const { rows } = await pool.query(`
            SELECT
              r.name                          AS "Recipe",
              cat.name                        AS "Category",
              ri.item_type                    AS "Item Type",
              COALESCE(i.name, sr.name)       AS "Item Name",
              ri.prep_qty                     AS "Qty",
              ri.prep_unit                    AS "Unit"
            FROM mcogs_recipe_items ri
            JOIN mcogs_recipes r            ON r.id   = ri.recipe_id
            LEFT JOIN mcogs_categories cat  ON cat.id = r.category_id
            LEFT JOIN mcogs_ingredients i   ON i.id   = ri.ingredient_id
            LEFT JOIN mcogs_recipes sr      ON sr.id  = ri.recipe_item_id
            ORDER BY r.name, ri.id
          `);
          addSheet('Recipes', rows);
        }

        // ── Menus ────────────────────────────────────────────────────────────
        if (dataset === 'menus' || dataset === 'full_export') {
          const params = [];
          let whereClause = '';
          if (countryFilter) {
            params.push(countryFilter);
            whereClause = `WHERE m.country_id = ANY($${params.length})`;
          }
          const { rows } = await pool.query(`
            SELECT
              m.name                              AS "Menu",
              c.name                              AS "Market",
              mi.display_name                     AS "Item Name",
              COALESCE(r.name, ing.name)          AS "Recipe/Ingredient",
              pl.name                             AS "Price Level",
              mip.sell_price                      AS "Sell Price (USD)"
            FROM mcogs_menus m
            JOIN mcogs_countries c        ON c.id  = m.country_id
            JOIN mcogs_menu_items mi      ON mi.menu_id = m.id
            LEFT JOIN mcogs_recipes r     ON r.id  = mi.recipe_id
            LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
            LEFT JOIN mcogs_menu_item_prices mip ON mip.menu_item_id = mi.id
            LEFT JOIN mcogs_price_levels pl  ON pl.id = mip.price_level_id
            ${whereClause}
            ORDER BY m.name, mi.sort_order, pl.name
          `, params);
          addSheet('Menus', rows);
        }

        if (!sheets.length) {
          return { error: 'No data found to export for the requested dataset and market scope.' };
        }

        // Generate Excel buffer and base64-encode it
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const base64 = buffer.toString('base64');

        // Build filename
        const date  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const fname = customFilename ? `${customFilename}.xlsx` : `cogs-export-${dataset}-${date}.xlsx`;

        // Emit download event through the SSE stream so the browser can save the file
        if (send) {
          send({
            type:     'download',
            filename: fname,
            base64,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
        }

        return { ok: true, filename: fname, sheets, total_rows: totalRows };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'save_to_media_library': {
      try {
        const { url, filename, category_id, form_key } = input;
        if (!url) return { error: 'url is required' };
        const safeName = filename || url.split('/').pop()?.split('?')[0] || 'image.jpg';
        const { rows } = await pool.query(
          `INSERT INTO mcogs_media_items (filename, original_filename, url, thumb_url, web_url, storage_type, mime_type, size_bytes, scope, form_key, category_id, uploaded_by)
           VALUES ($1,$2,$3,$3,$3,'external','image/jpeg',0,$4,$5,$6,$7)
           RETURNING id, filename, url, thumb_url, web_url, scope, category_id, created_at`,
          [safeName, safeName, url, form_key ? 'form' : 'shared', form_key || null, category_id || null, userCtx?.sub || null]
        );
        return { saved: true, item: rows[0], message: `Saved "${safeName}" to the media library (id: ${rows[0].id})` };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'list_media_library': {
      try {
        const { q, category_id, form_key } = input;
        const conds = [], vals = [];
        if (q) { vals.push(`%${q.toLowerCase()}%`); conds.push(`LOWER(m.filename) LIKE $${vals.length}`); }
        if (category_id) { vals.push(Number(category_id)); conds.push(`m.category_id = $${vals.length}`); }
        if (form_key) { vals.push(form_key); conds.push(`m.form_key = $${vals.length}`); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool.query(
          `SELECT m.id, m.filename, m.url, m.thumb_url, m.web_url, m.scope, m.form_key,
                  m.size_bytes, m.width, m.height, m.created_at, c.name AS category_name
           FROM mcogs_media_items m
           LEFT JOIN mcogs_media_categories c ON c.id = m.category_id
           ${where} ORDER BY m.created_at DESC LIMIT 50`,
          vals
        );
        return { count: rows.length, items: rows };
      } catch (err) {
        return { error: err.message };
      }
    }

    // ── Memory tools ──────────────────────────────────────────────────────────

    case 'save_memory_note': {
      const { note } = input;
      if (!note?.trim()) return 'Error: note text is required';
      const sub = userCtx.sub;
      if (!sub) return 'Error: user context unavailable';
      try {
        const { rows: [created] } = await pool.query(
          'INSERT INTO mcogs_user_notes (user_sub, note) VALUES ($1, $2) RETURNING id, note, created_at',
          [sub, note.trim()]
        );
        return `Saved note #${created.id}: "${created.note}"`;
      } catch (err) {
        return `Error saving note: ${err.message}`;
      }
    }
    case 'list_memory_notes': {
      const sub = userCtx.sub;
      if (!sub) return 'Error: user context unavailable';
      try {
        const { rows } = await pool.query(
          'SELECT id, note, created_at FROM mcogs_user_notes WHERE user_sub = $1 ORDER BY created_at ASC',
          [sub]
        );
        if (!rows.length) return 'No pinned notes found.';
        return rows.map(n => `#${n.id}: "${n.note}" (saved ${new Date(n.created_at).toLocaleDateString()})`).join('\n');
      } catch (err) {
        return `Error listing notes: ${err.message}`;
      }
    }
    case 'delete_memory_note': {
      const { note_id } = input;
      const sub = userCtx.sub;
      if (!sub) return 'Error: user context unavailable';
      try {
        const { rowCount } = await pool.query(
          'DELETE FROM mcogs_user_notes WHERE id = $1 AND user_sub = $2',
          [note_id, sub]
        );
        return rowCount ? `Deleted note #${note_id}` : `Note #${note_id} not found`;
      } catch (err) {
        return `Error deleting note: ${err.message}`;
      }
    }

    // ── Audit Log ───────────────────────────────────────────────────────────────

    case 'query_audit_log': {
      const { entity_type, entity_id, user_email, action, from, to, search, limit } = input;
      const conditions = [], params = [];
      let idx = 1;
      if (entity_type) { conditions.push(`entity_type = $${idx++}`); params.push(entity_type); }
      if (entity_id)   { conditions.push(`entity_id = $${idx++}`);   params.push(entity_id); }
      if (user_email)  { conditions.push(`user_email ILIKE $${idx++}`); params.push(`%${user_email}%`); }
      if (action)      { conditions.push(`action = $${idx++}`);       params.push(action); }
      if (from)        { conditions.push(`created_at >= $${idx++}`);  params.push(from); }
      if (to)          { conditions.push(`created_at < ($${idx++})::date + 1`); params.push(to); }
      if (search)      { conditions.push(`entity_label ILIKE '%' || $${idx++} || '%'`); params.push(search); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const cap = Math.min(limit || 20, 50);
      const { rows } = await pool.query(`
        SELECT id, action, entity_type, entity_id, entity_label,
               user_email, user_name, field_changes, context, created_at
        FROM   mcogs_audit_log ${where}
        ORDER BY created_at DESC LIMIT $${idx}
      `, [...params, cap]);
      return { count: rows.length, entries: rows };
    }

    case 'get_entity_audit_history': {
      const { entity_type, entity_id } = input;
      const { rows } = await pool.query(`
        SELECT id, action, entity_label, user_email, user_name,
               field_changes, context, related_entities, created_at
        FROM   mcogs_audit_log
        WHERE  entity_type = $1 AND entity_id = $2
        ORDER BY created_at ASC
      `, [entity_type, entity_id]);
      return { entity_type, entity_id, history: rows };
    }

    case 'search_faq': {
      const { query, category } = input;
      const conditions = ['is_published = TRUE'];
      const faqParams = [];
      let fi = 1;
      conditions.push(`(question ILIKE '%' || $${fi} || '%' OR answer ILIKE '%' || $${fi} || '%' OR tags::text ILIKE '%' || $${fi} || '%')`);
      faqParams.push(query);
      fi++;
      if (category) { conditions.push(`category = $${fi++}`); faqParams.push(category); }
      const { rows } = await pool.query(`
        SELECT id, question, answer, category
        FROM   mcogs_faq
        WHERE  ${conditions.join(' AND ')}
        ORDER BY sort_order, id LIMIT 5
      `, faqParams);
      if (!rows.length) return { message: 'No FAQ entries found matching that query. Try different keywords or answer from your own knowledge.' };
      return { count: rows.length, results: rows };
    }

    case 'get_changelog': {
      const { version, limit } = input;
      if (version) {
        const { rows } = await pool.query(
          'SELECT * FROM mcogs_changelog WHERE version = $1 ORDER BY id', [version]
        );
        return rows.length ? rows : { message: `No changelog entry for version ${version}` };
      }
      const cap = Math.min(limit || 5, 20);
      const { rows } = await pool.query(
        'SELECT * FROM mcogs_changelog ORDER BY version DESC, id DESC LIMIT $1', [cap]
      );
      return { count: rows.length, entries: rows };
    }

    case 'list_audits': {
      const { audit_type, status, location_id, limit } = input;
      const where = [], params = [];
      if (audit_type)  { params.push(audit_type);   where.push(`a.audit_type = $${params.length}`); }
      if (status)      { params.push(status);       where.push(`a.status = $${params.length}`); }
      if (location_id) { params.push(location_id);  where.push(`a.location_id = $${params.length}`); }
      params.push(Math.min(limit || 20, 100));
      const { rows } = await pool.query(
        `SELECT a.id, a.key, a.audit_type, a.status, a.overall_score, a.overall_rating,
                a.auto_unacceptable, a.started_at, a.completed_at, a.auditor_name,
                l.name AS location_name
         FROM   mcogs_qsc_audits a
         LEFT JOIN mcogs_locations l ON l.id = a.location_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER  BY a.started_at DESC LIMIT $${params.length}`,
        params
      );
      return { count: rows.length, audits: rows };
    }

    case 'get_audit_report': {
      const { audit_id, audit_key } = input;
      if (!audit_id && !audit_key) return { error: 'Provide audit_id or audit_key' };
      const audit = await pool.query(
        audit_id
          ? `SELECT a.*, l.name AS location_name FROM mcogs_qsc_audits a LEFT JOIN mcogs_locations l ON l.id = a.location_id WHERE a.id = $1`
          : `SELECT a.*, l.name AS location_name FROM mcogs_qsc_audits a LEFT JOIN mcogs_locations l ON l.id = a.location_id WHERE a.key = $1`,
        [audit_id || audit_key]
      );
      if (!audit.rows.length) return { error: 'Audit not found' };
      const a = audit.rows[0];
      const nc = await pool.query(
        `SELECT r.question_code, r.comment, r.points_deducted, r.is_repeat,
                q.title, q.risk_level, q.department, q.category
         FROM   mcogs_qsc_responses r
         JOIN   mcogs_qsc_questions q ON q.code = r.question_code AND q.version = $2
         WHERE  r.audit_id = $1 AND r.status = 'not_compliant'
         ORDER  BY q.sort_order`,
        [a.id, a.question_version]
      );
      return {
        audit: {
          key: a.key, type: a.audit_type, status: a.status,
          location: a.location_name, auditor: a.auditor_name,
          started_at: a.started_at, completed_at: a.completed_at,
          overall_score: a.overall_score, overall_rating: a.overall_rating,
          auto_unacceptable: a.auto_unacceptable, notes: a.notes,
        },
        non_compliant_count: nc.rows.length,
        non_compliant:       nc.rows,
      };
    }

    case 'list_qsc_questions': {
      const { department, category, risk_level, search, limit } = input;
      const where = ['active = TRUE'];
      const params = [];
      if (department) { params.push(department);                         where.push(`department = $${params.length}`); }
      if (category)   { params.push(category);                           where.push(`category = $${params.length}`); }
      if (risk_level) { params.push(risk_level);                         where.push(`risk_level = $${params.length}`); }
      if (search)     {
        params.push(`%${search}%`);
        where.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length})`);
      }
      params.push(Math.min(limit || 25, 100));
      const { rows } = await pool.query(
        `SELECT code, department, category, title, risk_level, points, repeat_points,
                auto_unacceptable, photo_required, temperature_input
         FROM   mcogs_qsc_questions
         WHERE  ${where.join(' AND ')}
         ORDER  BY sort_order LIMIT $${params.length}`,
        params
      );
      return { count: rows.length, questions: rows };
    }

    case 'get_qsc_question': {
      const { code } = input;
      if (!code) return { error: 'code is required' };
      const { rows } = await pool.query(
        `SELECT * FROM mcogs_qsc_questions WHERE code = $1 AND active = TRUE ORDER BY version DESC LIMIT 1`,
        [code]
      );
      if (!rows.length) return { error: `Question ${code} not found` };
      return rows[0];
    }

    case 'list_audit_templates': {
      const { rows } = await pool.query(
        `SELECT id, name, description, is_system, question_codes,
                jsonb_array_length(question_codes) AS question_count
         FROM   mcogs_qsc_templates
         ORDER  BY is_system DESC, name`
      );
      return { count: rows.length, templates: rows };
    }

    case 'get_audit_nc_trends': {
      const { location_id, audit_type, from, to, limit } = input;
      const where = [`a.status = 'completed'`, `r.status = 'not_compliant'`];
      const params = [];
      if (location_id) { params.push(location_id); where.push(`a.location_id = $${params.length}`); }
      if (audit_type)  { params.push(audit_type);  where.push(`a.audit_type = $${params.length}`); }
      if (from)        { params.push(from);        where.push(`a.completed_at >= $${params.length}`); }
      if (to)          { params.push(to);          where.push(`a.completed_at < ($${params.length})::date + 1`); }
      params.push(Math.min(limit || 20, 50));
      const { rows } = await pool.query(
        `SELECT r.question_code,
                q.title, q.risk_level, q.department, q.category,
                COUNT(*)::int AS nc_count,
                SUM(r.points_deducted)::int AS total_points_deducted,
                COUNT(*) FILTER (WHERE r.is_repeat)::int AS repeat_count
         FROM   mcogs_qsc_responses r
         JOIN   mcogs_qsc_audits    a ON a.id   = r.audit_id
         JOIN   mcogs_qsc_questions q ON q.code = r.question_code AND q.version = a.question_version
         WHERE  ${where.join(' AND ')}
         GROUP  BY r.question_code, q.title, q.risk_level, q.department, q.category
         ORDER  BY nc_count DESC, total_points_deducted DESC
         LIMIT $${params.length}`,
        params
      );
      // Also return how many audits were in the filter window for denominator context
      const denomWhere = where.filter(w => !w.includes('r.status'));
      const denomParams = params.slice(0, params.length - 1);
      const denom = await pool.query(
        `SELECT COUNT(DISTINCT a.id)::int AS audit_count
         FROM   mcogs_qsc_audits a
         ${denomWhere.length ? 'WHERE ' + denomWhere.join(' AND ').replace(/r\.status = 'not_compliant' AND /, '') : ''}`,
        denomParams
      );
      return {
        audit_count: denom.rows[0]?.audit_count ?? 0,
        trend_count: rows.length,
        trends:      rows,
      };
    }

    case 'get_location_audit_history': {
      const { location_id, limit } = input;
      if (!location_id) return { error: 'location_id is required' };
      const cap = Math.min(limit || 10, 50);
      const { rows } = await pool.query(
        `SELECT a.id, a.key, a.audit_type, a.status,
                a.started_at, a.completed_at,
                a.overall_score, a.overall_rating, a.auto_unacceptable,
                a.auditor_name,
                (SELECT COUNT(*)::int FROM mcogs_qsc_responses WHERE audit_id = a.id AND status = 'not_compliant') AS nc_count
         FROM   mcogs_qsc_audits a
         WHERE  a.location_id = $1
         ORDER  BY COALESCE(a.completed_at, a.started_at) DESC
         LIMIT  $2`,
        [location_id, cap]
      );
      const completed = rows.filter(r => r.status === 'completed' && r.overall_score != null);
      const avg = completed.length
        ? Math.round((completed.reduce((s, r) => s + Number(r.overall_score), 0) / completed.length) * 10) / 10
        : null;
      const ratingDist = completed.reduce((acc, r) => {
        acc[r.overall_rating || 'Unknown'] = (acc[r.overall_rating || 'Unknown'] || 0) + 1;
        return acc;
      }, {});
      return {
        location_id,
        audit_count:          rows.length,
        completed_count:      completed.length,
        average_score:        avg,
        rating_distribution:  ratingDist,
        audits:               rows,
      };
    }

    case 'get_audit_stats': {
      const { from, to } = input;
      const conditions = [], params = [];
      let idx = 1;
      if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
      if (to)   { conditions.push(`created_at < ($${idx++})::date + 1`); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [totRes, byRes, usrRes] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM mcogs_audit_log ${where}`, params),
        pool.query(`SELECT action, entity_type, COUNT(*)::int AS count FROM mcogs_audit_log ${where} GROUP BY action, entity_type ORDER BY count DESC`, params),
        pool.query(`SELECT user_email, user_name, COUNT(*)::int AS action_count, MAX(created_at) AS last_action FROM mcogs_audit_log ${where} GROUP BY user_email, user_name ORDER BY action_count DESC LIMIT 10`, params),
      ]);
      return { total: totRes.rows[0].total, by_action_entity: byRes.rows, top_users: usrRes.rows };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

async function buildSystemPrompt(context, helpContext, conciseMode = false, is_dev = false, userLanguage = 'en') {
  const page = context?.currentPage || 'unknown';

  // ── Language directive ───────────────────────────────────────────────────
  // When the user has a non-English preference, instruct Pepper to respond in
  // that language. Tool results will still come back in the resolved language
  // (via the COALESCE pattern in route handlers); Pepper reads them and
  // naturally re-uses those translated strings in its prose.
  let languageBlock = '';
  if (userLanguage && userLanguage !== 'en') {
    const languageNames = {
      fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', nl: 'Dutch',
      pl: 'Polish', pt: 'Portuguese', hi: 'Hindi',
    };
    const name = languageNames[userLanguage] || userLanguage;
    languageBlock = `\n\n## User Language\nThe user's preferred language is ${name} (${userLanguage}). Respond to the user in ${name}. When you present data (ingredient names, recipe names, categories, etc.) use the translations returned by the tools — do not re-translate them yourself. Keep keyboard shortcuts, feature names like "Dashboard" / "Pepper" / URLs, and SQL/technical identifiers in English where appropriate.\n`;
  }

  // ── Memory context (pinned notes + profile) ──────────────────────────────
  let memoryBlock = '';
  try {
    const userSub = context?.userSub;
    if (userSub) {
      const [notesRes, profileRes, dailyRes, lastChatRes] = await Promise.all([
        pool.query(
          'SELECT note, created_at FROM mcogs_user_notes WHERE user_sub = $1 ORDER BY created_at ASC',
          [userSub]
        ),
        pool.query(
          'SELECT display_name, profile_json, long_term_summary FROM mcogs_user_profiles WHERE user_sub = $1',
          [userSub]
        ),
        pool.query(
          'SELECT summary_date, summary FROM mcogs_memory_daily WHERE user_sub = $1 ORDER BY summary_date DESC LIMIT 3',
          [userSub]
        ),
        pool.query(
          'SELECT created_at FROM mcogs_ai_chat_log WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 1 OFFSET 1',
          [userSub]
        ),
      ]);
      const notes   = notesRes.rows;
      const profile = profileRes.rows[0];
      const dailySummaries = dailyRes.rows;
      const prevChat = lastChatRes.rows[0];

      if (notes.length || profile || dailySummaries.length) {
        memoryBlock = '\n\n## Memory\n';

        if (profile?.display_name) {
          memoryBlock += `The user\'s preferred name is "${profile.display_name}".\n`;
        }
        if (profile?.long_term_summary) {
          memoryBlock += `\nUser summary: ${profile.long_term_summary}\n`;
        }
        if (profile?.profile_json && typeof profile.profile_json === 'object' && Object.keys(profile.profile_json).length > 0) {
          const pj = profile.profile_json;
          if (pj.primary_markets) memoryBlock += `Primary markets: ${Array.isArray(pj.primary_markets) ? pj.primary_markets.join(', ') : pj.primary_markets}.\n`;
          if (pj.response_preference) memoryBlock += `Response preference: ${pj.response_preference}.\n`;
          if (pj.recurring_focus) memoryBlock += `Recurring focus areas: ${Array.isArray(pj.recurring_focus) ? pj.recurring_focus.join(', ') : pj.recurring_focus}.\n`;
        }

        if (notes.length) {
          memoryBlock += '\nPinned notes (the user asked Pepper to remember these):\n';
          for (const n of notes) {
            memoryBlock += `- ${n.note}\n`;
          }
        }

        // Recent daily summaries (from nightly consolidation job)
        if (dailySummaries.length) {
          memoryBlock += '\nRecent conversation summaries:\n';
          for (const d of dailySummaries) {
            memoryBlock += `- ${d.summary_date}: ${d.summary}\n`;
          }
        }

        // Activity digest — changes since last conversation
        if (prevChat?.created_at) {
          try {
            const { rows: recentAudit } = await pool.query(`
              SELECT entity_type, action, entity_label
              FROM   mcogs_audit_log
              WHERE  created_at > $1
              ORDER BY created_at DESC LIMIT 10
            `, [prevChat.created_at]);
            if (recentAudit.length) {
              memoryBlock += '\nChanges since your last conversation:\n';
              for (const a of recentAudit) {
                memoryBlock += `- ${a.action} ${a.entity_type}: ${a.entity_label || '(unnamed)'}\n`;
              }
            }
          } catch { /* non-critical — skip activity digest */ }
        }
      }
    }
  } catch (err) {
    console.error('[memory] Failed to load memory context:', err.message);
    // Graceful degradation — chat works without memory
  }

  return `You are Pepper — an AI assistant embedded in the COGS Manager platform, a tool for restaurant franchise operators to manage menu cost-of-goods (COGS).

Your name is Pepper. When users greet you or ask your name, introduce yourself as Pepper.
${languageBlock}${memoryBlock}
## Memory Tools

You have persistent memory across conversations via pinned notes. When the user says things like:
- "Remember that I always want prices in GBP"
- "Note that our UK supplier is Farm Fresh"
- "Always use concise format for reports"

Call the save_memory_note tool to save this as a pinned note. These notes are loaded into every future conversation.

When the user asks "what do you remember?" or "show my notes", call list_memory_notes.
When the user asks to forget something, call delete_memory_note.

Your pinned notes (if any) are shown in the Memory section above. Use them to personalize your responses.

## CRITICAL: ACCURACY RULES
- NEVER invent page names, tab names, feature names, or field names that are not explicitly documented in your context or the sections below.
- If you are unsure whether a feature exists, say so — do not guess or hallucinate UI elements.
- The authoritative list of pages, tabs, and features is in this system prompt and the retrieved documentation context. Treat it as ground truth over any prior training knowledge about this app.

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

## PRICE QUOTE & PREFERRED VENDOR MODEL
An ingredient can have MULTIPLE price quotes — from different vendors, at different prices, in different purchase units.
- Each quote links: ingredient → vendor (vendors are country-specific, so quotes are implicitly market-scoped)
- Multiple quotes per ingredient per market are normal (competing suppliers at different prices)
- is_active flag: only active quotes count toward COGS calculations and coverage % metrics
- preferred_vendor: ONE preferred vendor per ingredient×country — this is the quote used for COGS
- If no preferred vendor is set: system falls back to the lowest active quote for that ingredient in that market
- A single ingredient commonly has quotes in multiple markets: UK (GBP via Vendor A), France (EUR via Vendor B), Germany (EUR via Vendor C)

To price an ingredient in a new market:
1. list_vendors — find a vendor in that country, or create_vendor for that country first
2. create_price_quote — link ingredient_id + vendor_id + purchase_price + qty_in_base_units
3. set_preferred_vendor — designate which quote to use for COGS in that market (ingredient_id + country_id + vendor_id + quote_id)

When users ask "why is COGS £0 for this ingredient?", the answer is almost always: no preferred vendor set, or no active price quote exists in that market.

## ALLERGEN NOTES
Both ingredients and menu items have an allergen_notes TEXT field for free-text allergen information.
- Ingredient allergen notes: stored on mcogs_ingredients.allergen_notes — editable in Inventory → Allergens matrix
- Menu item allergen notes: stored on mcogs_menu_items.allergen_notes — editable in Allergens → Menu matrix
- These are in addition to the structured C/M/F (Contains/May Contain/Free From) allergen status per allergen
- Use these for notes like "sourced from allergen-controlled facility", "contains due to shared fryer", or customer-facing advisory text

## CONTEXTUAL HELP (right-click Ask Pepper)
Users can right-click on data cells in the UI to get contextual explanations. When you receive a question like "Explain a COGS% of X for item Y on menu Z", the user right-clicked that specific cell. Answer directly — explain the number, whether it is good or bad relative to industry norms (20–35% is typical), what drives it, and what levers exist to improve it.

## PAGE SCREENSHOTS
Users may attach a screenshot of the current page to their message (via the camera icon in the chat, or via right-click Ask Pepper which auto-captures). When an image is provided, use it to understand exactly what the user is looking at before answering. Reference specific values or UI elements visible in the screenshot when relevant.

## PANEL MODES
Pepper can be displayed as a floating popup (bottom-right), docked to the left side, or docked to the right side of the screen. The mode toggle is in the Pepper panel header — three icons: dock-left, float, dock-right. Mode is persisted per browser in localStorage under the key "pepper-mode".

## WORKFLOW
1. Always call list_* tools first to resolve names → IDs before any write operation. Never guess IDs.
2. To add an ingredient to a recipe: list_ingredients → get ID → add_recipe_item
3. To set a preferred vendor: list_vendors + list_price_quotes → set_preferred_vendor
4. For new ingredients/recipes without a category: call list_categories (with for_ingredients=true or for_recipes=true) first to pick an existing one, or call create_category to make a new one, then pass category_id

## FILE UPLOADS (when images or CSV text is provided)
- CSV: parse all rows, summarise the full import plan (count, fields, sample rows), confirm once, then create records
- Image (invoice / label / recipe card / screenshot): describe all fields you can read, confirm extraction, then create records
- Never create records from a file without user confirmation

## MENU ENGINEER (SCENARIO) TOOLS
Use these to help users model pricing changes, hit COGS targets, and save/push scenarios.

### Workflow for scenario changes:
1. get_scenario_analysis(menu_id) — get all items with costs, prices, tax rates, COGS% per level
2. Compute new values (all in USD):
   - **% price change**: new_price = base_price_usd * (1 + pct/100)
   - **Target COGS%**: price_gross_usd = (effective_cost_usd / target_cogs_decimal) * (1 + tax_rate)
   - **% cost change**: new_cost = base_cost_usd * (1 + pct/100)
   - **Filter by category**: match item.category (case-insensitive contains)
3. save_scenario(name, menu_id, price_overrides, cost_overrides, note) — save with computed values
4. Optionally push_scenario_prices(scenario_id) — make prices live (confirm first, warns user it's permanent)

### Key fields from get_scenario_analysis:
- item.cost_override_key = item.nat_key e.g. "r_5" — key for cost_overrides
- item.per_level[].price_override_key e.g. "42_l1" — key for price_overrides
- item.per_level[].tax_rate — decimal tax rate for that level (use in target COGS formula)
- item.per_level[].base_price_usd — current price before any override
- item.effective_cost_usd — current cost (with any cost override applied)

### Example — "raise Wings prices by 10% across all levels":
- Filter items where category contains "wing"
- For each such item, for each level: new_price = base_price_usd * 1.10
- Build price_overrides: { [price_override_key]: new_price, ... }
- save_scenario with note "Wings prices +10%"

### Example — "set Wings to 25% COGS":
- Filter Wing items, for each level: price_gross = (effective_cost_usd / 0.25) * (1 + tax_rate)
- save_scenario with the computed price_overrides

## MENUS PAGE TABS
The Menus page (/menus) has exactly FOUR tabs. Never invent tab names. The four tabs are:

**Menu Builder** — Create and manage menus (each linked to a market/country). Add items (recipes or ingredients) with a display name and sort order. Items are grouped by category. This is where you define what is on the menu.

**Menu Engineer** — Sales mix and profitability analysis. The Mix Manager button opens a modal to enter expected sales quantities per item. Shows cost per portion, sell price, and contribution margin per item. Categories are collapsible. Cross-tab sync: selecting a menu here also selects it in Menu Builder and vice versa.

**Shared Links** — Create and manage password-protected public links for external reviewers. Recipients can view the pricing grid (view mode) or edit sell prices (edit mode). Each link can be pinned to a specific scenario and given an expiry date.

There is NO "Compare Markets" tab, NO "Market Price Tool" tab, NO "PLT" tab, NO "MPT" tab, NO "Scenario" tab (it was renamed to Menu Engineer), and no other tabs on this page.

## SETTINGS PAGE TABS
The Settings page has these tabs — users sometimes ask what they do:

**Units** — manage measurement units (kg, litre, each, etc.) used across ingredients and recipes.

**Price Levels** — manage sell price tiers (e.g. Eat-in, Takeaway, Delivery). Each menu item can have a different price per level.

**Exchange Rates** — view and sync live currency exchange rates (via Frankfurter API, no key needed). All prices stored in USD base; rates are used to display in local currency.

**COGS Thresholds** — configure the green/amber/red colour thresholds for COGS% display. "Excellent" (green) and "Acceptable" (amber) percentages are set here; above acceptable = red.

**Test Data** (System → Database section, visible to dev users only) — developer/demo tool to populate the database with realistic dummy data. Four actions:
- "Load Test Data" — wipes ALL existing data, then inserts 1,000 ingredients, 500 quotes, 48 recipes, 4 menus, 10 vendors, 4 countries. Requires typing today's date (ddmmyyyy format) to confirm.
- "Load Small Data" — same but 200 ingredients (faster, for development). Also requires date confirmation.
- "Clear Database" — permanently removes ALL rows from every table. Schema is preserved. Requires date confirmation.
- "Load Default Data" — safe to run after Clear Database; adds a minimal production-ready starting point (1 market/UK, 3 units, 6 categories, 1 price level, 1 vendor, UK VAT rates). Does NOT wipe existing data.
Warning users: these operations cannot be undone and will delete real data. Only use Test Data on a demo or dev account. The Test Data section is only visible to users with the dev flag enabled (Settings → Users → </> button).${is_dev ? '\nThe current user HAS the dev flag — they can access System → Database → Test Data.' : ''}

**AI** — configure API keys (Anthropic for Pepper, Voyage for semantic search, Brave for web search), toggle Concise Mode, and generate a Claude Code integration key.

**Import** — embeds the full AI Import Wizard (same as the /import page). A 5-step wizard: Upload file → Review extracted data → Map categories → Map vendors → Execute. Supports CSV, XLSX, XLSB. Use this to bulk-import ingredients, price quotes, recipes, and menus from a spreadsheet.

## TOOLS AVAILABLE
You have 97 tools covering: dashboard stats, ingredients, vendors, price quotes, preferred vendors, recipes, recipe items, menus, menu items, menu item prices, categories (full CRUD), units, price levels (full CRUD), tax rates (full CRUD), markets (full CRUD), brand partners (full CRUD + assign), settings (read/update), HACCP equipment + temp logs + CCP logs, locations + location groups, allergens (list/read/write/menu matrix), feedback (submit/read/update status/delete), **start_import**, **search_web** (only when explicitly asked), **Menu Engineer** (list_scenarios, get_scenario_analysis, save_scenario, push_scenario_prices), **GitHub** (github_list_files, github_read_file, github_search_code, github_create_or_update_file, github_create_branch, github_list_prs, github_get_pr_diff, github_create_pr), **export_to_excel** (generates an Excel download filtered to the user's market scope), **Memory** (save_memory_note, list_memory_notes, delete_memory_note), **Audit Log** (query_audit_log, get_entity_audit_history, get_audit_stats), **FAQ** (search_faq — searches the FAQ knowledge base for how-to answers), and **Change Log** (get_changelog — project change history by version/date).

## GITHUB TOOLS
Use GitHub tools when the user asks to check code, view files, review PRs, or make code changes. The default repo is configured in Settings → AI → GitHub Repo.

### Rules for GitHub writes (MANDATORY):
- NEVER write directly to main or master — always use a feature branch
- Before github_create_or_update_file: state the file path, branch, and what you are changing — confirm with user
- Before github_create_pr: state the PR title, head→base direction — confirm with user
- Before github_create_branch: state the branch name — confirm with user
- For multi-file changes: create the branch once, then write each file one at a time

### Workflow for code changes:
1. github_read_file — read the current file to get its content AND sha
2. Modify the content as needed
3. github_create_branch (if branch doesn't exist yet) — CONFIRMATION REQUIRED
4. github_create_or_update_file — pass the sha from step 1 — CONFIRMATION REQUIRED
5. github_create_pr when all files are committed — CONFIRMATION REQUIRED

### Reading code:
- Use github_list_files to browse directories and find files
- Use github_search_code to locate code by keyword (function names, variable names, etc.)
- Use github_read_file to read a specific file — files over ~8,000 chars may be very long

## EXCEL EXPORT (export_to_excel tool)
Use export_to_excel when the user asks to "export", "download", "get a spreadsheet", or "export to Excel".
- Datasets: ingredients, price_quotes, recipes, menus, full_export (all four combined)
- The tool automatically filters to only the markets/countries the user is allowed to access
- The file downloads automatically in the user's browser; tell them it has been downloaded
- No confirmation required (read-only operation)

## BULK FILE IMPORT (start_import + list_import_jobs tools)
When the user uploads a spreadsheet/CSV with many rows AND wants to import it:
1. Call start_import with the file content text and filename.
2. It stages the data under the user's email and returns a job URL.
3. Reply: "I've staged your file for import. **[Open Import Wizard](/import?job=<id>)** to review [N] ingredients, [N] recipes etc. and commit."
4. Do NOT individually call create_ingredient/create_vendor etc. for bulk imports — use start_import.
5. Do NOT commit the staged data yourself. The user reviews and finishes the import manually in the wizard.

When the user asks "what imports do I have pending?", "any staged imports?", "can I resume an earlier import?":
- Call list_import_jobs (defaults to the current user's non-terminal jobs).
- Format the result as a short table: job id, filename, status, counts, clickable /import?job=<id> link.
- If the list is empty, say so plainly and suggest uploading a new file to start one.

## FEEDBACK TOOL RULES
- After calling submit_feedback, you MUST state the ticket ID from the tool result (e.g. "Ticket #15 logged"). Never confirm a ticket was submitted without seeing a successful tool result containing a valid id. If submit_feedback returns an error, tell the user it failed — do not claim success.
- Never hallucinate ticket deletion or status updates. Only delete_feedback and update_feedback_status can perform those actions — call the actual tool.
- CONFIRMATION REQUIRED before calling delete_feedback or update_feedback_status. State the ticket ID and what will change, then wait for explicit "yes" before calling.

Be concise and practical. For numbers include currency symbols and units. Format data as readable lists or tables where appropriate.

${conciseMode ? `## RESPONSE STYLE (concise mode ON)
- Give the direct answer only — no preamble, no narration of steps.
- Do NOT say things like "Let me check…", "I'll look that up…", "First I'll…", "Now I'll…", or "I've retrieved…".
- Call tools silently. When a tool returns data, summarise the result in the fewest words possible.
- Use bullet points or a short table for multi-item results. One sentence max per item.
- For write operations: one short confirmation sentence ("Creating X — shall I proceed?"), then execute on yes. No elaboration.
- Skip any closing remarks ("Let me know if you need anything else", "Hope that helps", etc.).
` : ''}
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

  // ── Monthly token allowance check ────────────────────────────────────────────
  const allowance = await checkTokenAllowance(userSub || req.user?.sub);
  if (!allowance.allowed) {
    const resetDate = allowance.nextReset
      ? new Date(allowance.nextReset).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
      : 'the 25th';
    return res.status(429).json({
      error: {
        message:   `Monthly token allowance of ${Number(allowance.limit).toLocaleString()} tokens reached. Resets on ${resetDate}.`,
        code:      'token_allowance_exceeded',
        resets_at: allowance.nextReset,
      },
    });
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // RAG — retrieve relevant help context
  const helpContext  = await rag.retrieve(message);

  // Read concise-mode setting
  let conciseMode = false;
  try {
    const { rows: sRows } = await pool.query(`SELECT data->>'ai_concise_mode' AS v FROM mcogs_settings WHERE id = 1`);
    conciseMode = sRows[0]?.v === 'true';
  } catch (_) {}

  // Inject userSub into context so buildSystemPrompt can load memory
  context.userSub = context.userSub || userSub || req.user?.sub;

  const systemPrompt = await buildSystemPrompt(context, helpContext, conciseMode, req.user?.is_dev || false, req.language || 'en');

  // Build messages array (enforce max 20 history items)
  const messages = [
    ...history.slice(-20),
    { role: 'user', content: message.trim() },
  ];

  // Bind user context (allowedCountries, etc.) into executeTool for this request
  // Inject req.language into userCtx so every tool executor that resolves
  // translatable fields can COALESCE via the user's preferred language.
  const userCtxWithLang = { ...(req.user || {}), language: req.language || 'en' };
  const boundExecuteTool = (name, input, send) => executeTool(name, input, send, userCtxWithLang);

  const { responseText, toolsCalled, tokensIn, tokensOut, errorMsg } =
    await agenticStream({ anthropic, systemPrompt, messages, tools: TOOLS, executeTool: boundExecuteTool, res });

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

// ── Billing period helpers ────────────────────────────────────────────────────
// Billing period runs from the 25th of each month to the 24th of the next.

function getBillingPeriodStart() {
  const now   = new Date();
  const start = new Date(now);
  if (now.getDate() >= 25) {
    start.setDate(25);
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setDate(25);
  }
  start.setHours(0, 0, 0, 0);
  return start;
}

function getNextResetDate() {
  const next = getBillingPeriodStart();
  next.setMonth(next.getMonth() + 1);
  return next;
}

// Returns { allowed, periodTokens, limit, nextReset }
// Fails open (allows request) if settings cannot be read.
async function checkTokenAllowance(userSub) {
  try {
    const { rows: sRows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`);
    const globalLimit = Number(sRows[0]?.data?.ai_monthly_token_limit) || 0;
    if (!globalLimit || !userSub) return { allowed: true, periodTokens: 0, limit: globalLimit, nextReset: null };

    const periodStart = getBillingPeriodStart();
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)), 0)::bigint AS total
      FROM   mcogs_ai_chat_log
      WHERE  user_sub = $1 AND created_at >= $2
    `, [userSub, periodStart.toISOString()]);

    const periodTokens = Number(rows[0]?.total || 0);
    const nextReset    = getNextResetDate();
    return { allowed: periodTokens < globalLimit, periodTokens, limit: globalLimit, nextReset };
  } catch {
    return { allowed: true, periodTokens: 0, limit: 0, nextReset: null }; // fail open
  }
}

// GET /ai-chat/my-usage — current billing period usage for the requesting user
router.get('/my-usage', async (req, res) => {
  try {
    const { rows: sRows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`);
    const globalLimit  = Number(sRows[0]?.data?.ai_monthly_token_limit) || 0;
    const periodStart  = getBillingPeriodStart();
    const nextReset    = getNextResetDate();
    const userSub      = req.user?.sub;

    let periodTokens = 0;
    if (userSub) {
      const { rows } = await pool.query(`
        SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)), 0)::bigint AS total
        FROM   mcogs_ai_chat_log
        WHERE  user_sub = $1 AND created_at >= $2
      `, [userSub, periodStart.toISOString()]);
      periodTokens = Number(rows[0]?.total || 0);
    }

    res.json({
      period_start:  periodStart.toISOString(),
      next_reset:    nextReset.toISOString(),
      period_tokens: periodTokens,
      limit:         globalLimit,
      remaining:     globalLimit > 0 ? Math.max(0, globalLimit - periodTokens) : null,
      exceeded:      globalLimit > 0 && periodTokens >= globalLimit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch usage' } });
  }
});

// ── Token Usage Report ────────────────────────────────────────────────────────
// Haiku 4.5 pricing (USD per 1M tokens, as of early 2026)
const COST_PER_M_IN  = 0.80;
const COST_PER_M_OUT = 4.00;

router.get('/usage', async (req, res) => {
  try {
    const periodStart = getBillingPeriodStart();

    const [totals, daily, byUser, settingsRow] = await Promise.all([
      // All-time totals
      pool.query(`
        SELECT
          COUNT(*)::int                              AS total_turns,
          COALESCE(SUM(tokens_in),  0)::bigint       AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0)::bigint       AS total_tokens_out,
          COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::int AS total_sessions,
          COUNT(DISTINCT user_email) FILTER (WHERE user_email IS NOT NULL)::int AS total_users,
          MIN(created_at)                            AS first_turn,
          MAX(created_at)                            AS last_turn
        FROM mcogs_ai_chat_log
      `),

      // Daily breakdown — last 30 days
      pool.query(`
        SELECT
          DATE(created_at AT TIME ZONE 'UTC')        AS day,
          COUNT(*)::int                              AS turns,
          COALESCE(SUM(tokens_in),  0)::bigint       AS tokens_in,
          COALESCE(SUM(tokens_out), 0)::bigint       AS tokens_out
        FROM mcogs_ai_chat_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `),

      // Per-user breakdown — top 20 by total tokens, including current billing period
      pool.query(`
        SELECT
          COALESCE(user_email, user_sub, 'unknown')  AS user_label,
          COUNT(*)::int                              AS turns,
          COALESCE(SUM(tokens_in),  0)::bigint       AS tokens_in,
          COALESCE(SUM(tokens_out), 0)::bigint       AS tokens_out,
          COALESCE(SUM(CASE WHEN created_at >= $1
            THEN COALESCE(tokens_in,0) + COALESCE(tokens_out,0) ELSE 0 END), 0)::bigint AS period_tokens,
          MAX(created_at)                            AS last_active
        FROM mcogs_ai_chat_log
        GROUP BY COALESCE(user_email, user_sub, 'unknown')
        ORDER BY (COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0)) DESC
        LIMIT 20
      `, [periodStart.toISOString()]),

      // Global monthly limit from settings
      pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`),
    ]);

    const t = totals.rows[0];
    const totalIn  = Number(t.total_tokens_in);
    const totalOut = Number(t.total_tokens_out);
    const totalCost = (totalIn / 1_000_000) * COST_PER_M_IN + (totalOut / 1_000_000) * COST_PER_M_OUT;

    res.json({
      summary: {
        total_turns:    t.total_turns,
        total_sessions: t.total_sessions,
        total_users:    t.total_users,
        tokens_in:      totalIn,
        tokens_out:     totalOut,
        tokens_total:   totalIn + totalOut,
        cost_usd:       Math.round(totalCost * 10000) / 10000,
        first_turn:     t.first_turn,
        last_turn:      t.last_turn,
      },
      daily: daily.rows.map(r => ({
        day:        r.day,
        turns:      r.turns,
        tokens_in:  Number(r.tokens_in),
        tokens_out: Number(r.tokens_out),
        cost_usd:   Math.round(((Number(r.tokens_in) / 1_000_000) * COST_PER_M_IN + (Number(r.tokens_out) / 1_000_000) * COST_PER_M_OUT) * 10000) / 10000,
      })),
      by_user: byUser.rows.map(r => ({
        user:          r.user_label,
        turns:         r.turns,
        tokens_in:     Number(r.tokens_in),
        tokens_out:    Number(r.tokens_out),
        period_tokens: Number(r.period_tokens),
        cost_usd:      Math.round(((Number(r.tokens_in) / 1_000_000) * COST_PER_M_IN + (Number(r.tokens_out) / 1_000_000) * COST_PER_M_OUT) * 10000) / 10000,
        last_active:   r.last_active,
      })),
      monthly_limit:  Number(settingsRow.rows[0]?.data?.ai_monthly_token_limit) || 0,
      period_start:   periodStart.toISOString(),
      next_reset:     getNextResetDate().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch usage stats' } });
  }
});

module.exports = { router, TOOLS, executeTool, buildSystemPrompt, checkTokenAllowance };
