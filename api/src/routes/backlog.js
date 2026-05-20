const router    = require('express').Router();
const pool      = require('../db/local-pool');
const Anthropic = require('@anthropic-ai/sdk');
const aiConfig  = require('../helpers/aiConfig');
const { logAudit, diffFields } = require('../helpers/audit');

// ── GET / — list backlog with filters ───────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, priority, item_type, assigned_to, search, epic_id, orphan_stories, sort = 'sort_order', limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const vals = [];
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push(`b.status = $${vals.push(statuses[0])}`);
    } else {
      const placeholders = statuses.map(s => `$${vals.push(s)}`).join(',');
      conditions.push(`b.status IN (${placeholders})`);
    }
  }
  if (priority)    conditions.push(`b.priority = $${vals.push(priority)}`);
  if (item_type)   conditions.push(`b.item_type = $${vals.push(item_type)}`);
  if (assigned_to) conditions.push(`b.assigned_to = $${vals.push(assigned_to)}`);
  if (epic_id)     conditions.push(`b.epic_id = $${vals.push(parseInt(epic_id, 10))}`);
  if (orphan_stories === 'true') conditions.push(`b.epic_id IS NULL AND b.item_type != 'epic'`);
  if (search)      conditions.push(`(b.summary ILIKE $${vals.push(`%${search}%`)} OR b.description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap = {
    sort_order: 'b.sort_order ASC, b.created_at DESC',
    priority:   `CASE b.priority WHEN 'highest' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 WHEN 'lowest' THEN 5 END ASC, b.created_at DESC`,
    created_at: 'b.created_at DESC',
    updated_at: 'b.updated_at DESC',
    due_date:   'b.due_date ASC NULLS LAST, b.sort_order ASC',
  };
  const orderBy = sortMap[sort] || sortMap.sort_order;

  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT b.*, e.key AS epic_key, e.summary AS epic_summary,
              child_stats.child_count, child_stats.child_done
       FROM mcogs_backlog b
       LEFT JOIN mcogs_backlog e ON e.id = b.epic_id AND e.item_type = 'epic'
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS child_count,
                COUNT(*) FILTER (WHERE status = 'done')::int AS child_done
         FROM mcogs_backlog WHERE epic_id = b.id
       ) child_stats ON b.item_type = 'epic'
       ${where} ORDER BY ${orderBy} LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    const countQ = await pool.query(`SELECT COUNT(*)::int AS total FROM mcogs_backlog b ${where}`,
      vals.slice(0, vals.length - 2));
    res.json({ rows, total: countQ.rows[0].total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch backlog' } });
  }
});

// ── GET /epics — list all epics with child counts (BEFORE /:id) ────────────
router.get('/epics', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ep.*,
             COUNT(ch.id)::int AS child_count,
             COUNT(ch.id) FILTER (WHERE ch.status = 'done')::int AS child_done
      FROM mcogs_backlog ep
      LEFT JOIN mcogs_backlog ch ON ch.epic_id = ep.id
      WHERE ep.item_type = 'epic'
      GROUP BY ep.id
      ORDER BY ep.sort_order ASC, ep.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch epics' } });
  }
});

// ── GET /export/jira — Jira-compatible export (BEFORE /:id) ─────────────────
router.get('/export/jira', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, e.key AS epic_key
      FROM mcogs_backlog b
      LEFT JOIN mcogs_backlog e ON e.id = b.epic_id AND e.item_type = 'epic'
      ORDER BY b.sort_order ASC, b.created_at DESC
    `);
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
      'Epic Link':  r.epic_key || '',
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

