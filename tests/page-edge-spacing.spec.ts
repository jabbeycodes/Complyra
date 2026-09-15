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

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

async function canvasMetrics(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const topbar = document.querySelector(".topbar");
    const shell = document.querySelector(".main-shell");
    if (!main || !topbar || !shell) throw new Error("missing main, topbar, or shell");
    const mainStyle = getComputedStyle(main);
    const topbarStyle = getComputedStyle(topbar);
    const shellStyle = getComputedStyle(shell);
    const px = (value: string) => Number.parseFloat(value);
    const doc = document.documentElement;
    return {
      mainPadStart: px(shellStyle.paddingLeft) + px(mainStyle.paddingLeft),
      mainPadEnd: px(shellStyle.paddingRight) + px(mainStyle.paddingRight),
      topbarPadStart: px(shellStyle.paddingLeft) + px(topbarStyle.paddingLeft),
      topbarPadEnd: px(shellStyle.paddingRight) + px(topbarStyle.paddingRight),
      pageInline: px(getComputedStyle(doc).getPropertyValue("--page-inline")),
      panelInline: px(getComputedStyle(doc).getPropertyValue("--panel-inline")),
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
}

async function closeMobileNav(page: Page) {
  const open = page.locator(".sidebar.mobile-open");
  if (await open.count()) {
    await page.locator(".sidebar-close").click();
  }
  await expect(page.locator(".sidebar.mobile-open")).toHaveCount(0);
  // Navigate already drops mobileOpen; wait out the 0.2s slide so shots
  // are of the page, not the half-closed drawer.
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

async function panelActionGap(
  page: Page,
  heading: string,
  buttonName: string | RegExp,
) {
  const panel = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: heading }),
  });
  const button = panel.getByRole("button", { name: buttonName }).first();
  await expect(button).toBeVisible();
  await button.scrollIntoViewIfNeeded();
  const [panelBox, buttonBox] = await Promise.all([
    panel.boundingBox(),
    button.boundingBox(),
  ]);
  if (!panelBox || !buttonBox) throw new Error("missing boxes");
  return {
    fromStart: buttonBox.x - panelBox.x,
    fromEnd: panelBox.x + panelBox.width - (buttonBox.x + buttonBox.width),
  };
}

async function assertNoPageHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      scrollX: window.scrollX,
    };
  });
  expect(overflow.scrollX, "page should not be shifted sideways").toBe(0);
  expect(
    overflow.scrollWidth,
    "page should not grow a horizontal scrollbar",
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test("desktop canvas and panel actions keep a 48/28 inset at 1280", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  const overview = await canvasMetrics(page);
  expect(overview.pageInline).toBeGreaterThanOrEqual(48);
  expect(overview.mainPadStart).toBeGreaterThanOrEqual(48);
  expect(overview.mainPadEnd).toBeGreaterThanOrEqual(48);
  expect(overview.topbarPadStart).toBeGreaterThanOrEqual(48);
  expect(overview.topbarPadEnd).toBeGreaterThanOrEqual(48);
  expect(overview.panelInline).toBeGreaterThanOrEqual(28);
  await assertNoPageHorizontalScroll(page);

  const avatar = page.getByRole("button", { name: "Your profile" });
  await expect(avatar).toBeVisible();
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox).toBeTruthy();
  expect(1280 - (avatarBox!.x + avatarBox!.width)).toBeGreaterThanOrEqual(16);

  await page.screenshot({
    path: shotPath("overview_after_1280.png"),
    fullPage: false,
  });

  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({
    path: shotPath("settings_after_1280.png"),
    fullPage: false,
  });

  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Individuals" })).toBeVisible();
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({
    path: shotPath("individuals_after_1280.png"),
    fullPage: false,
  });

  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name: "Delegations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await page.getByRole("button", { name: "RN delegation forms" }).click();

  const openForm = await panelActionGap(page, "Delegations", "Open form");
  expect(openForm.fromEnd).toBeGreaterThanOrEqual(20);
  await page.screenshot({
    path: shotPath("delegations_list_after_1280.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "New delegation" }).click();
  const cancel = await panelActionGap(page, "Delegations", "Cancel");
  expect(cancel.fromEnd).toBeGreaterThanOrEqual(20);
  await assertNoPageHorizontalScroll(page);

  await page.screenshot({
    path: shotPath("delegations_after_1280.png"),
    fullPage: false,
  });
});

test("phone canvas keeps 22px page inset and 24px panel actions at 390", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const overview = await canvasMetrics(page);
  expect(overview.pageInline).toBeGreaterThanOrEqual(22);
  expect(overview.mainPadStart).toBeGreaterThanOrEqual(22);
  expect(overview.mainPadEnd).toBeGreaterThanOrEqual(22);
  expect(overview.topbarPadStart).toBeGreaterThanOrEqual(22);
  expect(overview.topbarPadEnd).toBeGreaterThanOrEqual(22);
  expect(overview.panelInline).toBeGreaterThanOrEqual(24);
  await assertNoPageHorizontalScroll(page);

  await page.screenshot({
    path: shotPath("overview_after_390.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Settings", exact: true }).click();
  await closeMobileNav(page);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({
    path: shotPath("settings_after_390.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Individuals", exact: true }).click();
  await closeMobileNav(page);
  await expect(page.getByRole("heading", { name: "Individuals" })).toBeVisible();
  await assertNoPageHorizontalScroll(page);
  await page.screenshot({
    path: shotPath("individuals_after_390.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator(".sidebar").getByRole("button", { name: "Delegations", exact: true }).click();
  await closeMobileNav(page);
  await expect(page.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await page.getByRole("button", { name: "RN delegation forms" }).click();

  const openForm = await panelActionGap(page, "Delegations", "Open form");
  expect(openForm.fromEnd).toBeGreaterThanOrEqual(20);
  await page.screenshot({
    path: shotPath("delegations_list_after_390.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "New delegation" }).click();
  const cancel = await panelActionGap(page, "Delegations", "Cancel");
  expect(cancel.fromEnd).toBeGreaterThanOrEqual(20);
  await assertNoPageHorizontalScroll(page);

  await page.screenshot({
    path: shotPath("delegations_after_390.png"),
    fullPage: false,
  });
});
