const router    = require('express').Router();
const pool      = require('../db/pool');
const aiConfig  = require('../helpers/aiConfig');

// Key-auth middleware — checks X-Internal-Key header or ?key= query param
// Validates against the DB-managed CLAUDE_CODE_API_KEY (set via Settings > AI)
// with fallback to INTERNAL_API_KEY env var for backwards compatibility
function requireInternalKey(req, res, next) {
  const provided = req.headers['x-internal-key'] || req.query.key;
  const valid    = aiConfig.get('CLAUDE_CODE_API_KEY') || process.env.INTERNAL_API_KEY;
  if (!valid || provided !== valid) {
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

// POST /internal/feedback — create a ticket
router.post('/', async (req, res) => {
  const { type = 'general', title, description, page, status = 'open' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: { message: 'title is required' } });
  const validTypes    = ['bug', 'feature', 'general'];
  const validStatuses = ['open', 'in_progress', 'resolved'];
  if (!validTypes.includes(type))       return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });
  if (!validStatuses.includes(status))  return res.status(400).json({ error: { message: `status must be one of: ${validStatuses.join(', ')}` } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_feedback (type, title, description, page, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [type, title.trim(), description?.trim() || null, page?.trim() || null, status]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create ticket' } });
  }
});

// DELETE /internal/feedback/:id — delete a ticket
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM mcogs_feedback WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete ticket' } });
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
