// Database helpers for transaction-rolled test isolation.
//
// USAGE PATTERN:
//
//   import { withTx, getTestPool } from '../helpers/db.js';
//
//   describe('my route', () => {
//     it('creates a thing', async () => {
//       await withTx(async (client) => {
//         await client.query("INSERT INTO mcogs_categories(name) VALUES('test')");
//         const { rows } = await client.query('SELECT count(*) FROM mcogs_categories');
//         expect(Number(rows[0].count)).toBeGreaterThan(0);
//         // Implicit ROLLBACK at the end — DB returns to its previous state.
//       });
//     });
//   });
//
// For tests that need to call the actual Express app (Supertest), use
// `withAppTx()` which seeds a transaction-tagged client onto req.dbClient
// via a small middleware (see api/src/db/pool.js for the convention).

const { Pool } = require('pg');

let _pool = null;

function getTestPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 5,
  });
  return _pool;
}

/**
 * Run callback inside a transaction; ALWAYS rollback at the end.
 * Use this in unit/integration tests so the DB stays clean between tests.
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} callback
 */
async function withTx(callback) {
  const client = await getTestPool().connect();
  try {
    await client.query('BEGIN');
    return await callback(client);
  } finally {
    await client.query('ROLLBACK').catch(() => { /* swallow if already aborted */ });
    client.release();
  }
}

/**
 * Truncate all mcogs_* tables EXCEPT reference data (units, allergens, languages).
 * Use sparingly — most tests should prefer withTx() for isolation.
 * Useful for migration-idempotency tests that need a clean slate.
 */
async function truncateUserTables() {
  const pool = getTestPool();
  // Order matters: child tables first, then parents.
  const tables = [
    'mcogs_audit_log',
    'mcogs_ai_chat_log',
    'mcogs_user_notes',
    'mcogs_user_profiles',
    'mcogs_memory_daily',
    'mcogs_memory_monthly',
    'mcogs_user_brand_partners',
    'mcogs_users',
    'mcogs_role_permissions',
    'mcogs_roles',
    'mcogs_menu_sales_item_prices',
    'mcogs_menu_sales_items',
    'mcogs_menu_combo_option_prices',
    'mcogs_menu_modifier_option_prices',
    'mcogs_menu_item_prices',
    'mcogs_menu_items',
    'mcogs_menu_scenarios',
    'mcogs_shared_page_changes',
    'mcogs_shared_pages',
    'mcogs_menus',
    'mcogs_combo_step_option_modifier_groups',
    'mcogs_combo_template_step_options',
    'mcogs_combo_template_steps',
    'mcogs_combo_templates',
    'mcogs_combo_step_options',
    'mcogs_combo_steps',
    'mcogs_combos',
    'mcogs_sales_item_modifier_groups',
    'mcogs_sales_item_prices',
    'mcogs_sales_item_markets',
    'mcogs_sales_items',
    'mcogs_modifier_options',
    'mcogs_modifier_groups',
    'mcogs_recipe_pl_variations',
    'mcogs_recipe_items',
    'mcogs_recipes',
    'mcogs_ingredient_preferred_vendor',
    'mcogs_ingredient_allergens',
    'mcogs_price_quotes',
    'mcogs_ingredients',
    'mcogs_vendors',
    'mcogs_brand_partners',
    'mcogs_country_level_tax',
    'mcogs_country_tax_rates',
    'mcogs_locations',
    'mcogs_location_groups',
    'mcogs_countries',
    'mcogs_categories',
    'mcogs_category_groups',
    'mcogs_equipment_temp_logs',
    'mcogs_equipment',
    'mcogs_ccp_logs',
    // Stock manager
    'mcogs_stocktake_items',
    'mcogs_stocktakes',
    'mcogs_stock_transfer_items',
    'mcogs_stock_transfers',
    'mcogs_credit_note_items',
    'mcogs_credit_notes',
    'mcogs_invoice_items',
    'mcogs_invoices',
    'mcogs_goods_received_items',
    'mcogs_goods_received',
    'mcogs_order_template_items',
    'mcogs_order_templates',
    'mcogs_purchase_order_items',
    'mcogs_purchase_orders',
    'mcogs_waste_log',
    'mcogs_waste_reason_codes',
    'mcogs_stock_movements',
    'mcogs_stock_levels',
    'mcogs_stores',
    // Bugs / backlog / faq / changelog (idempotent seeded — re-truncating is fine)
    'mcogs_bugs',
    'mcogs_backlog',
    'mcogs_faq',
    'mcogs_changelog',
  ];
  await pool.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

async function closeTestPool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

module.exports = {
  getTestPool,
  withTx,
  truncateUserTables,
  closeTestPool,
};
