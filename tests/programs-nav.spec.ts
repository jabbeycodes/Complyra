import { test, expect, type Page } from "./fixtures";

async function signIn(page: Page) {
  // These specs drive the desktop layout, including at phone width
  // (mid-test resizes included). Since PR #134 a phone sign-in lands
  // in the mobile shell and a mid-session narrow resize swaps to it;
  // the desktop layout is what a user gets after picking "Desktop
  // view" once — the pick persists (the app reads complyrer.viewMode
  // at boot), so seed it before the app loads.
  await page.addInitScript(() => {
    localStorage.setItem("complyrer.viewMode", "desktop");
  });
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
  // Only click the close button when the drawer is actually open:
  // at desktop widths .sidebar-close is display:none with an empty
  // box at the sidebar's top-left, and a force click there lands on
  // the brand button and navigates to Overview (the pattern the
  // mobile / page-edge-spacing helpers already guard against).
  const open = page.locator(".sidebar.mobile-open");
  if (await open.count()) {
    await page.locator(".sidebar-close").click();
  }
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

test("sidebar group is Programs and the header chip says Programs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  const programsLabel = page.locator(".sidebar .nav-label").first();
  await expect(programsLabel).toHaveText("Programs");
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
    .filter({ hasText: "Cedar House" })
    .getByRole("button", { name: /Open site/ })
    .click();
  // The site title is the h1; the coverage board's h2 ("Cedar House
  // coverage") also matches a bare name lookup.
  await expect(page.getByRole("heading", { name: "Cedar House", exact: true, level: 1 })).toBeVisible();
  await page.screenshot({ path: shotPath("site_detail_after_1280.png"), fullPage: false });
});

test("phone drawer shows Programs, not WORKSPACE", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.addStyleTag({
    content: ".sidebar,.mobile-backdrop{transition:none!important}",
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar.mobile-open .nav-label").first()).toHaveText(
    "Programs",
  );
  await expect(page.locator(".nav-label", { hasText: "WORKSPACE" })).toHaveCount(0);
  await expect(
    page.locator(".sidebar.mobile-open").getByRole("button", { name: "Overview" }),
  ).toBeInViewport();
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
