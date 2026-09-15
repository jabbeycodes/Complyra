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

test("sidebar group is PROGRAMS and the header chip says Programs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  const programsLabel = page.locator(".sidebar .nav-label").first();
  await expect(programsLabel).toHaveText("PROGRAMS");
  await expect(page.locator(".nav-label", { hasText: "WORKSPACE" })).toHaveCount(0);
  await expect(page.locator(".breadcrumb")).toContainText("Programs");
  await expect(page.locator(".breadcrumb")).not.toContainText("Workspace");
  await page.screenshot({ path: shotPath("programs_sidebar_1280.png"), fullPage: false });

  await openNav(page, "Sites & programs");
  await expect(page.getByRole("heading", { name: "Sites & programs" })).toBeVisible();
  await page.screenshot({ path: shotPath("sites_after_1280.png"), fullPage: false });

  await openNav(page, "Mileage");
  await expect(page.getByRole("heading", { level: 1, name: "Mileage" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_after_1280.png"), fullPage: false });

  await openNav(page, "Sites & programs");
  await page
    .locator(".location-card")
    .filter({ hasText: "Maple House" })
    .getByRole("button", { name: /Open site/ })
    .click();
  await expect(page.getByRole("heading", { name: "Maple House" })).toBeVisible();
  await page.screenshot({ path: shotPath("site_detail_after_1280.png"), fullPage: false });
});

test("phone drawer shows PROGRAMS, not WORKSPACE", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar.mobile-open .nav-label").first()).toHaveText(
    "PROGRAMS",
  );
  await expect(page.locator(".nav-label", { hasText: "WORKSPACE" })).toHaveCount(0);
  await page.screenshot({ path: shotPath("programs_drawer_390.png"), fullPage: false });
  await closeMobileNav(page);
  await page.screenshot({ path: shotPath("overview_programs_390.png"), fullPage: false });
  await openNav(page, "Sites & programs");
  await expect(page.getByRole("heading", { name: "Sites & programs" })).toBeVisible();
  await page.screenshot({ path: shotPath("sites_after_390.png"), fullPage: false });
  await openNav(page, "Mileage");
  await expect(page.getByRole("heading", { level: 1, name: "Mileage" })).toBeVisible();
  await page.screenshot({ path: shotPath("mileage_after_390.png"), fullPage: false });
});
