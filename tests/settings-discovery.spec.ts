import { test, expect, type Page } from './fixtures';

// Agency-admin slice 4: the Settings page signposts the agency-level
// editors that live elsewhere, gated exactly as those editors are.
// Sign-in follows the pattern in agency-admin-drilldowns.spec.ts.

async function signIn(page: Page, username = 'sarah.mitchell') {
  await page.addInitScript(() => localStorage.setItem('complyrer.viewMode', 'desktop'));
  await page.goto('/');
  await page.getByLabel('Provider code').fill('EVERGREEN-MO');
  await page.getByLabel('Username').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill('Evergreen!demo1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await page.getByRole('dialog', { name: 'Interactive demo tour' }).waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined);
  await page.keyboard.press('Escape');
}

async function openSettings(page: Page) {
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

test('administrator: Pay settings and Punch/Clock links land on the Payroll tab editors', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await expect(page.getByText('Agency configuration')).toBeVisible();
  await page.getByRole('button', { name: 'Open Pay settings' }).click();
  await expect(page.getByRole('heading', { name: 'Employee Hub' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payroll' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Pay settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clock settings' })).toBeVisible();
  // The pay-side ownership note is on the surface it describes.
  await expect(page.getByText(/These overtime rules decide pay/)).toBeVisible();
  await expect(page.getByText(/govern the clock itself/)).toBeVisible();
});

test('administrator: Binder templates link lands on the template editor itself', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Open Binder templates' }).click();
  await expect(page.getByRole('heading', { name: 'Employee Hub' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Binder Board' })).toHaveAttribute('aria-selected', 'true');
  // The link carries the Templates subview, so the template EDITOR
  // renders — not merely the board with a Templates button on it. The
  // editor's snapshot-rule note and Reset to starter control exist
  // only inside the editor; the board's summary must be absent and
  // the Templates view toggle must be the active one.
  await expect(page.locator('.binder-editor')).toBeVisible();
  await expect(page.getByText(/Snapshot rule/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to starter' })).toBeVisible();
  await expect(page.locator('.binder-board-summary')).toHaveCount(0);
  await expect(
    page.locator('.binder-board-views').getByRole('button', { name: /Templates/ }),
  ).toHaveClass(/primary/);
});

test('administrator: Binder Board reached by ordinary navigation still opens on the board', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar').getByRole('button', { name: 'Employee Hub', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Employee Hub' })).toBeVisible();
  await page.getByRole('tab', { name: 'Binder Board' }).click();
  await expect(page.getByRole('tab', { name: 'Binder Board' })).toHaveAttribute('aria-selected', 'true');
  // No deep-link subview: the board view renders exactly as before —
  // summary visible, Board toggle active, no editor anywhere.
  await expect(page.locator('.binder-board-summary')).toBeVisible();
  await expect(page.locator('.binder-editor')).toHaveCount(0);
  await expect(
    page.locator('.binder-board-views').getByRole('button', { name: 'Board', exact: true }),
  ).toHaveClass(/primary/);
});

test('administrator: Delegation templates link lands on the library', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Open Delegation templates' }).click();
  await expect(page.getByRole('heading', { name: 'Delegations', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Template library' }).first()).toBeVisible();
});

test('administrator: Agency rules carry the overtime and accountability ownership notes', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await expect(page.getByText(/These overtime rules are the operational ones/)).toBeVisible();
  await expect(page.getByText(/The late clock-in rule here is an accountability rule/)).toBeVisible();
});

test('program manager: Consent types link lands on the Consents page configuration', async ({ page }) => {
  await signIn(page, 'melissa.grant');
  await openSettings(page);
  await page.getByRole('button', { name: 'Open Consent types' }).click();
  await expect(page.getByRole('button', { name: 'Configure consent types' })).toBeVisible();
});

test('DSP: no discovery section on Settings', async ({ page }) => {
  await signIn(page, 'alex.morgan');
  await openSettings(page);
  await expect(page.getByText('Agency configuration')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Open (Pay settings|Binder templates|Consent types)/ })).toHaveCount(0);
});

test('Settings discovery rows hold up at phone width', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Agency configuration')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
