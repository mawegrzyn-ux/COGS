const router = require('express').Router();
const pool   = require('../db/local-pool');
const { logAudit, diffFields } = require('../helpers/audit');

// ── GET / — list backlog with filters ───────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, priority, item_type, assigned_to, search, sort = 'sort_order', limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (status)      conditions.push(`status = $${vals.push(status)}`);
  if (priority)    conditions.push(`priority = $${vals.push(priority)}`);
  if (item_type)   conditions.push(`item_type = $${vals.push(item_type)}`);
  if (assigned_to) conditions.push(`assigned_to = $${vals.push(assigned_to)}`);
  if (search)      conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap = {
    sort_order: 'sort_order ASC, created_at DESC',
    priority:   `CASE priority WHEN 'highest' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 WHEN 'lowest' THEN 5 END ASC, created_at DESC`,
    created_at: 'created_at DESC',
    updated_at: 'updated_at DESC',
  };
  const orderBy = sortMap[sort] || sortMap.sort_order;

  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_backlog ${where} ORDER BY ${orderBy} LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    const countQ = await pool.query(`SELECT COUNT(*)::int AS total FROM mcogs_backlog ${where}`,
      vals.slice(0, vals.length - 2));
    res.json({ rows, total: countQ.rows[0].total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch backlog' } });
  }
});

// ── GET /export/jira — Jira-compatible export (BEFORE /:id) ─────────────────
router.get('/export/jira', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_backlog ORDER BY sort_order ASC, created_at DESC`);
    const statusMap = { backlog: 'To Do', todo: 'To Do', in_progress: 'In Progress', in_review: 'In Progress', done: 'Done', wont_do: "Won't Do" };
    const typeMap   = { story: 'Story', task: 'Task', epic: 'Epic', improvement: 'Improvement' };
    const jira = rows.map(r => ({
      Summary:      r.summary,
      Description:  r.description || '',
      'Issue Type': typeMap[r.item_type] || 'Story',
      Priority:     r.priority.charAt(0).toUpperCase() + r.priority.slice(1),
      Status:       statusMap[r.status] || 'To Do',
      Reporter:     r.requested_by_email || r.requested_by || '',
      Assignee:     r.assigned_to || '',
      Labels:       (r.labels || []).join(','),
      'Story Points': r.story_points || '',
      Sprint:       r.sprint || '',
      Created:      r.created_at,
      Updated:      r.updated_at,
    }));
    res.json(jira);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to export backlog' } });
  }
});

// ── PUT /reorder — bulk sort_order update (BEFORE /:id) ─────────────────────
router.put('/reorder', async (req, res) => {
  const { items } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: { message: 'items array is required' } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, sort_order } of items) {
      await client.query(`UPDATE mcogs_backlog SET sort_order = $1, updated_at = NOW() WHERE id = $2`, [sort_order, id]);
    }
    await client.query('COMMIT');
    res.json({ updated: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to reorder backlog' } });
  } finally {
    client.release();
  }
});

// ── GET /:id — single backlog item ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_backlog WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch backlog item' } });
  }
});

// ── POST / — create backlog item (requires backlog:write) ───────────────────
router.post('/', async (req, res) => {
  const { summary, description, item_type, priority, labels, acceptance_criteria, story_points, sprint, assigned_to } = req.body;
  if (!summary?.trim()) return res.status(400).json({ error: { message: 'summary is required' } });
  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_backlog_number_seq')::int AS num`);
    const key = `BACK-${keyRes.rows[0].num}`;
    // Get max sort_order
    const maxSort = await pool.query(`SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next FROM mcogs_backlog`);
    const { rows } = await pool.query(`
      INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, requested_by, requested_by_email, assigned_to, labels, acceptance_criteria, story_points, sprint, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [
      key,
      summary.trim(),
      description?.trim() || null,
      item_type || 'story',
      priority || 'medium',
      req.user?.sub || null,
      req.user?.email || null,
      assigned_to || null,
      JSON.stringify(labels || []),
      acceptance_criteria?.trim() || null,
      story_points || null,
      sprint?.trim() || null,
      maxSort.rows[0].next,
    ]);
    await logAudit(pool, req, { action: 'create', entity_type: 'backlog', entity_id: rows[0].id, entity_label: key, context: { source: 'manual' } });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create backlog item' } });
  }
});

// ── PUT /:id — update backlog item (status changes require is_dev) ──────────
router.put('/:id', async (req, res) => {
  const { summary, description, item_type, priority, status, assigned_to, labels, acceptance_criteria, story_points, sprint } = req.body;

  if (status !== undefined && !req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Only developers can change backlog status' } });
  }

  try {
    const old = await pool.query(`SELECT * FROM mcogs_backlog WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });

    const { rows } = await pool.query(`
      UPDATE mcogs_backlog SET
        summary = COALESCE($1, summary),
        description = COALESCE($2, description),
        item_type = COALESCE($3, item_type),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        assigned_to = COALESCE($6, assigned_to),
        labels = COALESCE($7, labels),
        acceptance_criteria = COALESCE($8, acceptance_criteria),
        story_points = COALESCE($9, story_points),
        sprint = COALESCE($10, sprint),
        updated_at = NOW()
      WHERE id = $11 RETURNING *
    `, [
      summary?.trim() || null,
      description?.trim() || null,
      item_type || null,
      priority || null,
      status || null,
      assigned_to || null,
      labels ? JSON.stringify(labels) : null,
      acceptance_criteria?.trim() || null,
      story_points || null,
      sprint?.trim() || null,
      req.params.id,
    ]);

    const changes = diffFields(old.rows[0], rows[0], ['summary', 'item_type', 'priority', 'status', 'assigned_to', 'story_points', 'sprint']);
    if (changes) await logAudit(pool, req, { action: 'update', entity_type: 'backlog', entity_id: rows[0].id, entity_label: rows[0].key, field_changes: changes, context: { source: 'manual' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update backlog item' } });
  }
});

// ── DELETE /:id — dev only ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!req.user?.is_dev) return res.status(403).json({ error: { message: 'Only developers can delete backlog items' } });
  try {
    const { rows } = await pool.query(`DELETE FROM mcogs_backlog WHERE id = $1 RETURNING id, key`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });
    await logAudit(pool, req, { action: 'delete', entity_type: 'backlog', entity_id: rows[0].id, entity_label: rows[0].key, context: { source: 'manual' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete backlog item' } });
  }
});

module.exports = router;
