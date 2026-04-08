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
const aiConfig    = require('../helpers/aiConfig');
const configStore = require('../config-store');
const rag         = require('../helpers/rag');

const ALLOWED_KEYS = configStore.AI_KEY_NAMES;

function actorOf(req) {
  return (req.user && (req.user.email || req.user.sub)) || null;
}

// GET /ai-config — returns boolean flags only
router.get('/', (_req, res) => {
  res.json(aiConfig.status());
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

module.exports = router;
