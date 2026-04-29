// =============================================================================
// AI Config route
// GET  /api/ai-config         — returns key status (set/not-set), never values
// PATCH /api/ai-config        — save keys to the local config store + update runtime
// DELETE /api/ai-config/:key  — clear a specific key
//
// All key values are persisted encrypted in the local config store (see
// api/src/config-store). This replaces the legacy storage in mcogs_settings.
// =============================================================================

const crypto      = require('crypto');
const router      = require('express').Router();
const pool        = require('../db/pool');
const aiConfig    = require('../helpers/aiConfig');
const configStore = require('../config-store');
const rag         = require('../helpers/rag');
const { logAudit } = require('../helpers/audit');

const ALLOWED_KEYS = configStore.AI_KEY_NAMES;

function actorOf(req) {
  return (req.user && (req.user.email || req.user.sub)) || null;
}

// GET /ai-config — returns boolean flags only
router.get('/', (_req, res) => {
  res.json(aiConfig.status());
});

// ── Integration health status ────────────────────────────────────────────────
// Pings each configured integration with a cheap call and reports whether it
// is reachable + latency. Cached for 60 s so a dashboard widget polling every
// minute doesn't re-hammer external APIs. Integrations without a configured
// key are reported as "not_configured" without a network call.
//
// Response shape:
//   {
//     checked_at: ISO timestamp,
//     integrations: [
//       { name, label, status: 'healthy'|'unhealthy'|'not_configured', latency_ms?, error? }
//     ]
//   }
const INTEGRATION_TTL_MS = 60_000;
let integrationCache = { checked_at: 0, response: null };

