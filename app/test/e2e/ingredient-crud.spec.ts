// E2E: create → edit → delete an ingredient.
//
// This is the canonical "happy path" for any data-CRUD page. If this
// works, most other CRUD pages will too (Vendors, Categories, etc.)
// because they all follow the same pattern.
//
// Each test creates a uniquely-named row so parallel runs don't collide.

import { test, expect, Page } from '@playwright/test';

const ts = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 999)}`;

// The shared `Field` component renders `<label>` as a sibling (not a wrapper)
// of the input, so Playwright's `getByLabel` can't resolve it. Until the Field
// component is refactored to use htmlFor/id or wrap children, target the
// modal's name input via its autoFocus + placeholder. The add modal's name
// input consistently renders with `placeholder="e.g. …"` and `autoFocus`.
const nameInput = (page: Page) =>
  page.locator('[role="dialog"] input[placeholder^="e.g." i]').first();

// The Ingredient add-modal has Name + Base Unit both marked `required`. Saving
// with only Name silently fails validation (the modal stays open but no visible
// toast), so the test also needs to pick a unit. Returns true if a unit was
// selected, false if the staging DB has no units at all (in which case the
// test should skip). The select is the 2nd <select> inside the dialog — after
// the Category dropdown.
async function pickFirstBaseUnit(page: Page): Promise<boolean> {
  const select = page.locator('[role="dialog"] select').nth(1);
  // Collect the values of real (non-placeholder) options.
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
