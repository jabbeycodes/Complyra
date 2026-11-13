import { test, expect, type Page } from './fixtures';

async function signIn(page: Page, username='sarah.mitchell') {
  await page.addInitScript(() => localStorage.setItem('complyrer.viewMode','desktop'));
  await page.goto('/');
  await page.getByLabel('Provider code').fill('EVERGREEN-MO');
  await page.getByLabel('Username').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill('Evergreen!demo1');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await page.getByRole('dialog',{name:'Interactive demo tour'}).waitFor({state:'visible',timeout:2000}).catch(()=>undefined);
  await page.keyboard.press('Escape');
}

test('donut cohorts and Audit Me deadlines open record evidence at desktop and phone widths',async({page})=>{
  await signIn(page);
  await page.getByRole('button',{name:/View \d+ .* requirement records/}).first().click();
  const requirements=page.getByRole('dialog',{name:'Requirement source records',exact:true});
  await expect(requirements).toContainText('matching requirement record');
  await requirements.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('.sidebar').getByRole('button',{name:'Audit Me',exact:true}).click();
  await page.getByRole('button',{name:'View score source records',exact:true}).click();
  const sources=page.getByRole('dialog',{name:'Source records',exact:true});
  await expect(sources).toContainText('Read-only evidence');
  await expect(sources.locator('section').first()).toContainText('Record ');
  await sources.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('[aria-labelledby="cc-duenext"] button.cc-item-title').first().click();
  await expect(sources).toBeVisible();
  await expect(sources).not.toContainText('No substitute record');
  await page.setViewportSize({width:390,height:844});
  await expect(sources).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sources).not.toBeVisible();
});

test('auditor source inspection stays read-only',async({page})=>{
  await signIn(page,'mark.delaney');
  await page.locator('.sidebar').getByRole('button',{name:'Audit Me',exact:true}).click();
  await page.getByRole('button',{name:'View score source records',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Source records',exact:true})).toContainText('Read-only evidence');
  await expect(page.getByRole('button',{name:'Resolve',exact:true})).toHaveCount(0);
  await expect(page.getByPlaceholder('e.g. Re-train night shift on incident reporting')).toHaveCount(0);
});
