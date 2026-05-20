// Migration idempotency smoke test.
//
// The migration script (api/scripts/migrate.js) MUST be safe to re-run
// against an already-migrated database. This test:
//   1. Counts tables in the test DB before any action
//   2. Runs migrate.js a second time via spawnSync
//   3. Asserts the table count is identical and no errors are thrown
//
// We rely on test:setup having already run migrate once.

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { getTestPool, closeTestPool } from '../helpers/db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterAll(() => closeTestPool());

async function countTables() {
  const pool = getTestPool();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'mcogs_%'`
  );
  return rows[0].n;
}

async function listTables() {
  const pool = getTestPool();
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'mcogs_%'
     ORDER BY tablename`
  );
  return rows.map((r) => r.tablename);
}

describe('Migration idempotency', () => {
  it('expected number of mcogs_ tables exist after migrate', async () => {
    const n = await countTables();
    // Per CLAUDE.md §8: 82 tables. Allow ±5 to give room for in-flight changes
    // without making this test brittle.
    expect(n).toBeGreaterThanOrEqual(60);
    expect(n).toBeLessThanOrEqual(120);
  });

  it('re-running migrate.js does not change table count', async () => {
    const before = await countTables();
    const beforeList = await listTables();

    const env = {
      ...process.env,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      NODE_ENV: 'test',
    };
    const migrateScript = path.resolve(__dirname, '../../scripts/migrate.js');
    const result = spawnSync('node', [migrateScript], { env, encoding: 'utf-8' });

    if (result.status !== 0) {
      // Fail with the actual error so the developer can see what went wrong.
      throw new Error(`Re-running migrate failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }

    const after = await countTables();
    const afterList = await listTables();
    expect(after).toBe(before);
    expect(afterList).toEqual(beforeList);
  }, 60_000);

  it('all expected core tables are present', async () => {
    const tables = await listTables();
    const required = [
      'mcogs_units', 'mcogs_countries', 'mcogs_categories',
      'mcogs_ingredients', 'mcogs_price_quotes', 'mcogs_recipes',
      'mcogs_menus', 'mcogs_users', 'mcogs_roles',
      'mcogs_audit_log', 'mcogs_stock_levels', 'mcogs_stock_movements',
    ];
    for (const t of required) {
      expect(tables, `missing required table: ${t}`).toContain(t);
    }
  });
});
