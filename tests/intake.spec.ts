import { test, expect, type Page } from "./fixtures";

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

test("admin Intake adds an Individual and opens the chart", async ({ page }, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page);
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "Add a site" }).click();
  const siteDialog = page.getByRole("dialog", { name: "Add a program site" });
  await siteDialog.getByLabel("Site name").fill("Poplar House");
  await siteDialog.getByLabel("Address").fill("12 Poplar Lane");
  await siteDialog.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByRole("heading", { name: "Poplar House", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Intake", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Intake" })).toBeVisible();
  await expect(
    page.getByText("Intake creates an Individual and places them on a program site."),
  ).toBeVisible();
  await page.screenshot({ path: shot("intake_page.png") });
  await page.getByRole("tab", { name: /Add by hand/ }).click();
  await page.getByLabel("Legal name").fill("Casey Nguyen");
  await page.getByLabel("Goes by").fill("Casey");
  await page.getByLabel("Date of birth").fill("1993-06-04");
  await page.getByLabel("Program site").selectOption({ label: "Poplar House" });
  await expect(page.getByLabel("Enrollment date (optional)")).toHaveValue(
    "2026-09-12",
  );
  await expect(page.getByText("0 of 2 Individuals")).toBeVisible();
  await page.getByRole("button", { name: "Add Individual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Casey Nguyen" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Individual added to Poplar House.");
  await expect(page.locator(".individual-chart")).toBeVisible();
});

test("Intake blocks a demo house that is already at 2 Individuals", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Intake", exact: true }).click();
  await page.getByRole("tab", { name: /Add by hand/ }).click();
  await page.getByLabel("Program site").selectOption({ label: "Cedar House" });
  await expect(page.getByText("2 of 2 Individuals")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Cedar House is at its 2-Individual limit" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Individual", exact: true })).toBeDisabled();
});

test("DSP does not see Intake", async ({ page }) => {
  await signIn(page, "alex.morgan");
  await expect(page.getByRole("button", { name: "Intake", exact: true })).toHaveCount(0);
});
