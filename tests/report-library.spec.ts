import { test, expect, type Page } from "./fixtures";

async function signIn(page: Page, username = "sarah.mitchell") {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Report Library" })).toBeVisible();
}

function card(page: Page, title: string) {
  return page.locator(".report-card", {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

test("report library lists the catalog grouped by module and runs a report", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Report Library" }).click();
  await expect(page.getByRole("heading", { name: "Report Library" })).toBeVisible();

  // Catalog groups and representative entries across the modules.
  await expect(page.getByRole("heading", { name: "Agency & compliance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home checks & safety" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual records" })).toBeVisible();
  await expect(card(page, "Compliance report")).toBeVisible();
  await expect(card(page, "Monthly mileage sheet")).toBeVisible();
  await expect(card(page, "QA audit report")).toBeVisible();
  await expect(card(page, "Staff training checklist")).toBeVisible();

  // Running the compliance report produces a real PDF download.
  const downloadPromise = page.waitForEvent("download");
  await card(page, "Compliance report")
    .getByRole("button", { name: "Download PDF" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/compliance.*\.pdf$/i);
});

test("a home's Overview links into the library scoped to that home", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page
    .locator(".location-card")
    .filter({ hasText: "Cedar House" })
    .getByRole("button", { name: /Open site/ })
    .click();
  await expect(page.getByRole("heading", { name: "Cedar House" })).toBeVisible();
  await page.getByRole("button", { name: "Open reports for this home" }).click();
  await expect(page.getByRole("heading", { name: "Report Library" })).toBeVisible();
  const drillCard = card(page, "Drill schedule");
  await expect(drillCard).toBeVisible();
  await expect(drillCard.getByLabel("Home")).toHaveValue(/.+/);
  const selected = await drillCard
    .getByLabel("Home")
    .locator("option:checked")
    .textContent();
  expect(selected).toContain("Cedar House");
});

test("report library search narrows the catalog", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Report Library" }).click();
  await page.getByLabel("Search reports").fill("mileage");
  await expect(card(page, "Monthly mileage sheet")).toBeVisible();
  await expect(card(page, "Yearly mileage summary")).toBeVisible();
  await expect(card(page, "Compliance report")).toHaveCount(0);
});
