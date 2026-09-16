import { test, expect, type Page } from './fixtures';
async function login(page: Page, username = 'sarah.mitchell') {
  await page.goto('/');
  await page.getByLabel('Provider code').fill('EVERGREEN-MO');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('Evergreen!demo1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Your profile', exact: true })).toBeVisible();
}

test('Audit Me persists corrective actions and opens their risk sources', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('button', { name: 'Audit Me', exact: true }).click();
  await page.getByLabel('Action title').fill('Verify emergency contact folder');
  await page.getByRole('button', { name: 'Add corrective action', exact: true }).click();
  const action = page.locator('.cc-item').filter({ hasText: 'Verify emergency contact folder' });
  await expect(action).toBeVisible();
  await action.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(action).toContainText('Resolved');
  await page.reload();
  await expect(page.locator('.cc-item').filter({ hasText: 'Verify emergency contact folder' })).toContainText('Resolved');
  await page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/audit-me-desktop.png`, fullPage: true });
  await page.locator('.cc-wrap a[href]').first().click();
  await expect(page.locator('.cc-wrap')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Quarterly QA creates, scores, reloads and exports a site audit', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'QA Review', exact: true }).click();
  await page.locator('.qa-new-audit').getByRole('combobox').first().selectOption({ label: 'Cedar House' });
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByRole('button', { name: /Home environment/ }).click();
  const item = page.locator('.qa-item:not(.qa-item--locked)').first();
  await item.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Yes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/qa-audit-desktop.png`, fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await page.reload();
  await expect(page.locator('.qa-list')).toContainText('Cedar House');
});

test('Audit pages stay usable on a phone and invalid routes recover', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Audit Me', exact: true }).click();
  await expect(page.getByLabel('Action title')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.WALKTHROUGH_DIR}/audit-me-phone.png`, fullPage: false });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'QA Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start review', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#nonexistent-page');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});
