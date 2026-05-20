const router    = require('express').Router();
const pool      = require('../db/local-pool');
const aiConfig  = require('../helpers/aiConfig');

function requireInternalKey(req, res, next) {
  const provided = req.headers['x-internal-key'] || req.query.key;
  const valid    = aiConfig.get('CLAUDE_CODE_API_KEY') || process.env.INTERNAL_API_KEY;
  if (!valid || provided !== valid) {
    return res.status(401).json({ error: { message: 'Invalid or missing API key' } });
  }
  next();
}

router.use(requireInternalKey);

// GET /internal/bugs?status=open&priority=high&severity=critical&search=&limit=50&offset=0
router.get('/', async (req, res) => {
  const { status, priority, severity, search, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (status)   conditions.push(`status = $${vals.push(status)}`);
  if (priority) conditions.push(`priority = $${vals.push(priority)}`);
  if (severity) conditions.push(`severity = $${vals.push(severity)}`);
  if (search)   conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_bugs ${where} ORDER BY created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch bugs' } });
  }
});

// POST /internal/bugs — create a bug
router.post('/', async (req, res) => {
  const { summary, description, priority, severity, page, steps_to_reproduce, environment, labels, status = 'open' } = req.body;
  if (!summary?.trim()) return res.status(400).json({ error: { message: 'summary is required' } });
  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_bug_number_seq')::int AS num`);
    const key = `BUG-${keyRes.rows[0].num}`;
    const { rows } = await pool.query(`
      INSERT INTO mcogs_bugs (key, summary, description, priority, severity, reported_by, reported_by_email, page, steps_to_reproduce, environment, labels, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [
      key,
      summary.trim(),
      description?.trim() || null,
      priority || 'medium',
      severity || 'minor',
      'claude-code',
      null,
      page?.trim() || null,
      steps_to_reproduce?.trim() || null,
      environment?.trim() || null,
      JSON.stringify(labels || []),
      status,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create bug' } });
  }
});

// PATCH /internal/bugs/:id — update fields
router.patch('/:id', async (req, res) => {
  const { summary, description, priority, severity, status, assigned_to, resolution, labels } = req.body;
  const sets = [];
  const vals = [];
  if (summary !== undefined)     sets.push(`summary = $${vals.push(summary.trim())}`);
  if (description !== undefined) sets.push(`description = $${vals.push(description.trim())}`);
  if (priority !== undefined)    sets.push(`priority = $${vals.push(priority)}`);
  if (severity !== undefined)    sets.push(`severity = $${vals.push(severity)}`);
  if (status !== undefined)      sets.push(`status = $${vals.push(status)}`);
  if (assigned_to !== undefined) sets.push(`assigned_to = $${vals.push(assigned_to)}`);
  if (resolution !== undefined)  sets.push(`resolution = $${vals.push(resolution.trim())}`);
  if (labels !== undefined)      sets.push(`labels = $${vals.push(JSON.stringify(labels))}`);
  if (!sets.length) return res.status(400).json({ error: { message: 'No fields to update' } });
  sets.push(`updated_at = NOW()`);
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_bugs SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update bug' } });
  }
});

// DELETE /internal/bugs/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM mcogs_bugs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete bug' } });
  }
});

module.exports = router;
