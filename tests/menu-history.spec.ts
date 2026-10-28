import { test, expect, type Page } from "./fixtures";

// Menu record history: a correction keeps its earlier version on the chart
// (History expansion on the entry), a voided entry stays listed for the
// week with its reason and voider, and none of it is reachable from
// another home. (Clock is pinned to Saturday 2026-09-12 by the fixture.)

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Your profile" }).click();
  await page
    .getByRole("dialog", { name: "Your profile" })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page.getByLabel("Provider code")).toBeVisible();
}

async function openChart(page: Page, name: string) {
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(
    chart.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  return chart;
}

async function recordFood(
  page: Page,
  menu: ReturnType<Page["locator"]>,
  food: string,
  amount: string,
) {
  await menu.getByRole("button", { name: "Record food" }).click();
  await menu.getByLabel("Food eaten").fill(food);
  await menu.getByLabel("Amount eaten").selectOption(amount);
  await menu.getByRole("button", { name: "Save entry" }).click();
  await expect(menu).toContainText(food);
}

test("a correction's earlier version and a voided entry stay readable on the chart", async ({
  page,
}) => {
  await signIn(page, "alex.morgan", "Evergreen!demo1");
  const chart = await openChart(page, "Ellis Hart");
  const menu = chart.locator(".menu-card");
  await menu.scrollIntoViewIfNeeded();
  await expect(menu.getByRole("heading", { name: "Menu" })).toBeVisible();

  // Record, then correct the entry: the original must survive as history.
  await recordFood(page, menu, "Oatmeal with berries", "most");
  const entry = menu.locator(".menu-entry", { hasText: "Oatmeal with berries" });
  await entry.getByRole("button", { name: "Edit" }).click();
  await menu.getByLabel("Food eaten").fill("Oatmeal with berries and honey");
  await menu.getByLabel("Amount eaten").selectOption("all");
  await menu.getByRole("button", { name: "Save correction" }).click();
  await expect(menu).toContainText("Oatmeal with berries and honey");

  await menu.getByRole("button", { name: /History \(1\)/ }).click();
  await expect(menu).toContainText("Earlier version: Oatmeal with berries (Most)");
  await expect(menu).toContainText("Replaced by Alex Morgan");

  // Record and void a snack: it leaves the grid but stays on the record.
  await recordFood(page, menu, "Yogurt cup", "all");
  const snack = menu.locator(".menu-entry", { hasText: "Yogurt cup" });
  await snack.getByRole("button", { name: "Void" }).click();
  await menu.getByLabel("Reason for voiding").fill("Recorded against the wrong day");
  await menu.getByRole("button", { name: "Void entry" }).click();
  await expect(
    menu.locator(".menu-entry", { hasText: "Yogurt cup" }),
  ).toHaveCount(0);

  await menu.getByRole("button", { name: /Voided this week \(1\)/ }).click();
  await expect(menu).toContainText("Yogurt cup");
  await expect(menu).toContainText(
    "Voided by Alex Morgan: Recorded against the wrong day",
  );
});

test("a DSP at another home cannot reach the chart, its history, or its voids", async ({
  page,
}) => {
  // The administrator builds menu history on Harper Soto (Willow House).
  await signIn(page, "sarah.mitchell", "Evergreen!demo1");
  const chart = await openChart(page, "Harper Soto");
  const menu = chart.locator(".menu-card");
  await menu.scrollIntoViewIfNeeded();
  await recordFood(page, menu, "Grilled salmon", "all");
  const entry = menu.locator(".menu-entry", { hasText: "Grilled salmon" });
  await entry.getByRole("button", { name: "Edit" }).click();
  await menu.getByLabel("Food eaten").fill("Grilled salmon with lemon");
  await menu.getByRole("button", { name: "Save correction" }).click();
  await expect(menu.getByRole("button", { name: /History \(1\)/ })).toBeVisible();
  await recordFood(page, menu, "Tomato soup", "some");
  const soup = menu.locator(".menu-entry", { hasText: "Tomato soup" });
  await soup.getByRole("button", { name: "Void" }).click();
  await menu.getByLabel("Reason for voiding").fill("Wrong Individual");
  await menu.getByRole("button", { name: "Void entry" }).click();
  await expect(
    menu.getByRole("button", { name: /Voided this week \(1\)/ }),
  ).toBeVisible();
  await signOut(page);

  // Alex Morgan supports Cedar House: Harper's chart is not in their list,
  // so neither the entries, nor the history, nor the voids can be reached.
  await signIn(page, "alex.morgan", "Evergreen!demo1");
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Harper Soto/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Ellis Hart/ }).first(),
  ).toBeVisible();
});
