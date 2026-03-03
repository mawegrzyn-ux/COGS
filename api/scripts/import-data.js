#!/usr/bin/env node
// =============================================================================
// Menu COGS — PostgreSQL Data Import
// Reads mcogs-export.json and imports into PostgreSQL
// Usage: node import-data.js mcogs-export.json
// =============================================================================

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Tables in import order (parents before children)
const IMPORT_ORDER = [
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

// Fields to exclude (WordPress-specific or auto-generated)
const EXCLUDE_FIELDS = new Set(['option_name', 'option_value']);

function cleanRow(row) {
  const clean = {};
  for (const [key, val] of Object.entries(row)) {
    if (EXCLUDE_FIELDS.has(key)) continue;
    // Convert MySQL tinyint booleans
    if (val === 0 || val === 1) {
      // Keep as-is — PostgreSQL accepts 0/1 for boolean columns with casting
    }
    clean[key] = val === undefined ? null : val;
  }
  return clean;
}

async function importTable(client, tableName, rows) {
  if (!rows || rows.length === 0) {
    console.log(`  → ${tableName.padEnd(45)} 0 rows (skipped)`);
    return;
  }

  // Clear existing data
  await client.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);

  let imported = 0;
  for (const rawRow of rows) {
    const row = cleanRow(rawRow);
    const keys   = Object.keys(row);
    const values = Object.values(row);
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

  // Reset sequence to max id + 1
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('${tableName}', 'id'),
      COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1,
      false
    )
  `);

  console.log(`  ✔ ${tableName.padEnd(45)} ${imported}/${rows.length} rows`);
}

async function importData() {
  const exportFile = process.argv[2];
  if (!exportFile) {
    console.error('Usage: node import-data.js mcogs-export.json');
    process.exit(1);
  }

  if (!fs.existsSync(exportFile)) {
    console.error(`File not found: ${exportFile}`);
    process.exit(1);
  }

  const exportData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  console.log(`\n📥 Menu COGS — Data Import`);
  console.log(`   Source: ${exportFile}`);
  console.log(`   Exported at: ${exportData.exported_at}\n`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Disable triggers/constraints during import
    await client.query('SET session_replication_role = replica');

    for (const tableName of IMPORT_ORDER) {
      const rows = exportData.tables[tableName] || [];
      await importTable(client, tableName, rows);
    }

    // Re-enable constraints
    await client.query('SET session_replication_role = DEFAULT');

    await client.query('COMMIT');
    console.log('\n✅ Import complete\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Import failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

importData();
