import { test, expect, type Page } from "./fixtures";

// Platform-wide bottom navigation + collapsed-by-default sidebar, on the
// regular (desktop-layout) pages in mobile view. The mobile shell has its
// own pill for its own screens (mobile-shell.spec.ts); this spec covers
// the desktop layout showing in a mobile context — reached here by
// deep-linking from the shell (a tile tap) under the mobile pick, which
// is how those pages actually occur. An explicit "Desktop view" pick is
// the opposite case — a true desktop layout with no mobile context —
// and is covered as such in the last test.
//
// Founder rules under test:
// - the sidebar starts collapsed in mobile view; the existing menu
//   control still opens it;
// - the same role-gated pill renders across the regular pages, with the
//   scroll behavior: down collapses it to a slim remnant, tapping the
//   remnant restores it, scrolling up restores it;
// - the pill stays away where the bottom is already owned: the Weekly
//   checklist's sticky sign-&-submit bar, the MAR flow, the ISP form.
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(300_000);

const SHOT_DIR = "mobile-screenshots";
const shot = (name: string) => `${SHOT_DIR}/${name}`;

async function signIn(page: Page, username: string) {
  await page.clock.setFixedTime(new Date("2026-09-12T13:30:00.000Z"));
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function toShellHome(page: Page) {
  // Multi-home users land on the home picker first; single-home users
  // skip straight in.
  const picker = page.getByText("Select your home");
  try {
    await picker.waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: /Cedar House/ }).click();
  } catch {
    // Already in the shell home.
  }
  await expect(
    page.getByRole("heading", { name: "Today at Cedar House" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function toDeepLinkedPage(page: Page) {
  // A tile tap deep-links from the shell into the regular page under the
  // mobile pick: the desktop layout in a mobile context — "‹ Mobile
  // home" return bar on top, .mobile-context on the shell, the platform
  // pill at the bottom.
  await page.getByRole("button", { name: /Appointments/ }).first().click();
  await expect(page.locator(".breadcrumb strong")).toHaveText(
    "Appointments",
    { timeout: 30_000 },
  );
  await expect(page.locator(".mobile-return-bar")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveClass(/mobile-context/);
}

async function drawerTo(page: Page, name: string) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.locator(".breadcrumb strong")).toHaveText(name);
}

test("DSP shell: ISP Data tile present, no Shift Notes tile", async ({
  page,
}) => {
  await signIn(page, "alex.morgan");
  await toShellHome(page);
  await expect(
    page.getByRole("button", { name: /ISP Data/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Shift Notes/ })).toHaveCount(
    0,
  );
});

/**
 * Scroll in steps, like a finger does. A single programmatic jump fires
 * one scroll event, but the collapse behavior is defined over a stream
 * of positions (and a mounted page anchors on its first reading, so a
 * restored scroll position never collapses the nav by itself).
 */
async function scrollToInSteps(page: Page, target: number) {
  await page.evaluate(async (targetY) => {
    const step = window.scrollY < targetY ? 180 : -240;
    let y = window.scrollY;
    while (step > 0 ? y < targetY : y > targetY) {
      y = step > 0 ? Math.min(y + step, targetY) : Math.max(y + step, targetY);
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
  }, target);
}

test("platform nav: Overview — sidebar starts collapsed, scroll-collapse cycle", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");
  await toShellHome(page);
  await toDeepLinkedPage(page);
  await drawerTo(page, "Overview");

  // Sidebar starts collapsed in mobile view: its box sits off the left
  // edge of the viewport. The existing menu control opens it; the
  // backdrop dismisses it again.
  const sidebar = page.locator(".sidebar");
  const collapsedBox = await sidebar.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.x + collapsedBox!.width).toBeLessThanOrEqual(1);
  await page.screenshot({ path: shot("sidebar-collapsed-390.png") });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.x ?? -999)
    .toBeGreaterThanOrEqual(-1);
  await page.screenshot({ path: shot("sidebar-expanded-390.png") });
  // Tap the dimmed area beside the drawer (the drawer's own box covers
  // the backdrop's center — a tap there lands on the drawer, as it
  // should).
  await page
    .locator(".mobile-backdrop")
    .click({ position: { x: 375, y: 400 } });
  await expect
    .poll(async () => {
      const box = await sidebar.boundingBox();
      return box ? box.x + box.width : 999;
    })
    .toBeLessThanOrEqual(1);

  // The pill is here, expanded, carrying the role's destinations.
  const nav = page.getByRole("navigation", { name: "Mobile" });
  await expect(nav).toBeVisible();
  for (const label of ["Home", "Tasks", "Meds", "People", "More"]) {
    await expect(
      nav.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({ path: shot("overview-nav-expanded.png") });

  // Scroll down: the pill collapses to the slim remnant (not gone).
  await scrollToInSteps(page, 1400);
  const remnant = page.getByRole("button", { name: "Show navigation" });
  await expect(remnant).toBeVisible();
  await expect(nav).toHaveCount(0);
  await page.screenshot({ path: shot("overview-nav-collapsed.png") });

  // Tap the remnant: the pill returns.
  await remnant.click();
  await expect(nav).toBeVisible();

  // Scroll down again: collapsed again. Scroll up: restored.
  await scrollToInSteps(page, 2400);
  await expect(remnant).toBeVisible();
  await expect(nav).toHaveCount(0);
  await scrollToInSteps(page, 300);
  await expect(nav).toBeVisible();
  await expect(remnant).toHaveCount(0);
});

test("platform nav: present on Individuals and Appointments, absent where the bottom is owned", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");
  await toShellHome(page);
  await toDeepLinkedPage(page);
  const nav = page.getByRole("navigation", { name: "Mobile" });
  await expect(nav).toBeVisible();

  // Between regular pages the pill stays. Pages are reached through the
  // (collapsed) sidebar drawer, which is how a phone user gets there.
  await drawerTo(page, "Individuals");
  await expect(nav).toBeVisible();

  await drawerTo(page, "Appointments");
  await expect(nav).toBeVisible();

  // The Weekly checklist's sticky sign-&-submit bar owns the bottom on
  // that screen — the pill stays away entirely.
  await drawerTo(page, "Weekly checklist");
  await expect(page.locator(".checklist-sticky-bar")).toBeVisible();
  await expect(nav).toHaveCount(0);

  // Back in the shell (the deep link's "‹ Mobile home" return bar), the
  // MAR flow and the ISP entry form own their bottoms too — no pill
  // there either.
  await page.locator(".mobile-return-bar").click();
  await expect(
    page.getByRole("heading", { name: "Today at Cedar House" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await expect(
    page.getByText("Pick the person whose medications"),
  ).toBeVisible();
  await expect(nav).toHaveCount(0);
  await page.getByRole("button", { name: "‹ Home" }).click();
  await page.getByRole("button", { name: /ISP Data/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page
    .getByRole("button", { name: /2026 ISP — Daily living supports/ })
    .click();
  await page.getByRole("button", { name: "Create entry" }).click();
  await expect(
    page.getByRole("heading", { name: "Task scores" }),
  ).toBeVisible();
  await expect(nav).toHaveCount(0);
});

test("platform nav destinations land in the shell at the right view", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");
  await toShellHome(page);
  await toDeepLinkedPage(page);
  const nav = page.getByRole("navigation", { name: "Mobile" });
  await expect(nav).toBeVisible();

  // Tasks opens the shell's queue view.
  await nav.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Your due and priority work")).toBeVisible({
    timeout: 30_000,
  });

  // Home returns to the shell home.
  await page
    .getByRole("navigation", { name: "Mobile" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Today at Cedar House" }),
  ).toBeVisible();
});

test("explicit Desktop pick and desktop width: true desktop layout, no platform pill", async ({
  page,
}) => {
  // At phone width, an explicit "Desktop view" pick is an escape hatch:
  // the user gets the true desktop layout — no .mobile-context (so no
  // collapsed-by-context sidebar, no 112px nav padding), no platform
  // pill, no return bar. The desktop layout's own phone-width rules are
  // what apply.
  await signIn(page, "sarah.mitchell");
  await toShellHome(page);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: /Desktop view/ }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("Overview", {
    timeout: 30_000,
  });
  await expect(page.locator(".app-shell")).not.toHaveClass(/mobile-context/);
  await expect(
    page.getByRole("navigation", { name: "Mobile" }),
  ).toHaveCount(0);
  await expect(page.locator(".mobile-return-bar")).toHaveCount(0);

  // At desktop width the same layout is simply docked, as before.
  await page.setViewportSize({ width: 1280, height: 1050 });
  await expect(page.locator(".breadcrumb strong")).toHaveText("Overview", {
    timeout: 60_000,
  });
  await expect(page.locator(".app-shell")).not.toHaveClass(/mobile-context/);
  const sidebar = page.locator(".sidebar");
  const box = await sidebar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeGreaterThan(150);
  await expect(
    page.getByRole("navigation", { name: "Mobile" }),
  ).toHaveCount(0);
  await expect(page.locator(".mobile-return-bar")).toHaveCount(0);
});
