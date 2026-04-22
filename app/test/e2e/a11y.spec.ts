// Accessibility baseline using axe-playwright.
//
// Runs axe scans on top pages and asserts no SERIOUS or CRITICAL
// violations. Lower-severity items are tracked but not fail-blocking
// initially. Raise the gate as a11y debt is paid down.

import { test, expect } from '@playwright/test';
import { injectAxe, getViolations } from 'axe-playwright';

const PAGES = [
  { path: '/',           label: 'Dashboard' },
  { path: '/inventory',  label: 'Inventory' },
  { path: '/recipes',    label: 'Recipes' },
  { path: '/menus',      label: 'Menus' },
];

for (const { path, label } of PAGES) {
  test(`${label} has no critical/serious a11y violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await injectAxe(page);

    const violations = await getViolations(page, undefined, {
      detailedReport: true,
      detailedReportOptions: { html: false },
    });

    const blocking = violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (blocking.length > 0) {
      const summary = blocking.map(
        (v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`
      ).join('\n');
      throw new Error(`A11y violations on ${label}:\n${summary}`);
    }

    expect(blocking).toHaveLength(0);
  });
}
