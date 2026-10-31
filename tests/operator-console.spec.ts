import { test, expect, type Page } from "./fixtures";
async function login(page:Page,operator:boolean){
 await page.goto('/');await page.getByLabel('Provider code').fill(operator?'COMPLYRER-MO':'EVERGREEN-MO');await page.getByLabel('Username').fill(operator?'platform.owner':'sarah.mitchell');await page.locator('input[autocomplete="current-password"]').fill('Evergreen!demo1');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.topbar')).toBeVisible();await page.keyboard.press('Escape');
}
test('operator overview drills to real seeded agency and audit explorer exports a bounded page',async({page})=>{
 await login(page,true);await expect(page.getByRole('heading',{name:'Operator Control Center · Overview',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Reporting group',exact:true}).selectOption('demo');
 await expect(page.getByRole('link',{name:/1.*Total agencies/})).toBeVisible();
 await page.locator('svg a[aria-label="2026-09-01: 1; open registrations"]').first().click();
 await expect(page.getByRole('heading',{name:'Operator Control Center · Agencies'})).toBeVisible();await expect(page.getByRole('button',{name:'Evergreen Care',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('combobox',{name:'Reporting group',exact:true})).toHaveValue('demo');
 await page.locator('.sidebar').getByRole('button',{name:'Operator audit',exact:true}).click();await expect(page.getByRole('heading',{name:'Operator Control Center · Activity & audit'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Events · page 1'})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page (CSV)',exact:true}).click();expect((await download).suggestedFilename()).toBe('operator-audit-current-page.csv');
});
test('agency administrator cannot deep-link any new operator surface',async({page})=>{
 await login(page,false);
 for(const name of ['Operator overview','Operator agencies','Operator audit','Operator people','Operator health','Operator notifications']){await page.evaluate(name=>{location.hash=encodeURIComponent(name);},name);await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();await expect(page.locator('.sidebar').getByRole('button',{name,exact:true})).toHaveCount(0);}
});
test('operator people search opens read-only agency support context',async({page})=>{
 await login(page,true);await page.locator('.sidebar').getByRole('button',{name:'Operator people',exact:true}).click();
 await page.getByLabel('Search people or provider code',{exact:true}).fill('Sarah Mitchell');await page.getByRole('button',{name:'Sarah Mitchell',exact:true}).click();
 const context=page.getByRole('region',{name:'Read-only support context'});await expect(context).toBeVisible();await expect(context.getByRole('link',{name:'Agency details & rules'})).toBeVisible();await expect(context.getByRole('link',{name:'Agency recorded activity'})).toBeVisible();
});
test('health labels absent local telemetry as unknown',async({page})=>{
 await login(page,true);await page.locator('.sidebar').getByRole('button',{name:'Operator health',exact:true}).click();await expect(page.getByRole('heading',{name:'Operator Control Center · Observed system health'})).toBeVisible();await expect(page.getByText('Unknown — no observations',{exact:true})).toHaveCount(4);
});
test('operator configures supported in-app templates with original notice context preserved',async({page})=>{
 await login(page,true);await page.locator('.sidebar').getByRole('button',{name:'Operator notifications',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Global in-app reminder templates'})).toBeVisible();
 await page.getByLabel('Title template for med.unrecorded',{exact:true}).fill('Reminder: {{title}}');await page.getByLabel('Change reason for med.unrecorded',{exact:true}).fill('Clarify reminder label');
 await page.getByRole('button',{name:'Save med.unrecorded template',exact:true}).click();await expect(page.getByRole('heading',{name:'med.unrecorded · version 2',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Body template for med.unrecorded',exact:true})).toHaveValue('{{body}}');
});
