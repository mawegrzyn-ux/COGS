// =============================================================================
// DB Config route  (gated by settings:write at the mount point)
//
// GET    /api/db-config              — current connection config (password masked)
// POST   /api/db-config/test         — dry-run a candidate config
// PUT    /api/db-config              — persist a new config to the config store
// POST   /api/db-config/restart      — graceful exit so PM2 restarts the API
// POST   /api/db-config/migrate      — run migrations against the active target
// POST   /api/db-config/probe        — ping the currently-active pool
//
// The test/save flow is intentionally split: the admin UI first POSTs the
// candidate to /test and only calls PUT once the probe succeeds.
// =============================================================================

const router      = require('express').Router();
const { Pool }    = require('pg');
const pool        = require('../db/pool');
const configStore = require('../config-store');
const { buildPoolConfigFromStored, describeTarget } = require('../db/config');

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
router.post('/restart', (_req, res) => {
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
router.post('/migrate', async (_req, res) => {
  try {
    const { migrations } = require('../../scripts/migrate');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let applied = 0;
      for (const stmt of migrations) {
        await client.query(stmt);
        applied++;
      }
      await client.query('COMMIT');
      res.json({ ok: true, applied });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[db-config] migrate failed:', err);
    res.status(500).json({ ok: false, error: { message: err.message } });
  }
});

module.exports = router;
