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

// GET /internal/backlog?status=backlog&priority=high&item_type=story&search=&limit=50&offset=0
router.get('/', async (req, res) => {
  const { status, priority, item_type, search, sort = 'sort_order', limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (status)    conditions.push(`status = $${vals.push(status)}`);
  if (priority)  conditions.push(`priority = $${vals.push(priority)}`);
  if (item_type) conditions.push(`item_type = $${vals.push(item_type)}`);
  if (search)    conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap = {
    sort_order: 'sort_order ASC, created_at DESC',
    priority:   `CASE priority WHEN 'highest' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 WHEN 'lowest' THEN 5 END ASC`,
    created_at: 'created_at DESC',
  };
  const orderBy = sortMap[sort] || sortMap.sort_order;

  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_backlog ${where} ORDER BY ${orderBy} LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch backlog' } });
  }
});

// POST /internal/backlog — create
router.post('/', async (req, res) => {
  const { summary, description, item_type, priority, labels, acceptance_criteria, story_points, sprint, status = 'backlog' } = req.body;
  if (!summary?.trim()) return res.status(400).json({ error: { message: 'summary is required' } });
  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_backlog_number_seq')::int AS num`);
    const key = `BACK-${keyRes.rows[0].num}`;
    const maxSort = await pool.query(`SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next FROM mcogs_backlog`);
    const { rows } = await pool.query(`
      INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, requested_by, requested_by_email, labels, acceptance_criteria, story_points, sprint, sort_order, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [
      key,
      summary.trim(),
      description?.trim() || null,
      item_type || 'story',
      priority || 'medium',
      'claude-code',
      null,
      JSON.stringify(labels || []),
      acceptance_criteria?.trim() || null,
      story_points || null,
      sprint?.trim() || null,
      maxSort.rows[0].next,
      status,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create backlog item' } });
  }
});

// PATCH /internal/backlog/:id — update
router.patch('/:id', async (req, res) => {
  const { summary, description, item_type, priority, status, assigned_to, labels, acceptance_criteria, story_points, sprint, sort_order, epic_id } = req.body;
  const sets = [];
  const vals = [];
  if (summary !== undefined)             sets.push(`summary = $${vals.push(summary.trim())}`);
  if (description !== undefined)         sets.push(`description = $${vals.push(description.trim())}`);
  if (item_type !== undefined)           sets.push(`item_type = $${vals.push(item_type)}`);
  if (priority !== undefined)            sets.push(`priority = $${vals.push(priority)}`);
  if (status !== undefined)              sets.push(`status = $${vals.push(status)}`);
  if (assigned_to !== undefined)         sets.push(`assigned_to = $${vals.push(assigned_to)}`);
  if (labels !== undefined)              sets.push(`labels = $${vals.push(JSON.stringify(labels))}`);
  if (acceptance_criteria !== undefined) sets.push(`acceptance_criteria = $${vals.push(acceptance_criteria.trim())}`);
  if (story_points !== undefined)        sets.push(`story_points = $${vals.push(story_points)}`);
  if (sprint !== undefined)              sets.push(`sprint = $${vals.push(sprint.trim())}`);
  if (sort_order !== undefined)          sets.push(`sort_order = $${vals.push(sort_order)}`);
  if (epic_id !== undefined)             sets.push(`epic_id = $${vals.push(epic_id)}`);
  if (!sets.length) return res.status(400).json({ error: { message: 'No fields to update' } });
  sets.push(`updated_at = NOW()`);
  vals.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_backlog SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update backlog item' } });
  }
});

// DELETE /internal/backlog/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM mcogs_backlog WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete backlog item' } });
  }
});

module.exports = router;