// ── GET /:id — single backlog item (includes can_edit flag) ────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, e.key AS epic_key, e.summary AS epic_summary
      FROM mcogs_backlog b
      LEFT JOIN mcogs_backlog e ON e.id = b.epic_id AND e.item_type = 'epic'
      WHERE b.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });
    const item = rows[0];
    item.can_edit = (item.requested_by && item.requested_by === req.user?.sub) || !!req.user?.is_dev;
    // If this is an epic, attach child story count
    if (item.item_type === 'epic') {
      const childQ = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done
         FROM mcogs_backlog WHERE epic_id = $1`, [item.id]);
      item.child_count = childQ.rows[0].total;
      item.child_done  = childQ.rows[0].done;
    }
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch backlog item' } });
  }
});

// ── POST / — create backlog item (requires backlog:write) ───────────────────
router.post('/', async (req, res) => {
  const { summary, description, item_type, priority, labels, acceptance_criteria, story_points, sprint, assigned_to, epic_id, due_date } = req.body;
  if (!summary?.trim()) return res.status(400).json({ error: { message: 'summary is required' } });
  // Validate epic_id if provided — must reference an existing epic
  if (epic_id) {
    const epicCheck = await pool.query(`SELECT id FROM mcogs_backlog WHERE id = $1 AND item_type = 'epic'`, [epic_id]);
    if (!epicCheck.rows.length) return res.status(400).json({ error: { message: 'epic_id must reference an existing epic' } });
  }
  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_backlog_number_seq')::int AS num`);
    const key = `BACK-${keyRes.rows[0].num}`;
    // Get max sort_order
    const maxSort = await pool.query(`SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next FROM mcogs_backlog`);
    const { rows } = await pool.query(`
      INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, requested_by, requested_by_email, assigned_to, labels, acceptance_criteria, story_points, sprint, sort_order, epic_id, due_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *
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
      epic_id || null,
      due_date || null,
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
  const { summary, description, item_type, priority, status, assigned_to, labels, acceptance_criteria, story_points, sprint, epic_id, due_date } = req.body;

  try {
    const old = await pool.query(`SELECT * FROM mcogs_backlog WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });

    // Author + dev gate
    const isAuthor = old.rows[0].requested_by && old.rows[0].requested_by === req.user?.sub;
    if (!isAuthor && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'Only the original requester or a developer can edit this item' } });
    }

    // Status changes still require dev even if author
    if (status !== undefined && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'Only developers can change backlog status' } });
    }

    // Validate epic_id if provided
    if (epic_id) {
      if (epic_id === parseInt(req.params.id, 10)) return res.status(400).json({ error: { message: 'An item cannot be its own epic' } });
      const epicCheck = await pool.query(`SELECT id FROM mcogs_backlog WHERE id = $1 AND item_type = 'epic'`, [epic_id]);
      if (!epicCheck.rows.length) return res.status(400).json({ error: { message: 'epic_id must reference an existing epic' } });
    }

    // Handle explicit null for epic_id (unlink from epic) — use sentinel 0 to mean "clear"
    const epicVal = epic_id === null || epic_id === 0 ? null : (epic_id || undefined);

    // due_date: undefined → keep, '' or null → clear, '2026-05-15' → set
    const dueProvided = Object.prototype.hasOwnProperty.call(req.body, 'due_date');
    const dueVal = !dueProvided ? undefined
                 : (due_date === null || due_date === '') ? null
                 : due_date;

    const params = [
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
    ];
    let epicClause = 'epic_id = epic_id';
    if (epic_id !== undefined) {
      params.push(epicVal);
      epicClause = `epic_id = $${params.length}`;
    }
    let dueClause = 'due_date = due_date';
    if (dueVal !== undefined) {
      params.push(dueVal);
      dueClause = `due_date = $${params.length}`;
    }

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
        ${epicClause},
        ${dueClause},
        updated_at = NOW()
      WHERE id = $11 RETURNING *
    `, params);

    const changes = diffFields(old.rows[0], rows[0], ['summary', 'item_type', 'priority', 'status', 'assigned_to', 'story_points', 'sprint', 'epic_id', 'due_date']);
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

// ── GET /:id/comments — list comments for a backlog item ───────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_item_comments WHERE entity_type = 'backlog' AND entity_id = $1 ORDER BY created_at ASC`,
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
    const itemCheck = await pool.query(`SELECT id FROM mcogs_backlog WHERE id = $1`, [req.params.id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: { message: 'Backlog item not found' } });

    if (parent_id) {
      const parentCheck = await pool.query(
        `SELECT id FROM mcogs_item_comments WHERE id = $1 AND entity_type = 'backlog' AND entity_id = $2`,
        [parent_id, req.params.id]
      );
      if (!parentCheck.rows.length) return res.status(400).json({ error: { message: 'Parent comment not found' } });
    }

    const { rows } = await pool.query(`
      INSERT INTO mcogs_item_comments (entity_type, entity_id, user_sub, user_email, user_name, comment, parent_id)
      VALUES ('backlog', $1, $2, $3, $4, $5, $6) RETURNING *
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
      `SELECT * FROM mcogs_item_comments WHERE id = $1 AND entity_type = 'backlog' AND entity_id = $2`,
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

// ── POST /backlog/suggest-priorities ──────────────────────────────────────
// Claude reads all open backlog items and proposes priority adjustments.
// Returns a structured `{summary, proposals: [{key, summary, current, proposed, reasoning}]}`
// payload — the frontend Kanban modal lets the user accept/reject each one
// and batches PUTs through the existing PUT /backlog/:id endpoint.
router.post('/suggest-priorities', async (req, res) => {
  if (!req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Only developers can request priority suggestions' } });
  }

  try {
    // 1. Load all OPEN backlog items (skip done/wont_do — no need to reprioritise)
    const { rows: items } = await pool.query(`
      SELECT b.id, b.key, b.summary, b.description, b.item_type, b.priority,
             b.status, b.story_points, b.labels,
             ep.key AS epic_key, ep.summary AS epic_summary
      FROM   mcogs_backlog b
      LEFT JOIN mcogs_backlog ep ON ep.id = b.epic_id
      WHERE  b.status IN ('backlog', 'todo', 'in_progress', 'in_review')
      ORDER BY b.created_at DESC
      LIMIT 200
    `);

    if (items.length === 0) {
      return res.json({ summary: 'No open backlog items to triage.', proposals: [] });
    }

    // 2. Build a compact representation for the AI — drop fields it doesn't need
    const compact = items.map(i => ({
      key:           i.key,
      summary:       i.summary,
      description:   (i.description || '').slice(0, 500), // cap to keep token use reasonable
      item_type:     i.item_type,
      current_priority: i.priority,
      status:        i.status,
      story_points:  i.story_points,
      labels:        Array.isArray(i.labels) ? i.labels : [],
      epic:          i.epic_key ? `${i.epic_key} — ${i.epic_summary}` : null,
    }));

    // 3. System prompt — strict JSON contract, conservative defaults
    const systemPrompt = `You are a product manager helping triage a software backlog.

Priorities (highest → lowest):
- highest: blocks revenue, security, or compliance; user-facing breakage; legal/regulatory deadline
- high: significant UX pain, frequent customer complaint, blocks other work
- medium: meaningful improvement, planned feature work
- low: nice-to-have, cosmetic, niche edge case
- lowest: backlog noise, "someday/maybe", trivial

You will be given a list of open backlog items. Propose a priority for each AS A JSON OBJECT with this exact structure:

{
  "summary": "<one-sentence overview of the proposed reprioritisation>",
  "proposals": [
    {
      "key": "<item key like BACK-1234>",
      "current": "<current priority>",
      "proposed": "<proposed priority>",
      "reasoning": "<one short sentence — why>"
    }
  ]
}

Rules:
- Only include items where you would CHANGE the priority. If the current priority is correct, OMIT the item.
- Be conservative — small adjustments are fine; aggressive sweeps cause churn.
- Use the description, item_type, status, story_points, labels, and epic context to inform the call.
- If you can't tell, leave the item alone (omit it).
- Output ONLY the JSON object, no preamble, no code fences.`;

    // 4. Call Claude Haiku
    const apiKey = aiConfig.get('ANTHROPIC_API_KEY');
    if (!apiKey) return res.status(503).json({ error: { message: 'AI is not configured. Set an Anthropic API key in Settings → AI.' } });
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Backlog items:\n${JSON.stringify(compact, null, 2)}` }],
    });

    // 5. Parse JSON response (forgiving — strip code fences if present)
    const text = response.content?.[0]?.text || '';
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || text);
    } catch {
      parsed = { summary: 'Could not parse AI response', proposals: [], raw: text };
    }

    // 6. Enrich proposals with the item id + summary for the modal
    const byKey = new Map(items.map(i => [i.key, i]));
    const proposals = (parsed.proposals || [])
      .map(p => {
        const it = byKey.get(p.key);
        if (!it) return null;
        const valid = ['highest', 'high', 'medium', 'low', 'lowest'];
        if (!valid.includes(p.proposed) || !valid.includes(p.current)) return null;
        if (p.proposed === it.priority) return null; // sanity check — must be a change
        return {
          key:       it.key,
          id:        it.id,
          summary:   it.summary,
          current:   it.priority,
          proposed:  p.proposed,
          reasoning: String(p.reasoning || '').slice(0, 300),
        };
      })
      .filter(Boolean);

    // 7. Log the AI call
    try {
      await pool.query(`
        INSERT INTO mcogs_ai_chat_log (user_sub, messages, tools_called, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        req.user?.sub || null,
        JSON.stringify([
          { role: 'user', content: `Suggest priorities for ${items.length} open backlog items` },
          { role: 'assistant', content: text },
        ]),
        JSON.stringify(['suggest_backlog_priorities']),
        response.usage?.input_tokens || 0,
        response.usage?.output_tokens || 0,
      ]);
    } catch { /* silent */ }

    res.json({
      summary:   parsed.summary || `${proposals.length} proposed change${proposals.length !== 1 ? 's' : ''}.`,
      proposals,
    });
  } catch (err) {
    console.error('[suggest-priorities]', err);
    res.status(500).json({ error: { message: 'Failed to generate priority suggestions' } });
  }
});

module.exports = router;
