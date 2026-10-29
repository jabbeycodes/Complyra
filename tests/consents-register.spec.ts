import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from './fixtures';
async function signIn(page: Page) {
    await page.goto('/');
    await page.getByLabel('Provider code').fill('EVERGREEN-MO');
    await page.getByLabel('Username').fill('james.wilson');
    await page.getByLabel('Password', { exact: true }).fill('Evergreen!demo1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Consents', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consents', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Consents register', exact: true })).toBeVisible();
}
async function createPacket(page: Page) {
    const packets = page.getByRole('region', { name: 'Consent packets', exact: true });
    await packets.getByText('Create a packet', { exact: true }).click();
    await expect(packets.getByRole('combobox', { name: 'Individual', exact: true }).locator('option').nth(1)).toBeAttached();
    const options = await packets.getByRole('combobox', { name: 'Individual', exact: true }).locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).filter(Boolean));
    await packets.getByRole('combobox', { name: 'Individual', exact: true }).selectOption(options[0]);
    await packets.getByLabel('Expected signer', { exact: true }).fill('Jordan Lee');
    await packets.getByLabel('Expiry/review date', { exact: true }).fill('2027-09-12');
    await packets.getByRole('button', { name: 'Create draft packet', exact: true }).click();
    await packets.getByRole('button', { name: 'Generate packet', exact: true }).click();
    await expect(packets.getByRole('button', { name: 'Download packet', exact: true })).toBeVisible();
    return packets;
}
async function fillSignature(page: Page, paper = false) {
    const choices = page.getByRole('combobox', { name: 'Recorded choice', exact: true });
    for (let i = 0; i < await choices.count(); i++)
        await choices.nth(i).selectOption(i === 8 ? 'group' : i === 1 ? 'no' : 'yes');
    await page.getByLabel('Printed signer name', { exact: true }).fill('Jordan Lee');
    await page.getByRole('combobox', { name: 'Legal authority', exact: true }).selectOption('Guardian');
    await page.getByLabel(paper ? 'Signature name shown on paper' : 'Type your signature', { exact: true }).fill('Jordan Lee');
    await page.getByLabel('Witness name', { exact: true }).fill('Taylor Witness');
    await page.getByRole('checkbox', { name: paper ? /I checked that/ : /I reviewed every section/ }).check();
}
test('manager packet -> account-free signing -> filed register outcomes and closed token', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await signIn(page);
    const packets = await createPacket(page);
    await packets.getByRole('button', { name: 'Issue secure link for sharing', exact: true }).click();
    const link = await packets.getByLabel('Secure signing link', { exact: true }).inputValue();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Provider code')).toBeVisible();
    await page.goto(link);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ComplyRer consent signing', exact: true })).toBeVisible();
    await expect(page.locator('nav')).toHaveCount(0);
    await fillSignature(page);
    await page.getByRole('button', { name: 'Sign and submit packet', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed and filed', exact: true })).toBeVisible();
    const copy = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download your signed copy', exact: true }).click();
    expect((await copy).suggestedFilename()).toBe('Signed consent packet.pdf');
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('unavailable or expired');
    await signIn(page);
    await expect(page.getByRole('heading', { name: /— filed$/ })).toBeVisible();
    await page.locator('.consent-table details').evaluateAll(details => details.forEach(d => (d as HTMLDetailsElement).open = true));
    await expect(page.getByText('Recorded choice: group', { exact: true })).toBeVisible();
    await expect(page.getByText('Permission not given', { exact: false }).first()).toBeVisible();
    expect(errors).toEqual([]);
});
test('manager can download and file a signed paper packet as evidence', async ({ page }) => {
    await signIn(page);
    const packets = await createPacket(page);
    const download = page.waitForEvent('download');
    await packets.getByRole('button', { name: 'Download packet', exact: true }).click();
    const pdf = await download;
    await packets.getByRole('button', { name: 'File signed paper copy', exact: true }).click();
    await fillSignature(page, true);
    await page.getByLabel('Signed copy (PDF, PNG, JPEG; up to 10 MB)', { exact: true }).setInputFiles({ name: 'signed-paper.pdf', mimeType: 'application/pdf', buffer: await readFile((await pdf.path())!) });
    await page.getByRole('button', { name: 'File signed packet', exact: true }).click();
    await expect(packets.getByRole('heading', { name: /— filed$/ })).toBeVisible();
    await expect(packets.getByRole('button', { name: 'Download filed signed evidence', exact: true })).toBeVisible();
});
