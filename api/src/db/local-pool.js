// =============================================================================
// Local-only Postgres pool
//
// Some features (bugs log, backlog) always run against the local PostgreSQL
// instance regardless of DB_MODE.  When DB_MODE=standalone the main pool
// points at a remote host (e.g. AWS RDS), but these project-management tables
// stay local to avoid cluttering the production database.
//
// This module exposes a tiny Pool that always connects to localhost using the
// same credentials as the main local config (DB_USER / DB_PASSWORD / DB_NAME).
// =============================================================================

const { Pool } = require('pg');
require('dotenv').config();

let pool = null;

function getLocalPool() {
  if (pool) return pool;
  pool = new Pool({
    host:     'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'mcogs',
    user:     process.env.DB_USER     || 'mcogs',
    password: process.env.DB_PASSWORD || '',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('[local-pool] Unexpected error:', err.message);
  });
  return pool;
}

// Proxy so route files can do `const pool = require('../db/local-pool')`
// and call pool.query(...) directly — same DX as the main pool.
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'then') return undefined; // not a thenable
    const p = getLocalPool();
    const v = p[prop];
    return typeof v === 'function' ? v.bind(p) : v;
  },
});
