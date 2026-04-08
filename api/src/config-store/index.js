// =============================================================================
// Config store — public API
//
// Exposes getters / setters for the two things managed via the config store:
//   • DB connection config (main/transactional database)
//   • AI / integration API keys
//
// All secrets are encrypted at rest using AES-256-GCM with the master key
// supplied via CONFIG_STORE_SECRET (see ./crypto.js).
//
// Bootstrap:
//   bootstrap() is called once at API startup. It:
//     1. Validates CONFIG_STORE_SECRET is set
//     2. Creates the config-store schema if missing
//     3. Seeds the DB connection row from process.env (DB_HOST/...) if empty
//     4. Seeds AI keys from process.env if the keys table is empty
//     5. Optionally migrates AI keys from the legacy mcogs_settings table in
//        the main DB the first time the store is populated
// =============================================================================

const { getPool, describe: describeConfigDb } = require('./pool');
const { ensureSchema } = require('./schema');
const { encrypt, decrypt, assertReady } = require('./crypto');

const AI_KEY_NAMES = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'CLAUDE_CODE_API_KEY',
  'GITHUB_PAT',
  'GITHUB_REPO',
];

// ── DB connection ────────────────────────────────────────────────────────────

// Returns the stored DB connection config with the password decrypted in-place.
// Returns null if no row exists yet.
async function getDbConnection() {
  const { rows } = await getPool().query(
    `SELECT * FROM mcogs_config_db_connection WHERE id = 1`
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    mode:                   r.mode,
    host:                   r.host,
    port:                   r.port,
    database:               r.database,
    username:               r.username,
    password:               decrypt(r.password_encrypted),
    ssl_enabled:            r.ssl_enabled,
    ssl_ca_path:            r.ssl_ca_path,
    ssl_reject_unauthorized: r.ssl_reject_unauthorized,
    connection_string:      decrypt(r.connection_string_encrypted),
    pool_max:               r.pool_max,
    idle_timeout_ms:        r.idle_timeout_ms,
    connection_timeout_ms:  r.connection_timeout_ms,
    updated_at:             r.updated_at,
    updated_by:             r.updated_by,
  };
}

// Same as getDbConnection but with the password masked. Used by GET endpoints.
async function getDbConnectionMasked() {
  const cfg = await getDbConnection();
  if (!cfg) return null;
  return {
    ...cfg,
    password:          cfg.password ? '********' : null,
    password_set:      !!cfg.password,
    connection_string: cfg.connection_string ? '********' : null,
    connection_string_set: !!cfg.connection_string,
  };
}

// Upsert the DB connection config. `input` is an object with the same fields
// as getDbConnection(). If `password` is undefined the stored password is kept
// untouched; pass null or '' to clear it.
async function setDbConnection(input, updatedBy = null) {
  const existing = await getDbConnection();

  const merged = {
    mode:                   input.mode                   ?? existing?.mode                   ?? 'local',
    host:                   input.host                   ?? existing?.host                   ?? null,
    port:                   input.port                   ?? existing?.port                   ?? 5432,
    database:               input.database               ?? existing?.database               ?? null,
    username:               input.username               ?? existing?.username               ?? null,
    ssl_enabled:            input.ssl_enabled            ?? existing?.ssl_enabled            ?? false,
    ssl_ca_path:            input.ssl_ca_path            ?? existing?.ssl_ca_path            ?? null,
    ssl_reject_unauthorized: input.ssl_reject_unauthorized ?? existing?.ssl_reject_unauthorized ?? null,
    pool_max:               input.pool_max               ?? existing?.pool_max               ?? 10,
    idle_timeout_ms:        input.idle_timeout_ms        ?? existing?.idle_timeout_ms        ?? 30000,
    connection_timeout_ms:  input.connection_timeout_ms  ?? existing?.connection_timeout_ms  ?? 10000,
  };

  // Password: only overwrite when the caller explicitly supplied one.
  const passwordEncrypted = (input.password !== undefined)
    ? encrypt(input.password)
    : (existing ? encrypt(existing.password) : null);

  // Same semantics for connection_string.
  const connStringEncrypted = (input.connection_string !== undefined)
    ? encrypt(input.connection_string)
    : (existing ? encrypt(existing.connection_string) : null);

  await getPool().query(
    `INSERT INTO mcogs_config_db_connection (
      id, mode, host, port, database, username, password_encrypted,
      ssl_enabled, ssl_ca_path, ssl_reject_unauthorized,
      connection_string_encrypted, pool_max, idle_timeout_ms,
      connection_timeout_ms, updated_at, updated_by
    ) VALUES (
      1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14
    )
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode,
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      database = EXCLUDED.database,
      username = EXCLUDED.username,
      password_encrypted = EXCLUDED.password_encrypted,
      ssl_enabled = EXCLUDED.ssl_enabled,
      ssl_ca_path = EXCLUDED.ssl_ca_path,
      ssl_reject_unauthorized = EXCLUDED.ssl_reject_unauthorized,
      connection_string_encrypted = EXCLUDED.connection_string_encrypted,
      pool_max = EXCLUDED.pool_max,
      idle_timeout_ms = EXCLUDED.idle_timeout_ms,
      connection_timeout_ms = EXCLUDED.connection_timeout_ms,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by`,
    [
      merged.mode, merged.host, merged.port, merged.database, merged.username,
      passwordEncrypted,
      merged.ssl_enabled, merged.ssl_ca_path, merged.ssl_reject_unauthorized,
      connStringEncrypted,
      merged.pool_max, merged.idle_timeout_ms, merged.connection_timeout_ms,
      updatedBy,
    ]
  );
}

