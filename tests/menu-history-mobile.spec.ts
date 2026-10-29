import { test, expect, type Page } from "./fixtures";

// TEMP (fix-141 verification): the History expansion and the Voided list
// must fit a 390px phone chart with no horizontal overflow.

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

test("history + voided surface fits 390px with no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "alex.morgan", "Evergreen!demo1");
  // Phone width: the chart is reached through the navigation drawer.
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Individuals", exact: true })
    .click();
  await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
  const chart = page.locator(".individual-chart");
  const menu = chart.locator(".menu-card");
  await menu.scrollIntoViewIfNeeded();

  await menu.getByRole("button", { name: "Record food" }).click();
  await menu.getByLabel("Food eaten").fill("Oatmeal with berries");
  await menu.getByLabel("Amount eaten").selectOption("most");
  await menu.getByRole("button", { name: "Save entry" }).click();
  await expect(menu).toContainText("Oatmeal with berries");

  const entry = menu.locator(".menu-entry", { hasText: "Oatmeal with berries" });
  await entry.getByRole("button", { name: "Edit" }).click();
  await menu.getByLabel("Food eaten").fill("Oatmeal with berries and honey");
  await menu.getByRole("button", { name: "Save correction" }).click();
  await menu.getByRole("button", { name: /History \(1\)/ }).click();
  await expect(menu).toContainText("Earlier version: Oatmeal with berries (Most)");

  await menu.getByRole("button", { name: "Record food" }).click();
  await menu.getByLabel("Food eaten").fill("Yogurt cup");
  await menu.getByLabel("Amount eaten").selectOption("all");
  await menu.getByRole("button", { name: "Save entry" }).click();
  const snack = menu.locator(".menu-entry", { hasText: "Yogurt cup" });
  await snack.getByRole("button", { name: "Void" }).click();
  await menu.getByLabel("Reason for voiding").fill("Recorded against the wrong day");
  await menu.getByRole("button", { name: "Void entry" }).click();
  await menu.getByRole("button", { name: /Voided this week \(1\)/ }).click();
  await expect(menu).toContainText("Voided by Alex Morgan: Recorded against the wrong day");

  const overflow = await page.evaluate(() => {
    const el = document.querySelector(".menu-card") as HTMLElement;
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      cardScroll: el.scrollWidth,
      cardClient: el.clientWidth,
    };
  });
  expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient);
  expect(overflow.cardScroll).toBeLessThanOrEqual(overflow.cardClient + 1);
});
