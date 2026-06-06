#!/usr/bin/env node
// =============================================================================
// Menu COGS — PostgreSQL Full Data Import
// Reads a JSON export file and imports ALL 87 application tables.
// Usage: node scripts/import-data-full.js mcogs-export.json [--dry-run]
//        [--tables=mcogs_units,mcogs_vendors] [--skip=mcogs_stock_movements]
// =============================================================================

const fs = require('fs');

// Pool + config are only created when running as a CLI script (see bottom).
let pool;

// ---------------------------------------------------------------------------
// Tables in dependency order (parents before children) — must match export
// ---------------------------------------------------------------------------
const IMPORT_ORDER = [
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

// Junction tables (composite PK, no serial id) — skip setval for these
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

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    file: null,
    dryRun: false,
    onlyTables: null,   // null = all tables
    skipTables: new Set(),
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg.startsWith('--tables=')) {
      result.onlyTables = new Set(arg.slice('--tables='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--skip=')) {
      result.skipTables = new Set(arg.slice('--skip='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (!arg.startsWith('--')) {
      result.file = arg;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------
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

async function importTable(client, tableName, rows, dryRun) {
  if (!rows || rows.length === 0) {
    console.log(`  → ${tableName.padEnd(45)} 0 rows (skipped)`);
    return 0;
  }

  if (dryRun) {
    console.log(`  ~ ${tableName.padEnd(45)} ${rows.length} rows (dry-run)`);
    return rows.length;
  }

  // Clear existing data
  await client.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);

  let imported = 0;
  for (const row of rows) {
    const keys   = Object.keys(row);
    const values = keys.map(k => row[k] === undefined ? null : row[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    try {
      await client.query(
        `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
        values
      );
      imported++;
    } catch (err) {
      console.error(`\n  ⚠ Row failed in ${tableName}:`, err.message);
      console.error('    Row:', JSON.stringify(row));
    }
  }

  // Reset sequence for tables with a serial id column
  if (!JUNCTION_TABLES.has(tableName)) {
    try {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('${tableName}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1,
          false
        )
      `);
    } catch {
      // Table may not have a serial id — that's fine, skip silently
    }
  }

  console.log(`  ✔ ${tableName.padEnd(45)} ${imported}/${rows.length} rows`);
  return imported;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function importData() {
  const opts = parseArgs();

  if (!opts.file) {
    console.error('Usage: node scripts/import-data-full.js <export-file.json> [--dry-run] [--tables=t1,t2] [--skip=t1,t2]');
    process.exit(1);
  }

  if (!fs.existsSync(opts.file)) {
    console.error(`File not found: ${opts.file}`);
    process.exit(1);
  }

  const exportData = JSON.parse(fs.readFileSync(opts.file, 'utf8'));

  console.log(`\n📥 Menu COGS — Full Data Import${opts.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`   Source file:  ${opts.file}`);
  console.log(`   Exported at:  ${exportData.exported_at}`);
  console.log(`   Export ver:   ${exportData.version || 'unknown'}`);
  if (opts.onlyTables) console.log(`   Only tables:  ${[...opts.onlyTables].join(', ')}`);
  if (opts.skipTables.size) console.log(`   Skip tables:  ${[...opts.skipTables].join(', ')}`);
  console.log('');

  const client = await pool.connect();

  try {
    if (!opts.dryRun) {
      await client.query('BEGIN');
      // Disable triggers / FK constraints during import
      await client.query('SET session_replication_role = replica');
    }

    let totalImported = 0;
    let tablesProcessed = 0;
    let tablesSkipped = 0;

    for (const tableName of IMPORT_ORDER) {
      // Filter: --tables
      if (opts.onlyTables && !opts.onlyTables.has(tableName)) {
        continue;
      }
      // Filter: --skip
      if (opts.skipTables.has(tableName)) {
        console.log(`  ⏭ ${tableName.padEnd(45)} skipped (--skip)`);
        tablesSkipped++;
        continue;
      }

      // Check table exists in database
      if (!opts.dryRun) {
        const exists = await tableExists(client, tableName);
        if (!exists) {
          console.log(`  ⚠ ${tableName.padEnd(45)} table not found (skipped)`);
          tablesSkipped++;
          continue;
        }
      }

      const rows = exportData.tables[tableName] || [];
      const imported = await importTable(client, tableName, rows, opts.dryRun);
      totalImported += imported;
      tablesProcessed++;
    }

    if (!opts.dryRun) {
      // Re-enable constraints
      await client.query('SET session_replication_role = DEFAULT');
      await client.query('COMMIT');
    }

    console.log(`\n✅ Import complete${opts.dryRun ? ' (dry-run — no changes made)' : ''}`);
    console.log(`   Tables processed: ${tablesProcessed}`);
    console.log(`   Tables skipped:   ${tablesSkipped}`);
    console.log(`   Rows imported:    ${totalImported}\n`);

  } catch (err) {
    if (!opts.dryRun) {
      await client.query('ROLLBACK');
    }
    console.error('\n❌ Import failed:', err.message);
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
module.exports = { IMPORT_ORDER, JUNCTION_TABLES, tableExists, importTable };

// Run as CLI script
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const { buildPoolConfig, describeTarget } = require('../src/db/config');
  const { mode, config } = buildPoolConfig();
  console.log(`[import] Target: ${describeTarget({ mode, config })}`);
  pool = new Pool(config);
  importData();
}
