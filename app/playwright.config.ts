// Playwright configuration for COGS end-to-end tests.
//
// CRITICAL: E2E tests run against a deployed environment, never the local
// dev server alone. Either:
//   - PLAYWRIGHT_BASE_URL=http://localhost:5173    (dev with API on :3001)
//   - PLAYWRIGHT_BASE_URL=https://cogs-staging.... (staging)
//   - PLAYWRIGHT_BASE_URL=https://cogs.macaroonie.com (read-only smoke only)
//
// Auth strategy (see test/e2e/auth.setup.ts):
//   - One auth.setup.ts spec runs first, logs in once via Auth0, saves
//     storageState to .auth/user.json
//   - All other specs reuse that storageState — no login per test
//
// Required env vars when running locally:
//   E2E_TEST_USER_EMAIL    — a real user with admin role in the target env
//   E2E_TEST_USER_PASSWORD — that user's Auth0 password
//
// In CI these come from GitHub Secrets.

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }], ['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // 1. Auth setup — runs once, captures storageState
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // 2. Authenticated tests — reuse storage state
    {
      name: 'chromium-authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
    // 3. Mobile smoke (subset, marked @mobile)
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
      grep: /@mobile/,
    },
  ],
  // No webServer — we assume the target is already up.
  // For pure local dev, run `npm run dev` in app/ and api/ first.
});
