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
const pool        = require('../db/pool');

const _keys = {
  ANTHROPIC_API_KEY:    null,
  VOYAGE_API_KEY:       null,
  BRAVE_SEARCH_API_KEY: null,
  CLAUDE_CODE_API_KEY:  null,
  GITHUB_PAT:           null,
  GITHUB_REPO:          null,
};

// One-time migration: pre-feature, AI keys lived in mcogs_settings.data->ai_keys
// in the main DB. The new code reads from the encrypted config store, so on the
// first boot after the upgrade the new store is empty and the keys appear "Not
// set" in the UI even though the values are still in the legacy row.
//
// This routine runs once per deployment, copies any legacy keys into the config
// store, and sets a meta flag so it never runs again. It is safe to re-run —
// the empty-store check guarantees we never overwrite keys an admin has set
// through the UI.
async function migrateLegacyKeysFromMainDb() {
  const flag = await configStore.getMeta('ai_keys_migrated_from_settings');
  if (flag === 'true') return { migrated: 0, skipped: 'already-migrated' };

  const existing = await configStore.getAllAiKeys();
  const hasAny = Object.values(existing).some(v => v);
  if (hasAny) {
    await configStore.setMeta('ai_keys_migrated_from_settings', 'true');
    return { migrated: 0, skipped: 'store-not-empty' };
  }

  let legacy = {};
  try {
    const { rows } = await pool.query(
      `SELECT data->'ai_keys' AS ai_keys FROM mcogs_settings WHERE id = 1`
    );
    legacy = rows[0]?.ai_keys || {};
  } catch (err) {
    // Legacy table may not exist on a fresh install — that's fine.
    console.warn('[aiConfig] No legacy mcogs_settings row to migrate:', err.message);
    await configStore.setMeta('ai_keys_migrated_from_settings', 'true');
    return { migrated: 0, skipped: 'no-legacy' };
  }

  let migrated = 0;
  for (const name of configStore.AI_KEY_NAMES) {
    const v = legacy[name];
    if (v) {
      await configStore.setAiKey(name, v, 'migrate:legacy-mcogs-settings');
      migrated++;
    }
  }
  await configStore.setMeta('ai_keys_migrated_from_settings', 'true');
  return { migrated };
}

// Load keys from the config store into the runtime cache. Also honours
// process.env as a last-resort fallback so a fresh deployment that hasn't been
// populated yet still picks up keys supplied via .env on first boot.
async function init() {
  try {
    // First-time upgrades: pull any keys that still live in mcogs_settings.
    try {
      const result = await migrateLegacyKeysFromMainDb();
      if (result.migrated > 0) {
        console.log(`[aiConfig] Migrated ${result.migrated} legacy key(s) from mcogs_settings → config store`);
      }
    } catch (err) {
      console.warn('[aiConfig] Legacy key migration failed (non-fatal):', err.message);
    }

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
