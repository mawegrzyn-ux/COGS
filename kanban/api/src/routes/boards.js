const router = require('express').Router();
const pool   = require('../db/pool');

// GET /boards
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*,
             (SELECT COUNT(*) FROM kbn_columns WHERE board_id = b.id) AS column_count,
             (SELECT COUNT(*) FROM kbn_cards   WHERE board_id = b.id) AS card_count
      FROM kbn_boards b
      ORDER BY b.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch boards' } });
  }
});

// GET /boards/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [board] } = await pool.query(
      `SELECT * FROM kbn_boards WHERE id = $1`, [req.params.id]
    );
    if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

    const { rows: columns } = await pool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM kbn_cards WHERE column_id = c.id) AS card_count
      FROM kbn_columns c
      WHERE c.board_id = $1
      ORDER BY c.sort_order ASC
    `, [req.params.id]);

    res.json({ ...board, columns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch board' } });
  }
});

// POST /boards
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [board] } = await client.query(`
      INSERT INTO kbn_boards (name, description)
      VALUES ($1, $2) RETURNING *
    `, [name.trim(), description || null]);

    // Create 5 default columns
    const defaults = [
      { name: 'Backlog',     sort_order: 0, color: '#6B7280' },
      { name: 'To Do',       sort_order: 1, color: '#3B82F6' },
      { name: 'In Progress', sort_order: 2, color: '#F59E0B' },
      { name: 'Review',      sort_order: 3, color: '#8B5CF6' },
      { name: 'Done',        sort_order: 4, color: '#10B981' },
    ];

    const colRows = [];
    for (const col of defaults) {
      const { rows: [row] } = await client.query(`
        INSERT INTO kbn_columns (board_id, name, sort_order, color)
        VALUES ($1, $2, $3, $4) RETURNING *
      `, [board.id, col.name, col.sort_order, col.color]);
      colRows.push(row);
    }

    await client.query('COMMIT');
    res.status(201).json({ ...board, columns: colRows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create board' } });
  } finally {
    client.release();
  }
});

// PUT /boards/:id
router.put('/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      UPDATE kbn_boards SET name=$1, description=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [name.trim(), description || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update board' } });
  }
});

// DELETE /boards/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM kbn_boards WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete board' } });
  }
});

module.exports = router;
