import { test, expect, type Page } from "./fixtures";

async function signIn(
  page: Page,
  username = "sarah.mitchell",
  password = "Evergreen!demo1",
  agencyCode = "EVERGREEN-MO",
) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill(agencyCode);
  await page.getByLabel("Username").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function dismissTour(page: Page) {
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

async function signedIn(page: Page, username?: string) {
  await signIn(page, username);
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await dismissTour(page);
}

async function openNav(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
}

async function openNewDelegationForm(page: Page) {
  await openNav(page);
  await page.locator(".sidebar").getByRole("button", { name: "Delegations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await page.getByRole("button", { name: "RN delegation forms" }).click();
  await page.getByRole("button", { name: "New delegation" }).click();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeVisible();
}

function individualOptions(page: Page) {
  return page.getByLabel("Individual").locator("option");
}

test("admin new-delegation dropdown is site-scoped across two homes", async ({
  page,
}) => {
  await signedIn(page);
  await openNewDelegationForm(page);
  const site = page.getByLabel("Program site");
  await expect(site).toHaveValue("");
  await expect(page.getByLabel("Individual")).toBeDisabled();

  await site.selectOption({ label: "Cedar House" });
  const mapleLabels = await individualOptions(page).allTextContents();
  expect(mapleLabels.join(" ")).toContain("Ellis Hart");
  expect(mapleLabels.join(" ")).toContain("Morgan Pruitt");
  expect(mapleLabels.join(" ")).not.toContain("Harper Soto");
  expect(mapleLabels.join(" ")).not.toContain("Reese Lang");

  await site.selectOption({ label: "Willow House" });
  const oakwoodLabels = await individualOptions(page).allTextContents();
  expect(oakwoodLabels.join(" ")).toContain("Harper Soto");
  expect(oakwoodLabels.join(" ")).toContain("Reese Lang");
  expect(oakwoodLabels.join(" ")).not.toContain("Ellis Hart");
  expect(oakwoodLabels.join(" ")).not.toContain("Morgan Pruitt");
});

test("Willow HM does not see Cedar people in a new-delegation dropdown", async ({
  page,
}) => {
  await signedIn(page, "james.wilson");
  await openNav(page);
  await page.locator(".sidebar").getByRole("button", { name: "Delegations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await page.getByRole("button", { name: "RN delegation forms" }).click();
  const create = page.getByRole("button", { name: "New delegation" });
  if ((await create.count()) === 0) {
    await expect(create).toHaveCount(0);
    return;
  }
  await create.click();
  await expect(page.getByLabel("Program site")).toHaveValue(/./);
  await expect(page.getByLabel("Program site")).toBeDisabled();
  const labels = await individualOptions(page).allTextContents();
  expect(labels.join(" ")).not.toContain("Ellis Hart");
  expect(labels.join(" ")).not.toContain("Morgan Pruitt");
});

test("demo nurse cameron.price signs in and only sees Cedar people", async ({
  page,
}) => {
  await signedIn(page, "cameron.price");
  await openNewDelegationForm(page);
  await expect(page.getByLabel("Program site")).toBeDisabled();
  const siteLabel = await page.getByLabel("Program site").locator("option:checked").innerText();
  expect(siteLabel).toContain("Cedar House");
  const labels = await individualOptions(page).allTextContents();
  expect(labels.join(" ")).toContain("Ellis Hart");
  expect(labels.join(" ")).not.toContain("Harper Soto");
  expect(labels.join(" ")).not.toContain("Reese Lang");
});

test("admin staff list includes demo nurse cameron.price", async ({ page }) => {
  await signedIn(page);
  await openNav(page);
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByLabel("Search staff").fill("cameron");
  await expect(page.getByText("Cameron Price")).toBeVisible();
  await expect(page.getByText("cameron.price")).toBeVisible();
});

test("a person added on a new site keeps that site on a requirement", async ({
  page,
}) => {
  await signedIn(page);
  await openNav(page);
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "Add a site" }).click();
  const siteDialog = page.getByRole("dialog", { name: "Add a program site" });
  await siteDialog.getByLabel("Site name").fill("QA Audit House");
  await siteDialog.getByLabel("Address").fill("9 Audit Way");
  await siteDialog.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByRole("heading", { name: "QA Audit House", exact: true })).toBeVisible();

  await openNav(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: "Add an individual" }).first().click();
  const personDialog = page.getByRole("dialog", { name: "Add an individual" });
  await personDialog.getByRole("tab", { name: /Add by hand/ }).click();
  await expect(personDialog.getByLabel("Program site")).toHaveValue(/./);
  const selectedSite = await personDialog
    .getByLabel("Program site")
    .locator("option:checked")
    .innerText();
  expect(selectedSite).toContain("QA Audit House");
  expect(selectedSite).not.toContain("Cedar House");
  await personDialog.getByLabel("Legal name").fill("Nia Brooks");
  await personDialog.getByLabel("Date of birth").fill("1990-01-15");
  await personDialog.getByRole("button", { name: "Add Individual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nia Brooks" })).toBeVisible();
  await expect(page.locator(".individual-chart")).toContainText("QA Audit House");

  await openNav(page);
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  const reqDialog = page.getByRole("dialog", { name: "Create a requirement draft" });
  await reqDialog.getByLabel("Program site").selectOption({ label: "QA Audit House" });
  await reqDialog.getByLabel("Individual").selectOption({ label: "Nia Brooks" });
  await reqDialog.getByPlaceholder("e.g. Acknowledge the updated supervision plan").fill(
    "QA acknowledgment",
  );
  await reqDialog.getByPlaceholder("e.g. Ellis Hart · PCSP 2026 · v2").fill(
    "Nia Brooks · PCSP 2026 · v1",
  );
  await reqDialog.getByRole("button", { name: "Save draft for review" }).click();
  await expect(page.getByText("QA acknowledgment")).toBeVisible();
  const row = page.locator("tr").filter({ hasText: "QA acknowledgment" }).first();
  await expect(row).toContainText("QA Audit House");
  await expect(row).not.toContainText("Cedar House");
});

test("inviting qa.dpm then signing in is recognized", async ({ page }) => {
  await signedIn(page);
  await openNav(page);
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a member" });
  await dialog.getByLabel("Full name").fill("QA Degreed Manager");
  await dialog.getByLabel("Username").fill("qa.dpm");
  await dialog.getByLabel("Temporary password").fill("TempPass!1");
  await dialog.getByLabel("Role").selectOption("degreed_professional_manager");
  await dialog.getByRole("button", { name: "Create member account" }).click();
  await expect(dialog).toContainText("qa.dpm");
  await expect(dialog).toContainText("EVERGREEN-MO");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("qa.dpm");
  await page.locator('input[autocomplete="current-password"]').fill("TempPass!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your own password" }),
  ).toBeVisible();
  await page.getByLabel("Temporary password").fill("TempPass!1");
  await page.getByRole("textbox", { name: "New password", exact: true }).fill("QaDpm!own2");
  await page.getByRole("textbox", { name: "Confirm new password" }).fill("QaDpm!own2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 15_000 });
  await dismissTour(page);
  await expect(page.getByText("Loading workspace…")).toHaveCount(0);
});