// ── AI keys ──────────────────────────────────────────────────────────────────

async function getAiKey(name) {
  const { rows } = await getPool().query(
    `SELECT value_encrypted FROM mcogs_config_ai_keys WHERE key_name = $1`,
    [name]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].value_encrypted);
}

async function getAllAiKeys() {
  const { rows } = await getPool().query(
    `SELECT key_name, value_encrypted FROM mcogs_config_ai_keys`
  );
  const out = {};
  for (const r of rows) {
    out[r.key_name] = decrypt(r.value_encrypted);
  }
  return out;
}

async function setAiKey(name, value, updatedBy = null) {
  if (!AI_KEY_NAMES.includes(name)) {
    throw new Error(`[config-store] Unknown AI key name: ${name}`);
  }
  await getPool().query(
    `INSERT INTO mcogs_config_ai_keys (key_name, value_encrypted, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key_name) DO UPDATE SET
       value_encrypted = EXCLUDED.value_encrypted,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [name, encrypt(value), updatedBy]
  );
}

async function deleteAiKey(name, updatedBy = null) {
  if (!AI_KEY_NAMES.includes(name)) {
    throw new Error(`[config-store] Unknown AI key name: ${name}`);
  }
  await getPool().query(
    `INSERT INTO mcogs_config_ai_keys (key_name, value_encrypted, updated_at, updated_by)
     VALUES ($1, NULL, NOW(), $2)
     ON CONFLICT (key_name) DO UPDATE SET
       value_encrypted = NULL,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [name, updatedBy]
  );
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function setMeta(key, value) {
  await getPool().query(
    `INSERT INTO mcogs_config_meta (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

async function getMeta(key) {
  const { rows } = await getPool().query(
    `SELECT value FROM mcogs_config_meta WHERE key = $1`, [key]
  );
  return rows.length ? rows[0].value : null;
}

async function seedDbConnectionFromEnv() {
  const existing = await getDbConnection();
  if (existing && existing.host) return { seeded: false, reason: 'already-set' };

  // Infer mode the same way api/src/db/config.js does.
  const envMode = (process.env.DB_MODE || '').trim().toLowerCase();
  let mode = 'local';
  if (['standalone', 'remote', 'aws'].includes(envMode)) mode = 'standalone';
  else if (envMode === 'local') mode = 'local';
  else if (process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL) mode = 'standalone';
  else if (process.env.DB_HOST && !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST.toLowerCase())) mode = 'standalone';

  const sslEnabled = (() => {
    const v = (process.env.DB_SSL || '').trim().toLowerCase();
    if (['1','true','yes','on','require','required'].includes(v)) return true;
    if (['0','false','no','off','disable','disabled'].includes(v)) return false;
    return mode === 'standalone';
  })();

  await setDbConnection({
    mode,
    host:     process.env.DB_HOST     || (mode === 'local' ? 'localhost' : null),
    port:     process.env.DB_PORT     ? parseInt(process.env.DB_PORT, 10) : 5432,
    database: process.env.DB_NAME     || 'mcogs',
    username: process.env.DB_USER     || 'mcogs',
    password: process.env.DB_PASSWORD || null,
    ssl_enabled: sslEnabled,
    ssl_ca_path: process.env.DB_SSL_CA || null,
    connection_string: process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL || null,
    pool_max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
    idle_timeout_ms: process.env.DB_IDLE_TIMEOUT_MS ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) : 30000,
    connection_timeout_ms: process.env.DB_CONNECTION_TIMEOUT_MS ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) : 10000,
  }, 'bootstrap:env');

  return { seeded: true, mode };
}

async function seedAiKeysFromEnv() {
  const existing = await getAllAiKeys();
  const hasAny = Object.values(existing).some(v => v);
  if (hasAny) return { seeded: false, reason: 'already-set' };

  let count = 0;
  for (const name of AI_KEY_NAMES) {
    const v = process.env[name];
    if (v) {
      await setAiKey(name, v, 'bootstrap:env');
      count++;
    }
  }
  return { seeded: count > 0, count };
}

async function bootstrap() {
  assertReady(); // throws clearly if CONFIG_STORE_SECRET is missing
  await ensureSchema();
  const dbRes = await seedDbConnectionFromEnv();
  const aiRes = await seedAiKeysFromEnv();
  await setMeta('last_bootstrap_at', new Date().toISOString());
  console.log(
    `[config-store] Bootstrapped (${describeConfigDb()}) — ` +
    `db:${dbRes.seeded ? `seeded(${dbRes.mode})` : 'kept'}, ` +
    `ai:${aiRes.seeded ? `seeded(${aiRes.count})` : 'kept'}`
  );
}

module.exports = {
  AI_KEY_NAMES,
  bootstrap,
  describeConfigDb,
  // DB connection
  getDbConnection,
  getDbConnectionMasked,
  setDbConnection,
  // AI keys
  getAiKey,
  getAllAiKeys,
  setAiKey,
  deleteAiKey,
  // Meta
  getMeta,
  setMeta,
};
