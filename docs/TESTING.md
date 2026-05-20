# COGS Testing Guide

Single source of truth for everything testing-related. Read this before adding new test files or changing CI.

## TL;DR

| Layer | Tool | Where | Run command |
|---|---|---|---|
| Unit (API) | Vitest | `api/test/unit/**` | `cd api && npm run test:unit` |
| Integration (API + Postgres) | Vitest + Supertest | `api/test/integration/**` | `cd api && npm run test:integration` |
| Schema validation (tools) | Vitest | `api/test/schema/**` | `cd api && npm run test:schema` |
| Unit (frontend) | Vitest + React Testing Library | `app/test/unit/**` | `cd app && npm test` |
| E2E | Playwright | `app/test/e2e/**` | `cd app && npm run test:e2e` |
| A11y | axe-playwright | `app/test/e2e/a11y.spec.ts` | included in `test:e2e` |
| Pepper evals (Phase 3) | Custom runner | `api/test/evals/**` | `node api/test/evals/runner.js` |
| Performance (Phase 3) | k6 | `api/test/perf/**` | `k6 run api/test/perf/smoke.k6.js` |
| UAT | Markdown scripts | `docs/UAT/**` | Manual |

## First-time setup

### Local

```bash
# 1. Install dependencies
cd api && npm install
cd ../app && npm install

# 2. Set up the test database (creates mcogs_test, runs migration)
cd ../api && npm run test:setup

# 3. Run the test suite
npm test                  # all tests in api/
cd ../app && npm test     # all tests in app/

# 4. Optional: install Playwright browsers
cd app && npm run test:e2e:install
```

### CI

GitHub Actions does this automatically via `.github/workflows/test.yml`. No action needed beyond pushing code.

## Writing tests

### When to add a test

| Trigger | Test type |
|---|---|
| Every bug fix | At least one regression test in the same PR |
| New API route | Unit + integration |
| New page | At least one Playwright E2E happy-path |
| New Pepper tool | Schema test entry + add to eval prompts |
| New migration step | Add expected count to migration-idempotent test |
| New shared helper | Unit test |

### Patterns

**Unit test (no DB):**
```js
// api/test/unit/myhelper.test.js
import { describe, it, expect } from 'vitest';

describe('myHelper', () => {
  it('does the thing', () => {
    expect(myHelper(1)).toBe(2);
  });
});
```

**Integration test (real DB, transaction-rolled):**
```js
// api/test/integration/myroute.test.js
import { describe, it, expect, afterAll } from 'vitest';
import { withTx, closeTestPool } from '../helpers/db.js';
import { makeIngredient } from '../helpers/factories.js';

afterAll(() => closeTestPool());

describe('my route', () => {
  it('does the thing', async () => {
    await withTx(async (c) => {
      const ing = await makeIngredient(c, { name: 'Test' });
      // ...assertions
    });
  });
});
```

**E2E test:**
```ts
// app/test/e2e/myflow.spec.ts
import { test, expect } from '@playwright/test';

test('user can do X', async ({ page }) => {
  await page.goto('/somepage');
  await page.getByRole('button', { name: /submit/i }).click();
  await expect(page.getByText('Success')).toBeVisible();
});
```

## Coverage targets

We do **not** chase coverage % — we target high-risk areas. Current thresholds (in `vitest.config.js`):

- API: 25% lines (will raise as suite grows)
- Frontend: 10% lines (component tests are sparse intentionally — most coverage comes from E2E)

**Raising thresholds:** every meaningful test addition should bump the threshold by 1–2% so we never regress.

## CI / merge gates

| Gate | Source | Blocks merge? |
|---|---|---|
| `typecheck` | tsc --noEmit | Yes |
| `lint` | ESLint | No (warnings tolerated initially) |
| `api-test` | vitest run | Yes |
| `app-test` | vitest run | Yes |
| `e2e` | Playwright (push to main only) | No initially — flip to Yes once stable |

When `e2e` becomes mandatory, also update `deploy.yml` to add `needs: [api-test, app-test, e2e]`.

## Test data conventions

- Every factory-created row has a name ending in `__test_<timestamp>_<n>` so leaked rows (if rollback fails) are obvious in dev DBs
- Never use real customer data in tests
- E2E tests should generate unique names per run to avoid collisions in parallel CI runs

## Anti-patterns

| Anti-pattern | Why bad |
|---|---|
| Mocking the database in integration tests | Mocks don't catch SQL bugs; use a real test DB |
| Sharing state between tests | Use withTx() — each test gets its own transaction |
| `it.skip` without a comment | Future-you won't know why it's disabled |
| Testing implementation details (private functions) | Refactors will break tests for no reason; test contracts |
| Testing third-party libs (Auth0, react-router) | Trust the lib; test your integration with it |

## Running a single test

```bash
# By filename
cd api && npm test -- test/unit/currency.test.js

# By test name regex
cd api && npm test -- -t "preserves tax ratio"

# Watch mode (re-runs on change)
cd api && npm run test:watch
```

## When tests fail in CI but pass locally

Common causes:
1. **Missing test DB seed data** — CI starts with an empty DB; locally yours might have leftover data
2. **Time/timezone** — CI is UTC; your machine might not be
3. **Parallel execution** — locally your tests may run sequentially; CI runs in parallel
4. **Network** — Auth0, Anthropic, GitHub APIs may be unavailable in CI

Use `act` (https://github.com/nektos/act) to run GitHub Actions locally for debugging.

## See also

- `.github/workflows/test.yml` — CI test pipeline
- `.github/workflows/smoke-after-deploy.yml` — Post-deploy smoke
- `docs/UAT/` — UAT scripts
- `docs/STAGING.md` — Staging environment setup
- `api/test/evals/README.md` — Pepper AI eval suite
