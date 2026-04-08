// =============================================================================
// Config store — schema bootstrap
// Creates the tables used by the local config store. Idempotent — safe to run
// on every startup. Runs against a dedicated Postgres database (CONFIG_DB_*).
// =============================================================================

const { getPool } = require('./pool');

const DDL = [
  // Single-row table holding the connection config for the main/transactional DB.
  `CREATE TABLE IF NOT EXISTS mcogs_config_db_connection (
    id                        INTEGER PRIMARY KEY CHECK (id = 1),
    mode                      VARCHAR(20) NOT NULL DEFAULT 'local'
                                CHECK (mode IN ('local','standalone')),
    host                      VARCHAR(255),
    port                      INTEGER DEFAULT 5432,
    database                  VARCHAR(255),
    username                  VARCHAR(255),
    password_encrypted        TEXT,
    ssl_enabled               BOOLEAN NOT NULL DEFAULT false,
    ssl_ca_path               VARCHAR(1024),
    ssl_reject_unauthorized   BOOLEAN,
    connection_string_encrypted TEXT,
    pool_max                  INTEGER NOT NULL DEFAULT 10,
    idle_timeout_ms           INTEGER NOT NULL DEFAULT 30000,
    connection_timeout_ms     INTEGER NOT NULL DEFAULT 10000,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by                VARCHAR(255)
  )`,

  // Key/value table for encrypted AI / integration keys.
  // One row per key name. Password encrypted at rest.
  `CREATE TABLE IF NOT EXISTS mcogs_config_ai_keys (
    key_name          VARCHAR(100) PRIMARY KEY,
    value_encrypted   TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by        VARCHAR(255)
  )`,

  // Meta / audit — bootstrap timestamp, schema version, etc.
  `CREATE TABLE IF NOT EXISTS mcogs_config_meta (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

async function ensureSchema() {
  const pool = getPool();
  for (const stmt of DDL) {
    await pool.query(stmt);
  }
}

module.exports = { ensureSchema };
