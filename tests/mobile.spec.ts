import { test, expect, type Page } from "@playwright/test";

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
  await page.waitForFunction(() => {
    const sidebar = getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar")
      .trim();
    return window.innerWidth <= 430 && sidebar === "0px";
  });
  await page.addStyleTag({
    content: ".sidebar,.mobile-backdrop{transition:none!important}",
  });
}

async function closeMobileNav(page: Page) {
  const open = page.locator(".sidebar.mobile-open");
  if (await open.count()) {
    await page.locator(".sidebar-close").click();
  }
  const overview = page.locator(".sidebar").getByRole("button", { name: "Overview" });
  if (await overview.count()) {
    await expect(overview).not.toBeInViewport();
  }
}

/**
 * Page shell must not pan sideways. Inner `.table-scroll` may be wider than
 * the viewport (PR #13). Chromium still folds that inner overflow into
 * `documentElement.scrollWidth`, so we assert boxes — not that metric.
 */
async function assertNoHorizontalOverflow(page: Page) {
  await closeMobileNav(page);
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const pageShifted = window.scrollX > 0;
    window.scrollTo(0, window.scrollY);

    function insideHorizontalScroller(el: Element) {
      let parent = el.parentElement;
      while (
        parent &&
        parent !== document.body &&
        parent !== document.documentElement
      ) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (
          overflowX === "auto" ||
          overflowX === "scroll" ||
          overflowX === "hidden" ||
          overflowX === "clip"
        ) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }

    const wide = [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position === "fixed") return false;
      if (insideHorizontalScroller(el)) return false;
      const box = el.getBoundingClientRect();
      return box.width > 1 && box.right > vw + 2;
    });

    const scrollers = [...document.querySelectorAll(".table-scroll")].map((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      right: el.getBoundingClientRect().right,
    }));

    return {
      vw,
      pageShifted,
      scrollers,
      wide: wide.slice(0, 8).map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 40)}`,
      ),
    };
  });
  expect(result.pageShifted, "page should not scroll sideways").toBe(false);
  expect(result.wide, "in-flow layout should stay in the viewport").toEqual([]);
  for (const scroller of result.scrollers) {
    expect(
      scroller.clientWidth,
      "table-scroll viewport must stay on canvas",
    ).toBeLessThanOrEqual(result.vw + 1);
    expect(
      scroller.right,
      "table-scroll box must stay on canvas",
    ).toBeLessThanOrEqual(result.vw + 2);
  }
}

async function openPage(page: Page, name: string) {
  await closeMobileNav(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name }).click();
  await closeMobileNav(page);
}

test.describe("390 phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("login and workspace pages stay on screen at phone width", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Needs attention/ })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    for (const name of [
      "Individuals",
      "Sites & programs",
      "Staff",
      "Requirements",
      "Delegations",
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
    await expect(
      page.getByRole("heading", { name: "Jodie Williams", exact: true }),
    ).toBeVisible();
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

  test("phone chrome keeps 44px targets, one title, and reachable Create", async ({
    page,
  }) => {
    await signIn(page);

    const banner = page.locator(".demo-banner");
    await expect(banner).toBeVisible();
    const bannerBox = await banner.boundingBox();
    expect(bannerBox).toBeTruthy();
    expect(bannerBox!.height).toBeLessThanOrEqual(48);
    await expect(page.locator(".demo-banner-sub")).toBeHidden();

    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).toBeTruthy();
    expect(menuBox!.width).toBeGreaterThanOrEqual(44);
    expect(menuBox!.height).toBeGreaterThanOrEqual(44);
    expect(menuBox!.x).toBeGreaterThanOrEqual(16);

    const bell = page.getByRole("button", { name: "View notifications" });
    const bellBox = await bell.boundingBox();
    expect(bellBox).toBeTruthy();
    expect(bellBox!.width).toBeGreaterThanOrEqual(44);
    expect(bellBox!.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.locator("main .eyebrow")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("A little clarity");
    await expect(page.locator("body")).not.toContainText("YOUR AGENCY");
    await expect(page.locator("body")).not.toContainText("A record of care");

    const review = page.locator(".readiness-banner").getByRole("button", { name: /Review/ });
    await expect(review).toBeVisible();
    const reviewBox = await review.boundingBox();
    expect(reviewBox).toBeTruthy();
    expect(reviewBox!.width).toBeGreaterThanOrEqual(44);
    expect(reviewBox!.height).toBeGreaterThanOrEqual(44);

    const exportBtn = page.getByRole("button", { name: "Export" });
    await expect(exportBtn).toBeVisible();
    const exportBox = await exportBtn.boundingBox();
    expect(exportBox).toBeTruthy();
    expect(exportBox!.height).toBeGreaterThanOrEqual(44);
    expect(exportBox!.x).toBeGreaterThanOrEqual(0);
    expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(390 + 1);

    const shot = `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}`;
    await page.screenshot({ path: `${shot}/mobile_overview_390.png`, fullPage: false });

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.locator(".sidebar").getByRole("button", { name: "Overview" }),
    ).toBeInViewport();
    const navItem = page.locator(".sidebar .nav-item").first();
    const navBox = await navItem.boundingBox();
    expect(navBox).toBeTruthy();
    expect(navBox!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${shot}/mobile_nav_390.png`, fullPage: false });
    await closeMobileNav(page);

    await openPage(page, "Delegations");
    await page.getByRole("button", { name: "RN delegation forms" }).click();
    await page.getByRole("button", { name: "New delegation" }).click();
    const create = page.getByRole("button", { name: "Create", exact: true });
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${shot}/mobile_delegations_create_390.png`, fullPage: false });
  });
});

test.describe("430 phone", () => {
  test.use({ viewport: { width: 430, height: 932 } });

  test("430-wide phone also keeps the shell from scrolling sideways", async ({
    page,
  }) => {
    await signIn(page);
    await assertNoHorizontalOverflow(page);
    await openPage(page, "Requirements");
    await expect(page.locator(".sidebar.mobile-open")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    const shot = `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}`;
    await page.screenshot({ path: `${shot}/mobile_requirements_430.png`, fullPage: false });
    await openPage(page, "Delegations");
    await assertNoHorizontalOverflow(page);
  });
});
