// =============================================================================
// DB Config route  (gated by settings:write at the mount point)
//
// GET    /api/db-config                 — current connection config (password masked)
// POST   /api/db-config/test            — dry-run a candidate config
// PUT    /api/db-config                 — persist a new config to the config store
// POST   /api/db-config/restart         — graceful exit so PM2 restarts the API
// POST   /api/db-config/migrate         — run schema migrations against the active target
// POST   /api/db-config/probe           — ping the currently-active pool
// POST   /api/db-config/migrate-preview — connect to candidate target, return source + target row counts
// POST   /api/db-config/migrate-data    — copy schema + data from active pool → candidate target, then persist
//
// The test/save flow is intentionally split: the admin UI first POSTs the
// candidate to /test and only calls PUT once the probe succeeds.
// =============================================================================

const router        = require('express').Router();
const { Pool }      = require('pg');
const pool          = require('../db/pool');
const configStore   = require('../config-store');
const { buildPoolConfigFromStored, describeTarget } = require('../db/config');
const dataMigrator  = require('../db/data-migrator');
const { logAudit }  = require('../helpers/audit');

// ── Helpers ───────────────────────────────────────────────────────────────────

function actorOf(req) {
  return (req.user && (req.user.email || req.user.sub)) || null;
}

// Normalize a candidate config payload from the UI into the shape
// expected by configStore.setDbConnection() / buildPoolConfigFromStored().
function normalizeInput(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  const keys = [
    'mode', 'host', 'port', 'database', 'username', 'password',
    'ssl_enabled', 'ssl_ca_path', 'ssl_reject_unauthorized',
    'connection_string', 'pool_max', 'idle_timeout_ms', 'connection_timeout_ms',
  ];
  for (const k of keys) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  if (out.port                  !== undefined && out.port                  !== null) out.port                  = parseInt(out.port, 10);
  if (out.pool_max              !== undefined && out.pool_max              !== null) out.pool_max              = parseInt(out.pool_max, 10);
  if (out.idle_timeout_ms       !== undefined && out.idle_timeout_ms       !== null) out.idle_timeout_ms       = parseInt(out.idle_timeout_ms, 10);
  if (out.connection_timeout_ms !== undefined && out.connection_timeout_ms !== null) out.connection_timeout_ms = parseInt(out.connection_timeout_ms, 10);
  if (out.ssl_enabled !== undefined) out.ssl_enabled = !!out.ssl_enabled;
  if (out.ssl_reject_unauthorized !== undefined && out.ssl_reject_unauthorized !== null) {
    out.ssl_reject_unauthorized = !!out.ssl_reject_unauthorized;
  }
  // Empty strings become null (so the "don't change" semantics in setDbConnection apply only
  // when the field is genuinely absent from the payload).
  for (const k of ['host', 'database', 'username', 'ssl_ca_path', 'connection_string']) {
    if (out[k] === '') out[k] = null;
  }
  // Password: '' means "clear"; undefined means "keep".
  if (out.password === '') out.password = null;
  return out;
}

// Builds a throwaway pool config from a candidate payload for the /test endpoint.
// Unlike the persisted case, "keep existing" semantics don't apply here — the
// admin is explicitly providing every field they want to probe against.
async function buildCandidateForProbe(payload) {
  const existing = await configStore.getDbConnection();
  const merged = {
    mode:                   payload.mode                   ?? existing?.mode                   ?? 'local',
    host:                   payload.host                   ?? existing?.host                   ?? null,
    port:                   payload.port                   ?? existing?.port                   ?? 5432,
    database:               payload.database               ?? existing?.database               ?? null,
    username:               payload.username               ?? existing?.username               ?? null,
    password:               payload.password !== undefined ? payload.password : existing?.password,
    ssl_enabled:            payload.ssl_enabled            ?? existing?.ssl_enabled            ?? false,
    ssl_ca_path:            payload.ssl_ca_path            ?? existing?.ssl_ca_path            ?? null,
    ssl_reject_unauthorized: payload.ssl_reject_unauthorized ?? existing?.ssl_reject_unauthorized ?? null,
    connection_string:      payload.connection_string !== undefined ? payload.connection_string : existing?.connection_string,
    pool_max:               payload.pool_max               ?? existing?.pool_max               ?? 2,
    idle_timeout_ms:        5000,
    connection_timeout_ms:  payload.connection_timeout_ms  ?? 5000,
  };
  return buildPoolConfigFromStored(merged);
}

