// =============================================================================
// Pepper AI Memory — Pinned Notes + User Profile
// GET/POST/DELETE /api/memory/notes   — user pinned notes (CRUD)
// GET/PUT        /api/memory/profile  — user profile (preferences, summary)
// =============================================================================

const router = require('express').Router();
const pool   = require('../db/pool');

// ── Pinned Notes ────────────────────────────────────────────────────────────

// GET /memory/notes — list all notes for the current user
router.get('/notes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mcogs_user_notes WHERE user_sub = $1 ORDER BY created_at DESC',
      [req.user.sub]
    );
    res.json(rows);
  } catch (err) {
    console.error('[memory] notes list error:', err.message);
    res.status(500).json({ error: { message: 'Failed to load notes' } });
  }
});

// POST /memory/notes — add a pinned note
router.post('/notes', async (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: { message: 'note is required' } });
  try {
    const { rows: [created] } = await pool.query(
      'INSERT INTO mcogs_user_notes (user_sub, note) VALUES ($1, $2) RETURNING *',
      [req.user.sub, note.trim()]
    );
    res.status(201).json(created);
  } catch (err) {
    console.error('[memory] note create error:', err.message);
    res.status(500).json({ error: { message: 'Failed to save note' } });
  }
});

// DELETE /memory/notes/:id — delete a note (only own notes)
router.delete('/notes/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_user_notes WHERE id = $1 AND user_sub = $2',
      [req.params.id, req.user.sub]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Note not found' } });
    res.status(204).send();
  } catch (err) {
    console.error('[memory] note delete error:', err.message);
    res.status(500).json({ error: { message: 'Failed to delete note' } });
  }
});

// ── User Profile ────────────────────────────────────────────────────────────

// GET /memory/profile — get current user's profile
router.get('/profile', async (req, res) => {
  try {
    const { rows: [profile] } = await pool.query(
      'SELECT * FROM mcogs_user_profiles WHERE user_sub = $1',
      [req.user.sub]
    );
    res.json(profile || { user_sub: req.user.sub, profile_json: {}, long_term_summary: null });
  } catch (err) {
    console.error('[memory] profile read error:', err.message);
    res.status(500).json({ error: { message: 'Failed to load profile' } });
  }
});

// PUT /memory/profile — upsert profile fields
router.put('/profile', async (req, res) => {
  const { display_name, profile_json } = req.body;
  try {
    const { rows: [profile] } = await pool.query(`
      INSERT INTO mcogs_user_profiles (user_sub, display_name, profile_json, profile_updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_sub) DO UPDATE SET
        display_name = COALESCE($2, mcogs_user_profiles.display_name),
        profile_json = COALESCE($3, mcogs_user_profiles.profile_json),
        profile_updated_at = NOW()
      RETURNING *
    `, [req.user.sub, display_name || null, profile_json ? JSON.stringify(profile_json) : null]);
    res.json(profile);
  } catch (err) {
    console.error('[memory] profile update error:', err.message);
    res.status(500).json({ error: { message: 'Failed to update profile' } });
  }
});

// ── Memory Consolidation (admin only) ─────────────────────────────────────────

// POST /memory/consolidate — trigger consolidation manually
router.post('/consolidate', async (req, res) => {
  if (req.user?.permissions?.settings !== 'write') {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }
  const { date, forceMonthly } = req.body || {};
  const targetDate = date || undefined;

  // Fire-and-forget — return immediately
  const { runConsolidation } = require('../jobs/consolidateMemory');
  runConsolidation({ targetDate, forceMonthly })
    .then(result => console.log('[memory] Manual consolidation done:', JSON.stringify(result)))
    .catch(err => console.error('[memory] Manual consolidation error:', err.message));

  res.json({ status: 'started', targetDate: targetDate || 'yesterday' });
});

// GET /memory/consolidation-status — last run info
router.get('/consolidation-status', async (req, res) => {
  if (req.user?.permissions?.settings !== 'write') {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }
  try {
    const { rows } = await pool.query(
      "SELECT data->'memory_consolidation' AS status FROM mcogs_settings WHERE id = 1"
    );
    res.json(rows[0]?.status || { last_run: null });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to read consolidation status' } });
  }
});

module.exports = router;
