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

test("chart Health shows appointments, allergies, and a consultation packet", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Jodie Williams/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(chart.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(chart.getByRole("button", { name: "New appointment" })).toBeVisible();
  await expect(chart.getByRole("button", { name: "Edit allergies" })).toBeVisible();
  await expect(chart).toContainText("Dr. Priya Shah");
  await expect(chart).toContainText("Tree nuts");
  await expect(chart).toContainText("Logged by Cameron Price");
  await expect(chart.getByRole("heading", { name: "Shift notes" })).toHaveCount(0);
  await expect(chart.getByRole("heading", { name: "Vitals" })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "Log BM" })).toHaveCount(0);
  await page.screenshot({ path: shot("health_appointments.png"), fullPage: true });
  const download = page.waitForEvent("download");
  await chart.getByRole("button", { name: "Generate consultation packet" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /complyrer-consultation-jodie-williams-2026-09-22/,
  );
});

test("DSP can view Health and generate a packet but cannot create appointments", async ({
  page,
}) => {
  await signIn(page, "alex.morgan");
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Jodie Williams/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(chart.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(chart.getByRole("button", { name: "New appointment" })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "Edit allergies" })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "Generate consultation packet" })).toBeVisible();
  await expect(chart).toContainText("Tree nuts");
});
