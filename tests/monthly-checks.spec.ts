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

test("monthly equipment, drills, and safety are due by the 7th and downloadable by month", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: /Your work/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Check adaptive equipment/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /emergency drills/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /home safety report/ }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("heading", { name: "Ellis Hart" }).click();
  await expect(page.getByRole("heading", { name: "Adaptive equipment log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wheelchair" })).toBeVisible();
  await page.getByLabel("Equipment log month").selectOption("2026-08");
  const equipmentDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download August/ }).click();
  expect((await equipmentDownload).suggestedFilename()).toMatch(
    /adaptive-equipment-ellis-hart-2026-08/,
  );

  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "This month’s checks" }).first().click();
  await expect(
    page.getByRole("heading", { name: /Monthly home checks/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fire drill" })).toBeVisible();
  await page.getByLabel("Home checks month").selectOption("2026-08");
  const drillDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download drills" }).click();
  expect((await drillDownload).suggestedFilename()).toMatch(
    /emergency-drills-cedar-house-2026-08/,
  );
  const safetyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download safety" }).click();
  expect((await safetyDownload).suggestedFilename()).toMatch(
    /home-safety-cedar-house-2026-08/,
  );
});

test("DPM can change monthly due days in settings", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Monthly check due dates"),
  ).toBeVisible();
  await page.getByLabel("Adaptive equipment due day").fill("15");
  await page.getByLabel("Emergency drills due day").fill("10");
  await page.getByLabel("Home safety report due day").fill("5");
  await page.getByRole("button", { name: "Save due dates" }).click();
  await expect(page.getByRole("status")).toContainText("Monthly due dates saved");
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("heading", { name: "Ellis Hart" }).click();
  await expect(page.getByText(/checked by the 15th of each month/)).toBeVisible();
});

test("people without equipment do not get an equipment log unless DPM adds one", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("heading", { name: "Reese Lang" }).click();
  await expect(page.getByRole("heading", { name: "Adaptive equipment log" })).toBeVisible();
  await expect(page.getByText("No adaptive equipment on this chart yet.")).toBeVisible();
  await page.getByLabel("Adaptive equipment name").fill("Walker");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByRole("heading", { name: "Walker" })).toBeVisible();
});
