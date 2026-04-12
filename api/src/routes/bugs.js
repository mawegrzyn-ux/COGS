const router = require('express').Router();
const pool   = require('../db/local-pool');
const { logAudit, diffFields } = require('../helpers/audit');

// ── GET / — list bugs with filters ──────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, priority, severity, assigned_to, search, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (status)      conditions.push(`status = $${vals.push(status)}`);
  if (priority)    conditions.push(`priority = $${vals.push(priority)}`);
  if (severity)    conditions.push(`severity = $${vals.push(severity)}`);
  if (assigned_to) conditions.push(`assigned_to = $${vals.push(assigned_to)}`);
  if (search)      conditions.push(`(summary ILIKE $${vals.push(`%${search}%`)} OR description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_bugs ${where} ORDER BY created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    const countQ = await pool.query(`SELECT COUNT(*)::int AS total FROM mcogs_bugs ${where}`,
      vals.slice(0, vals.length - 2));
    res.json({ rows, total: countQ.rows[0].total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch bugs' } });
  }
});

// ── GET /export/jira — Jira-compatible export (BEFORE /:id) ─────────────────
router.get('/export/jira', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_bugs ORDER BY created_at DESC`);
    const statusMap = { open: 'To Do', in_progress: 'In Progress', resolved: 'Done', closed: 'Done', wont_fix: "Won't Do" };
    const jira = rows.map(r => ({
      Summary:      r.summary,
      Description:  r.description || '',
      'Issue Type': 'Bug',
      Priority:     r.priority.charAt(0).toUpperCase() + r.priority.slice(1),
      Status:       statusMap[r.status] || 'To Do',
      Severity:     r.severity,
      Reporter:     r.reported_by_email || r.reported_by || '',
      Assignee:     r.assigned_to || '',
      Labels:       (r.labels || []).join(','),
      Created:      r.created_at,
      Updated:      r.updated_at,
    }));
    res.json(jira);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to export bugs' } });
  }
});

// ── GET /:id — single bug (includes can_edit flag) ─────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_bugs WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });
    const bug = rows[0];
    bug.can_edit = (bug.reported_by && bug.reported_by === req.user?.sub) || !!req.user?.is_dev;
    res.json(bug);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch bug' } });
  }
});

// ── POST / — create bug (anyone with bugs:write) ───────────────────────────
router.post('/', async (req, res) => {
  const { summary, description, priority, severity, page, steps_to_reproduce, environment, labels, attachments } = req.body;
  if (!summary?.trim()) return res.status(400).json({ error: { message: 'summary is required' } });
  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_bug_number_seq')::int AS num`);
    const key = `BUG-${keyRes.rows[0].num}`;
    const { rows } = await pool.query(`
      INSERT INTO mcogs_bugs (key, summary, description, priority, severity, reported_by, reported_by_email, page, steps_to_reproduce, environment, labels, attachments)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [
      key,
      summary.trim(),
      description?.trim() || null,
      priority || 'medium',
      severity || 'minor',
      req.user?.sub || null,
      req.user?.email || null,
      page?.trim() || null,
      steps_to_reproduce?.trim() || null,
      environment?.trim() || null,
      JSON.stringify(labels || []),
      JSON.stringify(attachments || []),
    ]);
    await logAudit(pool, req, { action: 'create', entity_type: 'bug', entity_id: rows[0].id, entity_label: key, context: { source: 'manual' } });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create bug' } });
  }
});

// ── PUT /:id — update bug (status changes require is_dev) ──────────────────
router.put('/:id', async (req, res) => {
  const { summary, description, priority, severity, status, assigned_to, page, steps_to_reproduce, environment, labels, resolution } = req.body;

  try {
    const old = await pool.query(`SELECT * FROM mcogs_bugs WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });

    // Author + dev gate — only the original reporter or a developer can edit
    const isAuthor = old.rows[0].reported_by && old.rows[0].reported_by === req.user?.sub;
    if (!isAuthor && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'Only the original reporter or a developer can edit this bug' } });
    }

    // Status changes still require dev even if you are the author
    if (status !== undefined && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'Only developers can change bug status' } });
    }

    const { rows } = await pool.query(`
      UPDATE mcogs_bugs SET
        summary = COALESCE($1, summary),
        description = COALESCE($2, description),
        priority = COALESCE($3, priority),
        severity = COALESCE($4, severity),
        status = COALESCE($5, status),
        assigned_to = COALESCE($6, assigned_to),
        page = COALESCE($7, page),
        steps_to_reproduce = COALESCE($8, steps_to_reproduce),
        environment = COALESCE($9, environment),
        labels = COALESCE($10, labels),
        resolution = COALESCE($11, resolution),
        updated_at = NOW()
      WHERE id = $12 RETURNING *
    `, [
      summary?.trim() || null,
      description?.trim() || null,
      priority || null,
      severity || null,
      status || null,
      assigned_to || null,
      page?.trim() || null,
      steps_to_reproduce?.trim() || null,
      environment?.trim() || null,
      labels ? JSON.stringify(labels) : null,
      resolution?.trim() || null,
      req.params.id,
    ]);

    const changes = diffFields(old.rows[0], rows[0], ['summary', 'priority', 'severity', 'status', 'assigned_to', 'resolution']);
    if (changes) await logAudit(pool, req, { action: 'update', entity_type: 'bug', entity_id: rows[0].id, entity_label: rows[0].key, field_changes: changes, context: { source: 'manual' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update bug' } });
  }
});

