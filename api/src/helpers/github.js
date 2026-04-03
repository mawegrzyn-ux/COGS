// =============================================================================
// GitHub REST API helper for Pepper AI
// All calls use the PAT from aiConfig (Settings → AI → GitHub PAT).
// Base: https://api.github.com
// =============================================================================

const aiConfig = require('./aiConfig');

const BASE = 'https://api.github.com';

// ── Parse "owner/repo" string ─────────────────────────────────────────────────
function parseRepo(repoStr) {
  const parts = (repoStr || '').trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

// ── Shared fetch wrapper ──────────────────────────────────────────────────────
async function ghFetch(path, options = {}) {
  const pat = aiConfig.get('GITHUB_PAT');
  if (!pat) throw new Error('GitHub PAT not configured — add it in Settings → AI → GitHub PAT');

  const resp = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Accept:        'application/vnd.github+json',
      Authorization: `Bearer ${pat}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!resp.ok) {
    const msg = data?.message || data || `GitHub API returned ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── getRepo — resolve to configured repo if not specified ─────────────────────
function getRepo(repoOverride) {
  const r = repoOverride || aiConfig.get('GITHUB_REPO');
  if (!r) throw new Error('No repository specified and no default GitHub repo configured — add it in Settings → AI → GitHub Repo');
  const parsed = parseRepo(r);
  if (!parsed) throw new Error(`Invalid repository format "${r}" — expected "owner/repo"`);
  return parsed;
}

// ── List files in a directory ─────────────────────────────────────────────────
async function listFiles({ repo: repoStr, path = '', ref } = {}) {
  const { owner, repo } = getRepo(repoStr);
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${qs}`);
  if (Array.isArray(data)) {
    return data.map(f => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha }));
  }
  // Single file — return as array
  return [{ name: data.name, path: data.path, type: data.type, size: data.size, sha: data.sha }];
}

// ── Read a file ───────────────────────────────────────────────────────────────
async function readFile({ repo: repoStr, path, ref } = {}) {
  if (!path) throw new Error('path is required');
  const { owner, repo } = getRepo(repoStr);
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${qs}`);
  if (data.type !== 'file') throw new Error(`"${path}" is not a file`);
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { path: data.path, sha: data.sha, size: data.size, content };
}

// ── Search code ───────────────────────────────────────────────────────────────
async function searchCode({ repo: repoStr, query, max_results = 10 } = {}) {
  if (!query) throw new Error('query is required');
  const { owner, repo } = getRepo(repoStr);
  const q = `${query} repo:${owner}/${repo}`;
  const data = await ghFetch(`/search/code?q=${encodeURIComponent(q)}&per_page=${Math.min(max_results, 30)}`);
  return (data.items || []).map(i => ({
    path: i.path,
    repository: i.repository?.full_name,
    html_url:   i.html_url,
  }));
}

// ── Create or update a file ───────────────────────────────────────────────────
async function createOrUpdateFile({ repo: repoStr, path, content, message, branch, sha } = {}) {
  if (!path)    throw new Error('path is required');
  if (!content && content !== '') throw new Error('content is required');
  if (!message) throw new Error('commit message is required');
  if (!branch)  throw new Error('branch is required');

  const { owner, repo } = getRepo(repoStr);
  const encoded = Buffer.from(content, 'utf8').toString('base64');

  const body = { message, content: encoded, branch };
  if (sha) body.sha = sha; // required for updates

  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  return {
    path:   data.content?.path,
    sha:    data.content?.sha,
    commit: data.commit?.sha,
    url:    data.content?.html_url,
  };
}

// ── Create a branch ───────────────────────────────────────────────────────────
async function createBranch({ repo: repoStr, branch, from_branch = 'main' } = {}) {
  if (!branch) throw new Error('branch name is required');
  const { owner, repo } = getRepo(repoStr);

  // Get SHA of the source branch tip
  const refData = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${from_branch}`);
  const sha = refData.object?.sha;
  if (!sha) throw new Error(`Could not find branch "${from_branch}"`);

  const data = await ghFetch(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body:   JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  return { branch, sha: data.object?.sha, ref: data.ref };
}

// ── List PRs ──────────────────────────────────────────────────────────────────
async function listPRs({ repo: repoStr, state = 'open', max_results = 10 } = {}) {
  const { owner, repo } = getRepo(repoStr);
  const data = await ghFetch(
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${Math.min(max_results, 30)}&sort=updated&direction=desc`
  );
  return data.map(pr => ({
    number:    pr.number,
    title:     pr.title,
    state:     pr.state,
    author:    pr.user?.login,
    head:      pr.head?.ref,
    base:      pr.base?.ref,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    url:       pr.html_url,
  }));
}

// ── Create a PR ───────────────────────────────────────────────────────────────
async function createPR({ repo: repoStr, title, body = '', head, base = 'main' } = {}) {
  if (!title) throw new Error('title is required');
  if (!head)  throw new Error('head branch is required');
  const { owner, repo } = getRepo(repoStr);

  const data = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body:   JSON.stringify({ title, body, head, base }),
  });
  return {
    number: data.number,
    title:  data.title,
    url:    data.html_url,
    state:  data.state,
  };
}

// ── Get PR diff ───────────────────────────────────────────────────────────────
async function getPRDiff({ repo: repoStr, pr_number } = {}) {
  if (!pr_number) throw new Error('pr_number is required');
  const { owner, repo } = getRepo(repoStr);
  const diff = await ghFetch(`/repos/${owner}/${repo}/pulls/${pr_number}`, {
    headers: { Accept: 'application/vnd.github.diff' },
  });
  // Truncate large diffs
  const MAX = 8000;
  if (typeof diff === 'string' && diff.length > MAX) {
    return diff.slice(0, MAX) + `\n\n... [diff truncated at ${MAX} chars — ${diff.length} total]`;
  }
  return diff;
}

module.exports = { listFiles, readFile, searchCode, createOrUpdateFile, createBranch, listPRs, createPR, getPRDiff };
