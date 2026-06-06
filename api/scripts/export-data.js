#!/usr/bin/env node
// =============================================================================
// Menu COGS — PostgreSQL Data Export
// Exports all application data to a JSON file for backup / migration.
// Usage: node scripts/export-data.js [output-file] [--compact]
// =============================================================================

const fs = require('fs');

// Pool + config are only created when running as a CLI script (see bottom).
let pool, describeTarget, mode, config;

// ---------------------------------------------------------------------------
// Tables in dependency order (parents before children)
// ---------------------------------------------------------------------------
const EXPORT_ORDER = [
  // Master Data
  'mcogs_units',
  'mcogs_price_levels',
  'mcogs_brand_partners',
  'mcogs_countries',
  'mcogs_country_tax_rates',
  'mcogs_country_level_tax',
  'mcogs_country_price_levels',
  'mcogs_regions',
  'mcogs_market_regions',
  'mcogs_categories',
  'mcogs_category_groups',
  'mcogs_allergens',
  'mcogs_languages',
  'mcogs_settings',

  // Inventory
  'mcogs_vendors',
  'mcogs_ingredients',
  'mcogs_ingredient_allergens',
  'mcogs_price_quotes',
  'mcogs_ingredient_preferred_vendor',

  // Recipes
  'mcogs_recipes',
  'mcogs_recipe_items',
  'mcogs_recipe_variations',
  'mcogs_recipe_pl_variations',
  'mcogs_recipe_market_pl_variations',

  // Sales Items & Modifiers
  'mcogs_sales_items',
  'mcogs_sales_item_markets',
  'mcogs_sales_item_prices',
  'mcogs_modifier_groups',
  'mcogs_modifier_options',
  'mcogs_sales_item_modifier_groups',
  'mcogs_combos',
  'mcogs_combo_steps',
  'mcogs_combo_step_options',
  'mcogs_combo_step_option_modifier_groups',
  'mcogs_combo_templates',
  'mcogs_combo_template_steps',
  'mcogs_combo_template_step_options',

  // Menus
  'mcogs_menus',
  'mcogs_menu_items',
  'mcogs_menu_item_prices',
  'mcogs_menu_sales_items',
  'mcogs_menu_sales_item_prices',
  'mcogs_menu_combo_option_prices',
  'mcogs_menu_modifier_option_prices',
  'mcogs_menu_scenarios',
  'mcogs_shared_pages',
  'mcogs_shared_page_changes',

  // Locations & Stock
  'mcogs_location_groups',
  'mcogs_locations',
  'mcogs_stores',
  'mcogs_stock_levels',
  'mcogs_stock_movements',
  'mcogs_purchase_orders',
  'mcogs_purchase_order_items',
  'mcogs_order_templates',
  'mcogs_order_template_items',
  'mcogs_goods_received',
  'mcogs_goods_received_items',
  'mcogs_invoices',
  'mcogs_invoice_items',
  'mcogs_credit_notes',
  'mcogs_credit_note_items',
  'mcogs_waste_reason_codes',
  'mcogs_waste_log',
  'mcogs_stock_transfers',
  'mcogs_stock_transfer_items',
  'mcogs_stocktakes',
  'mcogs_stocktake_items',
  'mcogs_kiosk_orders',

  // HACCP
  'mcogs_equipment',
  'mcogs_equipment_temp_logs',
  'mcogs_ccp_logs',

  // QSC
  'mcogs_qsc_questions',
  'mcogs_qsc_templates',
  'mcogs_qsc_audits',
  'mcogs_qsc_responses',
  'mcogs_qsc_response_photos',

  // Backlog & Tracking
  'mcogs_feedback',
  'mcogs_bugs',
  'mcogs_backlog',
  'mcogs_item_comments',

  // Documentation
  'mcogs_doc_categories',
  'mcogs_docs',
  'mcogs_faq',

  // Media
  'mcogs_media_categories',
  'mcogs_media_items',

  // Changelog
  'mcogs_changelog',
];

// Junction tables (composite PK, no serial id column)
const JUNCTION_TABLES = new Set([
  'mcogs_ingredient_allergens',
  'mcogs_ingredient_preferred_vendor',
  'mcogs_country_level_tax',
  'mcogs_country_price_levels',
  'mcogs_market_regions',
  'mcogs_sales_item_markets',
  'mcogs_sales_item_modifier_groups',
  'mcogs_combo_step_option_modifier_groups',
  'mcogs_menu_combo_option_prices',
  'mcogs_menu_modifier_option_prices',
]);

async function tableExists(client, tableName) {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return res.rows[0].exists;
}

async function exportTable(client, tableName) {
  const exists = await tableExists(client, tableName);
  if (!exists) {
    console.log(`  ⚠ ${tableName.padEnd(45)} table not found (skipped)`);
    return null;
  }

  const orderClause = JUNCTION_TABLES.has(tableName) ? '' : ' ORDER BY id';
  const res = await client.query(`SELECT * FROM ${tableName}${orderClause}`);

  console.log(`  ✔ ${tableName.padEnd(45)} ${String(res.rowCount).padStart(6)} rows`);
  return res.rows;
}

async function exportData() {
  // Parse arguments
  const args = process.argv.slice(2);
  const compact = args.includes('--compact');
  const positional = args.filter(a => !a.startsWith('--'));

  const today = new Date().toISOString().slice(0, 10);
  const outputFile = positional[0] || `mcogs-export-${today}.json`;

  const client = await pool.connect();

  try {
    console.log(`\n📤 Menu COGS — Data Export`);
    console.log(`   Output: ${outputFile}${compact ? ' (compact)' : ''}\n`);

    const tables = {};
    const rowCounts = {};
    let totalRows = 0;
    let tableCount = 0;

    for (const tableName of EXPORT_ORDER) {
      const rows = await exportTable(client, tableName);
      if (rows !== null) {
        tables[tableName] = rows;
        rowCounts[tableName] = rows.length;
        totalRows += rows.length;
        tableCount++;
      }
    }

    const exportPayload = {
      exported_at: new Date().toISOString(),
      source: describeTarget({ mode, config }),
      version: '1.0.0',
      table_count: tableCount,
      tables,
      row_counts: rowCounts,
    };

    const json = compact
      ? JSON.stringify(exportPayload)
      : JSON.stringify(exportPayload, null, 2);

    fs.writeFileSync(outputFile, json, 'utf8');

    console.log(`\n✅ Export complete`);
    console.log(`   Tables: ${tableCount}`);
    console.log(`   Rows:   ${totalRows}`);
    console.log(`   File:   ${outputFile} (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB)\n`);

  } catch (err) {
    console.error('\n❌ Export failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Exports for reuse by API routes
// ---------------------------------------------------------------------------
module.exports = { EXPORT_ORDER, JUNCTION_TABLES, tableExists, exportTable };

// Run as CLI script
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const { buildPoolConfig, describeTarget: _describeTarget } = require('../src/db/config');
  const built = buildPoolConfig();
  mode = built.mode;
  config = built.config;
  describeTarget = _describeTarget;
  console.log(`[export] Target: ${describeTarget({ mode, config })}`);
  pool = new Pool(config);
  exportData();
}
