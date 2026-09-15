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

test("admin adds a site, then a person by hand and from a PCSP", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page);
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "Add a site" }).click();
  const siteDialog = page.getByRole("dialog", { name: "Add a program site" });
  await page.screenshot({ path: shot("add_site_form.png") });
  await siteDialog.getByLabel("Site name").fill("Poplar House");
  await siteDialog.getByLabel("Address").fill("12 Poplar Lane");
  await siteDialog.getByRole("button", { name: "Create site" }).click();
  await expect(page.getByRole("heading", { name: "Poplar House", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: "Add an individual" }).first().click();
  const personDialog = page.getByRole("dialog", { name: "Add an individual" });
  await page.screenshot({ path: shot("add_person_paths.png") });
  await personDialog.getByRole("tab", { name: /Add by hand/ }).click();
  await personDialog.getByLabel("Legal name").fill("Nora Fields");
  await personDialog.getByLabel("Goes by").fill("Nora");
  await personDialog.getByLabel("Date of birth").fill("1991-04-12");
  await personDialog.getByLabel("Program site").selectOption({ label: "Poplar House" });
  await personDialog.getByRole("button", { name: "Add Individual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nora Fields" })).toBeVisible();
  await expect(page.locator(".individual-chart")).toContainText("Nora");

  await page.getByRole("button", { name: "Back to individuals" }).click();
  await page.getByRole("button", { name: "Add an individual" }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Add an individual" });
  await uploadDialog.getByRole("tab", { name: /Upload a PCSP/ }).click();
  await uploadDialog.getByLabel("Legal name").fill("Eli Navarro");
  await uploadDialog.getByLabel("Date of birth").fill("1988-11-02");
  await uploadDialog.getByLabel("Program site").selectOption({ label: "Poplar House" });
  await uploadDialog.getByLabel("Choose PCSP PDF").setInputFiles({
    name: "eli-pcsp.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fictional-data-for-test"),
  });
  await uploadDialog
    .getByRole("button", { name: "Add Individual and send plan for review" })
    .click();
  await expect(page.getByRole("status")).toContainText("Review queue");
});

test("DSP does not see add-site, add-person, or Intake", async ({ page }) => {
  await signIn(page, "alex.morgan");
  await expect(page.getByRole("button", { name: "Intake", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add an individual" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add a site" })).toHaveCount(0);
});
