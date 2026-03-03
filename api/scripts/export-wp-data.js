#!/usr/bin/env node
// =============================================================================
// Menu COGS — WordPress Data Export
// Connects to WordPress MySQL and exports all mcogs_ tables as JSON
// Run this on your WordPress server or locally with WP DB access
//
// Usage:
//   npm install mysql2
//   node export-wp-data.js > mcogs-export.json
//
// Config: set env vars or edit the config block below
// =============================================================================

const mysql = require('mysql2/promise');
const fs    = require('fs');

// ── Config — edit these or set as environment variables ──────────────────────
const config = {
  host:     process.env.WP_DB_HOST     || 'localhost',
  port:     parseInt(process.env.WP_DB_PORT || '3306'),
  user:     process.env.WP_DB_USER     || 'root',
  password: process.env.WP_DB_PASSWORD || '',
  database: process.env.WP_DB_NAME     || 'wordpress',
};

// WordPress table prefix — change if yours is different
const WP_PREFIX = process.env.WP_PREFIX || 'wp_';

// All mcogs tables in dependency order (parents before children)
const TABLES = [
  'mcogs_units',
  'mcogs_price_levels',
  'mcogs_countries',
  'mcogs_country_tax_rates',
  'mcogs_country_level_tax',
  'mcogs_categories',
  'mcogs_vendors',
  'mcogs_ingredients',
  'mcogs_price_quotes',
  'mcogs_ingredient_preferred_vendor',
  'mcogs_recipes',
  'mcogs_recipe_items',
  'mcogs_menus',
  'mcogs_menu_items',
  'mcogs_menu_item_prices',
  'mcogs_locations',
];

async function exportData() {
  const conn = await mysql.createConnection(config);
  const export_data = {
    exported_at: new Date().toISOString(),
    source:      'wordpress',
    tables:      {},
  };

  process.stderr.write('\n📦 Menu COGS — WordPress Data Export\n\n');

  for (const table of TABLES) {
    const fullTable = `${WP_PREFIX}${table}`;
    try {
      const [rows] = await conn.query(`SELECT * FROM \`${fullTable}\``);
      export_data.tables[table] = rows;
      process.stderr.write(`  ✔ ${fullTable.padEnd(50)} ${rows.length} rows\n`);
    } catch (err) {
      process.stderr.write(`  ⚠ ${fullTable.padEnd(50)} skipped (${err.message})\n`);
      export_data.tables[table] = [];
    }
  }

  await conn.end();

  // Write JSON to stdout (redirect to file)
  process.stdout.write(JSON.stringify(export_data, null, 2));
  process.stderr.write('\n✅ Export complete\n\n');
}

exportData().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
