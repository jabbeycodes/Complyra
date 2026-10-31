import { test, expect, type Page } from "./fixtures";

async function signIn(page: Page) {
  // These specs assert on the desktop layout, including at phone
  // width. Since PR #134 a phone sign-in lands in the mobile shell;
  // the desktop layout is what a user gets after picking "Desktop
  // view" once — the pick persists (the app reads
  // complyrer.viewMode at boot), so seed it before the app loads.
  await page.addInitScript(() => {
    localStorage.setItem("complyrer.viewMode", "desktop");
  });
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  // At phone width sign-in lands in the mobile shell (PR #134) — its
  // header is the banner landmark; the desktop topbar only exists in
  // the desktop layout. Accept either.
  await expect(
    page.getByRole("banner").or(page.locator(".topbar")),
  ).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

test("Overview keeps a 2x2 score grid on a phone and no hero Export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.locator(".dashboard-heading").getByRole("button", { name: /Export/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export report (PDF)" })).toHaveCount(0);

  const cards = page.locator(".stat-card");
  await expect(cards).toHaveCount(4);
  const boxes = [];
  for (let i = 0; i < 4; i++) boxes.push(await cards.nth(i).boundingBox());
  expect(boxes[0] && boxes[1] && boxes[2] && boxes[3]).toBeTruthy();
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(12);
  expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(12);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + 48);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + 80);

  // The Overview now leads with per-house compliance donuts (same figure),
  // so this targets the Status mix panel's own figure specifically.
  const mix = page
    .locator(".status-mix-panel")
    .getByRole("figure", { name: /status mix/i });
  await expect(mix).toBeVisible();
  const mixBox = await mix.locator(".status-mix-chart").boundingBox();
  expect(mixBox).toBeTruthy();
  expect(mixBox!.width).toBeLessThanOrEqual(220);
  const shot = `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}`;
  await page.screenshot({ path: `${shot}/overview_2x2_390.png`, fullPage: false });
});

test("Settings exports a compliance report PDF for admins", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name: "Settings", exact: true }).click();
  const exportBtn = page.getByRole("button", { name: "Export compliance report" });
  await expect(exportBtn).toBeVisible();
  await exportBtn.scrollIntoViewIfNeeded();
  const shot = `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}`;
  await page.screenshot({ path: `${shot}/settings_export_1280.png`, fullPage: false });
  const download = page.waitForEvent("download");
  await exportBtn.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/Evergreen-Care-compliance-\d{4}-\d{2}-\d{2}\.pdf/);
});
