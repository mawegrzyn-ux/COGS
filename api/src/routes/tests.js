// =============================================================================
// Tests — in-app UI for triggering and inspecting CI test runs.
// Uses the configured GitHub PAT to dispatch the test.yml workflow and read
// run status + jobs + artifacts. All endpoints are dev-only (is_dev flag).
// =============================================================================

const router = require('express').Router();
const gh     = require('../helpers/github');

// Fixed target — the Tests CI workflow file at .github/workflows/test.yml.
// If the workflow is ever renamed, update this constant.
const WORKFLOW_ID = 'test.yml';

// ── dev-only gate ─────────────────────────────────────────────────────────────
function requireDev(req, res, next) {
  if (!req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Dev flag required to use the in-app test runner.' } });
  }
  next();
}
router.use(requireDev);

// ── POST /api/tests/run ───────────────────────────────────────────────────────
// Trigger a workflow_dispatch on the test.yml workflow.
// Body: { ref?: string } — branch/tag/sha (default "main")
router.post('/run', async (req, res) => {
  try {
    const ref = (req.body?.ref || 'main').trim();
    const result = await gh.dispatchWorkflow({ workflow_id: WORKFLOW_ID, ref });
    // GitHub's dispatch endpoint returns 204 without a run id, so polling the
    // list endpoint right after is how the UI finds the freshly-queued run.
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /api/tests/runs ───────────────────────────────────────────────────────
// List the most recent runs of the test.yml workflow.
router.get('/runs', async (req, res) => {
  try {
    const per_page = Math.min(parseInt(req.query.per_page, 10) || 10, 30);
    const branch   = req.query.branch || undefined;
    const runs = await gh.listWorkflowRuns({ workflow_id: WORKFLOW_ID, per_page, branch });
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /api/tests/runs/:id ───────────────────────────────────────────────────
// Single run + jobs + artifacts (one round-trip for the UI).
router.get('/runs/:id', async (req, res) => {
  try {
    const run_id = parseInt(req.params.id, 10);
    if (!run_id) return res.status(400).json({ error: { message: 'Invalid run id' } });

    const [run, jobs, artifacts] = await Promise.all([
      gh.getWorkflowRun({ run_id }),
      gh.listWorkflowRunJobs({ run_id }),
      gh.listRunArtifacts({ run_id }),
    ]);
    res.json({ run, jobs, artifacts });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /api/tests/status ─────────────────────────────────────────────────────
// Quick status check — used by the Run button to disable itself while a run
// is in flight. Returns the newest run's status/conclusion or null.
router.get('/status', async (_req, res) => {
  try {
    const runs = await gh.listWorkflowRuns({ workflow_id: WORKFLOW_ID, per_page: 1 });
    res.json({ latest: runs[0] || null });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
