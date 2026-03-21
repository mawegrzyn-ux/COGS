const router = require('express').Router();
const pool   = require('../db/pool');

// Key-auth middleware — reads ?key= or X-Internal-Key header
function requireInternalKey(req, res, next) {
  const key = req.query.key || req.headers['x-internal-key'];
  if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: { message: 'Invalid or missing API key' } });
  }
  next();
}

router.use(requireInternalKey);

// GET /internal/feedback?type=bug&status=open&limit=50&offset=0
router.get('/', async (req, res) => {
  const { type, status, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (type)   { conditions.push(`type = $${vals.push(type)}`); }
  if (status) { conditions.push(`status = $${vals.push(status)}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_feedback ${where} ORDER BY created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch feedback' } });
  }
});

// PATCH /internal/feedback/:id — update status
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['open', 'in_progress', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: { message: `status must be one of: ${validStatuses.join(', ')}` } });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_feedback SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update feedback' } });
  }
});

module.exports = router;
