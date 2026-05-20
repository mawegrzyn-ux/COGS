// Global test setup for the COGS API test suite.
//
// Loads test env vars BEFORE any source module is imported.
// Source code reads DB_* env vars at module load time via api/src/db/pool.js,
// so we must set them here before any `require('../src/...')` happens in tests.
//
// Convention:
//   - Every test runs against a real PostgreSQL database (`mcogs_test`)
//   - Test isolation is achieved per-test via BEGIN ... ROLLBACK in db helpers
//   - Migrations are run ONCE via `npm run test:setup` before the suite,
//     not per test file — that would balloon CI time
//
// Environment overrides (any of these can be set in CI):
//   TEST_DB_HOST       default: localhost
//   TEST_DB_PORT       default: 5432
//   TEST_DB_NAME       default: mcogs_test
//   TEST_DB_USER       default: postgres
//   TEST_DB_PASSWORD   default: postgres

import { afterAll, beforeAll } from 'vitest';

// Force NODE_ENV=test BEFORE source code reads it.
process.env.NODE_ENV = 'test';

// Map TEST_DB_* → DB_* so api/src/db/pool.js picks them up.
process.env.DB_HOST     = process.env.TEST_DB_HOST     || 'localhost';
process.env.DB_PORT     = process.env.TEST_DB_PORT     || '5432';
process.env.DB_NAME     = process.env.TEST_DB_NAME     || 'mcogs_test';
process.env.DB_USER     = process.env.TEST_DB_USER     || 'postgres';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'postgres';
process.env.DB_MODE     = 'local';

// Disable nightly cron jobs during tests (consolidateMemory, translateEntities).
process.env.DISABLE_CRON = '1';

// Disable external API calls by default (Anthropic, Brave, GitHub).
// Tests that need them must explicitly set the matching env var.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
process.env.BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
process.env.GITHUB_PAT = process.env.GITHUB_PAT || '';

// CONFIG_STORE_SECRET — required by the two-DB config store. Use a fixed
// dev value so encrypted columns remain decryptable across test runs.
process.env.CONFIG_STORE_SECRET = process.env.CONFIG_STORE_SECRET
  || 'a'.repeat(64);  // 64 hex chars = 32 bytes

// Ensure JWT_SECRET is set if anything reads it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-prod';

beforeAll(async () => {
  // Verify DB is reachable. Fail fast with a helpful message.
  try {
    const pg = await import('pg');
    const probe = new pg.default.Client({
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    await probe.connect();
    await probe.query('SELECT 1');
    await probe.end();
  } catch (err) {
    /* eslint-disable no-console */
    console.error('\n╔══════════════════════════════════════════════════════════════════╗');
    console.error('║  ❌ Could not connect to test database.                           ║');
    console.error('║                                                                  ║');
    console.error('║  Run this first:                                                 ║');
    console.error('║      npm run test:setup                                          ║');
    console.error('║                                                                  ║');
    console.error('║  Or set TEST_DB_* env vars to point at an existing test DB.     ║');
    console.error('╚══════════════════════════════════════════════════════════════════╝\n');
    /* eslint-enable no-console */
    throw err;
  }
});

afterAll(async () => {
  // Close any pg pools the source code may have opened so vitest exits cleanly.
  try {
    const { default: pool } = await import('../src/db/pool.js').catch(() =>
      import('../src/db/pool.cjs').catch(() => ({ default: null }))
    );
    if (pool && typeof pool.end === 'function') {
      await pool.end().catch(() => { /* already closed */ });
    }
  } catch {
    /* pool module may not load in pure-unit tests; ignore */
  }
});
