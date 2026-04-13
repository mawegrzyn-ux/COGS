// =============================================================================
// Jira Integration route
//
// GET  /               — config status + linked item counts
// POST /test           — test Jira connection
// POST /push/:type/:id — push single item to Jira (create or update)
// POST /push/bulk      — push multiple items
// POST /pull/:type/:id — pull latest from Jira for one linked item
// POST /pull/all       — pull all linked items
// POST /unlink/:type/:id — clear Jira link on local item
//
// All routes require settings:write (admin-only). Registered in index.js.
// =============================================================================

const router = require('express').Router();
const pool   = require('../db/local-pool');
const jira   = require('../helpers/jira');

// ── GET / — config status + linked counts ───────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const configured = jira.isConfigured();
    let bugCount = 0, backlogCount = 0, projectKey = null, baseUrl = null;

    if (configured) {
      const aiConfig = require('../helpers/aiConfig');
      projectKey = aiConfig.get('JIRA_PROJECT_KEY');
      baseUrl    = aiConfig.get('JIRA_BASE_URL');

      const [b, bl] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS c FROM mcogs_bugs WHERE jira_key IS NOT NULL`),
        pool.query(`SELECT COUNT(*)::int AS c FROM mcogs_backlog WHERE jira_key IS NOT NULL`),
      ]);
      bugCount     = b.rows[0].c;
      backlogCount = bl.rows[0].c;
    }

    res.json({ configured, projectKey, baseUrl, linkedBugs: bugCount, linkedBacklog: backlogCount });
  } catch (err) {
    console.error('[jira] status error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch Jira status' } });
  }
});

// ── POST /test — test connection ────────────────────────────────────────────
router.post('/test', async (_req, res) => {
  try {
    if (!jira.isConfigured()) {
      return res.status(400).json({ error: { message: 'Jira integration is not fully configured' } });
    }
    const result = await jira.testConnection();
    res.json(result);
  } catch (err) {
    console.error('[jira] test error:', err);
    res.status(400).json({ error: { message: err.message } });
  }
});

// ── POST /push/:type/:id — push single item ────────────────────────────────
router.post('/push/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!['bug', 'backlog'].includes(type)) {
    return res.status(400).json({ error: { message: 'type must be "bug" or "backlog"' } });
  }
  if (!jira.isConfigured()) {
    return res.status(400).json({ error: { message: 'Jira not configured' } });
  }

  try {
    const result = await pushItem(type, parseInt(id, 10));
    res.json(result);
  } catch (err) {
    console.error(`[jira] push ${type}/${id} error:`, err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /push/bulk — push multiple items ───────────────────────────────────
router.post('/push/bulk', async (req, res) => {
  const { bugs = [], backlog = [] } = req.body;
  if (!jira.isConfigured()) {
    return res.status(400).json({ error: { message: 'Jira not configured' } });
  }

  const results = { pushed: 0, errors: [] };
  for (const id of bugs) {
    try { await pushItem('bug', id); results.pushed++; }
    catch (err) { results.errors.push({ type: 'bug', id, error: err.message }); }
  }
  for (const id of backlog) {
    try { await pushItem('backlog', id); results.pushed++; }
    catch (err) { results.errors.push({ type: 'backlog', id, error: err.message }); }
  }
  res.json(results);
});

// ── POST /pull/:type/:id — pull from Jira for one item ─────────────────────
router.post('/pull/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!['bug', 'backlog'].includes(type)) {
    return res.status(400).json({ error: { message: 'type must be "bug" or "backlog"' } });
  }
  if (!jira.isConfigured()) {
    return res.status(400).json({ error: { message: 'Jira not configured' } });
  }

  try {
    const result = await pullItem(type, parseInt(id, 10));
    res.json(result);
  } catch (err) {
    console.error(`[jira] pull ${type}/${id} error:`, err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /pull/all — pull all linked items ──────────────────────────────────
router.post('/pull/all', async (_req, res) => {
  if (!jira.isConfigured()) {
    return res.status(400).json({ error: { message: 'Jira not configured' } });
  }

  try {
    const results = { pulled: 0, errors: [] };

    const [bugsRes, backlogRes] = await Promise.all([
      pool.query(`SELECT id FROM mcogs_bugs WHERE jira_key IS NOT NULL`),
      pool.query(`SELECT id FROM mcogs_backlog WHERE jira_key IS NOT NULL`),
    ]);

    for (const row of bugsRes.rows) {
      try { await pullItem('bug', row.id); results.pulled++; }
      catch (err) { results.errors.push({ type: 'bug', id: row.id, error: err.message }); }
    }
    for (const row of backlogRes.rows) {
      try { await pullItem('backlog', row.id); results.pulled++; }
      catch (err) { results.errors.push({ type: 'backlog', id: row.id, error: err.message }); }
    }

    res.json(results);
  } catch (err) {
    console.error('[jira] pull/all error:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /unlink/:type/:id — remove Jira link ──────────────────────────────
router.post('/unlink/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const table = type === 'bug' ? 'mcogs_bugs' : type === 'backlog' ? 'mcogs_backlog' : null;
  if (!table) return res.status(400).json({ error: { message: 'type must be "bug" or "backlog"' } });

  try {
    await pool.query(
      `UPDATE ${table} SET jira_key = NULL, jira_id = NULL, jira_url = NULL, jira_synced_at = NULL WHERE id = $1`,
      [id]
    );
    res.json({ unlinked: true });
  } catch (err) {
    console.error(`[jira] unlink ${type}/${id} error:`, err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── Internal: push a single item to Jira ────────────────────────────────────

async function pushItem(type, id) {
  const table = type === 'bug' ? 'mcogs_bugs' : 'mcogs_backlog';
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`${type} #${id} not found`);
  const item = rows[0];

  const fields    = type === 'bug' ? jira.buildBugFields(item) : jira.buildBacklogFields(item);
  const statusMap = type === 'bug' ? jira.BUG_STATUS_TO_JIRA : jira.BACKLOG_STATUS_TO_JIRA;
  const desiredJiraStatus = statusMap[item.status] || null;

  if (item.jira_key) {
    // ── Update existing ──
    await jira.updateIssue(item.jira_key, fields);
    // Try to transition to match current COGS status
    if (desiredJiraStatus) {
      await jira.tryTransition(item.jira_key, desiredJiraStatus);
    }
    await pool.query(
      `UPDATE ${table} SET jira_synced_at = NOW() WHERE id = $1`, [id]
    );
    return { action: 'updated', jira_key: item.jira_key };
  } else {
    // ── Create new ──
    const created = await jira.createIssue(fields);
    const jiraKey = created.key;
    const jiraId  = created.id;
    const aiConfig = require('../helpers/aiConfig');
    const baseUrl  = (aiConfig.get('JIRA_BASE_URL') || '').replace(/\/+$/, '');
    const jiraUrl  = `${baseUrl}/browse/${jiraKey}`;

    await pool.query(
      `UPDATE ${table} SET jira_key = $1, jira_id = $2, jira_url = $3, jira_synced_at = NOW() WHERE id = $4`,
      [jiraKey, jiraId, jiraUrl, id]
    );

    // Try to transition to match current COGS status (new issues start as "To Do")
    if (desiredJiraStatus && desiredJiraStatus !== 'To Do') {
      try { await jira.tryTransition(jiraKey, desiredJiraStatus); } catch { /* best effort */ }
    }

    return { action: 'created', jira_key: jiraKey, jira_url: jiraUrl };
  }
}

