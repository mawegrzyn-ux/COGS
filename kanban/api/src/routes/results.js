const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');

// GET /boards/:boardId/results — aggregate results across all sessions for a board
router.get('/:boardId/results', async (req, res) => {
  try {
    // Verify board exists
    const { rows: [board] } = await pool.query(
      `SELECT id, name FROM kbn_boards WHERE id = $1`, [req.params.boardId]
    );
    if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

    // Ranked cards with aggregate vote totals across all sessions
    const { rows: cards } = await pool.query(`
      SELECT c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key,
             c.column_id, col.name AS column_name,
             c.votes_for, c.votes_against,
             (c.votes_for - c.votes_against) AS net_score,
             COUNT(DISTINCT v.voter_id) AS total_voters,
             COUNT(DISTINCT v.session_id) AS session_count
      FROM kbn_cards c
      JOIN kbn_columns col ON col.id = c.column_id
      LEFT JOIN kbn_votes v ON v.card_id = c.id
      WHERE c.board_id = $1
      GROUP BY c.id, c.title, c.priority, c.labels, c.story_points, c.epic, c.jira_key,
               c.column_id, col.name, c.votes_for, c.votes_against
      ORDER BY net_score DESC, c.votes_for DESC, c.title ASC
    `, [req.params.boardId]);

    // Aggregate stats
    const { rows: [stats] } = await pool.query(`
      SELECT COUNT(DISTINCT v.voter_id)  AS total_voters,
             COUNT(*)                     AS total_votes,
             COALESCE(SUM(v.token_count), 0) AS total_tokens,
             COUNT(DISTINCT v.session_id) AS session_count
      FROM kbn_votes v
      JOIN kbn_sessions s ON s.id = v.session_id
      WHERE s.board_id = $1
    `, [req.params.boardId]);

    res.json({
      board: { id: board.id, name: board.name },
      cards,
      stats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch results' } });
  }
});

module.exports = router;
