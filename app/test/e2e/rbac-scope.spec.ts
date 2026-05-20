// E2E: RBAC sidebar visibility.
//
// Verifies that the sidebar nav reflects the current user's permissions.
// Admin sees all items; Viewer sees only read-allowed items.
//
// This test relies on the test user being an Admin. If you have multiple
// test users (admin + viewer) in your staging environment, extend this
// spec with a second describe block that uses a different storageState.

import { test, expect } from '@playwright/test';

test.describe('RBAC sidebar', () => {
  test('Admin user sees Configuration and System nav items', async ({ page }) => {
    await page.goto('/');
    // Target the sidebar links by role to avoid colliding with page headings
    // that also say "Dashboard", "Configuration", etc.
    await expect(page.getByRole('link', { name: /^Dashboard$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Configuration$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^System$/ })).toBeVisible();
  });

  test('navigating to a protected page does not 403', async ({ page }) => {
    await page.goto('/system');
    // Should NOT see "Forbidden" or "Pending approval"
    await expect(page.getByText(/forbidden|pending/i)).toHaveCount(0);
  });
});
