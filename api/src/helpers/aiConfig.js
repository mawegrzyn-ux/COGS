// =============================================================================
// AI Config — runtime key store
// Keys are loaded from the DB at startup, falling back to process.env.
// Updating via PATCH /api/ai-config writes to DB and updates this store.
// The actual key values are NEVER sent to the browser.
// =============================================================================

const pool = require('../db/pool');

const _keys = {
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY    || null,
  VOYAGE_API_KEY:       process.env.VOYAGE_API_KEY       || null,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY || null,
  CLAUDE_CODE_API_KEY:  process.env.CLAUDE_CODE_API_KEY  || null,
};

// Load DB-stored keys into the runtime store (called at startup)
async function init() {
  try {
    const { rows } = await pool.query(
      `SELECT data->'ai_keys' AS ai_keys FROM mcogs_settings WHERE id = 1`
    );
    const stored = rows[0]?.ai_keys || {};
    if (stored.ANTHROPIC_API_KEY)    _keys.ANTHROPIC_API_KEY    = stored.ANTHROPIC_API_KEY;
    if (stored.VOYAGE_API_KEY)       _keys.VOYAGE_API_KEY       = stored.VOYAGE_API_KEY;
    if (stored.BRAVE_SEARCH_API_KEY) _keys.BRAVE_SEARCH_API_KEY = stored.BRAVE_SEARCH_API_KEY;
    if (stored.CLAUDE_CODE_API_KEY)  _keys.CLAUDE_CODE_API_KEY  = stored.CLAUDE_CODE_API_KEY;
    console.log('[aiConfig] Keys loaded:', {
      anthropic:  !!_keys.ANTHROPIC_API_KEY,
      voyage:     !!_keys.VOYAGE_API_KEY,
      brave:      !!_keys.BRAVE_SEARCH_API_KEY,
      claude_code: !!_keys.CLAUDE_CODE_API_KEY,
    });
  } catch (err) {
    console.warn('[aiConfig] Could not load keys from DB:', err.message);
  }
}

function get(key) {
  return _keys[key] || null;
}

function set(key, value) {
  _keys[key] = value || null;
}

function status() {
  return {
    anthropic_key_set:    !!_keys.ANTHROPIC_API_KEY,
    voyage_key_set:       !!_keys.VOYAGE_API_KEY,
    brave_key_set:        !!_keys.BRAVE_SEARCH_API_KEY,
    claude_code_key_set:  !!_keys.CLAUDE_CODE_API_KEY,
  };
}

module.exports = { init, get, set, status };
