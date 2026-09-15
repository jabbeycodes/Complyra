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

async function closeMobileNav(page: Page) {
  const open = page.locator(".sidebar.mobile-open");
  if (await open.count()) {
    await page.locator(".sidebar-close").click();
  }
  await expect(page.locator(".sidebar.mobile-open")).toHaveCount(0);
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

async function openNavPage(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
  await closeMobileNav(page);
}

async function shellMetrics(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".page-shell");
    const main = document.querySelector("main");
    const topbar = document.querySelector(".topbar");
    if (!shell || !main || !topbar) throw new Error("missing .page-shell, main, or topbar");
    const px = (value: string) => Number.parseFloat(value);
    const root = getComputedStyle(document.documentElement);
    const shellStyle = getComputedStyle(shell);
    const mainStyle = getComputedStyle(main);
    const topbarStyle = getComputedStyle(topbar);
    return {
      padStart: px(shellStyle.paddingInlineStart),
      padEnd: px(shellStyle.paddingInlineEnd),
      tokenStart: px(root.getPropertyValue("--page-inline-start")),
      tokenEnd: px(root.getPropertyValue("--page-inline-end")),
      pageInline: px(root.getPropertyValue("--page-inline")),
      panelInline: px(root.getPropertyValue("--panel-inline")),
      mainInlineStart: px(mainStyle.paddingInlineStart),
      topbarInlineStart: px(topbarStyle.paddingInlineStart),
    };
  });
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

async function assertTitleInheritsShell(page: Page) {
  const crumb = page.locator(".breadcrumb");
  const heading = page.locator("main h1").first();
  await expect(heading).toBeVisible();
  const [crumbBox, headingBox] = await Promise.all([
    crumb.boundingBox(),
    heading.boundingBox(),
  ]);
  expect(crumbBox).toBeTruthy();
  expect(headingBox).toBeTruthy();
  expect(
    Math.abs(crumbBox!.x - headingBox!.x),
    "topbar title and page title should share the shell inset",
  ).toBeLessThanOrEqual(2);
}

async function assertPageHasNoSecondGutter(page: Page, selector: string) {
  const extra = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return Number.parseFloat(getComputedStyle(el).paddingInlineStart);
  }, selector);
  if (extra === null) return;
  expect(extra, `${selector} must not add a second page gutter`).toBe(0);
}

const VIEWPORTS = [
  { width: 1280, height: 800, pageInline: 48, panelInline: 28 },
  { width: 960, height: 800, pageInline: 32, panelInline: 28 },
  { width: 390, height: 844, pageInline: 20, panelInline: 24 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`page-shell padding-inline-start matches the token at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await signIn(page);

    const metrics = await shellMetrics(page);
    expect(metrics.pageInline).toBe(viewport.pageInline);
    expect(metrics.panelInline).toBe(viewport.panelInline);
    expect(metrics.padStart).toBe(metrics.tokenStart);
    expect(metrics.padEnd).toBe(metrics.tokenEnd);
    expect(metrics.padStart).toBe(viewport.pageInline);
    expect(metrics.mainInlineStart).toBe(0);
    expect(metrics.topbarInlineStart).toBe(0);
    await assertTitleInheritsShell(page);
    await assertNoPageHorizontalScroll(page);

    await openNavPage(page, "Mileage");
    await expect(page.getByRole("heading", { name: "Mileage" })).toBeVisible();
    await assertPageHasNoSecondGutter(page, ".mileage-page");
    await assertTitleInheritsShell(page);
    await assertNoPageHorizontalScroll(page);
    await page.screenshot({
      path: shotPath(`mileage_shell_${viewport.width}.png`),
      fullPage: false,
    });

    await openNavPage(page, "Intake");
    await expect(page.getByRole("heading", { name: "Intake" })).toBeVisible();
    await assertPageHasNoSecondGutter(page, ".setup-form");
    const intakePad = await page.evaluate(() => {
      const panel = document.querySelector(".intake-panel");
      const root = getComputedStyle(document.documentElement);
      if (!panel) return null;
      return {
        pad: Number.parseFloat(getComputedStyle(panel).paddingInlineStart),
        token: Number.parseFloat(root.getPropertyValue("--panel-inline")),
      };
    });
    expect(intakePad).toBeTruthy();
    expect(intakePad!.pad).toBe(intakePad!.token);
    await assertTitleInheritsShell(page);
    await assertNoPageHorizontalScroll(page);
    await page.screenshot({
      path: shotPath(`intake_shell_${viewport.width}.png`),
      fullPage: false,
    });

    const appointmentsNav = page.locator(".sidebar").getByRole("button", {
      name: "Appointments",
      exact: true,
    });
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await appointmentsNav.count()) {
      if (await menu.isVisible()) await menu.click();
      await appointmentsNav.click();
      await closeMobileNav(page);
      await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
      await assertPageHasNoSecondGutter(page, ".appointments-page");
      await assertNoPageHorizontalScroll(page);
    }

    await openNavPage(page, "Individuals");
    await expect(page.getByRole("heading", { name: "Individuals" })).toBeVisible();
    await page.getByRole("button", { name: /Jodie Williams|Ellis Hart/ }).first().click();
    await expect(page.locator(".individual-chart")).toBeVisible();
    await assertPageHasNoSecondGutter(page, ".individual-chart");
    const chartPad = await page.evaluate(() => {
      const widget = document.querySelector(".health-widget, .chart-widget");
      const root = getComputedStyle(document.documentElement);
      if (!widget) return null;
      return {
        pad: Number.parseFloat(getComputedStyle(widget).paddingInlineStart),
        token: Number.parseFloat(root.getPropertyValue("--panel-inline")),
      };
    });
    expect(chartPad).toBeTruthy();
    expect(chartPad!.pad).toBe(chartPad!.token);
    await assertNoPageHorizontalScroll(page);
    await page.screenshot({
      path: shotPath(`chart_shell_${viewport.width}.png`),
      fullPage: false,
    });

    if (viewport.width === 390) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const lastButton = page.locator("main .button").last();
      const box = await lastButton.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
    }
  });
}
