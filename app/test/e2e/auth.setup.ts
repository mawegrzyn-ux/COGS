// One-time Auth0 login that captures storageState for all other E2E specs.
//
// This spec runs first (configured as the `setup` project in
// playwright.config.ts) and produces .auth/user.json which subsequent
// specs reuse — so we only login through Auth0 ONCE per CI run, not
// per test.
//
// Required env vars:
//   E2E_TEST_USER_EMAIL    — a real Auth0 user with admin role
//   E2E_TEST_USER_PASSWORD
//
// SECURITY: Use a dedicated test user. Do not reuse production accounts.
// Rotate the password if .auth/user.json ever leaks.

import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM replacement for the CommonJS `__dirname` global — the app package is
// `"type": "module"`, so Playwright loads this file as an ES module where
// `__dirname` is undefined.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const authFile = path.join(__dirname, '..', '..', '.auth', 'user.json');

setup('authenticate via Auth0', async ({ page }) => {
  const email    = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD must be set.\n' +
      'Add them to GitHub Secrets for CI, or to a local .env for local runs.'
    );
  }

  await page.goto('/');

  // Auth0 redirect — wait for the login page hostname.
  await page.waitForURL(/\.auth0\.com\/u\/login/, { timeout: 30_000 });

  // Auth0 universal login form selectors. These can vary by tenant
  // configuration — selectors below match obscurekitty.uk.auth0.com defaults.
  await page.fill('input[name="username"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]:has-text("Continue"), button[type="submit"]');

  // Land back on the app
  await page.waitForURL(/^(?!.*auth0\.com).*$/, { timeout: 30_000 });
  await expect(page.locator('body')).toContainText(/Dashboard|Inventory|COGS/i, { timeout: 20_000 });

  // Persist auth state so subsequent specs skip login.
  await page.context().storageState({ path: authFile });
});