// ── GET /api/db-config ────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const current = await configStore.getDbConnectionMasked();
    const active = {
      mode:   pool.getMode ? pool.getMode() : null,
      target: null,
    };
    // Report whichever target the live pool is currently pointing at.
    try {
      const r = await pool.query('SELECT current_database() AS db, inet_server_addr() AS host, inet_server_port() AS port, version() AS version');
      const row = r.rows[0] || {};
      active.target  = `${row.host || '(local)'}:${row.port || '?'}/${row.db || '?'}`;
      active.version = row.version;
      active.ok = true;
    } catch (err) {
      active.ok = false;
      active.error = err.message;
    }
    res.json({ stored: current, active });
  } catch (err) {
    console.error('[db-config] GET failed:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /api/db-config/test ──────────────────────────────────────────────────
router.post('/test', async (req, res) => {
  const payload = normalizeInput(req.body);
  let probePool = null;
  try {
    const built = await buildCandidateForProbe(payload);
    if (!built || !built.config || (!built.config.host && !built.config.connectionString)) {
      return res.status(400).json({ ok: false, error: 'Host or connection string is required' });
    }
    probePool = new Pool({
      ...built.config,
      max: 1,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: built.config.connectionTimeoutMillis || 5000,
    });
    const start = Date.now();
    const { rows } = await probePool.query('SELECT version() AS version, current_database() AS db');
    const ms = Date.now() - start;
    res.json({
      ok: true,
      latency_ms: ms,
      version: rows[0]?.version || null,
      database: rows[0]?.db || null,
      target: describeTarget(built),
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  } finally {
    if (probePool) {
      probePool.end().catch(() => {});
    }
  }
});

// ── POST /api/db-config/probe ─────────────────────────────────────────────────
// Lightweight ping of the currently-active pool (not a candidate config).
router.post('/probe', async (_req, res) => {
  try {
    const start = Date.now();
    const { rows } = await pool.query('SELECT version() AS version, current_database() AS db');
    res.json({
      ok: true,
      latency_ms: Date.now() - start,
      version: rows[0]?.version || null,
      database: rows[0]?.db || null,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

// ── PUT /api/db-config ────────────────────────────────────────────────────────
router.put('/', async (req, res) => {
  const payload = normalizeInput(req.body);
  try {
    // Refuse to save a config we can't actually connect to — catches typos.
    const built = await buildCandidateForProbe(payload);
    if (!built || !built.config || (!built.config.host && !built.config.connectionString)) {
      return res.status(400).json({ error: { message: 'Host or connection string is required' } });
    }
    const probePool = new Pool({
      ...built.config,
      max: 1,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: built.config.connectionTimeoutMillis || 5000,
    });
    try {
      await probePool.query('SELECT 1');
    } catch (err) {
      return res.status(400).json({ error: { message: `Cannot connect with provided config: ${err.message}` } });
    } finally {
      probePool.end().catch(() => {});
    }

    await configStore.setDbConnection(payload, actorOf(req));
    const saved = await configStore.getDbConnectionMasked();
    logAudit(pool, req, { action: 'update', entity_type: 'db_config', entity_id: 1, entity_label: 'database config', context: { mode: payload.mode || 'local' } });
    res.json({
      saved,
      restart_required: true,
      message: 'Saved. Restart the API (POST /api/db-config/restart) to start using the new connection.',
    });
  } catch (err) {
    console.error('[db-config] PUT failed:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /api/db-config/restart ───────────────────────────────────────────────
// Graceful exit. PM2 (production) or nodemon (dev) restarts the process and
// the new pool picks up the saved config via the startup sequence.
router.post('/restart', (req, res) => {
  logAudit(pool, req, { action: 'update', entity_type: 'db_config', entity_id: 1, entity_label: 'database config', context: { action: 'restart' } });
  res.json({ restarting: true });
  // Small delay so the response flushes before we exit.
  setTimeout(() => {
    console.log('[db-config] Restart requested via API — exiting for process manager to respawn');
    process.exit(0);
  }, 300);
});

// ── POST /api/db-config/migrate ───────────────────────────────────────────────
// Runs the mcogs_* schema migrations against the currently-active pool. Safe
// to run multiple times (CREATE TABLE IF NOT EXISTS). Intended to be called
// right after switching to a fresh remote DB.
router.post('/migrate', async (req, res) => {
  try {
    const applied = await runSchemaMigrationsOn(pool);
    logAudit(pool, req, { action: 'update', entity_type: 'db_config', entity_id: 1, entity_label: 'database config', context: { action: 'migrate', applied } });
    res.json({ ok: true, applied });
  } catch (err) {
    console.error('[db-config] migrate failed:', err);
    res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

// Internal: run all CREATE TABLE IF NOT EXISTS statements against an arbitrary
// pg pool (the live one or a freshly-built one for a candidate target).
async function runSchemaMigrationsOn(targetPool) {
  const { migrations } = require('../../scripts/migrate');
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    let applied = 0;
    for (const stmt of migrations) {
      await client.query(stmt);
      applied++;
    }
    await client.query('COMMIT');
    return applied;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Build a real pg.Pool from a normalized payload, using the same SSL/CA
// resolution rules as the persisted store.
async function buildCandidatePool(payload) {
  const built = await buildCandidateForProbe(payload);
  if (!built || !built.config || (!built.config.host && !built.config.connectionString)) {
    const e = new Error('Host or connection string is required');
    e.status = 400;
    throw e;
  }
  return new Pool({
    ...built.config,
    max: 4,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: built.config.connectionTimeoutMillis || 10000,
  });
}

// ── POST /api/db-config/migrate-preview ───────────────────────────────────────
// Connects to the candidate target, ensures schema is present, and returns
// per-table row counts for source (live pool) and target. Read-only — no data
// is copied. Used by the UI to show a "this will overwrite N rows" warning
// before the admin commits to the actual data migration.
router.post('/migrate-preview', async (req, res) => {
  const payload = normalizeInput(req.body);
  let targetPool = null;
  try {
    targetPool = await buildCandidatePool(payload);
    // Ensure target has the schema before counting — otherwise the table list
    // would be empty for a freshly-provisioned RDS instance.
    let schema_applied = 0;
    try {
      schema_applied = await runSchemaMigrationsOn(targetPool);
    } catch (err) {
      return res.status(400).json({ ok: false, error: `Schema migration on target failed: ${err.message}` });
    }

    const result = await dataMigrator.preview(pool, targetPool);
    res.json({
      ok: true,
      schema_applied,
      order:         result.order,
      source:        result.source,
      target_before: result.target_before,
      warnings:      result.warnings,
      target_not_empty: result.target_before.total > 0,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  } finally {
    if (targetPool) targetPool.end().catch(() => {});
  }
});

// ── POST /api/db-config/migrate-data ──────────────────────────────────────────
// Schema-and-data migration. Steps:
//   1. Build candidate pool, run CREATE TABLE IF NOT EXISTS on target
//   2. data-migrator.migrate (TRUNCATE + COPY in FK-safe order)
//   3. Persist the candidate config to the config store
// Body must include `overwrite: true` if the target already contains rows.
// Long-running — sets a generous request timeout. After success the admin
// must POST /restart to activate the new connection.
router.post('/migrate-data', async (req, res) => {
  // Allow up to 10 minutes for the copy.
  req.setTimeout(10 * 60 * 1000);
  res.setTimeout(10 * 60 * 1000);

  const payload = normalizeInput(req.body);
  const overwrite = req.body && req.body.overwrite === true;

  let targetPool = null;
  try {
    targetPool = await buildCandidatePool(payload);

    console.log('[db-config] Migrate-data: applying schema on target…');
    const schema_applied = await runSchemaMigrationsOn(targetPool);

    console.log('[db-config] Migrate-data: copying rows…');
    const result = await dataMigrator.migrate(pool, targetPool, {
      allowOverwrite: overwrite,
      log: (msg) => console.log(msg),
    });

    console.log('[db-config] Migrate-data: persisting new connection config…');
    await configStore.setDbConnection(payload, actorOf(req));
    const saved = await configStore.getDbConnectionMasked();

    logAudit(pool, req, { action: 'update', entity_type: 'db_config', entity_id: 1, entity_label: 'database config', context: { action: 'migrate_data', tables_copied: result.order?.length || 0 } });
    res.json({
      ok: true,
      schema_applied,
      order:         result.order,
      source:        result.source,
      target_before: result.target_before,
      copied:        result.copied,
      warnings:      result.warnings,
      saved,
      restart_required: true,
      message: 'Migration complete. Restart the API (POST /api/db-config/restart) to begin using the new database.',
    });
  } catch (err) {
    console.error('[db-config] migrate-data failed:', err);
    if (err.code === 'TARGET_NOT_EMPTY') {
      return res.status(409).json({
        ok:    false,
        error: err.message,
        code:  'TARGET_NOT_EMPTY',
        target_before: err.target_before,
      });
    }
    res.status(err.status || 500).json({ ok: false, error: err.message });
  } finally {
    if (targetPool) targetPool.end().catch(() => {});
  }
});

module.exports = router;
