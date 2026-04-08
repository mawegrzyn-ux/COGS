// =============================================================================
// Main (transactional) Postgres pool
//
// The API has two Postgres connections:
//   • This one — the transactional DB holding all mcogs_* business tables.
//     May be local or standalone (AWS RDS, etc.) depending on the config.
//   • The config store (api/src/config-store/pool.js) — always local, holds
//     encrypted connection settings and AI keys.
//
// Connection precedence for this pool:
//   1. Config store (mcogs_config_db_connection row)  — authoritative once set
//   2. process.env (DB_HOST / DB_PORT / ... or DB_CONNECTION_STRING)
//   3. If neither yields a valid config, the API fails to start.
//
// The module exports a Proxy that delegates to the underlying pg Pool once it
// has been initialized via ensureReady(). This keeps all existing route files
// working — they continue to `require('../db/pool')` and call `pool.query(...)`
// with no changes — while allowing the connection to be loaded asynchronously
// at startup from the config store.
// =============================================================================

const { Pool } = require('pg');
require('dotenv').config();

const {
  buildPoolConfig,
  buildPoolConfigFromStored,
  describeTarget,
} = require('./config');

let underlying = null;
let readyPromise = null;
let resolvedMode = null;

async function resolveConfig() {
  // 1. Try the config store first. If it's reachable and has a populated row,
  //    use that. If it's unreachable (e.g. local Postgres down, or the
  //    mcogs_config database hasn't been created yet) fall back to .env.
  try {
    const configStore = require('../config-store');
    await configStore.bootstrap();
    const stored = await configStore.getDbConnection();
    if (stored && (stored.host || stored.connection_string)) {
      const built = buildPoolConfigFromStored(stored);
      if (built) {
        console.log('[db] Using connection config from config store');
        return built;
      }
    }
  } catch (err) {
    const code = err && err.code;
    if (code === '3D000') {
      console.warn(
        '[db] Config store database does not exist yet. Create it with:\n' +
        '     createdb mcogs_config\n' +
        '     Falling back to .env for this boot.'
      );
    } else {
      console.warn(`[db] Config store unavailable (${err.message}). Falling back to .env.`);
    }
  }

  // 2. Fall back to env-based config.
  return buildPoolConfig();
}

async function ensureReady() {
  if (underlying) return underlying;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const { mode, config } = await resolveConfig();
    resolvedMode = mode;

    const p = new Pool(config);
    p.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });

    try {
      await p.query('SELECT NOW()');
      console.log(`[db] PostgreSQL connected (${describeTarget({ mode, config })})`);
    } catch (err) {
      console.error(
        `[db] PostgreSQL connection failed (${describeTarget({ mode, config })}): ${err.message}`
      );
      throw err;
    }

    underlying = p;
    return p;
  })();

  try {
    return await readyPromise;
  } catch (err) {
    // Reset so a retry is possible (e.g. after fixing config via the admin UI).
    readyPromise = null;
    throw err;
  }
}

function getMode() {
  return resolvedMode;
}

// Proxy that lazily forwards to the underlying pg Pool.
// Existing route files do `const pool = require('../db/pool'); pool.query(...)`
// — those calls land here and hit the real Pool.
const proxy = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'ensureReady') return ensureReady;
    if (prop === 'getMode')     return getMode;
    if (prop === 'then')        return undefined; // not a thenable
    if (!underlying) {
      throw new Error(
        `[db] pool.${String(prop)} called before ensureReady(). ` +
        'Ensure the startup sequence awaits pool.ensureReady() before ' +
        'handling requests.'
      );
    }
    const v = underlying[prop];
    return typeof v === 'function' ? v.bind(underlying) : v;
  },
});

module.exports = proxy;
