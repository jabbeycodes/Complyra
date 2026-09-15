import { test, expect, type Page } from "./fixtures";

async function dismissTour(page: Page) {
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

async function signIn(
  page: Page,
  agency = "EVERGREEN-MO",
  username = "sarah.mitchell",
) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill(agency);
  await page.getByLabel("Username").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await dismissTour(page);
}

async function openNavPage(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
}

test("agency admin cannot see or open AI settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);

  await expect(
    page.locator(".sidebar").getByRole("button", { name: "AI settings", exact: true }),
  ).toHaveCount(0);

  await openNavPage(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verify service account" })).toHaveCount(0);
  await expect(page.getByLabel("AI model name")).toHaveCount(0);

  await page.evaluate(() => {
    location.hash = "AI settings";
  });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI settings" })).toHaveCount(0);
});

test("platform operator can open and use AI settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "COMPLYRER-MO", "platform.owner");

  await openNavPage(page, "AI settings");
  await expect(page.getByRole("heading", { name: "AI settings" })).toBeVisible();
  await expect(page.getByLabel("AI model name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save model" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify service account" })).toBeVisible();

  await openNavPage(page, "Settings");
  await expect(page.getByRole("heading", { name: "AI settings" })).toBeVisible();
});
