const router = require('express').Router();
const pool   = require('../db/pool');
const { signVoterToken, verifyVoterToken } = require('../helpers/hmac');

// ── Middleware: validate Bearer voter token ──────────────────────────────────

function requireVoterToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const rawToken   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload    = verifyVoterToken(rawToken);
  if (!payload || payload.slug !== req.params.slug) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  req.voter = payload; // { voter_id, session_id, slug }
  next();
}

// ── Helper: load session by slug with active/expiry checks ──────────────────

async function loadSession(slug) {
  const { rows: [session] } = await pool.query(
    `SELECT * FROM kbn_sessions WHERE slug = $1`, [slug]
  );
  return session || null;
}

function checkSessionActive(session, res) {
  if (!session)           return res.status(404).json({ error: { message: 'Session not found' } });
  if (!session.is_active) return res.status(403).json({ error: { message: 'This voting session is closed' } });
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return res.status(403).json({ error: { message: 'This voting session has expired' } });
  }
  return null; // OK
}

// GET /vote/:slug — session meta
router.get('/:slug', async (req, res) => {
  try {
    const session = await loadSession(req.params.slug);
    if (!session) return res.status(404).json({ error: { message: 'Session not found' } });

    // Get board name
    const { rows: [board] } = await pool.query(
      `SELECT name FROM kbn_boards WHERE id = $1`, [session.board_id]
    );

    res.json({
      name:           session.name,
      board_name:     board?.name || null,
      tokens_for:     session.tokens_for,
      tokens_against: session.tokens_against,
      is_active:      session.is_active,
      expires_at:     session.expires_at,
      notes:          session.notes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

// POST /vote/:slug/join — { name } -> create/find voter, return HMAC token
router.post('/:slug/join', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const session = await loadSession(req.params.slug);
    const blocked = checkSessionActive(session, res);
    if (blocked) return;

    // Upsert voter (unique on session_id + name)
    const { rows: [voter] } = await pool.query(`
      INSERT INTO kbn_voters (session_id, name)
      VALUES ($1, $2)
      ON CONFLICT (session_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `, [session.id, name.trim()]);

    const token = signVoterToken(voter.id, session.id, session.slug);

    res.json({
      token,
      voter_id:   voter.id,
      voter_name: voter.name,
      session_id: session.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to join session' } });
  }
});

// GET /vote/:slug/cards — cards in session scope (Bearer required)
router.get('/:slug/cards', requireVoterToken, async (req, res) => {
  try {
    const session = await loadSession(req.params.slug);
    if (!session) return res.status(404).json({ error: { message: 'Session not found' } });

    let query = `
      SELECT c.*, col.name AS column_name
      FROM kbn_cards c
      JOIN kbn_columns col ON col.id = c.column_id
      WHERE c.board_id = $1
    `;
    const vals = [session.board_id];
    let idx = 2;

    if (session.filter_column_ids && session.filter_column_ids.length > 0) {
      query += ` AND c.column_id = ANY($${idx++}::int[])`;
      vals.push(session.filter_column_ids);
    }
    if (session.filter_label) {
      query += ` AND $${idx++} = ANY(c.labels)`;
      vals.push(session.filter_label);
    }

    query += ` ORDER BY c.sort_order ASC, c.id ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch cards' } });
  }
});

// GET /vote/:slug/my-votes — voter's current allocations (Bearer required)
router.get('/:slug/my-votes', requireVoterToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT card_id, direction, token_count
      FROM kbn_votes
      WHERE voter_id = $1 AND session_id = $2
    `, [req.voter.voter_id, req.voter.session_id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch votes' } });
  }
});

// POST /vote/:slug/cast — { votes: [{card_id, direction, token_count}] }
router.post('/:slug/cast', requireVoterToken, async (req, res) => {
  const { votes } = req.body;
  if (!Array.isArray(votes)) {
    return res.status(400).json({ error: { message: 'votes must be an array of {card_id, direction, token_count}' } });
  }

  try {
    const session = await loadSession(req.params.slug);
    const blocked = checkSessionActive(session, res);
    if (blocked) return;

    // Validate token budgets
    let totalFor = 0;
    let totalAgainst = 0;
    for (const v of votes) {
      if (!v.card_id || !v.direction || !v.token_count) {
        return res.status(400).json({ error: { message: 'Each vote requires card_id, direction, and token_count' } });
      }
      if (!['for', 'against'].includes(v.direction)) {
        return res.status(400).json({ error: { message: `Invalid direction: ${v.direction}` } });
      }
      if (v.token_count < 1) {
        return res.status(400).json({ error: { message: 'token_count must be >= 1' } });
      }
      if (v.direction === 'for')     totalFor     += v.token_count;
      if (v.direction === 'against') totalAgainst += v.token_count;
    }

    if (totalFor > session.tokens_for) {
      return res.status(400).json({ error: { message: `For-tokens (${totalFor}) exceed budget (${session.tokens_for})` } });
    }
    if (totalAgainst > session.tokens_against) {
      return res.status(400).json({ error: { message: `Against-tokens (${totalAgainst}) exceed budget (${session.tokens_against})` } });
    }

    // Validate all card_ids belong to the board and are in scope
    const cardIds = [...new Set(votes.map(v => v.card_id))];
    let cardQuery = `SELECT id, column_id FROM kbn_cards WHERE board_id = $1 AND id = ANY($2::int[])`;
    const cardVals = [session.board_id, cardIds];

    const { rows: validCards } = await pool.query(cardQuery, cardVals);
    const validCardIds = new Set(validCards.map(c => c.id));

    for (const cid of cardIds) {
      if (!validCardIds.has(cid)) {
        return res.status(400).json({ error: { message: `Card ${cid} does not belong to this board` } });
      }
    }

    // If session has filter_column_ids, verify cards are in those columns
    if (session.filter_column_ids && session.filter_column_ids.length > 0) {
      const allowedCols = new Set(session.filter_column_ids);
      for (const card of validCards) {
        if (cardIds.includes(card.id) && !allowedCols.has(card.column_id)) {
          return res.status(400).json({ error: { message: `Card ${card.id} is not in a votable column for this session` } });
        }
      }
    }

    // Upsert votes in transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing votes for this voter in this session
      await client.query(
        `DELETE FROM kbn_votes WHERE voter_id = $1 AND session_id = $2`,
        [req.voter.voter_id, session.id]
      );

      // Insert new votes
      for (const v of votes) {
        await client.query(`
          INSERT INTO kbn_votes (session_id, voter_id, card_id, direction, token_count)
          VALUES ($1, $2, $3, $4, $5)
        `, [session.id, req.voter.voter_id, v.card_id, v.direction, v.token_count]);
      }

      // Recalculate denormalized votes_for / votes_against on affected cards
      const affectedCardIds = [...cardIds];
      // Also include cards that may have had votes removed
      const { rows: prevVoteCards } = await client.query(
        `SELECT DISTINCT card_id FROM kbn_votes WHERE voter_id = $1 AND session_id = $2`,
        [req.voter.voter_id, session.id]
      );
      for (const r of prevVoteCards) {
        if (!affectedCardIds.includes(r.card_id)) affectedCardIds.push(r.card_id);
      }

      for (const cid of affectedCardIds) {
        await client.query(`
          UPDATE kbn_cards SET
            votes_for     = COALESCE((SELECT SUM(token_count) FROM kbn_votes WHERE card_id = $1 AND direction = 'for'), 0),
            votes_against = COALESCE((SELECT SUM(token_count) FROM kbn_votes WHERE card_id = $1 AND direction = 'against'), 0),
            updated_at    = NOW()
          WHERE id = $1
        `, [cid]);
      }

      await client.query('COMMIT');
      res.json({ saved: true, votes_cast: votes.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to cast votes' } });
  }
});

// GET /vote/:slug/results — live results (Bearer required)
router.get('/:slug/results', requireVoterToken, async (req, res) => {
  try {
    const session = await loadSession(req.params.slug);
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

    const { rows: cards } = await pool.query(`
      SELECT c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key,
             col.name AS column_name,
             COALESCE(SUM(CASE WHEN v.direction = 'for'     THEN v.token_count ELSE 0 END), 0) AS votes_for,
             COALESCE(SUM(CASE WHEN v.direction = 'against'  THEN v.token_count ELSE 0 END), 0) AS votes_against,
             COALESCE(SUM(CASE WHEN v.direction = 'for' THEN v.token_count ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN v.direction = 'against' THEN v.token_count ELSE 0 END), 0) AS net_score,
             COUNT(DISTINCT v.voter_id) AS voter_count
      FROM kbn_cards c
      JOIN kbn_columns col ON col.id = c.column_id
      LEFT JOIN kbn_votes v ON v.card_id = c.id AND v.session_id = ${session.id}
      WHERE ${cardFilter}
      GROUP BY c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key, col.name
      ORDER BY net_score DESC, votes_for DESC, c.title ASC
    `, vals);

    const { rows: [stats] } = await pool.query(`
      SELECT COUNT(DISTINCT voter_id) AS total_voters,
             COUNT(*) AS total_votes,
             COALESCE(SUM(token_count), 0) AS total_tokens
      FROM kbn_votes WHERE session_id = $1
    `, [session.id]);

    res.json({
      session: { id: session.id, name: session.name },
      cards,
      stats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch results' } });
  }
});

module.exports = router;
