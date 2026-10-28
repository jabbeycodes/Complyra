import { test, expect, type Page } from "./fixtures";

// Med count under Medications: every medication row in the mobile MAR
// carries its own supply countdown (no separate Med Count tile). A
// manager's refill tap records a count that becomes the countdown's
// baseline; from then on, doses recorded Given burn it down pill by
// pill. Clock starts pinned to 08:30 Central on the seed's service day.
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(180_000);

const SHOT_DIR = "mobile-screenshots";
const shot = (name: string) => `${SHOT_DIR}/${name}`;

async function signIn(page: Page, username: string) {
  await page.clock.setFixedTime(new Date("2026-09-12T13:30:00.000Z"));
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function toShellHome(page: Page, homeName: string) {
  const picker = page.getByText("Select your home");
  try {
    await picker.waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: new RegExp(homeName) }).click();
  } catch {
    // Single-home user — already in the shell.
  }
  await expect(
    page.getByRole("heading", { name: `Today at ${homeName}` }),
  ).toBeVisible({ timeout: 30_000 });
}

async function toPersonMar(page: Page, personName: string) {
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page.getByRole("button", { name: new RegExp(personName) }).click();
  await expect(page.getByText("Med count & supply")).toBeVisible();
}

test("no Med Count tile; a refill count becomes the baseline and Given doses burn it down", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");
  await toShellHome(page, "Cedar House");

  // The tile is gone from the grid (the shell spec covers the More sheet).
  await expect(page.getByRole("button", { name: /Med Count/ })).toHaveCount(0);

  await toPersonMar(page, "Ellis Hart");
  await page.getByRole("button", { name: /8:00 AM/ }).click();

  // Levetiracetam's countdown sits on its own row. The seeded med has no
  // delivery record yet, so the row shows the maintained count; tapping
  // it (administrator = a count-recording role) opens the refill form.
  await page.getByRole("button", { name: /pills left/ }).first().click();
  await expect(page.getByText("Refill count")).toBeVisible();
  await page.getByLabel("Pills now on hand").fill("28");
  await page.getByRole("button", { name: "Save count" }).click();

  // The recorded count is now the baseline: 28 pills, 2 per day.
  await expect(
    page.getByRole("button", {
      name: /28 pills left · about 14 days at 2 per day/,
    }),
  ).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("mar-countdown.png"), fullPage: true });

  // Move to the next Central day: the countdown still reads the full
  // baseline (nothing recorded since the count).
  await page.clock.setFixedTime(new Date("2026-09-13T13:30:00.000Z"));
  await page.getByRole("button", { name: "Next day" }).click();
  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await expect(
    page.getByRole("button", { name: /28 pills left/ }),
  ).toBeVisible();

  // Record the morning dose Given: exactly one pill (this dose's
  // quantity — 2 per day over 2 dose times) burns off the countdown.
  await page.getByRole("button", { name: /Levetiracetam/ }).click();
  await page.getByLabel(/I confirm the administered time/).check();
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByText(/Given by Sarah Mitchell/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", {
      name: /27 pills left · about 13 days at 2 per day/,
    }),
  ).toBeVisible();
});

test("a house manager resets the countdown with a refill count; the count is recorded", async ({
  page,
}) => {
  await signIn(page, "james.wilson");
  await toShellHome(page, "Willow House");
  await toPersonMar(page, "Reese Lang");

  // Reese's Omeprazole: 30 on hand, 1 per day, counted today.
  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await page
    .getByRole("button", { name: /30 pills left · about 30 days at 1 per day/ })
    .click();
  await expect(page.getByText("Refill count")).toBeVisible();
  await expect(page.getByText("Countdown now")).toBeVisible();
  await page.getByLabel("Pills now on hand").fill("20");
  await page.screenshot({ path: shot("mar-refill-form.png"), fullPage: true });
  await page.getByRole("button", { name: "Save count" }).click();

  // The countdown restarts from the manager's count.
  await expect(
    page.getByRole("button", {
      name: /20 pills left · about 20 days at 1 per day/,
    }),
  ).toBeVisible({ timeout: 10_000 });

  // The count is on the record: reopening shows the new baseline date
  // and the audited recent-count entry (date, pills, recorded by).
  await page.getByRole("button", { name: /20 pills left/ }).click();
  await expect(page.getByText("Counted Sat, Sep 12")).toBeVisible();
  await expect(page.getByText(/20 pills counted/)).toBeVisible();
  await expect(page.getByText(/recorded by/)).toBeVisible();
});

test("a DSP reads the countdown as text (no refill tap) and PRN shows no day projection", async ({
  page,
}) => {
  await signIn(page, "alex.morgan");
  await toShellHome(page, "Cedar House");
  await toPersonMar(page, "Ellis Hart");

  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await expect(page.getByText(/pills left · about/)).toBeVisible();
  // No tappable countdown anywhere for a role that cannot record counts.
  await expect(
    page.getByRole("button", { name: /Record a refill count/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /pills left/ })).toHaveCount(0);

  // PRN: pills left, "as needed — no daily rate", no day projection.
  await page.getByRole("button", { name: "PRN", exact: true }).click();
  await expect(
    page.getByText("12 pills left · as needed — no daily rate"),
  ).toBeVisible();
  await page.screenshot({ path: shot("mar-prn-count.png"), fullPage: true });
});
