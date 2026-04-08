// =============================================================================
// AI Config — runtime key cache
//
// Keys live encrypted in the local config store (api/src/config-store). This
// module provides a synchronous get()/status() API backed by an in-memory
// cache that is hydrated at startup via init() and refreshed whenever a key is
// written through the /api/ai-config endpoint.
//
// Key values are never returned to the browser — only boolean status flags.
// =============================================================================

const configStore = require('../config-store');

const _keys = {
  ANTHROPIC_API_KEY:    null,
  VOYAGE_API_KEY:       null,
  BRAVE_SEARCH_API_KEY: null,
  CLAUDE_CODE_API_KEY:  null,
  GITHUB_PAT:           null,
  GITHUB_REPO:          null,
};

// Load keys from the config store into the runtime cache. Also honours
// process.env as a last-resort fallback so a fresh deployment that hasn't been
// populated yet still picks up keys supplied via .env on first boot — the
// config store bootstrap then migrates those values into persistent storage.
async function init() {
  try {
    const stored = await configStore.getAllAiKeys();
    for (const name of Object.keys(_keys)) {
      if (stored[name]) {
        _keys[name] = stored[name];
      } else if (process.env[name]) {
        _keys[name] = process.env[name];
      }
    }
    console.log('[aiConfig] Keys loaded:', {
      anthropic:   !!_keys.ANTHROPIC_API_KEY,
      voyage:      !!_keys.VOYAGE_API_KEY,
      brave:       !!_keys.BRAVE_SEARCH_API_KEY,
      claude_code: !!_keys.CLAUDE_CODE_API_KEY,
      github:      !!_keys.GITHUB_PAT,
    });
  } catch (err) {
    console.warn('[aiConfig] Could not load keys from config store:', err.message);
    // Fall back entirely to env so the server can still boot.
    for (const name of Object.keys(_keys)) {
      _keys[name] = process.env[name] || null;
    }
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
    github_pat_set:       !!_keys.GITHUB_PAT,
    github_repo_set:      !!_keys.GITHUB_REPO,
  };
}

module.exports = { init, get, set, status };
