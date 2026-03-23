// =============================================================================
// AI Config route
// GET  /api/ai-config         — returns key status (set/not-set), never values
// PATCH /api/ai-config        — save keys to DB + update runtime store
// DELETE /api/ai-config/:key  — clear a specific key
// =============================================================================

const router   = require('express').Router();
const pool     = require('../db/pool');
const aiConfig = require('../helpers/aiConfig');
const rag      = require('../helpers/rag');

const ALLOWED_KEYS = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'BRAVE_SEARCH_API_KEY'];

// GET /ai-config — returns boolean flags only
router.get('/', (_req, res) => {
  res.json(aiConfig.status());
});

// PATCH /ai-config — { ANTHROPIC_API_KEY?: string, VOYAGE_API_KEY?: string }
router.patch('/', async (req, res) => {
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (req.body[key] !== undefined) {
      const val = req.body[key]?.trim() || null;
      updates[key] = val;
      aiConfig.set(key, val);
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: { message: 'No valid keys provided' } });
  }

  try {
    // Merge into mcogs_settings.data.ai_keys (never return these to GET /settings)
    await pool.query(
      `UPDATE mcogs_settings
       SET data = jsonb_set(
         COALESCE(data, '{}'),
         '{ai_keys}',
         COALESCE(data->'ai_keys', '{}') || $1::jsonb
       ),
       updated_at = NOW()
       WHERE id = 1`,
      [JSON.stringify(updates)]
    );

    // Re-init RAG if Voyage key changed
    if (updates.VOYAGE_API_KEY !== undefined) {
      rag.init().catch(err => console.error('[rag] re-init error:', err.message));
    }

    res.json(aiConfig.status());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save AI config' } });
  }
});

// DELETE /ai-config/:key — clear a specific key
router.delete('/:key', async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: { message: 'Invalid key name' } });
  }

  aiConfig.set(key, null);

  try {
    await pool.query(
      `UPDATE mcogs_settings
       SET data = jsonb_set(
         COALESCE(data, '{}'),
         '{ai_keys}',
         COALESCE(data->'ai_keys', '{}') - $1
       ),
       updated_at = NOW()
       WHERE id = 1`,
      [key]
    );
    res.json(aiConfig.status());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to clear key' } });
  }
});

module.exports = router;
