import { test, expect, type Page } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

async function openNav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
  const close = page.locator(".sidebar.mobile-open");
  if (await close.isVisible()) await page.locator(".sidebar-close").click();
}

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

test("demo admin can print and download weekly and monthly mileage sheets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openNav(page, "Mileage");
  await expect(page.getByRole("heading", { level: 1, name: "Mileage" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Weekly sheet" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Monthly log" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Week 1: days 1–7");
  await expect(page.locator("body")).not.toContainText("Continues from last trip");

  await expect(page.getByRole("button", { name: "Print monthly" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Monthly PDF" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_admin_monthly.png"), fullPage: false });

  const monthly = page.waitForEvent("download");
  await page.getByRole("button", { name: "Monthly PDF" }).click();
  const monthlyFile = await monthly;
  expect(monthlyFile.suggestedFilename()).toMatch(/mileage-log.*\.pdf$/);

  await page.getByRole("tab", { name: "Weekly sheet" }).click();
  await expect(page.getByRole("heading", { name: /Weekly sheet/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print weekly" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weekly PDF" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_admin_weekly.png"), fullPage: false });

  const weekly = page.waitForEvent("download");
  await page.getByRole("button", { name: "Weekly PDF" }).click();
  const weeklyFile = await weekly;
  expect(weeklyFile.suggestedFilename()).toMatch(/mileage-weekly.*\.pdf$/);
});

test("program site hero and tabs at 1280 and 390 keep Staff last", async ({
  page,
}) => {
  async function openMaple() {
    await openNav(page, "Sites & programs");
    await page
      .locator(".location-card")
      .filter({ hasText: "Maple House" })
      .getByRole("button", { name: /Open site/ })
      .click();
    await expect(page.getByRole("heading", { name: "Maple House" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openMaple();
  await expect(page.locator(".site-hero")).toBeVisible();
  await expect(page.locator(".site-hero .status-mix")).toBeVisible();
  await expect(page.locator(".site-hero-people")).toBeVisible();
  await expect(page.locator(".site-hero-person img").first()).toBeVisible();
  await expect(page.locator(".site-hero-scores")).toContainText("Ready");
  await expect(page.locator("body")).not.toContainText("Open record");
  const tabs = page.locator(".site-detail-tabs [role='tab']");
  await expect(tabs.last()).toHaveText(/Staff/);
  await page.screenshot({ path: shotPath("site_hero_1280.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.locator(".sidebar-close");
  if (await close.count()) await close.click({ force: true });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.querySelector(".sidebar");
        if (!el) return true;
        return el.getBoundingClientRect().right <= 4;
      }),
    )
    .toBe(true);
  await expect(page.locator(".site-hero")).toBeVisible();
  await expect(page.locator(".site-hero-person img").first()).toBeVisible();
  const tablist = page.locator(".site-detail-tabs");
  await expect(tablist).toBeVisible();
  const box = await tablist.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(tabs.last()).toHaveText(/Staff/);
  await page.screenshot({ path: shotPath("site_hero_390.png"), fullPage: false });
});
