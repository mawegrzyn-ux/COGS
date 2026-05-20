// =============================================================================
// Nightly (well, every-15-minutes) Jira pull-sync.
//
// Scheduled from api/src/index.js at */15 * * * * (every quarter-hour). Each
// run calls the shared `syncAll()` helper from the jira route which:
//   - Skips cleanly if Jira isn't configured
//   - Iterates every mcogs_bugs + mcogs_backlog row with a jira_key
//   - Pulls status + priority (always) and summary + description + labels
//     (only when Jira's `updated` is newer than the local `updated_at`)
//   - Persists last-run metadata to mcogs_settings.data.jira_sync_status so
//     the UI banner can show "Last synced 3 min ago" and any errors
//
// No log spam on success — only logs when items changed or errors occurred,
// so a well-behaved cron fades into the background.
// =============================================================================

const jiraRoute = require('../routes/jira');

async function runJiraSync() {
  const { syncAll } = jiraRoute;
  if (typeof syncAll !== 'function') {
    throw new Error('syncAll helper not found on jira route exports');
  }
  return syncAll({ trigger: 'cron' });
}

module.exports = { runJiraSync };
