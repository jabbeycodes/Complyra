import { test, expect, type Page } from "./fixtures";

// Founder directive (2026-10-27): the "House coverage" board does not belong
// on a house manager's Overview. A house manager runs one home — their
// Overview opens already focused on that home, with no coverage board, and
// the coverage summary (incl. the monthly site review status) lives inside
// the home's own page. Agency-wide roles keep the board exactly as before.
//
// PR #139 review fix: hiding the board from the HM Overview must not strand
// the capability — the same SiteCoverageBoard is mounted inside the home's
// own page (SiteDetailPage Overview tab, behind the board's own permission
// gate), so a house manager runs weekly coverage from the home itself.

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

test("house manager runs weekly coverage from inside their home's page", async ({
  page,
}) => {
  await signIn(page, "james.wilson");

  // The Overview stays board-free (the fix must not resurrect it there).
  await expect(coverageBoard(page)).toHaveCount(0);

  // Into the home itself.
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Sites & programs", exact: true })
    .click();
  await page.locator(".location-card", { hasText: "Willow" }).first().click();
  await expect(page.locator(".site-hero")).toBeVisible();

  // The full board lives here now: week grid, fill/copy actions, and the
  // regular house hours editor — behind the same permission gate as before.
  const board = coverageBoard(page);
  await expect(board).toHaveCount(1);
  await expect(
    board.getByRole("heading", { name: "Willow House coverage", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    board.getByRole("button", { name: "Fill open hours" }),
  ).toBeVisible();
  await expect(
    board.getByRole("heading", { name: "Regular house hours" }),
  ).toBeVisible();

  // An authorized coverage action from this page: post an open shift for a
  // PRN and see it land on the board. Done on next week's first day — the
  // demo clock pins "today" to the seed day, and a temporary shift must
  // start in the future, so this week's remaining slots can already be past.
  const range = board.locator(".coverage-toolbar span");
  const rangeBefore = await range.textContent();
  await board.getByRole("button", { name: "Next week" }).click();
  await expect(range).not.toHaveText(rangeBefore ?? "");
  const firstDay = board.locator(".coverage-day").first();
  await firstDay.getByRole("button", { name: "Add someone" }).click();
  await board.getByLabel("Who is working").selectOption("__open__");
  await board.getByRole("button", { name: "Save coverage" }).click();
  await expect(
    board.getByText("Posted. A PRN takes it from Open Shifts"),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    firstDay.getByText("Open for a PRN", { exact: true }),
  ).toBeVisible();
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
