import { test, expect, type Page } from "./fixtures";

// #75 + #76: the site Overview due-items list must show both typed row types
// with the craft copy, and the Individual chart must carry the HM alone-time
// editor and the scheduled-med MAR check-off. The demo seed is deterministic
// under the fixture's fixed clock (2026-09-12).

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

test("Overview due items show missing Shift notes + unmarked meds with craft copy", async ({
  page,
}) => {
  await signIn(page);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Sites & programs", exact: true })
    .click();
  await page.locator(".location-card", { hasText: "Cedar" }).first().click();
  await expect(page.locator(".site-hero")).toBeVisible();
  await page
    .locator(".muted")
    .filter({ hasText: "Loading" })
    .waitFor({ state: "hidden", timeout: 8_000 })
    .catch(() => undefined);

  const panel = page.locator(".site-detail-panel");
  await expect(page.getByRole("heading", { name: "Due items", exact: true })).toBeVisible();
  // #75 — missing Shift note row.
  await expect(panel).toContainText("Missing Shift note");
  await expect(panel).toContainText("Morgan · Day · 6:00 a.m.–2:00 p.m.");
  await expect(panel).toContainText("Needed from Alex Morgan");
  await expect(panel).toContainText("Based on assigned house staff.");
  // #76 — unmarked medication row.
  await expect(panel).toContainText("Unmarked medication");
  await expect(panel).toContainText("Window ended 9:00 a.m. · still not marked");
  // Hero "Due items" count mirrors the list length (2 rows).
  await expect(
    page.locator(".site-hero-stat").filter({ hasText: "Due items" }),
  ).toContainText("2");
  await page.screenshot({ path: shotPath("cedar-overview-due-items.png") });
});

test("Individual chart carries the alone-time editor and MAR check-off", async ({
  page,
}) => {
  await signIn(page);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Sites & programs", exact: true })
    .click();
  await page.locator(".location-card", { hasText: "Cedar" }).first().click();
  await expect(page.locator(".site-hero")).toBeVisible();
  await page.getByLabel("Individuals in this house").getByText("Ellis").click();
  await expect(page.getByRole("heading", { name: "Ellis Hart" }).first()).toBeVisible();

  // #75 — HM alone-time editor with the seeded recurring window.
  await expect(page.locator(".alone-time-card")).toContainText("Alone time");
  await expect(page.locator(".alone-time-card")).toContainText(
    "6:00 a.m.–2:00 p.m.",
    { timeout: 8_000 },
  );
  await page.locator(".alone-time-card").screenshot({
    path: shotPath("ellis-chart-alone-time.png"),
  });

  // #76 — MAR check-off with the four clearing statuses; PRN excluded.
  const mar = page.locator(".mar-card");
  await expect(mar).toContainText("Medication administration");
  await expect(mar).toContainText("Levetiracetam", { timeout: 8_000 });
  await expect(mar.getByRole("button", { name: "Given" }).first()).toBeVisible();
  await expect(mar.getByRole("button", { name: "On hold" }).first()).toBeVisible();
  await expect(mar).not.toContainText("Lorazepam"); // PRN never appears
  await mar.screenshot({ path: shotPath("ellis-chart-mar.png") });
});
