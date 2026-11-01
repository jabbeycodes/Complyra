import { test, expect, type Page } from "./fixtures";

// Wave 7G — create-flow completion (simulation batches 2 + 3).
//
// Batch 2: after adding a staff member the Staff list did not show them
// until a full reload. Batch 3: after adding an Individual the record was
// not reachable in its list and the page misbehaved until reload. In both
// cases the create + workspace refresh had actually succeeded — the app's
// global site filter, set to a just-created house by the add-site
// completion, silently scoped the Staff list and the Individuals grid to
// that (empty) house. These specs run the exact setup sequence the
// simulation ran (create houses first, then people) and pin the
// completion guarantee: after a successful create, the record is visible
// in its list without a reload, and no dialog/backdrop residue remains.

async function signIn(page: Page, username = "sarah.mitchell") {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the workspace shell itself, not just the topbar: on a cold
  // dev server the banner can render while the nav is still loading.
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function addSite(page: Page, name: string, address: string) {
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "Add a site" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a program site" });
  await dialog.getByLabel("Site name").fill(name);
  await dialog.getByLabel("Address").fill(address);
  await dialog.getByRole("button", { name: "Create site" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

async function addPersonByHand(
  page: Page,
  name: string,
  siteName: string,
) {
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: "Add an individual" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an individual" });
  await dialog.getByRole("tab", { name: /Add by hand/ }).click();
  await dialog.getByLabel("Legal name").fill(name);
  await dialog.getByLabel("Date of birth").fill("1990-05-05");
  await dialog.getByLabel("Program site").selectOption({ label: siteName });
  await dialog.getByRole("button", { name: "Add Individual", exact: true }).click();
  // The chart's <h1> is the person's name (a consents subheading repeats
  // it, so target the h1 itself).
  await expect(page.locator("h1").filter({ hasText: name })).toBeVisible();
}

test("batch 2: staff list shows a member created right after adding a site, no reload", async ({
  page,
}) => {
  await signIn(page);
  await addSite(page, "Completion House", "1 Completion Way");

  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a member" });
  await dialog.getByLabel("Full name").fill("Completion Staffer");
  await dialog.getByLabel("Temporary password").fill("Completion!123");
  await dialog.getByRole("button", { name: "Create member account" }).click();
  await expect(page.locator(".invite-success")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // No reload: the new (agency-wide) member is in the Staff list even
  // though adding the site had scoped the app to that empty house.
  await expect(
    page.getByRole("cell", { name: "Completion Staffer" }),
  ).toBeVisible();
  await expect(page.getByText("12 team members")).toBeVisible();
});

test("batch 3: person added at a different house than the active filter is in the grid, page fully clickable, no dialog residue", async ({
  page,
}) => {
  await signIn(page);
  await addSite(page, "Alpha Completion House", "2 Alpha Way");
  // Creating the second house leaves the global filter on it.
  await addSite(page, "Beta Completion House", "3 Beta Way");

  await addPersonByHand(page, "Cross House Person", "Alpha Completion House");

  // The create dialog is fully torn down — nothing in the top layer.
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to individuals" }).click();
  // The grid is filtered to Beta by the add-site completion; the person
  // lives at Alpha, and must still be listed without a reload.
  await expect(
    page.getByRole("heading", { name: "Cross House Person", exact: true }),
  ).toBeVisible();

  // No invisible overlay intercepts clicks: hit-test the Add button, then
  // really open and dismiss the dialog again.
  const hit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Add an individual"),
    );
    if (!btn) return "missing";
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === btn || (el ? btn.contains(el) : false) ? "clean" : `blocked:${el?.tagName}.${el?.className}`;
  });
  expect(hit).toBe("clean");
  await page.getByRole("button", { name: "Add an individual" }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Add an individual" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("sibling flow: a requirement draft created for another house shows in the Review queue", async ({
  page,
}) => {
  await signIn(page);
  await addSite(page, "Draft Alpha House", "4 Draft Way");
  await addSite(page, "Draft Beta House", "5 Draft Way");
  await addPersonByHand(page, "Draft Target Person", "Draft Alpha House");
  await page.getByRole("button", { name: "Back to individuals" }).click();

  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page.getByRole("button", { name: "Add requirement" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create a requirement draft",
  });
  // The form opens scoped to the filtered house (Beta); file the draft
  // against the person at Alpha instead.
  await dialog.getByLabel("Program site").selectOption({
    label: "Draft Alpha House",
  });
  await dialog.getByLabel("Individual").selectOption({
    label: "Draft Target Person",
  });
  await dialog.getByLabel("Requirement").fill("Cross house draft check");
  await dialog
    .getByLabel("Source document & version")
    .fill("Draft Target Person · PCSP 2026 · v1");
  await dialog.getByRole("button", { name: "Save draft for review" }).click();

  // Saving lands on the Review queue; the draft must be listed there even
  // though the app filter was on the other house.
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(page.getByText("Cross house draft check")).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});