// ── DELETE /:id — dev only ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!req.user?.is_dev) return res.status(403).json({ error: { message: 'Only developers can delete bugs' } });
  try {
    const { rows } = await pool.query(`DELETE FROM mcogs_bugs WHERE id = $1 RETURNING id, key`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });
    await logAudit(pool, req, { action: 'delete', entity_type: 'bug', entity_id: rows[0].id, entity_label: rows[0].key, context: { source: 'manual' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete bug' } });
  }
});

// ── GET /:id/comments — list comments for a bug ───────────────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_item_comments WHERE entity_type = 'bug' AND entity_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch comments' } });
  }
});

// ── POST /:id/comments — add a comment (or reply) ─────────────────────────
router.post('/:id/comments', async (req, res) => {
  const { comment, parent_id } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: { message: 'comment is required' } });
  try {
    // Verify bug exists
    const bugCheck = await pool.query(`SELECT id FROM mcogs_bugs WHERE id = $1`, [req.params.id]);
    if (!bugCheck.rows.length) return res.status(404).json({ error: { message: 'Bug not found' } });

    // If reply, verify parent exists and belongs to same entity
    if (parent_id) {
      const parentCheck = await pool.query(
        `SELECT id FROM mcogs_item_comments WHERE id = $1 AND entity_type = 'bug' AND entity_id = $2`,
        [parent_id, req.params.id]
      );
      if (!parentCheck.rows.length) return res.status(400).json({ error: { message: 'Parent comment not found' } });
    }

    const { rows } = await pool.query(`
      INSERT INTO mcogs_item_comments (entity_type, entity_id, user_sub, user_email, user_name, comment, parent_id)
      VALUES ('bug', $1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.params.id, req.user?.sub || null, req.user?.email || null,
        req.user?.name || req.user?.email || 'Anonymous', comment.trim(), parent_id || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add comment' } });
  }
});

// ── DELETE /:id/comments/:commentId — delete own comment or dev ────────────
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_item_comments WHERE id = $1 AND entity_type = 'bug' AND entity_id = $2`,
      [req.params.commentId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Comment not found' } });
    const isCommentAuthor = rows[0].user_sub && rows[0].user_sub === req.user?.sub;
    if (!isCommentAuthor && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'Only the comment author or a developer can delete this comment' } });
    }
    await pool.query(`DELETE FROM mcogs_item_comments WHERE id = $1`, [req.params.commentId]);
    res.json({ deleted: parseInt(req.params.commentId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete comment' } });
  }
});

module.exports = router;
