import { expect, test } from '@playwright/test';

test('create household → item → consume to low → buy from shopping list → undo', async ({ page }) => {
  const stamp = Date.now();
  await page.goto(`/api/auth/dev-login?sub=e2e-${stamp}&name=E2E`);
  await expect(page.getByText('Hi E2E')).toBeVisible();

  await page.getByLabel('Create a household').fill(`E2E ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: '+ New' })).toBeVisible();

  await page.getByRole('link', { name: '+ New' }).click();
  await page.getByLabel('Name').fill('Cat food');
  await page.getByLabel('Have now').fill('3');
  await page.getByLabel('Minimum to keep').fill('2');
  await page.getByLabel('Usually buy').fill('12');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Cat food' })).toBeVisible();

  // Extra assertion (a): detail page shows Usage section + History row for initial count
  await expect(page.getByText('Usage')).toBeVisible();
  await expect(page.getByText(/History/)).toBeVisible();

  await page.getByRole('link', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Use 1 ea Cat food' }).click();
  await expect(page.getByText('2 ea · low')).toBeVisible(); // global "each" has abbreviation "ea"

  // Extra assertion (c): step is a guide, not a constraint. "each" has step 1, but the "Correct
  // count" dialog still accepts a typed off-step value (2.5) — verified via the item detail
  // page's dialog rather than the inventory row's long-press (simpler to drive reliably here).
  await page.getByRole('link', { name: 'Cat food' }).click();
  await page.getByRole('button', { name: 'Correct count' }).click();
  await page.getByLabel('Quantity').fill('1.5');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('1.5 ea · keep at least 2 ea')).toBeVisible(); // still low, so it stays on the shopping list below
  await page.getByRole('link', { name: 'Inventory' }).click();

  await page.getByRole('link', { name: /Shopping/ }).click();
  await page.getByRole('button', { name: /Got Cat food/ }).click();
  await expect(page.getByText('All stocked up.')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /Got Cat food/ })).toBeVisible();

  // Extra assertion (b): Settings → add a store "Costco" appears in the list
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByPlaceholder('New store').fill('Costco');
  await page.getByPlaceholder('New store').locator('..').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Costco')).toBeVisible();
});
