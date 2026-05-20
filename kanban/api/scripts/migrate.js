#!/usr/bin/env node
// =============================================================================
// Kanban — Database Migration
// Creates all kbn_* tables in PostgreSQL (same database as COGS: mcogs)
// Usage: npm run migrate
// Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
// =============================================================================

require('dotenv').config();
const { Pool } = require('pg');

const migrations = [

  // ── 1. Boards ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_boards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 2. Columns ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_columns (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES kbn_boards(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(7),
    wip_limit INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_columns_board ON kbn_columns(board_id)`,

  // ── 3. Cards ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_cards (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES kbn_boards(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES kbn_columns(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    priority VARCHAR(20) CHECK (priority IN ('highest','high','medium','low','lowest')),
    labels TEXT[],
    story_points NUMERIC(6,1),
    epic VARCHAR(200),
    jira_key VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    votes_for INTEGER NOT NULL DEFAULT 0,
    votes_against INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_cards_board ON kbn_cards(board_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_cards_column ON kbn_cards(column_id)`,

  // ── 4. Sessions ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_sessions (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES kbn_boards(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(32) NOT NULL UNIQUE,
    tokens_for INTEGER NOT NULL DEFAULT 10,
    tokens_against INTEGER NOT NULL DEFAULT 5,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    filter_column_ids INTEGER[],
    filter_label VARCHAR(200),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_sessions_board ON kbn_sessions(board_id)`,

  // ── 5. Voters ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_voters (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES kbn_sessions(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_voters_session ON kbn_voters(session_id)`,

  // ── 6. Votes ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_votes (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES kbn_sessions(id) ON DELETE CASCADE,
    voter_id INTEGER NOT NULL REFERENCES kbn_voters(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES kbn_cards(id) ON DELETE CASCADE,
    direction VARCHAR(7) NOT NULL CHECK (direction IN ('for', 'against')),
    token_count INTEGER NOT NULL DEFAULT 1 CHECK (token_count >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (voter_id, card_id, direction)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_votes_session ON kbn_votes(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_votes_card ON kbn_votes(card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_votes_voter ON kbn_votes(voter_id)`,

  // ── 7. Imports ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kbn_imports (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES kbn_boards(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    format VARCHAR(10) NOT NULL CHECK (format IN ('csv', 'json')),
    row_count INTEGER NOT NULL DEFAULT 0,
    cards_created INTEGER NOT NULL DEFAULT 0,
    column_mapping JSONB,
    errors JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kbn_imports_board ON kbn_imports(board_id)`,
];

async function runMigrations(pool) {
  const client = await pool.connect();
  console.log('\n  Kanban — Database Migration\n');

  try {
    await client.query('BEGIN');

    for (const sql of migrations) {
      const label = sql.trim().split('\n')[0].replace(/CREATE (TABLE|INDEX) IF NOT EXISTS /, '').split(' ')[0];
      process.stdout.write(`  -> ${label.padEnd(45)}`);
      await client.query(sql);
      console.log('OK');
    }

    await client.query('COMMIT');
    console.log('\n  Migration complete — all tables ready\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  Migration failed:', err.message);
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { migrations, runMigrations };

if (require.main === module) {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'mcogs',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      pool.end().catch(() => {});
      console.error('[migrate] Fatal:', err.message);
      process.exit(1);
    });
}
