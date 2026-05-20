const router     = require('express').Router({ mergeParams: true });
const cardRouter = require('express').Router();
const pool       = require('../db/pool');

// GET /boards/:boardId/cards
router.get('/:boardId/cards', async (req, res) => {
  try {
    const { column_id, label, priority } = req.query;
    let query = `SELECT * FROM kbn_cards WHERE board_id = $1`;
    const vals = [req.params.boardId];
    let idx = 2;

    if (column_id) {
      query += ` AND column_id = $${idx++}`;
      vals.push(column_id);
    }
    if (priority) {
      query += ` AND priority = $${idx++}`;
      vals.push(priority);
    }
    if (label) {
      query += ` AND $${idx++} = ANY(labels)`;
      vals.push(label);
    }

    query += ` ORDER BY sort_order ASC, id ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch cards' } });
  }
});

// POST /boards/:boardId/cards
router.post('/:boardId/cards', async (req, res) => {
  const { column_id, title, description, priority, labels, story_points, epic, jira_key, sort_order } = req.body;
  if (!title?.trim())  return res.status(400).json({ error: { message: 'title is required' } });
  if (!column_id)      return res.status(400).json({ error: { message: 'column_id is required' } });

  try {
    // Verify column belongs to board
    const { rows: [col] } = await pool.query(
      `SELECT id FROM kbn_columns WHERE id = $1 AND board_id = $2`, [column_id, req.params.boardId]
    );
    if (!col) return res.status(400).json({ error: { message: 'Column not found on this board' } });

    let order = sort_order;
    if (order === undefined || order === null) {
      const { rows: [max] } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM kbn_cards WHERE column_id = $1`, [column_id]
      );
      order = max.next;
    }

    const { rows: [card] } = await pool.query(`
      INSERT INTO kbn_cards (board_id, column_id, title, description, priority, labels, story_points, epic, jira_key, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [
      req.params.boardId, column_id, title.trim(), description || null,
      priority || null, labels || null, story_points || null,
      epic || null, jira_key || null, order,
    ]);

    res.status(201).json(card);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create card' } });
  }
});

// ── Card-level routes (mounted at /cards) ────────────────────────────────────

// GET /cards/:id — full detail with vote breakdown
cardRouter.get('/:id', async (req, res) => {
  try {
    const { rows: [card] } = await pool.query(
      `SELECT * FROM kbn_cards WHERE id = $1`, [req.params.id]
    );
    if (!card) return res.status(404).json({ error: { message: 'Card not found' } });

    // Vote breakdown per session
    const { rows: votes } = await pool.query(`
      SELECT v.session_id, s.name AS session_name,
             SUM(CASE WHEN v.direction = 'for'     THEN v.token_count ELSE 0 END) AS total_for,
             SUM(CASE WHEN v.direction = 'against'  THEN v.token_count ELSE 0 END) AS total_against,
             COUNT(DISTINCT v.voter_id) AS voter_count
      FROM kbn_votes v
      JOIN kbn_sessions s ON s.id = v.session_id
      WHERE v.card_id = $1
      GROUP BY v.session_id, s.name
      ORDER BY s.name
    `, [req.params.id]);

    res.json({ ...card, vote_breakdown: votes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch card' } });
  }
});

// PUT /cards/:id
cardRouter.put('/:id', async (req, res) => {
  const { title, description, priority, labels, story_points, epic, jira_key, column_id, sort_order } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: { message: 'title is required' } });

  try {
    const { rows } = await pool.query(`
      UPDATE kbn_cards SET
        title=$1, description=$2, priority=$3, labels=$4, story_points=$5,
        epic=$6, jira_key=$7, column_id=COALESCE($8, column_id),
        sort_order=COALESCE($9, sort_order), updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [
      title.trim(), description || null, priority || null, labels || null,
      story_points || null, epic || null, jira_key || null,
      column_id || null, sort_order !== undefined ? sort_order : null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update card' } });
  }
});

// PUT /cards/:id/move — move card to column + position
cardRouter.put('/:id/move', async (req, res) => {
  const { column_id, sort_order } = req.body;
  if (!column_id) return res.status(400).json({ error: { message: 'column_id is required' } });

  try {
    // Verify column exists and get its board_id
    const { rows: [col] } = await pool.query(
      `SELECT board_id FROM kbn_columns WHERE id = $1`, [column_id]
    );
    if (!col) return res.status(400).json({ error: { message: 'Target column not found' } });

    const { rows } = await pool.query(`
      UPDATE kbn_cards SET column_id=$1, sort_order=COALESCE($2, sort_order), board_id=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [column_id, sort_order !== undefined ? sort_order : null, col.board_id, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Card not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to move card' } });
  }
});

// DELETE /cards/:id
cardRouter.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM kbn_cards WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete card' } });
  }
});

module.exports = router;
module.exports.cardRouter = cardRouter;
