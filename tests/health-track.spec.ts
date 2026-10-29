import { test, expect, type Page } from "./fixtures";

/**
 * Dedicated coverage for the Individual chart's health trackers section
 * ("Trackers and logs"): it must stay distinct from the Health
 * card's own heading and 2-tab list at desktop and mobile widths.
 */

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

async function openEllisChart(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(
    chart.getByRole("heading", { name: "Trackers and logs" }),
  ).toBeVisible();
  return chart;
}

test("health trackers section is distinct from the Health card and its tabs switch the tracker panel", async ({
  page,
}) => {
  await signIn(page);
  const chart = await openEllisChart(page);

  // The Health card keeps its own heading and 2-tab list.
  await expect(chart.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
  await expect(
    chart.getByRole("tablist", { name: "Health sections" }).getByRole("tab"),
  ).toHaveCount(2);

  // The tracker section has its own heading and 4-tab list.
  const trackerTabs = chart.getByRole("tablist", { name: "Health trackers" });
  const tabs = trackerTabs.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(0)).toHaveText("Immunizations");
  await expect(tabs.nth(1)).toHaveText("Lab results");
  await expect(tabs.nth(2)).toHaveText("Infection tracking");
  await expect(tabs.nth(3)).toHaveText("Sleep");

  // Switching tabs swaps the panel's record form to that tracker.
  const panel = chart.getByRole("tabpanel");
  await tabs.nth(3).click();
  await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByLabel("Hours slept")).toBeVisible();
  await expect(panel.getByLabel("Night of")).toBeVisible();

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByLabel("Vaccine")).toBeVisible();
  await expect(panel.getByLabel("Date given")).toBeVisible();
});

test("health trackers section renders at a mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const chart = await openEllisChart(page);

  const trackerTabs = chart.getByRole("tablist", { name: "Health trackers" });
  await expect(trackerTabs.getByRole("tab")).toHaveCount(4);
  await trackerTabs.getByRole("tab", { name: "Lab results" }).click();
  const panel = chart.getByRole("tabpanel");
  await expect(panel.getByLabel("Test")).toBeVisible();
  await expect(
    panel.getByLabel("Flag this result abnormal (alerts the home's managers)"),
  ).toBeVisible();
});
