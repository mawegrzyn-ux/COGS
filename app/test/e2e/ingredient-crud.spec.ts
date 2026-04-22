// E2E: create → edit → delete an ingredient.
//
// This is the canonical "happy path" for any data-CRUD page. If this
// works, most other CRUD pages will too (Vendors, Categories, etc.)
// because they all follow the same pattern.
//
// Each test creates a uniquely-named row so parallel runs don't collide.

import { test, expect } from '@playwright/test';

const ts = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 999)}`;

test.describe('Ingredient CRUD', () => {
  test('create an ingredient and verify it appears', async ({ page }) => {
    const name = `${ts()}_TestIngredient`;
    await page.goto('/inventory');

    // Wait for the page to settle.
    await expect(page.getByRole('heading', { name: /Inventory/i })).toBeVisible();

    // Click the "+ Add Ingredient" / "+ New" button. UI text may vary —
    // try the most likely options.
    const addBtn = page.getByRole('button', { name: /add|new/i }).first();
    await addBtn.click();

    // Fill the form
    await page.getByLabel(/Name/i).first().fill(name);

    // Save
    await page.getByRole('button', { name: /save|create/i }).first().click();

    // The new row should appear in the table
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });

  test('edit an ingredient name', async ({ page }) => {
    const original = `${ts()}_Original`;
    const updated  = `${original}_EDITED`;

    await page.goto('/inventory');
    await page.getByRole('button', { name: /add|new/i }).first().click();
    await page.getByLabel(/Name/i).first().fill(original);
    await page.getByRole('button', { name: /save|create/i }).first().click();
    await expect(page.getByText(original)).toBeVisible();

    // Click the row to open edit
    await page.getByText(original).click();
    await page.getByLabel(/Name/i).first().fill(updated);
    await page.getByRole('button', { name: /save|update/i }).first().click();

    await expect(page.getByText(updated)).toBeVisible({ timeout: 10_000 });
  });
});
