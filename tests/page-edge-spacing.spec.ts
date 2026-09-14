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
}

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

async function canvasMetrics(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const topbar = document.querySelector(".topbar");
    if (!main || !topbar) throw new Error("missing main or topbar");
    const mainStyle = getComputedStyle(main);
    const topbarStyle = getComputedStyle(topbar);
    const px = (value: string) => Number.parseFloat(value);
    const doc = document.documentElement;
    return {
      mainPadStart: px(mainStyle.paddingLeft),
      mainPadEnd: px(mainStyle.paddingRight),
      topbarPadStart: px(topbarStyle.paddingLeft),
      topbarPadEnd: px(topbarStyle.paddingRight),
      pageInline: px(getComputedStyle(doc).getPropertyValue("--page-inline")),
      panelInline: px(getComputedStyle(doc).getPropertyValue("--panel-inline")),
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      clientWidth: doc.clientWidth,
    };
  });
}

async function closeMobileNav(page: Page) {
  const sidebar = page.locator(".sidebar.mobile-open");
  if (await sidebar.isVisible()) {
    await page.locator(".sidebar-close").click();
    await expect(sidebar).toBeHidden();
  }
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
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
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

test("desktop canvas and panel actions keep a 40/20 inset at 1280", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  const overview = await canvasMetrics(page);
  expect(overview.pageInline).toBeGreaterThanOrEqual(40);
  expect(overview.mainPadStart).toBeGreaterThanOrEqual(40);
  expect(overview.mainPadEnd).toBeGreaterThanOrEqual(40);
  expect(overview.topbarPadStart).toBeGreaterThanOrEqual(40);
  expect(overview.topbarPadEnd).toBeGreaterThanOrEqual(40);
  expect(overview.panelInline).toBeGreaterThanOrEqual(20);
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

test("phone canvas keeps 16px page inset and 20px panel actions at 390", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const overview = await canvasMetrics(page);
  expect(overview.pageInline).toBeGreaterThanOrEqual(16);
  expect(overview.mainPadStart).toBeGreaterThanOrEqual(16);
  expect(overview.mainPadEnd).toBeGreaterThanOrEqual(16);
  expect(overview.topbarPadStart).toBeGreaterThanOrEqual(16);
  expect(overview.topbarPadEnd).toBeGreaterThanOrEqual(16);
  expect(overview.panelInline).toBeGreaterThanOrEqual(20);
  await assertNoPageHorizontalScroll(page);

  await page.screenshot({
    path: shotPath("overview_after_390.png"),
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
