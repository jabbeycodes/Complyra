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

// D-09: a search/filter that matches nobody must show the shared empty
// state instead of a blank grid (Individuals) or an empty table (Documents).
test("Individuals shows an empty state when the search matches nobody", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.locator(".person-card").first()).toBeVisible();

  await page.getByLabel("Search individuals").fill("zz-no-such-person-zz");
  await expect(
    page.getByRole("heading", { name: "No individuals match your search" }),
  ).toBeVisible();
  await expect(page.locator(".person-card")).toHaveCount(0);

  // The clear-filters action restores the full list.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".person-card").first()).toBeVisible();
});

test("Documents shows an empty state when the search matches no plans", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.getByLabel("Search documents").fill("zz-no-such-document-zz");
  await expect(
    page.getByRole("heading", { name: "No documents match your search" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);

  // The clear-filters action restores the full table.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});
