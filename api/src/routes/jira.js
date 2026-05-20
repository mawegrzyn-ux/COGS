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
    const result = await syncAll({ trigger: 'manual' });
    res.json(result);
  } catch (err) {
    console.error('[jira] pull/all error:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /sync-status — last sync summary for the UI banner ─────────────────
router.get('/sync-status', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`);
    const status = rows[0]?.data?.jira_sync_status || null;
    res.json({
      configured: jira.isConfigured(),
      status,     // null if never synced
    });
  } catch (err) {
    console.error('[jira] sync-status error:', err);
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
//
// Now pulls status + priority + summary + description (flattened from ADF) +
// labels. Conflict resolution: if the local row's `updated_at` is newer than
// Jira's `updated` timestamp we skip Jira's values for that field so a
// freshly-edited local row doesn't get stomped. Next push will sync the
// other direction.
async function pullItem(type, id) {
  const table = type === 'bug' ? 'mcogs_bugs' : 'mcogs_backlog';
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`${type} #${id} not found`);
  const item = rows[0];
  if (!item.jira_key) throw new Error(`${type} #${id} is not linked to Jira`);

  const issue = await jira.getIssue(item.jira_key);
  const f = issue.fields || {};

  // Remote update timestamp from Jira — ms-precision ISO. Falls back to the
  // `created` field if `updated` is missing (shouldn't happen in practice).
  const remoteUpdatedAt = f.updated ? new Date(f.updated) : null;
  const localUpdatedAt  = item.updated_at ? new Date(item.updated_at) : null;

  // Only overwrite local fields when Jira is newer (or local timestamp is
  // missing, which is a degenerate case). This is the "last write wins" rule
  // the user asked for — gentle on fresh local edits.
  const jiraIsNewer = !localUpdatedAt || (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt);

  const jiraStatusName = (f.status?.name   || '').toLowerCase();
  const jiraPriority   = (f.priority?.name || '').toLowerCase();
  const statusMap      = type === 'bug' ? jira.BUG_STATUS_FROM_JIRA : jira.BACKLOG_STATUS_FROM_JIRA;
  const newStatus      = statusMap[jiraStatusName] || null;
  const newPriority    = jira.PRIORITY_FROM_JIRA[jiraPriority] || null;

  const newSummary     = typeof f.summary === 'string' ? f.summary.trim() : null;
  const newDescription = jira.adfToText(f.description) || null;
  const newLabels      = Array.isArray(f.labels) ? f.labels : null;

  const updates = [];
  const vals    = [];
  let idx = 1;
  const changes = {};

  // Status + priority always sync (Jira is workflow source of truth).
  if (newStatus && newStatus !== item.status) {
    updates.push(`status = $${idx++}`);
    vals.push(newStatus);
    changes.status = { from: item.status, to: newStatus };
  }
  if (newPriority && newPriority !== item.priority) {
    updates.push(`priority = $${idx++}`);
    vals.push(newPriority);
    changes.priority = { from: item.priority, to: newPriority };
  }

  // Text fields only sync when Jira is newer (conflict guard).
  if (jiraIsNewer) {
    if (newSummary && newSummary !== item.summary) {
      updates.push(`summary = $${idx++}`);
      vals.push(newSummary);
      changes.summary = { from: item.summary, to: newSummary };
    }
    if (newDescription != null && newDescription !== item.description) {
      updates.push(`description = $${idx++}`);
      vals.push(newDescription);
      changes.description = { changed: true };
    }
    if (newLabels) {
      const currentLabels = Array.isArray(item.labels) ? item.labels : []
      const same = currentLabels.length === newLabels.length &&
                   currentLabels.every((l, i) => l === newLabels[i])
      if (!same) {
        updates.push(`labels = $${idx++}`);
        vals.push(JSON.stringify(newLabels));
        changes.labels = { from: currentLabels, to: newLabels };
      }
    }
  } else {
    changes.skippedTextFields = 'local is newer';
  }

  updates.push(`jira_synced_at = NOW()`);
  if (remoteUpdatedAt) {
    updates.push(`jira_remote_updated_at = $${idx++}`);
    vals.push(remoteUpdatedAt);
  }

  if (updates.length) {
    vals.push(id);
    await pool.query(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = $${idx}`, vals);
  }

  return {
    pulled:   true,
    jira_key: item.jira_key,
    changes,
    skipped:  Object.keys(changes).length === 0,
  };
}

// ── Shared: pull every linked item + record outcome to mcogs_settings ──────
// Used by both POST /pull/all (UI Sync Now button) and the syncJira cron.
// `trigger` is 'manual' or 'cron' and ends up in the sync-status payload so
// the UI can tell the user "Last synced N min ago via cron" vs "You clicked
// Sync Now just now".
async function syncAll({ trigger = 'cron' } = {}) {
  const startedAt = new Date();
  const out = {
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    pulled: 0,
    changedCount: 0,
    errors: [],
  };

  if (!jira.isConfigured()) {
    out.error = 'Jira not configured';
    out.finishedAt = new Date().toISOString();
    return out;
  }

  try {
    const [bugsRes, backlogRes] = await Promise.all([
      pool.query(`SELECT id FROM mcogs_bugs    WHERE jira_key IS NOT NULL`),
      pool.query(`SELECT id FROM mcogs_backlog WHERE jira_key IS NOT NULL`),
    ]);
    for (const row of bugsRes.rows) {
      try {
        const r = await pullItem('bug', row.id);
        out.pulled++;
        if (r && !r.skipped) out.changedCount++;
      } catch (err) {
        out.errors.push({ type: 'bug', id: row.id, error: err.message });
      }
    }
    for (const row of backlogRes.rows) {
      try {
        const r = await pullItem('backlog', row.id);
        out.pulled++;
        if (r && !r.skipped) out.changedCount++;
      } catch (err) {
        out.errors.push({ type: 'backlog', id: row.id, error: err.message });
      }
    }
  } catch (err) {
    out.errors.push({ type: 'fatal', error: err.message });
  }

  out.finishedAt = new Date().toISOString();
  out.durationMs = Date.now() - startedAt.getTime();

  // Persist last-run status so the UI banner + any admin report can surface it.
  try {
    await pool.query(
      `INSERT INTO mcogs_settings (id, data) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE
       SET data = COALESCE(mcogs_settings.data, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()`,
      [JSON.stringify({ jira_sync_status: out })]
    );
  } catch (err) {
    console.warn('[jira] failed to persist sync status:', err.message);
  }

  return out;
}

module.exports = router;
module.exports.syncAll = syncAll;
