import { test, expect, type Page } from "@playwright/test";
import { evergreenDemoLogoBytes } from "../src/data/branding";

async function signIn(page: Page, username = "sarah.mitchell") {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
}

test("agency logo shows in the sidebar and can be replaced in settings", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator(".agency-mark img")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Agency logo")).toBeVisible();
  await expect(page.getByRole("img", { name: "Evergreen Care logo" })).toBeVisible();
  await page.getByLabel("Upload agency logo").setInputFiles({
    name: "custom-logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(evergreenDemoLogoBytes()),
  });
  await expect(page.getByRole("status")).toContainText("Agency logo saved");
  await expect(page.locator(".agency-mark img")).toBeVisible();
});

test("DSP sees the logo but cannot change it", async ({ page }) => {
  await signIn(page, "alex.morgan");
  await expect(page.locator(".agency-mark img")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Agency logo")).toBeVisible();
  await expect(page.getByLabel("Upload agency logo")).toHaveCount(0);
});