async function _pingWithTimeout(url, opts = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return { ok: res.ok, status: res.status, latency_ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

async function checkIntegrations() {
  const status = aiConfig.status();
  const out = [];

  // ── Anthropic: a HEAD on api.anthropic.com is enough to confirm reachability;
  //    we don't burn tokens on a real call.
  if (status.anthropic_key_set) {
    try {
      const r = await _pingWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': aiConfig.get('ANTHROPIC_API_KEY') || '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }, 6000);
      // 200/4xx both prove reachability + auth. 401 means bad key.
      if (r.status === 401) out.push({ name: 'anthropic', label: 'Anthropic (Claude)', status: 'unhealthy', latency_ms: r.latency_ms, error: 'Invalid API key' });
      else if (r.ok || r.status === 400) out.push({ name: 'anthropic', label: 'Anthropic (Claude)', status: 'healthy', latency_ms: r.latency_ms });
      else out.push({ name: 'anthropic', label: 'Anthropic (Claude)', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'anthropic', label: 'Anthropic (Claude)', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'anthropic', label: 'Anthropic (Claude)', status: 'not_configured' });
  }

  // ── Voyage AI (RAG)
  if (status.voyage_key_set) {
    try {
      const r = await _pingWithTimeout('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aiConfig.get('VOYAGE_API_KEY') || ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ input: ['x'], model: 'voyage-3' }),
      }, 6000);
      if (r.status === 401) out.push({ name: 'voyage', label: 'Voyage AI (RAG)', status: 'unhealthy', latency_ms: r.latency_ms, error: 'Invalid API key' });
      else if (r.ok || r.status === 400) out.push({ name: 'voyage', label: 'Voyage AI (RAG)', status: 'healthy', latency_ms: r.latency_ms });
      else out.push({ name: 'voyage', label: 'Voyage AI (RAG)', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'voyage', label: 'Voyage AI (RAG)', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'voyage', label: 'Voyage AI (RAG)', status: 'not_configured' });
  }

  // ── Brave Search
  if (status.brave_key_set) {
    try {
      const r = await _pingWithTimeout('https://api.search.brave.com/res/v1/web/search?q=ping&count=1', {
        method: 'GET',
        headers: { 'x-subscription-token': aiConfig.get('BRAVE_SEARCH_API_KEY') || '', 'accept': 'application/json' },
      }, 6000);
      if (r.ok) out.push({ name: 'brave', label: 'Brave Search', status: 'healthy', latency_ms: r.latency_ms });
      else out.push({ name: 'brave', label: 'Brave Search', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'brave', label: 'Brave Search', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'brave', label: 'Brave Search', status: 'not_configured' });
  }

  // ── GitHub PAT
  if (status.github_pat_set) {
    try {
      const r = await _pingWithTimeout('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${aiConfig.get('GITHUB_PAT') || ''}`, 'accept': 'application/vnd.github+json' },
      }, 6000);
      if (r.ok) out.push({ name: 'github', label: 'GitHub', status: 'healthy', latency_ms: r.latency_ms });
      else if (r.status === 401) out.push({ name: 'github', label: 'GitHub', status: 'unhealthy', latency_ms: r.latency_ms, error: 'Invalid PAT' });
      else out.push({ name: 'github', label: 'GitHub', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'github', label: 'GitHub', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'github', label: 'GitHub', status: 'not_configured' });
  }

  // ── Jira (only when fully configured: base_url + email + token)
  if (status.jira_base_url_set && status.jira_email_set && status.jira_token_set) {
    try {
      const baseUrl = (aiConfig.get('JIRA_BASE_URL') || '').replace(/\/+$/, '');
      const auth = Buffer.from(`${aiConfig.get('JIRA_EMAIL') || ''}:${aiConfig.get('JIRA_API_TOKEN') || ''}`).toString('base64');
      const r = await _pingWithTimeout(`${baseUrl}/rest/api/3/myself`, {
        headers: { 'Authorization': `Basic ${auth}`, 'accept': 'application/json' },
      }, 6000);
      if (r.ok) out.push({ name: 'jira', label: 'Jira', status: 'healthy', latency_ms: r.latency_ms });
      else if (r.status === 401) out.push({ name: 'jira', label: 'Jira', status: 'unhealthy', latency_ms: r.latency_ms, error: 'Invalid credentials' });
      else out.push({ name: 'jira', label: 'Jira', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'jira', label: 'Jira', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'jira', label: 'Jira', status: 'not_configured' });
  }

  // ── Mapbox: configuration is a token string. Public tokens (pk.*) are
  //    always valid for browser map widgets. We don't ping Mapbox — token
  //    presence + format check is enough.
  if (status.mapbox_token_set) {
    const token = aiConfig.get('MAPBOX_ACCESS_TOKEN') || '';
    if (token.startsWith('pk.')) {
      out.push({ name: 'mapbox', label: 'Mapbox', status: 'healthy', latency_ms: 0 });
    } else if (token.startsWith('sk.')) {
      out.push({ name: 'mapbox', label: 'Mapbox', status: 'unhealthy', error: 'Secret token (sk.*) will not work in browsers — use a public pk.* token' });
    } else {
      out.push({ name: 'mapbox', label: 'Mapbox', status: 'unhealthy', error: 'Token does not match expected pk.* / sk.* format' });
    }
  } else {
    out.push({ name: 'mapbox', label: 'Mapbox', status: 'not_configured' });
  }

  // ── OpenAI (Whisper voice fallback for Safari/iOS PWA)
  if (status.openai_key_set) {
    try {
      const r = await _pingWithTimeout('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${aiConfig.get('OPENAI_API_KEY') || ''}` },
      }, 6000);
      if (r.ok) out.push({ name: 'openai', label: 'OpenAI (Whisper)', status: 'healthy', latency_ms: r.latency_ms });
      else if (r.status === 401) out.push({ name: 'openai', label: 'OpenAI (Whisper)', status: 'unhealthy', latency_ms: r.latency_ms, error: 'Invalid API key' });
      else out.push({ name: 'openai', label: 'OpenAI (Whisper)', status: 'unhealthy', latency_ms: r.latency_ms, error: `HTTP ${r.status}` });
    } catch (err) {
      out.push({ name: 'openai', label: 'OpenAI (Whisper)', status: 'unhealthy', error: err.name === 'AbortError' ? 'Timed out' : (err.message || 'Network error') });
    }
  } else {
    out.push({ name: 'openai', label: 'OpenAI (Whisper)', status: 'not_configured' });
  }

  return { checked_at: new Date().toISOString(), integrations: out };
}

router.get('/integration-status', async (req, res) => {
  // Serve from cache when fresh; refresh otherwise. ?force=1 bypasses cache.
  const force = req.query.force === '1' || req.query.force === 'true';
  const now = Date.now();
  if (!force && integrationCache.response && (now - integrationCache.checked_at) < INTEGRATION_TTL_MS) {
    return res.json({ ...integrationCache.response, cached: true });
  }
  try {
    const response = await checkIntegrations();
    integrationCache = { checked_at: now, response };
    res.json({ ...response, cached: false });
  } catch (err) {
    console.error('[ai-config] integration-status error:', err);
    res.status(500).json({ error: { message: 'Failed to check integrations' } });
  }
});

// PATCH /ai-config — { ANTHROPIC_API_KEY?: string, VOYAGE_API_KEY?: string }
router.patch('/', async (req, res) => {
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (req.body[key] !== undefined) {
      const val = (req.body[key] === null || req.body[key] === '') ? null : String(req.body[key]).trim();
      updates[key] = val;
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: { message: 'No valid keys provided' } });
  }

  try {
    const actor = actorOf(req);
    for (const [name, value] of Object.entries(updates)) {
      await configStore.setAiKey(name, value, actor);
      aiConfig.set(name, value);
    }

    // Re-init RAG if Voyage key changed
    if (updates.VOYAGE_API_KEY !== undefined) {
      rag.init().catch(err => console.error('[rag] re-init error:', err.message));
    }

    logAudit(pool, req, { action: 'update', entity_type: 'ai_config', entity_id: 1, entity_label: 'ai settings', context: { keys_updated: Object.keys(updates) } });
    res.json(aiConfig.status());
  } catch (err) {
    console.error('[ai-config] save failed:', err);
    res.status(500).json({ error: { message: 'Failed to save AI config' } });
  }
});

