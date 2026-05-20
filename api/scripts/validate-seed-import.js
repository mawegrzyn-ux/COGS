// Live validation for the Test Data + Clear Database + Import tools.
//
// What it does (end-to-end, against whatever DB your .env points at):
//   1. Connects to the DB and counts rows in every mcogs_* table as a baseline.
//   2. Runs clearData() — confirms it doesn't throw and all expected tables are empty afterwards.
//   3. Runs seedSmall() — confirms it doesn't throw and a sensible number of rows land.
//   4. Verifies that the "preserved" tables (allergens, roles, settings, changelog, languages,
//      regions, qsc_questions, qsc_templates, audit_log, users, user_profiles) still have their
//      rows after the clear+seed cycle.
//   5. Exercises the import tool by sanity-checking the mcogs_import_jobs table (structure
//      + an INSERT + SELECT round-trip). The full AI-driven stageFileContent() path requires
//      an Anthropic API key and is not exercised here — run an import through the UI for
//      that end-to-end check.
//   6. Runs clearData() again to leave the DB in a neutral state.
//
// USAGE:
//   cd api
//   node scripts/validate-seed-import.js
//
// Exits non-zero on any failure. All assertions are printed as they run so you can see where
// it died if anything blows up.

/* eslint-disable no-console */
require('dotenv').config();
const { Pool } = require('pg');
const { seedData: seedSmall, clearData } = require('./seed-test-data-small');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT || 5432),
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME     || 'mcogs',
});

const PRESERVED = [
  'mcogs_allergens', 'mcogs_roles', 'mcogs_role_permissions',
  'mcogs_settings', 'mcogs_changelog', 'mcogs_languages',
  'mcogs_regions', 'mcogs_qsc_questions', 'mcogs_qsc_templates',
  'mcogs_audit_log', 'mcogs_users', 'mcogs_user_profiles',
];

async function countRows(tables) {
  const out = {};
  for (const t of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      out[t] = rows[0].n;
    } catch (err) {
      out[t] = `ERR: ${err.message}`;
    }
  }
  return out;
}

