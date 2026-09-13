import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password").fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

async function openPage(page: Page, name: string) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name }).click();
}

test("login and workspace pages stay on screen at phone width", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to your agency workspace" }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await signIn(page);
  await expect(
    page.getByRole("heading", { name: /What needs your attention/ }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);

  for (const name of [
    "Individuals",
    "Sites & programs",
    "Staff",
    "Requirements",
    "Audit center",
    "Acknowledgments",
    "Settings",
  ]) {
    await openPage(page, name);
    await expect(page.locator("main")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  }

  await openPage(page, "Individuals");
  await page.getByRole("button", { name: /Jodie Williams/ }).click();
  await expect(page.getByRole("heading", { name: "Jodie Williams" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await openPage(page, "Sites & programs");
  await page
    .locator(".location-card")
    .filter({ hasText: "Maple House" })
    .getByRole("button", { name: "Site review pack" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Site review pack/ }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
});