// DELETE /ai-config/:key — clear a specific key
router.delete('/:key', async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: { message: 'Invalid key name' } });
  }

  try {
    await configStore.deleteAiKey(key, actorOf(req));
    aiConfig.set(key, null);
    logAudit(pool, req, { action: 'delete', entity_type: 'ai_config', entity_id: 1, entity_label: 'ai settings', context: { key_deleted: key } });
    res.json(aiConfig.status());
  } catch (err) {
    console.error('[ai-config] delete failed:', err);
    res.status(500).json({ error: { message: 'Failed to clear key' } });
  }
});

// POST /ai-config/generate-claude-code-key — generate (or regenerate) a random API key
// Returns the key value so the user can copy it into their Claude Code settings
router.post('/generate-claude-code-key', async (req, res) => {
  const key = 'ccak_' + crypto.randomBytes(24).toString('hex');
  try {
    await configStore.setAiKey('CLAUDE_CODE_API_KEY', key, actorOf(req));
    aiConfig.set('CLAUDE_CODE_API_KEY', key);
    logAudit(pool, req, { action: 'create', entity_type: 'ai_config', entity_id: 1, entity_label: 'ai settings', context: { action: 'generate_claude_code_key' } });
    res.json({ key, ...aiConfig.status() });
  } catch (err) {
    console.error('[ai-config] generate key failed:', err);
    res.status(500).json({ error: { message: 'Failed to save key' } });
  }
});

// GET /ai-config/claude-code-key — return the actual key value so user can copy it
// (Only this key is ever returned in plaintext — it is self-generated, not a user credential)
router.get('/claude-code-key', async (_req, res) => {
  try {
    const key = await configStore.getAiKey('CLAUDE_CODE_API_KEY');
    res.json({ key: key || null });
  } catch (err) {
    console.error('[ai-config] fetch key failed:', err);
    res.status(500).json({ error: { message: 'Failed to fetch key' } });
  }
});

// GET /ai-config/derived-directives — return the auto-derived directives blob
// from mcogs_settings.data.pepper_derived_directives. Empty object if never run.
router.get('/derived-directives', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings LIMIT 1`);
    const blob = rows[0]?.data?.pepper_derived_directives || null;
    res.json(blob || { directives: [], derived_at: null, stats: null });
  } catch (err) {
    console.error('[ai-config] fetch derived directives failed:', err);
    res.status(500).json({ error: { message: 'Failed to fetch derived directives' } });
  }
});

// POST /ai-config/derived-directives/run — trigger derivation on demand
// Useful when an admin has just changed corpus content and wants the next
// chat session to pick up new directives without waiting for the cron.
router.post('/derived-directives/run', async (req, res) => {
  try {
    const { runDerivation } = require('../jobs/deriveDirectives');
    const result = await runDerivation();
    logAudit(pool, req, { action: 'create', entity_type: 'ai_config', entity_id: 1, entity_label: 'derived directives', context: { action: 'run_derivation', skipped: result?.skipped || false, kept: result?.stats?.candidates_kept } });
    res.json(result);
  } catch (err) {
    console.error('[ai-config] run derivation failed:', err);
    res.status(500).json({ error: { message: err.message || 'Failed to run derivation' } });
  }
});

// DELETE /ai-config/derived-directives — clear the derived blob
// Use when admin wants to revert to manual-only directives.
router.delete('/derived-directives', async (req, res) => {
  try {
    await pool.query(`UPDATE mcogs_settings SET data = COALESCE(data, '{}'::jsonb) - 'pepper_derived_directives', updated_at = NOW() WHERE id = 1`);
    logAudit(pool, req, { action: 'delete', entity_type: 'ai_config', entity_id: 1, entity_label: 'derived directives', context: { action: 'clear_derived_directives' } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[ai-config] clear derived directives failed:', err);
    res.status(500).json({ error: { message: 'Failed to clear derived directives' } });
  }
});

// GET /ai-config/mapbox-token — return the Mapbox PUBLIC token so the dashboard
// map widgets can initialise Mapbox GL JS. Public tokens (pk.xxx) are meant
// for browser use and are expected to be URL-restricted in the Mapbox
// dashboard, so exposing them to authenticated users is safe by design.
// If no token is configured the frontend falls back to a "not configured"
// message pointing the admin at System → AI → Integrations.
router.get('/mapbox-token', (_req, res) => {
  res.json({ token: aiConfig.get('MAPBOX_ACCESS_TOKEN') || null });
});

module.exports = router;
