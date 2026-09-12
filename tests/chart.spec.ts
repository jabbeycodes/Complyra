import { test, expect, type Page } from "@playwright/test";

async function signIn(
  page: Page,
  username = "sarah.mitchell",
  password = "Evergreen!demo1",
) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
}

async function openJodie(page: Page) {
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Jodie Williams/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(chart.getByRole("heading", { name: "Jodie Williams", exact: true })).toBeVisible();
  return chart;
}

test("Jodie opens as a full chart with widgets, download, and med count", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page);
  const chart = await openJodie(page);
  await expect(chart.getByRole("heading", { name: "Care plan" })).toBeVisible();
  await expect(chart.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await expect(chart.getByRole("heading", { name: "Upcoming clinical renewals" })).toBeVisible();
  await expect(chart.getByRole("heading", { name: "Medication board" })).toBeVisible();
  await expect(chart.getByRole("heading", { name: "Assigned staff" })).toBeVisible();
  await expect(chart).toContainText("Alex Morgan");
  await expect(chart).toContainText("days left");
  await page.screenshot({ path: shot("individual_chart.png"), fullPage: true });

  const download = page.waitForEvent("download");
  await chart
    .locator(".chart-widget")
    .filter({ hasText: "Care plan" })
    .getByRole("button", { name: "Download" })
    .click();
  expect((await download).suggestedFilename()).toMatch(/complyrer-care-plan-jodie-williams/);

  const keppra = chart.locator(".med-card").filter({ hasText: "Levetiracetam" });
  await keppra.getByLabel("Pills remaining").fill("40");
  await keppra.getByLabel("Pills per day").fill("2");
  await keppra.getByRole("button", { name: "Record delivery count" }).click();
  await expect(keppra).toContainText("40 pills left");

  const trainingDownload = page.waitForEvent("download");
  await chart
    .locator(".obligation-card")
    .filter({ hasText: "Alex Morgan" })
    .getByRole("button", { name: "Download" })
    .click();
  expect((await trainingDownload).suggestedFilename()).toMatch(
    /complyrer-training-alex-morgan-jodie-williams/,
  );
});

test("DSP sees meds and their training row, not annuals", async ({ page }) => {
  await signIn(page, "alex.morgan");
  const chart = await openJodie(page);
  await expect(chart.getByRole("heading", { name: "Medication board" })).toBeVisible();
  await expect(chart.getByRole("heading", { name: "Upcoming clinical renewals" })).toHaveCount(0);
  await expect(chart.getByRole("heading", { name: "Delegations" })).toHaveCount(0);
  await expect(chart).toContainText("Alex Morgan");
  await expect(chart.getByRole("button", { name: "Sign as staff" })).toBeVisible();
});
