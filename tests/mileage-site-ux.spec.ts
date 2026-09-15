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

async function closeMobileNav(page: Page) {
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
}

async function openNav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
  const open = page.locator(".sidebar.mobile-open");
  if (await open.isVisible()) await closeMobileNav(page);
}

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

async function assertNoPageHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, scrollX: window.scrollX };
  });
  expect(overflow.scrollX).toBe(0);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function assertPanelContentInset(page: Page, panelSelector: string, innerSelector: string) {
  const gap = await page.evaluate(
    ({ panelSelector: panel, innerSelector: inner }) => {
      const card = document.querySelector(panel);
      const node = document.querySelector(inner);
      if (!card || !node) return null;
      const a = card.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      return { fromStart: b.left - a.left, fromEnd: a.right - b.right };
    },
    { panelSelector, innerSelector },
  );
  expect(gap, `${panelSelector} ${innerSelector}`).toBeTruthy();
  expect(gap!.fromStart, `${innerSelector} start inset`).toBeGreaterThanOrEqual(20);
  expect(gap!.fromEnd, `${innerSelector} end inset`).toBeGreaterThanOrEqual(16);
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

  const monthlyBar = page.locator(".mileage-toolbar");
  await expect(monthlyBar.getByRole("button", { name: "Print monthly" })).toBeVisible();
  await expect(monthlyBar.getByRole("button", { name: "Monthly PDF" })).toBeVisible();
  await assertPanelContentInset(
    page,
    '[aria-label="Log a trip"]',
    '[aria-label="Log a trip"] input[type="date"]',
  );
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({ path: shotPath("mileage_admin_monthly.png"), fullPage: false });

  const monthly = page.waitForEvent("download");
  await monthlyBar.getByRole("button", { name: "Monthly PDF" }).click();
  const monthlyFile = await monthly;
  expect(monthlyFile.suggestedFilename()).toMatch(/mileage-log.*\.pdf$/);

  await page.getByRole("tab", { name: "Weekly sheet" }).click();
  await expect(page.getByRole("heading", { name: /Weekly sheet/ })).toBeVisible();
  const weeklyBar = page.locator(".mileage-toolbar");
  await expect(weeklyBar.getByRole("button", { name: "Print weekly" })).toBeVisible();
  await expect(weeklyBar.getByRole("button", { name: "Weekly PDF" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_admin_weekly.png"), fullPage: false });

  const weekly = page.waitForEvent("download");
  await weeklyBar.getByRole("button", { name: "Weekly PDF" }).click();
  const weeklyFile = await weekly;
  expect(weeklyFile.suggestedFilename()).toMatch(/mileage-weekly.*\.pdf$/);
  await assertPanelContentInset(
    page,
    '[aria-label="Weekly mileage sheet"]',
    '[aria-label="Weekly mileage sheet"] h2',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await closeMobileNav(page);
  await assertNoPageHorizontalScroll(page);
  await expect(weeklyBar.getByRole("button", { name: "Print weekly" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_admin_weekly_390.png"), fullPage: false });
  await page.getByRole("tab", { name: "Monthly log" }).click();
  await expect(page.getByRole("button", { name: "Print monthly" }).first()).toBeVisible();
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({ path: shotPath("mileage_admin_monthly_390.png"), fullPage: false });
});

test("program site hero and tabs at 1280 and 390 keep Staff last", async ({
  page,
}) => {
  async function openMaple() {
    await openNav(page, "Sites & programs");
    await page
      .locator(".location-card")
      .filter({ hasText: "Cedar House" })
      .getByRole("button", { name: /Open site/ })
      .click();
    await expect(page.getByRole("heading", { name: "Cedar House" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openMaple();
  await expect(page.locator(".site-hero")).toBeVisible();
  await expect(page.locator(".site-hero-stat").filter({ hasText: "Individuals" })).toContainText(
    "2",
  );
  await expect(page.getByLabel("Individuals in this house")).toContainText("Ellis");
  await expect(page.getByLabel("Individuals in this house")).toContainText("Morgan");
  await expect(page.getByLabel("Individuals in this house")).not.toContainText("Jodie");
  await expect(page.locator(".site-hero .status-mix")).toBeVisible();
  await expect(page.locator(".site-hero-people")).toBeVisible();
  await expect(page.locator(".site-hero-person img").first()).toBeVisible();
  await expect(page.locator(".site-hero-scores")).toContainText("Ready");
  await expect(page.locator(".site-hero-scores")).toContainText("Individuals");
  await expect(page.locator(".site-hero-scores")).not.toContainText("People");
  await expect(page.getByLabel("Individuals in this house")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Open record");
  const tabs = page.locator(".site-detail-tabs [role='tab']");
  await expect(tabs.last()).toHaveText(/Staff/);
  const dashFill = await page.evaluate(() => {
    const hero = document.querySelector(".site-hero");
    const dash = document.querySelector(".site-hero-dash");
    if (!hero || !dash) return 0;
    const h = hero.getBoundingClientRect();
    const d = dash.getBoundingClientRect();
    return (d.right - h.left) / h.width;
  });
  expect(dashFill, "hero dash should fill the panel").toBeGreaterThan(0.78);
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
  await page.locator(".site-hero").scrollIntoViewIfNeeded();
  await expect(page.locator(".site-hero-person img").first()).toBeVisible();
  const tablist = page.locator(".site-detail-tabs");
  await expect(tablist).toBeVisible();
  const box = await tablist.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(tabs.last()).toHaveText(/Staff/);
  const legendToKpis = await page.evaluate(() => {
    const legend = document.querySelector(".site-hero .status-mix-legend");
    const kpis = document.querySelector(".site-hero-kpis");
    if (!legend || !kpis) return 999;
    return kpis.getBoundingClientRect().top - legend.getBoundingClientRect().bottom;
  });
  expect(legendToKpis, "legend-to-KPI gap on phone").toBeLessThan(24);
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({ path: shotPath("site_hero_390.png"), fullPage: false });
  await tablist.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath("site_tabs_390.png"), fullPage: false });
});
