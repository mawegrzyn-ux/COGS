// =============================================================================
// Jira REST API v3 wrapper
//
// All credentials are read from the runtime aiConfig cache (populated from the
// encrypted config-store). Never stores or logs credentials.
//
// Jira Cloud REST API docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
// =============================================================================

const aiConfig = require('./aiConfig');

// ── Status / priority / type mappings ─────────────────────────────────────────

const BUG_STATUS_TO_JIRA  = { open: 'To Do', in_progress: 'In Progress', resolved: 'Done', closed: 'Done', wont_fix: "Won't Do" };
const BUG_STATUS_FROM_JIRA = Object.fromEntries(
  Object.entries(BUG_STATUS_TO_JIRA).map(([k, v]) => [v.toLowerCase(), k])
);
// Jira "Done" maps to resolved (not closed) by default
BUG_STATUS_FROM_JIRA['done'] = 'resolved';

const BACKLOG_STATUS_TO_JIRA  = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', wont_do: "Won't Do" };
const BACKLOG_STATUS_FROM_JIRA = Object.fromEntries(
  Object.entries(BACKLOG_STATUS_TO_JIRA).map(([k, v]) => [v.toLowerCase(), k])
);

const PRIORITY_TO_JIRA   = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };
const PRIORITY_FROM_JIRA = Object.fromEntries(
  Object.entries(PRIORITY_TO_JIRA).map(([k, v]) => [v.toLowerCase(), k])
);

const BACKLOG_TYPE_TO_JIRA = { story: 'Story', task: 'Task', epic: 'Epic', improvement: 'Improvement' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function isConfigured() {
  return !!(
    aiConfig.get('JIRA_BASE_URL') &&
    aiConfig.get('JIRA_EMAIL') &&
    aiConfig.get('JIRA_API_TOKEN') &&
    aiConfig.get('JIRA_PROJECT_KEY')
  );
}

function getClient() {
  const baseUrl    = aiConfig.get('JIRA_BASE_URL');
  const email      = aiConfig.get('JIRA_EMAIL');
  const token      = aiConfig.get('JIRA_API_TOKEN');
  const projectKey = aiConfig.get('JIRA_PROJECT_KEY');
  if (!baseUrl || !email || !token || !projectKey) {
    throw new Error('Jira integration is not fully configured — set all 4 keys in Settings → AI');
  }
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    projectKey,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    },
  };
}

async function jiraFetch(path, options = {}) {
  const { baseUrl, headers } = getClient();
  const url = `${baseUrl}/rest/api/3${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Jira API ${res.status}: ${body.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function createIssue(fields) {
  const { projectKey } = getClient();
  const body = {
    fields: {
      project:     { key: projectKey },
      ...fields,
    },
  };
  return jiraFetch('/issue', { method: 'POST', body: JSON.stringify(body) });
}

async function updateIssue(issueIdOrKey, fields) {
  return jiraFetch(`/issue/${issueIdOrKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
}

async function getIssue(issueIdOrKey) {
  return jiraFetch(`/issue/${issueIdOrKey}`);
}

async function getTransitions(issueIdOrKey) {
  const data = await jiraFetch(`/issue/${issueIdOrKey}/transitions`);
  return data.transitions || [];
}

async function transitionIssue(issueIdOrKey, transitionId) {
  return jiraFetch(`/issue/${issueIdOrKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

async function searchIssues(jql, maxResults = 50) {
  return jiraFetch('/search', {
    method: 'POST',
    body: JSON.stringify({ jql, maxResults, fields: ['summary', 'status', 'priority', 'issuetype', 'updated'] }),
  });
}

async function addComment(issueIdOrKey, bodyText) {
  return jiraFetch(`/issue/${issueIdOrKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }],
      },
    }),
  });
}

async function testConnection() {
  // Lightweight check — fetch current user via the API
  const { baseUrl, headers } = getClient();
  const res = await fetch(`${baseUrl}/rest/api/3/myself`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira connection test failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const user = await res.json();
  return { ok: true, displayName: user.displayName, emailAddress: user.emailAddress };
}

// ── Builder helpers for push ──────────────────────────────────────────────────

function buildBugFields(bug) {
  return {
    summary:     bug.summary,
    issuetype:   { name: 'Bug' },
    priority:    { name: PRIORITY_TO_JIRA[bug.priority] || 'Medium' },
    description: bug.description ? {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: bug.description }] }],
    } : undefined,
    labels:      bug.labels || [],
  };
}

function buildBacklogFields(item) {
  return {
    summary:     item.summary,
    issuetype:   { name: BACKLOG_TYPE_TO_JIRA[item.item_type] || 'Task' },
    priority:    { name: PRIORITY_TO_JIRA[item.priority] || 'Medium' },
    description: item.description ? {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: item.description }] }],
    } : undefined,
    labels:      item.labels || [],
    ...(item.story_points ? { story_points: item.story_points } : {}),
  };
}

/**
 * Try to transition a Jira issue to match a COGS status.
 * Jira transitions are workflow-specific, so we find the transition whose
 * target status name matches the desired Jira status string.
 */
async function tryTransition(issueKey, desiredJiraStatus) {
  if (!desiredJiraStatus) return false;
  const transitions = await getTransitions(issueKey);
  const match = transitions.find(t =>
    t.to && t.to.name && t.to.name.toLowerCase() === desiredJiraStatus.toLowerCase()
  );
  if (match) {
    await transitionIssue(issueKey, match.id);
    return true;
  }
  return false;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  isConfigured,
  getClient,
  testConnection,
  createIssue,
  updateIssue,
  getIssue,
  getTransitions,
  transitionIssue,
  searchIssues,
  addComment,
  tryTransition,
  buildBugFields,
  buildBacklogFields,
  // Mappings
  BUG_STATUS_TO_JIRA,
  BUG_STATUS_FROM_JIRA,
  BACKLOG_STATUS_TO_JIRA,
  BACKLOG_STATUS_FROM_JIRA,
  PRIORITY_TO_JIRA,
  PRIORITY_FROM_JIRA,
  BACKLOG_TYPE_TO_JIRA,
};
