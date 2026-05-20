// One-time test database setup.
//
// Creates the test database (default: mcogs_test) if missing, then runs
// the standard migration script against it. Idempotent — safe to re-run.
//
// USAGE:
//   npm run test:setup
//
// To use a different DB name / host / credentials, set TEST_DB_* env vars.
// CI will set these to point at the GitHub Actions Postgres service.

const { Client } = require('pg');
const { spawnSync } = require('child_process');

const HOST     = process.env.TEST_DB_HOST     || 'localhost';
const PORT     = Number(process.env.TEST_DB_PORT || 5432);
const NAME     = process.env.TEST_DB_NAME     || 'mcogs_test';
const USER     = process.env.TEST_DB_USER     || 'postgres';
const PASSWORD = process.env.TEST_DB_PASSWORD || 'postgres';

async function ensureDatabase() {
  // Connect to the maintenance DB to check / create the test DB.
  const admin = new Client({
    host: HOST, port: PORT, user: USER, password: PASSWORD,
    database: 'postgres',
  });
  try {
    await admin.connect();
  } catch (err) {
    /* eslint-disable no-console */
    console.error('\n❌ Could not connect to PostgreSQL admin DB at', `${USER}@${HOST}:${PORT}/postgres`);
    console.error('   Is PostgreSQL running? Are TEST_DB_* env vars correct?');
    console.error('   Error:', err.message, '\n');
    /* eslint-enable no-console */
    process.exit(1);
  }
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [NAME]);
  if (exists.rowCount === 0) {
    /* eslint-disable-next-line no-console */
    console.log(`Creating test database "${NAME}"...`);
    // CREATE DATABASE cannot be parameterised — name has been validated by env.
    await admin.query(`CREATE DATABASE "${NAME.replace(/"/g, '""')}"`);
  } else {
    /* eslint-disable-next-line no-console */
    console.log(`Test database "${NAME}" already exists.`);
  }
  await admin.end();
}

function runMigration() {
  /* eslint-disable-next-line no-console */
  console.log('Running migration against test database...');
  const env = {
    ...process.env,
    DB_HOST: HOST, DB_PORT: String(PORT), DB_NAME: NAME,
    DB_USER: USER, DB_PASSWORD: PASSWORD, DB_MODE: 'local',
    NODE_ENV: 'test',
  };
  const result = spawnSync('node', ['scripts/migrate.js'], {
    stdio: 'inherit',
    env,
    shell: false,
  });
  if (result.status !== 0) {
    /* eslint-disable-next-line no-console */
    console.error('❌ Migration failed.');
    process.exit(result.status || 1);
  }
}

(async () => {
  await ensureDatabase();
  runMigration();
  /* eslint-disable-next-line no-console */
  console.log('✔ Test database ready.');
})().catch((err) => {
  /* eslint-disable-next-line no-console */
  console.error(err);
  process.exit(1);
});
