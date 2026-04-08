// =============================================================================
// Menu COGS — Database Connection Config
// Centralized PostgreSQL connection configuration supporting two modes:
//
//   1. "local"      — Database runs on the same machine as the API
//                     (default, matches the historical single-box deployment).
//   2. "standalone" — Database runs on a separate host, e.g. AWS RDS,
//                     AWS Lightsail managed DB, or any remote PostgreSQL.
//
// The mode is selected via the DB_MODE env var. When unset, it is inferred:
//   • DB_MODE=standalone              → standalone
//   • DB_CONNECTION_STRING is set     → standalone
//   • DB_HOST is set and not loopback → standalone
//   • otherwise                        → local
//
// Either a full connection string (DB_CONNECTION_STRING / DATABASE_URL) or the
// individual DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD vars may be
// used. Individual vars always take precedence when both are provided so that
// an operator can override a single field (e.g. password rotation) without
// rewriting the full URI.
//
// SSL:
//   • Defaults to OFF in local mode (local sockets don't need it).
//   • Defaults to ON in standalone mode (AWS RDS requires TLS by default).
//   • Override with DB_SSL=true|false|require|disable.
//   • DB_SSL_CA may point at a CA bundle file (e.g. the AWS RDS global bundle)
//     for strict certificate verification. When unset and SSL is enabled, the
//     connection falls back to rejectUnauthorized=false to preserve the legacy
//     behaviour where RDS certificates are not pinned.
// =============================================================================

const fs   = require('fs');
const path = require('path');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'require', 'required'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(v)) return false;
  return fallback;
}

function parseIntOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function resolveMode() {
  const explicit = (process.env.DB_MODE || '').trim().toLowerCase();
  if (explicit === 'standalone' || explicit === 'remote' || explicit === 'aws') {
    return 'standalone';
  }
  if (explicit === 'local') {
    return 'local';
  }
  if (process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL) {
    return 'standalone';
  }
  const host = (process.env.DB_HOST || '').trim().toLowerCase();
  if (host && !LOOPBACK_HOSTS.has(host)) {
    return 'standalone';
  }
  return 'local';
}

function buildSslConfig(mode) {
  // Explicit off wins regardless of mode.
  const sslEnabled = parseBool(
    process.env.DB_SSL,
    mode === 'standalone' // default: ON for standalone, OFF for local
  );
  if (!sslEnabled) return false;

  const rejectUnauthorized = parseBool(
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    Boolean(process.env.DB_SSL_CA) // only verify if a CA bundle was supplied
  );

  const ssl = { rejectUnauthorized };

  if (process.env.DB_SSL_CA) {
    const caPath = path.isAbsolute(process.env.DB_SSL_CA)
      ? process.env.DB_SSL_CA
      : path.resolve(process.cwd(), process.env.DB_SSL_CA);
    try {
      ssl.ca = fs.readFileSync(caPath, 'utf8');
    } catch (err) {
      throw new Error(`[db] Failed to read DB_SSL_CA at ${caPath}: ${err.message}`);
    }
  }

  return ssl;
}

function buildPoolConfig() {
  const mode = resolveMode();

  const base = {
    max:                     parseIntOr(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis:       parseIntOr(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: parseIntOr(process.env.DB_CONNECTION_TIMEOUT_MS, 10000),
  };

  const ssl = buildSslConfig(mode);
  if (ssl) base.ssl = ssl;

  const connectionString = process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL;

  // Individual vars always win when provided — this makes it easy to override
  // a single field on top of a connection string.
  const explicit = {
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT ? parseIntOr(process.env.DB_PORT, undefined) : undefined,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };

  const hasExplicit = Object.values(explicit).some(v => v !== undefined && v !== '');

  let config;
  if (connectionString && !hasExplicit) {
    config = { ...base, connectionString };
  } else if (connectionString && hasExplicit) {
    // Merge: connection string provides defaults, individual vars override.
    config = { ...base, connectionString };
    for (const [k, v] of Object.entries(explicit)) {
      if (v !== undefined && v !== '') config[k] = v;
    }
  } else {
    config = {
      ...base,
      host:     explicit.host,
      port:     explicit.port,
      database: explicit.database,
      user:     explicit.user,
      password: explicit.password,
    };
  }

  return { mode, config };
}

function describeTarget({ mode, config }) {
  if (config.connectionString) {
    try {
      const u = new URL(config.connectionString);
      const host = config.host || u.hostname;
      const port = config.port || u.port || 5432;
      const db   = config.database || (u.pathname || '').replace(/^\//, '') || '?';
      return `${mode} → ${host}:${port}/${db}`;
    } catch {
      return `${mode} → (connection string)`;
    }
  }
  return `${mode} → ${config.host || '?'}:${config.port || '?'}/${config.database || '?'}`;
}

module.exports = { buildPoolConfig, describeTarget };
