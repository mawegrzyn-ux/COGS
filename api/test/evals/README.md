# Pepper AI Evaluation Suite

## Purpose

This is a **non-blocking, weekly-cron** evaluation that scores Pepper's behaviour across a fixed set of prompts. It is NOT a unit test — it costs real Anthropic tokens and is non-deterministic. Use it to catch quality regressions, not as a CI gate.

## What it measures

Each eval prompt has expected criteria:
- **Tool selection** — did Pepper call the right tool(s)?
- **Confirmation pattern** — did Pepper ask before write actions?
- **Response quality** — does the answer cover the criteria? (judged by a separate Claude call)
- **Token usage** — total tokens per task

## Files

- `prompts.json` — the eval set (versioned, append-only)
- `runner.js` — fires each prompt at the staging API, captures the SSE stream, scores it
- `judge.js` — calls Claude Haiku as a judge to grade the response

## Run manually

```bash
cd api
EVAL_BASE_URL=https://cogs-staging.macaroonie.com \
EVAL_AUTH_TOKEN=<bearer> \
node test/evals/runner.js
```

## Scheduling

Add a GitHub Actions workflow (`evals.yml`) that runs every Sunday at 03:00 UTC. Save results to `evals/results/<date>.json` and surface trends in the System → AI → Eval Dashboard (future work).

## Cost

~$0.05 per full eval run. With 20 prompts, that's $0.20/week ≈ $1/month. Affordable.

## Adding a prompt

Edit `prompts.json` and add a new entry:

```json
{
  "id": "list_ingredients",
  "prompt": "Show me all my ingredients",
  "expected_tools": ["list_ingredients"],
  "criteria": [
    "Returns a list (not just text)",
    "Names match the database",
    "No write tools called"
  ]
}
```

Bump the version in `prompts.json` `version` field.
