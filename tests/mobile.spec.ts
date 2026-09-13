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
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const scroller = document.scrollingElement;
    if (scroller) scroller.scrollLeft = 80;
    const pageShifted = Boolean(scroller && scroller.scrollLeft > 0);
    if (scroller) scroller.scrollLeft = 0;
    const wide = [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position === "fixed") return false;
      const box = el.getBoundingClientRect();
      return box.width > 1 && box.right > vw + 2;
    });
    return {
      pageShifted,
      wide: wide.slice(0, 8).map((el) => el.className?.toString().slice(0, 60)),
    };
  });
  expect(result.pageShifted, "page should not scroll sideways").toBe(false);
  expect(result.wide, "in-flow layout should stay in the viewport").toEqual([]);
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
