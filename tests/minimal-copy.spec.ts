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

async function openPage(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
  const close = page.locator(".sidebar.mobile-open");
  if (await close.isVisible()) await page.locator(".sidebar-close").click();
}

test("workspace chrome is a plain title without slogan eyebrows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("A little clarity");
  await expect(page.locator("body")).not.toContainText("audit-ready agency");
  await expect(page.locator("body")).not.toContainText("YOUR AGENCY");
  await expect(page.getByRole("heading", { name: "Agency compliance" })).toBeVisible();
  await expect(page.locator(".dashboard-heading").getByRole("button", { name: /Export/ })).toHaveCount(0);
  await page.screenshot({ path: shotPath("copy_overview_after.png"), fullPage: false });

  await openPage(page, "Individuals");
  await expect(page.getByRole("heading", { level: 1, name: "Individuals" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PEOPLE AT THE CENTER");
  await expect(page.locator("body")).not.toContainText("Every person. One connected record");
  await page.screenshot({ path: shotPath("copy_individuals_after.png"), fullPage: false });

  await openPage(page, "Delegations");
  await expect(page.getByRole("heading", { level: 1, name: "Delegations" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Delegation is non-transferable");
  await expect(page.locator("body")).not.toContainText("ONE TASK. ONE ROSTER");
  await page.screenshot({ path: shotPath("copy_delegations_after.png"), fullPage: false });

  await openPage(page, "Audit center");
  await expect(page.getByRole("heading", { level: 1, name: "Audit" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("An audit starts with confidence");
  await page.screenshot({ path: shotPath("copy_audit_after.png"), fullPage: false });
});
