import { test, expect, type Page } from "./fixtures";

// Founder directive (2026-10-27): the "House coverage" board does not belong
// on a house manager's Overview. A house manager runs one home — their
// Overview opens already focused on that home, with no coverage board, and
// the coverage summary (incl. the monthly site review status) lives inside
// the home's own page. Agency-wide roles keep the board exactly as before.

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
}

const coverageBoard = (page: Page) =>
  page.locator('section[aria-label="This week\'s coverage"]');

test("house manager Overview has no coverage board and is scoped to their home", async ({
  page,
}) => {
  await signIn(page, "james.wilson");

  // No coverage board anywhere on the page — no section, no heading.
  await expect(coverageBoard(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /coverage/i }),
  ).toHaveCount(0);

  // The site filter offers only their home — there is nothing to pick.
  const options = await page
    .getByLabel("Filter by site")
    .locator("option")
    .allTextContents();
  expect(options.map((o) => o.trim())).toEqual(["All sites", "Willow House"]);

  // Every number on the page is their home's: 11 active requirements for
  // Willow House, not the agency-wide 22.
  await expect(page.getByText("11 active requirements").first()).toBeVisible();
  await expect(page.getByText("22 active requirements")).toHaveCount(0);

  // The program-site card row is just their home.
  const grid = page.locator(".site-score-grid");
  await expect(grid).toContainText("Willow House");
  await expect(grid).not.toContainText("Cedar House");
  await expect(page.getByText("The home you are assigned to.")).toBeVisible();
});

test("administrator Overview keeps the coverage board and home picking still focuses it", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");

  // Unfocused: the board renders its "House coverage" chooser state.
  await expect(coverageBoard(page)).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "House coverage", exact: true }),
  ).toBeVisible();

  // Picking a home focuses the dashboard and the board follows the focus.
  await page.getByLabel("Filter by site").selectOption("Cedar House");
  await expect(
    page.getByRole("heading", { name: "Cedar House coverage", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator(".site-score-card.selected"),
  ).toContainText("Cedar House");
});

test("the home's own page carries the site review status from the Overview card", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Sites & programs", exact: true })
    .click();
  await page.locator(".location-card", { hasText: "Willow" }).first().click();
  await expect(page.locator(".site-hero")).toBeVisible();

  // Individuals count is in the hero, alongside the review status the
  // Overview card used to be the only place to summarize.
  const heroStats = page.locator(".site-hero-stat");
  await expect(
    heroStats.filter({ hasText: "Individuals" }),
  ).toContainText("2");
  await expect(
    heroStats.filter({ hasText: "Site review" }),
  ).toContainText("In place");
});
