// =============================================================================
// AI model tier helpers — read default + premium model IDs from mcogs_settings
// (data.ai_models = { default, premium }) with hardcoded fallbacks so a fresh
// deployment still works.
//
// Used by:
//   • /api/me — surfaces both IDs to the frontend so the picker can render
//     human-readable labels
//   • /api/ai-chat + /api/ai-upload — resolves the requested tier ('default' |
//     'premium') to the actual Anthropic model ID, gating premium behind
//     mcogs_users.ai_premium_access
// =============================================================================

const pool = require('../db/pool');

// Hardcoded fallbacks — used if mcogs_settings has nothing stored. Values
// match the seed migration (step 170). Bumped here when Anthropic ships a
// newer model and this codebase upgrades. Admins can override via Settings
// → AI without touching code.
const DEFAULTS = {
  default: 'claude-haiku-4-5-20251001',
  premium: 'claude-opus-4-7',
};

const TIERS = ['default', 'premium'];

async function getModelTiers() {
  try {
    const { rows } = await pool.query('SELECT data FROM mcogs_settings WHERE id = 1');
    const stored = rows[0]?.data?.ai_models || {};
    return {
      default: typeof stored.default === 'string' && stored.default.trim() ? stored.default : DEFAULTS.default,
      premium: typeof stored.premium === 'string' && stored.premium.trim() ? stored.premium : DEFAULTS.premium,
    };
  } catch (err) {
    console.error('[aiModels] Failed to load model config, using defaults:', err.message);
    return { ...DEFAULTS };
  }
}

// Resolve a tier label ('default' | 'premium') to the actual Anthropic model
// ID, enforcing user access. `userHasPremium` comes from req.user.ai_premium_access.
//
// Returns { modelId, tier } where tier is the actually-applied tier (in case
// a premium request gets quietly downgraded to default — but we don't quietly
// downgrade; we throw if the user requested premium without access).
async function resolveModelForTier(requestedTier, { userHasPremium }) {
  const tier = TIERS.includes(requestedTier) ? requestedTier : 'default';
  if (tier === 'premium' && !userHasPremium) {
    const err = new Error('Premium model access not granted for this user');
    err.statusCode = 403;
    err.code = 'NO_PREMIUM_ACCESS';
    throw err;
  }
  const tiers = await getModelTiers();
  return { modelId: tiers[tier], tier };
}

module.exports = { getModelTiers, resolveModelForTier, DEFAULTS, TIERS };
