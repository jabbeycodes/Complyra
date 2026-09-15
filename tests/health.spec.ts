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
  await expect(chart.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(chart.getByRole("tab", { name: "Appointments" })).toBeVisible();
  await expect(chart.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(chart.getByRole("button", { name: "Edit allergies" })).toBeVisible();
  await expect(chart).toContainText("Tree nuts");
  await expect(chart.getByRole("button", { name: "New appointment" })).toHaveCount(0);
  await page.screenshot({ path: shot("health_overview.png"), fullPage: true });
  await chart.getByRole("tab", { name: "Appointments" }).click();
  await expect(chart.getByRole("region", { name: "Appointment filters" })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "New appointment" })).toBeVisible();
  await expect(chart).toContainText("Dr. Priya Shah");
  await expect(chart.locator(".health-widget")).toContainText("Scheduled");
  await expect(chart.locator(".health-widget")).not.toContainText("Upcoming");
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
  await expect(chart.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(chart.getByRole("button", { name: "Edit allergies" })).toHaveCount(0);
  await expect(chart).toContainText("Tree nuts");
  await chart.getByRole("tab", { name: "Appointments" }).click();
  await expect(chart.getByRole("button", { name: "New appointment" })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "Generate consultation packet" })).toBeVisible();
  await expect(chart.getByRole("button", { name: "Upload consultation form" })).toBeVisible();
});

test("Appointments calendar lists caseload days and opens that day's visits", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page);
  await page.getByRole("button", { name: "Appointments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
  const filters = page.getByRole("region", { name: "Appointment filters" });
  await expect(filters).toBeVisible();
  await expect(filters.getByLabel("Filter by status")).toContainText("Scheduled");
  await expect(filters.getByLabel("Filter by status")).not.toContainText("Upcoming");
  await expect(filters.getByLabel("Filter by program")).toContainText("Residential services");
  await expect(filters.getByLabel("Filter by individual")).toBeVisible();
  await expect(filters.getByLabel("Filter by site")).toBeVisible();
  await expect(filters.getByLabel("From date")).toBeVisible();
  await expect(filters.getByLabel("To date")).toBeVisible();
  await expect(filters.getByLabel("Filter by staff")).toContainText("Cameron Price");
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await page.getByRole("gridcell", { name: /September 22, 2026/ }).click();
  await expect(page.getByRole("heading", { name: "September 22, 2026" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jodie Williams" })).toBeVisible();
  await expect(page.locator(".appointments-page")).toContainText("Dr. Priya Shah");
  await expect(page.locator(".appointments-page")).toContainText("Scheduled");
  await expect(page.getByRole("button", { name: "Generate consultation packet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New appointment" })).toHaveCount(0);

  const jodieOption = await filters
    .getByLabel("Filter by individual")
    .locator("option", { hasText: "Jodie Williams" })
    .getAttribute("value");
  const mapleOption = await filters
    .getByLabel("Filter by site")
    .locator("option", { hasText: "Maple House" })
    .getAttribute("value");
  await filters.getByLabel("Filter by status").selectOption("scheduled");
  await filters.getByLabel("Filter by program").selectOption("Residential services");
  await filters.getByLabel("Filter by individual").selectOption(jodieOption ?? "");
  await filters.getByLabel("Filter by site").selectOption(mapleOption ?? "");
  await expect(page.locator(".appointments-page")).toContainText("Dr. Priya Shah");
  await page.screenshot({ path: shot("appointments_calendar.png"), fullPage: true });
  await filters.getByLabel("Filter by status").selectOption("completed");
  await expect(page.locator(".appointments-page")).not.toContainText("Dr. Priya Shah");
});

test("uploading a consultation form completes the appointment", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Jodie Williams/ }).first().click();
  const chart = page.locator(".individual-chart");
  await chart.getByRole("tab", { name: "Appointments" }).click();
  await chart.getByRole("button", { name: "Upload consultation form" }).click();
  await chart.getByLabel("Consultation form").setInputFiles({
    name: "shah-visit.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await chart.getByPlaceholder("Optional notes from the visit").fill("Brought seizure log.");
  await chart.getByRole("button", { name: "Upload and complete" }).click();
  await expect(chart).toContainText("Completed by Sarah Mitchell");
  await expect(chart).toContainText("Brought seizure log.");
  await expect(chart.getByRole("button", { name: "Upload consultation form" })).toHaveCount(0);
});