// ── Internal: pull a single item from Jira ──────────────────────────────────

async function pullItem(type, id) {
  const table = type === 'bug' ? 'mcogs_bugs' : 'mcogs_backlog';
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`${type} #${id} not found`);
  const item = rows[0];
  if (!item.jira_key) throw new Error(`${type} #${id} is not linked to Jira`);

  const issue = await jira.getIssue(item.jira_key);
  const jiraStatusName = (issue.fields?.status?.name || '').toLowerCase();
  const jiraPriority   = (issue.fields?.priority?.name || '').toLowerCase();

  const statusMap   = type === 'bug' ? jira.BUG_STATUS_FROM_JIRA : jira.BACKLOG_STATUS_FROM_JIRA;
  const newStatus   = statusMap[jiraStatusName] || null;
  const newPriority = jira.PRIORITY_FROM_JIRA[jiraPriority] || null;

  const updates = [];
  const vals    = [];
  let idx = 1;

  if (newStatus && newStatus !== item.status) {
    updates.push(`status = $${idx++}`);
    vals.push(newStatus);
  }
  if (newPriority && newPriority !== item.priority) {
    updates.push(`priority = $${idx++}`);
    vals.push(newPriority);
  }
  updates.push(`jira_synced_at = NOW()`);

  if (updates.length) {
    vals.push(id);
    await pool.query(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
  }

  return {
    pulled: true,
    jira_key: item.jira_key,
    status_changed: newStatus && newStatus !== item.status ? { from: item.status, to: newStatus } : null,
    priority_changed: newPriority && newPriority !== item.priority ? { from: item.priority, to: newPriority } : null,
  };
}

module.exports = router;
