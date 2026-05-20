const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');

// GET /boards/:boardId/columns
router.get('/:boardId/columns', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM kbn_cards WHERE column_id = c.id) AS card_count
      FROM kbn_columns c
      WHERE c.board_id = $1
      ORDER BY c.sort_order ASC
    `, [req.params.boardId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch columns' } });
  }
});

// POST /boards/:boardId/columns
router.post('/:boardId/columns', async (req, res) => {
  const { name, sort_order, color, wip_limit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    // Verify board exists
    const { rows: [board] } = await pool.query(
      `SELECT id FROM kbn_boards WHERE id = $1`, [req.params.boardId]
    );
    if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

    // Default sort_order to max + 1
    let order = sort_order;
    if (order === undefined || order === null) {
      const { rows: [max] } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM kbn_columns WHERE board_id = $1`,
        [req.params.boardId]
      );
      order = max.next;
    }

    const { rows: [col] } = await pool.query(`
      INSERT INTO kbn_columns (board_id, name, sort_order, color, wip_limit)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [req.params.boardId, name.trim(), order, color || null, wip_limit || null]);

    res.status(201).json(col);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create column' } });
  }
});

// PUT /boards/:boardId/columns/reorder
router.put('/:boardId/columns/reorder', async (req, res) => {
  const items = req.body; // [{id, sort_order}]
  if (!Array.isArray(items)) return res.status(400).json({ error: { message: 'Expected array of {id, sort_order}' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(
        `UPDATE kbn_columns SET sort_order=$1, updated_at=NOW() WHERE id=$2 AND board_id=$3`,
        [item.sort_order, item.id, req.params.boardId]
      );
    }
    await client.query('COMMIT');

    const { rows } = await pool.query(`
      SELECT * FROM kbn_columns WHERE board_id = $1 ORDER BY sort_order ASC
    `, [req.params.boardId]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to reorder columns' } });
  } finally {
    client.release();
  }
});

// PUT /boards/:boardId/columns/:id
router.put('/:boardId/columns/:id', async (req, res) => {
  const { name, sort_order, color, wip_limit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      UPDATE kbn_columns
      SET name=$1, sort_order=COALESCE($2, sort_order), color=$3, wip_limit=$4, updated_at=NOW()
      WHERE id=$5 AND board_id=$6
      RETURNING *
    `, [name.trim(), sort_order, color || null, wip_limit || null, req.params.id, req.params.boardId]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update column' } });
  }
});

// DELETE /boards/:boardId/columns/:id
router.delete('/:boardId/columns/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM kbn_columns WHERE id=$1 AND board_id=$2`, [req.params.id, req.params.boardId]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: { message: 'Cannot delete column with cards. Move or delete cards first.' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete column' } });
  }
});

module.exports = router;