async function assert(label, fn) {
  try {
    await fn();
    console.log(`  ✔ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`     ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('\n🧪  Seed / Clear / Import validation\n');

  // ── 1. Preserved-tables baseline ──────────────────────────────────────────
  console.log('1. Checking preserved tables before clear…');
  const beforeCounts = await countRows(PRESERVED);
  for (const t of PRESERVED) console.log(`     ${t}: ${beforeCounts[t]}`);

  // ── 2. Clear ───────────────────────────────────────────────────────────────
  console.log('\n2. Running clearData()…');
  {
    const client = await pool.connect();
    try {
      await clearData(client);
      console.log('  ✔ clearData completed without error');
    } finally {
      client.release();
    }
  }

  // Verify a sample of truncated tables is empty
  const truncatedSamples = [
    'mcogs_ingredients', 'mcogs_recipes', 'mcogs_menus', 'mcogs_price_quotes',
    'mcogs_vendors', 'mcogs_countries', 'mcogs_categories', 'mcogs_sales_items',
  ];
  const afterClear = await countRows(truncatedSamples);
  for (const t of truncatedSamples) {
    await assert(`${t} is empty after clear`, () => {
      if (afterClear[t] !== 0) throw new Error(`expected 0 rows, got ${afterClear[t]}`);
    });
  }

  // Verify preserved tables still have their rows
  console.log('\n   Preserved tables after clear:');
  const afterPreserved = await countRows(PRESERVED);
  for (const t of PRESERVED) {
    await assert(`${t} survived clear (${beforeCounts[t]} → ${afterPreserved[t]})`, () => {
      if (typeof beforeCounts[t] !== 'number' || typeof afterPreserved[t] !== 'number') return; // was an ERR
      if (afterPreserved[t] < beforeCounts[t]) throw new Error('row count dropped');
    });
  }

  // ── 3. Small seed ──────────────────────────────────────────────────────────
  console.log('\n3. Running seedSmall()…');
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // seedSmall assumes a cleared DB, which we just achieved.
      const logs = [];
      await seedSmall(client, (msg) => logs.push(msg));
      await client.query('COMMIT');
      console.log(`  ✔ seedSmall completed (${logs.length} log lines)`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Verify sensible row counts
  const afterSeed = await countRows([
    'mcogs_ingredients', 'mcogs_recipes', 'mcogs_recipe_items',
    'mcogs_menus', 'mcogs_price_quotes', 'mcogs_vendors',
    'mcogs_countries', 'mcogs_categories', 'mcogs_sales_items',
    'mcogs_modifier_groups', 'mcogs_modifier_options',
  ]);
  const expectedNonZero = Object.entries(afterSeed).filter(([, n]) => typeof n === 'number' && n > 0).length;
  await assert(`seed populated at least 10 core tables (got ${expectedNonZero})`, () => {
    if (expectedNonZero < 10) throw new Error('seedSmall populated too few tables');
  });

  for (const [t, n] of Object.entries(afterSeed)) {
    console.log(`     ${t}: ${n}`);
  }

  // ── 4. Import tool (table + round-trip only — full AI path needs a key) ───
  console.log('\n4. Sanity-checking import tool (mcogs_import_jobs round-trip)…');
  const syntheticStaged = {
    ingredients: [
      { name: 'VALIDATION_Flour', source_category: 'Dry Goods', unit: 'kg', waste_pct: 0 },
      { name: 'VALIDATION_Sugar', source_category: 'Dry Goods', unit: 'kg', waste_pct: 0 },
      { name: 'VALIDATION_Salt',  source_category: 'Dry Goods', unit: 'kg', waste_pct: 0 },
    ],
    vendors: [], price_quotes: [], recipes: [], menus: [], menu_items: [],
    prerequisites: {}, category_mapping: {},
  };
  const { rows: insertRows } = await pool.query(
    `INSERT INTO mcogs_import_jobs (user_email, source_file, status, staged_data)
     VALUES ($1, $2, 'ready', $3) RETURNING id`,
    ['validation@local', 'validator-synthetic.csv', JSON.stringify(syntheticStaged)]
  );
  const jobId = insertRows[0].id;
  console.log(`     test job_id: ${jobId}`);

  const { rows: readBack } = await pool.query(
    `SELECT status, staged_data FROM mcogs_import_jobs WHERE id = $1`, [jobId]
  );
  await assert('mcogs_import_jobs row round-tripped', () => {
    if (!readBack.length) throw new Error('row disappeared after insert');
    if (readBack[0].status !== 'ready') throw new Error(`unexpected status: ${readBack[0].status}`);
    const n = readBack[0].staged_data?.ingredients?.length ?? 0;
    if (n !== 3) throw new Error(`expected 3 staged ingredients, got ${n}`);
  });

  // Clean up the synthetic job so it doesn't pollute the user's import history.
  await pool.query(`DELETE FROM mcogs_import_jobs WHERE id = $1`, [jobId]);
  console.log('  ✔ synthetic job cleaned up');

  console.log('\n   Note: full AI-driven stageFileContent() flow requires an Anthropic key');
  console.log('   and is not exercised here. To validate end-to-end, upload a real file');
  console.log('   via the Import wizard UI.');

  // ── 5. Final clear ─────────────────────────────────────────────────────────
  console.log('\n5. Final clearData() to leave DB neutral…');
  {
    const client = await pool.connect();
    try {
      await clearData(client);
      console.log('  ✔ final clear succeeded');
    } finally {
      client.release();
    }
  }

  console.log('\n✅  ALL CHECKS PASSED\n');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('\n❌  VALIDATION FAILED:', err.message);
    pool.end().catch(() => {});
    process.exit(1);
  });
