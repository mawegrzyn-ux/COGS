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
    await expect(page.getByText('Dashboard',     { exact: false })).toBeVisible();
    await expect(page.getByText('Configuration', { exact: false })).toBeVisible();
    await expect(page.getByText('System',        { exact: false })).toBeVisible();
  });

  test('navigating to a protected page does not 403', async ({ page }) => {
    await page.goto('/system');
    // Should NOT see "Forbidden" or "Pending approval"
    await expect(page.getByText(/forbidden|pending/i)).toHaveCount(0);
  });
});
