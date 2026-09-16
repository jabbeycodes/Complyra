import { test, expect, type Page } from "./fixtures";

async function signIn(page: Page, username = "sarah.mitchell") {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
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

test("Sites list is a 2-col card grid with address, capacity, and Open at 1280", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openNav(page, "Sites & programs");
  await expect(page.getByRole("heading", { name: "Sites & programs" })).toBeVisible();
  const cards = page.locator(".site-grid .location-card");
  await expect(cards).toHaveCount(2);
  const first = cards.first();
  await expect(first.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(first.locator(".location-address")).toContainText("Columbia, MO");
  await expect(first.locator(".location-capacity")).toContainText("of 2 Individuals");
  await expect(first.getByRole("button", { name: /Open site/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bPeople\b/);
  const columnCount = await page.evaluate(() => {
    const grid = document.querySelector(".site-grid");
    if (!grid) return 0;
    const cols = getComputedStyle(grid).gridTemplateColumns;
    return cols.split(/ (?![^(]*\))/).filter(Boolean).length;
  });
  expect(columnCount).toBe(2);
  await page.screenshot({ path: shotPath("sites_list_1280.png"), fullPage: false });

  await first.getByRole("button", { name: /Open site/ }).click();
  await expect(page.locator(".site-hero")).toBeVisible();
  await expect(page.locator(".site-hero-address-text")).toContainText("Columbia, MO");
  const tabs = page.locator(".site-detail-tabs [role='tab']");
  await expect(tabs.last()).toHaveText(/Staff/);
  const selected = page.locator(".site-detail-tabs [role='tab'][aria-selected='true']");
  await expect(selected).toBeVisible();
  const tabHeight = await selected.evaluate((el) => el.getBoundingClientRect().height);
  expect(tabHeight).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: shotPath("site_detail_tabs_1280.png"), fullPage: false });
});

test("Sites list stacks to one column at 390 and site tabs stay a single scrolling strip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.addStyleTag({
    content: ".sidebar,.mobile-backdrop{transition:none!important}",
  });
  await openNav(page, "Sites & programs");
  const columns = await page.evaluate(() => {
    const grid = document.querySelector(".site-grid");
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  });
  expect(columns).toBe(1);
  const cardBox = await page.locator(".site-grid .location-card").first().boundingBox();
  expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: shotPath("sites_list_390.png"), fullPage: false });

  await page.locator(".site-grid .location-card").first().getByRole("button", { name: /Open site/ }).click();
  await expect(page.locator(".site-hero")).toBeVisible();
  await page.locator(".site-detail-tabstrip").scrollIntoViewIfNeeded();
  const wrap = await page.evaluate(() => getComputedStyle(document.querySelector(".site-detail-tabs")!).flexWrap);
  expect(wrap).toBe("nowrap");
  await expect(page.locator(".site-detail-tabs [role='tab']").last()).toHaveText(/Staff/);
  await page.screenshot({ path: shotPath("site_detail_tabs_390.png"), fullPage: false });
});

test("DSP only sees caseload sites and cannot add a site", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "alex.morgan");
  await openNav(page, "Sites & programs");
  await expect(page.getByRole("button", { name: "Add a site" })).toHaveCount(0);
  await expect(page.locator(".site-grid .location-card")).toHaveCount(1);
});
