// =============================================================================
// Config store — dedicated Postgres pool
// The config store always runs on a local Postgres instance (loopback). It
// holds the connection config for the main/transactional database and the
// encrypted AI keys. Keeping it local means the API can always boot — even
// when the transactional DB is unreachable — and then surface a clear error
// message via the admin UI.
//
// Env vars (all optional; sensible defaults target localhost):
//   CONFIG_DB_HOST      default: localhost
//   CONFIG_DB_PORT      default: 5432
//   CONFIG_DB_NAME      default: mcogs_config
//   CONFIG_DB_USER      default: inherits DB_USER, then 'mcogs'
//   CONFIG_DB_PASSWORD  default: inherits DB_PASSWORD
// =============================================================================

const { Pool } = require('pg');

function buildConfigDbConfig() {
  return {
    host:     process.env.CONFIG_DB_HOST     || 'localhost',
    port:     parseInt(process.env.CONFIG_DB_PORT || '5432', 10),
    database: process.env.CONFIG_DB_NAME     || 'mcogs_config',
    user:     process.env.CONFIG_DB_USER     || process.env.DB_USER     || 'mcogs',
    password: process.env.CONFIG_DB_PASSWORD || process.env.DB_PASSWORD || '',
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = new Pool(buildConfigDbConfig());
  pool.on('error', (err) => {
    console.error('[config-store] pool error:', err.message);
  });
  return pool;
}

function describe() {
  const c = buildConfigDbConfig();
  return `${c.host}:${c.port}/${c.database}`;
}

module.exports = { getPool, describe, buildConfigDbConfig };
