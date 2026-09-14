import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

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

/** Page shell must not scroll sideways; inner table-scroll is allowed (PR #13). */
async function assertNoHorizontalOverflow(page: Page) {
  await page.mouse.wheel(120, 0);
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement;
    const pageShifted = window.scrollX > 0;
    window.scrollTo(0, window.scrollY);
    const wide = [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position === "fixed") return false;
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
          overflowX === "hidden"
        ) {
          return false;
        }
        parent = parent.parentElement;
      }
      const box = el.getBoundingClientRect();
      return box.width > 1 && box.right > vw + 2;
    });
    return {
      pageShifted,
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      clientWidth: doc.clientWidth,
      wide: wide.slice(0, 8).map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 40)}`,
      ),
    };
  });
  expect(result.pageShifted, "page should not scroll sideways").toBe(false);
  expect(
    result.scrollWidth,
    "shell scrollWidth must not exceed the viewport",
  ).toBeLessThanOrEqual(result.clientWidth + 1);
  expect(result.wide, "in-flow layout should stay in the viewport").toEqual([]);
}

async function openPage(page: Page, name: string) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
}

test("login and workspace pages stay on screen at phone width", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /What needs your attention/ })).toBeVisible();
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

  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).toBeTruthy();
  expect(menuBox!.width).toBeGreaterThanOrEqual(44);
  expect(menuBox!.height).toBeGreaterThanOrEqual(44);

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.locator("main .eyebrow")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("A little clarity");

  const exportBtn = page.getByRole("button", { name: "Export" });
  await expect(exportBtn).toBeVisible();
  const exportBox = await exportBtn.boundingBox();
  expect(exportBox).toBeTruthy();
  expect(exportBox!.height).toBeGreaterThanOrEqual(44);
  expect(exportBox!.x).toBeGreaterThanOrEqual(0);
  expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(390 + 1);

  await openPage(page, "Delegations");
  await page.getByRole("button", { name: "RN delegation forms" }).click();
  await page.getByRole("button", { name: "New delegation" }).click();
  const create = page.getByRole("button", { name: "Create", exact: true });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  await assertNoHorizontalOverflow(page);
});

test("430-wide phone also keeps the shell from scrolling sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await signIn(page);
  await assertNoHorizontalOverflow(page);
  await openPage(page, "Requirements");
  await assertNoHorizontalOverflow(page);
  await openPage(page, "Delegations");
  await assertNoHorizontalOverflow(page);
});
