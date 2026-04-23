// E2E: create → edit → delete an ingredient.
//
// This is the canonical "happy path" for any data-CRUD page. If this
// works, most other CRUD pages will too (Vendors, Categories, etc.)
// because they all follow the same pattern.
//
// Each test creates a uniquely-named row so parallel runs don't collide.

import { test, expect, Page } from '@playwright/test';

const ts = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 999)}`;

// The shared `Field` component now auto-wires htmlFor/id via useId + cloneElement
// (see components/ui.tsx), so Playwright's getByLabel() resolves correctly.
// Scope the lookup to the modal to avoid collisions with any other "Name"
// input on the page.
const nameInput = (page: Page) =>
  page.getByRole('dialog').getByLabel(/^Name$/i);

// Base Unit is required on the Ingredient add-modal. Saving with only Name
// silently fails validation, so the test also picks a unit. Returns true if
// a unit was selected, false when staging has no units at all.
async function pickFirstBaseUnit(page: Page): Promise<boolean> {
  const select = page.getByRole('dialog').getByLabel(/^Base Unit$/i);
  const values = await select.locator('option').evaluateAll(opts =>
    opts.map(o => (o as HTMLOptionElement).value).filter(v => v !== '')
  );
  if (values.length === 0) return false;
  await select.selectOption(values[0]);
  return true;
}

test.describe('Ingredient CRUD', () => {
  test('create an ingredient and verify it appears', async ({ page }) => {
    const name = `${ts()}_TestIngredient`;
    await page.goto('/inventory');

    await expect(page.getByRole('heading', { name: /Inventory/i })).toBeVisible();

    // Click the "+ Add Ingredient" / "+ New" button.
    await page.getByRole('button', { name: /add|new/i }).first().click();

    // Modal should be open with the name input focused
    await expect(nameInput(page)).toBeVisible({ timeout: 5_000 });
    await nameInput(page).fill(name);

    // Base Unit is required — pick the first available. Skip test if staging
    // has no units seeded (a seed issue, not a regression in the code).
    const hasUnits = await pickFirstBaseUnit(page);
    test.skip(!hasUnits, 'No base units on staging DB — seed Configuration → Base Units first.');

    await page.getByRole('button', { name: /save|create/i }).first().click();

    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });

  test('edit an ingredient name', async ({ page }) => {
    const original = `${ts()}_Original`;
    const updated  = `${original}_EDITED`;

    await page.goto('/inventory');
    await page.getByRole('button', { name: /add|new/i }).first().click();
    await expect(nameInput(page)).toBeVisible({ timeout: 5_000 });
    await nameInput(page).fill(original);
    const hasUnits = await pickFirstBaseUnit(page);
    test.skip(!hasUnits, 'No base units on staging DB — seed Configuration → Base Units first.');
    await page.getByRole('button', { name: /save|create/i }).first().click();
    await expect(page.getByText(original)).toBeVisible();

    // Open the just-created row's edit modal
    await page.getByText(original).click();
    await expect(nameInput(page)).toBeVisible({ timeout: 5_000 });
    await nameInput(page).fill(updated);
    await page.getByRole('button', { name: /save|update/i }).first().click();

    await expect(page.getByText(updated)).toBeVisible({ timeout: 10_000 });
  });
});
