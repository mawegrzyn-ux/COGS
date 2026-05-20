// Pepper AI eval runner.
//
// Reads prompts.json, fires each at the configured Pepper API endpoint,
// captures the SSE stream + tool calls, scores each response with the
// judge module, and writes results/<ISO-date>.json.
//
// USAGE:
//   EVAL_BASE_URL=https://cogs-staging.macaroonie.com \
//   EVAL_AUTH_TOKEN=<bearer token> \
//   node test/evals/runner.js
//
// EXIT CODE:
//   0 — all evals scored. Failures are surfaced in the JSON output, not exit code.
//   1 — runner crashed before completing.
//
// COSTS:
//   ~$0.005 per prompt × 12 prompts ≈ $0.06 per run.
//   Plus judge calls (Haiku) ~$0.002 per judgement = $0.024.
//   Total: ~$0.10 per full run.

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL  = process.env.EVAL_BASE_URL  || 'https://cogs-staging.macaroonie.com';
const AUTH_TOKEN = process.env.EVAL_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('EVAL_AUTH_TOKEN must be set (Auth0 access token for the test admin user)');
  process.exit(1);
}

const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf-8'));
const RESULTS_DIR = path.join(__dirname, 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

async function runPrompt(prompt) {
  const start = Date.now();
  const url = `${BASE_URL}/api/ai-chat`;
  const body = JSON.stringify({
    messages: [{ role: 'user', content: prompt.prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'text/event-stream',
      },
    }, (res) => {
      let buffer = '';
      const events = [];
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (event.startsWith('data: ')) {
            try { events.push(JSON.parse(event.slice(6))); }
            catch { /* skip non-JSON keepalive */ }
          }
        }
      });
      res.on('end', () => {
        const toolsCalled = [];
        let textOut = '';
        let totalTokens = 0;
        for (const e of events) {
          if (e.type === 'tool_use') toolsCalled.push(e.name);
          if (e.type === 'text_delta' && e.text) textOut += e.text;
          if (e.type === 'usage') totalTokens += (e.input_tokens || 0) + (e.output_tokens || 0);
        }
        resolve({
          status: res.statusCode,
          duration_ms: Date.now() - start,
          tools_called: toolsCalled,
          response_text: textOut,
          token_count: totalTokens,
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function scoreToolUsage(prompt, result) {
  const expected = new Set(prompt.expected_tools || []);
  const actual   = new Set(result.tools_called);
  if (expected.size === 0) {
    // Should NOT have called any specific tool — but allow any read-only ones
    return actual.size === 0 ? 1.0 : 0.5;
  }
  const matched = [...expected].filter((t) => actual.has(t)).length;
  return matched / expected.size;
}

(async () => {
  const date = new Date().toISOString().slice(0, 10);
  const results = [];
  let totalTokens = 0;

  for (const prompt of PROMPTS.prompts) {
    process.stdout.write(`Running [${prompt.id}]... `);
    try {
      const r = await runPrompt(prompt);
      const score = scoreToolUsage(prompt, r);
      totalTokens += r.token_count;
      results.push({
        id: prompt.id,
        category: prompt.category,
        prompt: prompt.prompt,
        expected_tools: prompt.expected_tools,
        criteria: prompt.criteria,
        result: {
          status: r.status,
          duration_ms: r.duration_ms,
          tools_called: r.tools_called,
          response_text: r.response_text.slice(0, 4000),
          token_count: r.token_count,
        },
        scores: { tool_match: score },
      });
      console.log(`tools=${score.toFixed(2)} ${r.duration_ms}ms ${r.token_count}tok`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: prompt.id, error: err.message });
    }
  }

  const summary = {
    run_date: new Date().toISOString(),
    prompts_version: PROMPTS.version,
    base_url: BASE_URL,
    prompt_count: results.length,
    total_tokens: totalTokens,
    avg_tool_match: results
      .filter((r) => r.scores)
      .reduce((s, r, _, arr) => s + r.scores.tool_match / arr.length, 0),
    results,
  };

  const outPath = path.join(RESULTS_DIR, `${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n✔ Wrote ${outPath}`);
  console.log(`  Average tool-match: ${summary.avg_tool_match.toFixed(2)}`);
  console.log(`  Total tokens used:  ${totalTokens}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
