const router        = require('express').Router({ mergeParams: true });
const sessionRouter = require('express').Router();
const pool          = require('../db/pool');
const crypto        = require('crypto');

// GET /boards/:boardId/sessions
router.get('/:boardId/sessions', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
             (SELECT COUNT(*) FROM kbn_voters WHERE session_id = s.id) AS voter_count
      FROM kbn_sessions s
      WHERE s.board_id = $1
      ORDER BY s.created_at DESC
    `, [req.params.boardId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch sessions' } });
  }
});

// POST /boards/:boardId/sessions
router.post('/:boardId/sessions', async (req, res) => {
  const { name, tokens_for, tokens_against, filter_column_ids, filter_label, expires_at, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    // Verify board exists
    const { rows: [board] } = await pool.query(
      `SELECT id FROM kbn_boards WHERE id = $1`, [req.params.boardId]
    );
    if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

    const slug = crypto.randomBytes(8).toString('hex');

    const { rows: [session] } = await pool.query(`
      INSERT INTO kbn_sessions (board_id, name, slug, tokens_for, tokens_against, filter_column_ids, filter_label, expires_at, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [
      req.params.boardId, name.trim(), slug,
      tokens_for !== undefined ? tokens_for : 10,
      tokens_against !== undefined ? tokens_against : 5,
      filter_column_ids || null,
      filter_label || null,
      expires_at || null,
      notes || null,
    ]);

    res.status(201).json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create session' } });
  }
});

// ── Session-level routes (mounted at /sessions) ─────────────────────────────

// GET /sessions/:id
sessionRouter.get('/:id', async (req, res) => {
  try {
    const { rows: [session] } = await pool.query(`
      SELECT s.*,
             (SELECT COUNT(*) FROM kbn_voters WHERE session_id = s.id) AS voter_count,
             (SELECT COUNT(*) FROM kbn_votes  WHERE session_id = s.id) AS total_votes,
             (SELECT COALESCE(SUM(token_count), 0) FROM kbn_votes WHERE session_id = s.id AND direction = 'for')     AS total_tokens_for,
             (SELECT COALESCE(SUM(token_count), 0) FROM kbn_votes WHERE session_id = s.id AND direction = 'against') AS total_tokens_against
      FROM kbn_sessions s
      WHERE s.id = $1
    `, [req.params.id]);
    if (!session) return res.status(404).json({ error: { message: 'Session not found' } });
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch session' } });
  }
});

// PUT /sessions/:id
sessionRouter.put('/:id', async (req, res) => {
  const { name, tokens_for, tokens_against, is_active, filter_column_ids, filter_label, expires_at, notes } = req.body;

  try {
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM kbn_sessions WHERE id = $1`, [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Not found' } });

    const { rows: [session] } = await pool.query(`
      UPDATE kbn_sessions SET
        name            = COALESCE($1, name),
        tokens_for      = COALESCE($2, tokens_for),
        tokens_against  = COALESCE($3, tokens_against),
        is_active       = COALESCE($4, is_active),
        filter_column_ids = $5,
        filter_label    = $6,
        expires_at      = $7,
        notes           = $8,
        updated_at      = NOW()
      WHERE id = $9
      RETURNING *
    `, [
      name?.trim() || null,
      tokens_for !== undefined ? tokens_for : null,
      tokens_against !== undefined ? tokens_against : null,
      is_active !== undefined ? is_active : null,
      filter_column_ids !== undefined ? (filter_column_ids || null) : existing.filter_column_ids,
      filter_label !== undefined ? (filter_label || null) : existing.filter_label,
      expires_at !== undefined ? (expires_at || null) : existing.expires_at,
      notes !== undefined ? (notes || null) : existing.notes,
      req.params.id,
    ]);

    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update session' } });
  }
});

// DELETE /sessions/:id
sessionRouter.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM kbn_sessions WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete session' } });
  }
});

// GET /sessions/:id/results — ranked cards with vote distribution + per-voter breakdown
sessionRouter.get('/:id/results', async (req, res) => {
  try {
    const { rows: [session] } = await pool.query(
      `SELECT * FROM kbn_sessions WHERE id = $1`, [req.params.id]
    );
    if (!session) return res.status(404).json({ error: { message: 'Session not found' } });

    // Build card filter
    let cardFilter = `c.board_id = $1`;
    const vals = [session.board_id];
    let idx = 2;

    if (session.filter_column_ids && session.filter_column_ids.length > 0) {
      cardFilter += ` AND c.column_id = ANY($${idx++}::int[])`;
      vals.push(session.filter_column_ids);
    }
    if (session.filter_label) {
      cardFilter += ` AND $${idx++} = ANY(c.labels)`;
      vals.push(session.filter_label);
    }

    // Get ranked cards with vote totals for this session
    const { rows: cards } = await pool.query(`
      SELECT c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key, c.column_id,
             col.name AS column_name,
             COALESCE(SUM(CASE WHEN v.direction = 'for'     THEN v.token_count ELSE 0 END), 0) AS votes_for,
             COALESCE(SUM(CASE WHEN v.direction = 'against'  THEN v.token_count ELSE 0 END), 0) AS votes_against,
             COALESCE(SUM(CASE WHEN v.direction = 'for' THEN v.token_count ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN v.direction = 'against' THEN v.token_count ELSE 0 END), 0) AS net_score,
             COUNT(DISTINCT v.voter_id) AS voter_count
      FROM kbn_cards c
      LEFT JOIN kbn_columns col ON col.id = c.column_id
      LEFT JOIN kbn_votes v ON v.card_id = c.id AND v.session_id = ${req.params.id}
      WHERE ${cardFilter}
      GROUP BY c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key, c.column_id, col.name
      ORDER BY net_score DESC, votes_for DESC, c.title ASC
    `, vals);

    // Per-voter breakdown
    const { rows: voterVotes } = await pool.query(`
      SELECT vt.id AS voter_id, vt.name AS voter_name,
             v.card_id, v.direction, v.token_count
      FROM kbn_voters vt
      LEFT JOIN kbn_votes v ON v.voter_id = vt.id
      WHERE vt.session_id = $1
      ORDER BY vt.name, v.card_id
    `, [req.params.id]);

    // Group by voter
    const voterMap = {};
    for (const row of voterVotes) {
      if (!voterMap[row.voter_id]) {
        voterMap[row.voter_id] = { voter_id: row.voter_id, voter_name: row.voter_name, votes: [] };
      }
      if (row.card_id) {
        voterMap[row.voter_id].votes.push({
          card_id: row.card_id,
          direction: row.direction,
          token_count: row.token_count,
        });
      }
    }

    res.json({
      session: { id: session.id, name: session.name, slug: session.slug },
      cards,
      voters: Object.values(voterMap),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch results' } });
  }
});

module.exports = router;
module.exports.sessionRouter = sessionRouter;
