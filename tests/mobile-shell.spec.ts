import { test, expect, type Page } from "./fixtures";

// Mobile shell + MAR + ISP flows at a phone viewport, in local/demo mode.
// The clock is pinned to 08:30 Central on the seed's service day so Ellis
// Hart's 08:00 dose is inside the med-pass window and recordable.
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(180_000);

const SHOT_DIR = "mobile-screenshots";
const shot = (name: string) => `${SHOT_DIR}/${name}`;

async function signInToShell(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-12T13:30:00.000Z"));
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Multi-home demo user lands on the home picker first.
  await expect(page.getByText("Select your home")).toBeVisible({
    timeout: 60_000,
  });
}

async function pickCedarHouse(page: Page) {
  await page.getByRole("button", { name: /Cedar House/ }).click();
  // The clean home: Central-time greeting + "Today at <Home>" heading.
  await expect(page.getByText("Morning, Sarah")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today at Cedar House" }),
  ).toBeVisible();
}

test("mobile shell: home picker, role tiles, and the MAR pass flow", async ({
  page,
}) => {
  await signInToShell(page);
  await page.screenshot({ path: shot("home-picker.png"), fullPage: true });

  await pickCedarHouse(page);

  // Role-correct tiles for an administrator; modules that do not exist on
  // main (Messages, Event Reports, Time Off) render no tile at all.
  for (const label of [
    "Medications",
    "Shift Notes",
    "ISP Data",
    "Time Clock",
    "My Tasks",
    "Individuals",
    "Checklists",
    "Med Count",
  ]) {
    await expect(
      page.getByRole("button", { name: new RegExp(label) }).first(),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Messages/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Time Off/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Event Reports/ })).toHaveCount(
    0,
  );
  await page.screenshot({ path: shot("tile-home.png"), fullPage: true });

  // MAR: pick the person, read the day as passes with text counts.
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await expect(page.getByText("Med count & supply")).toBeVisible();

  // Allergies are one tap from the person header.
  await page
    .getByRole("button", { name: /Contacts · Allergies · Diagnoses/ })
    .click();
  await expect(page.getByRole("heading", { name: "Allergies" })).toBeVisible();

  const morningPass = page.getByRole("button", { name: /8:00 AM/ });
  await expect(morningPass).toContainText("0 of 1 given");
  const ninePass = page.getByRole("button", { name: /9:00 AM/ });
  await expect(ninePass).toContainText("1 of 1 given");
  await page.screenshot({ path: shot("mar-day.png"), fullPage: true });

  // Pass view: the due med with its status in text.
  await morningPass.click();
  await expect(
    page.getByRole("button", { name: /Levetiracetam/ }),
  ).toContainText("Not yet given");
  await page.screenshot({ path: shot("mar-pass.png"), fullPage: true });

  // Administer: record type is one dropdown (marks + exceptions grouped),
  // defaulting to Given; the confirm-time control gates the save.
  await page.getByRole("button", { name: /Levetiracetam/ }).click();
  await expect(page.getByText("Scheduled time")).toBeVisible();
  await expect(page.getByText("Administered by")).toBeVisible();
  const recordType = page.getByLabel("Record type");
  await expect(recordType).toHaveValue("given");
  await expect(recordType.locator("option")).toHaveCount(7);
  const save = page.getByRole("button", { name: "Save record" });
  await expect(save).toBeDisabled();
  await page
    .getByLabel(/I confirm the administered time/)
    .check();
  await expect(save).toBeEnabled();
  await page.screenshot({ path: shot("mar-administer.png"), fullPage: true });

  await save.click();
  await expect(page.getByText(/Given by Sarah Mitchell/)).toBeVisible({
    timeout: 10_000,
  });
});

test("mobile MAR: a Refused record needs a reason and lands on the Other tab", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);

  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await page.getByRole("button", { name: /Levetiracetam/ }).click();

  // Picking the Refused exception from the Record type dropdown reveals the
  // required reason; confirming the time alone does not enable the save.
  const recordType = page.getByLabel("Record type");
  await expect(recordType).toHaveValue("given");
  await recordType.selectOption("refused");
  const save = page.getByRole("button", { name: "Save record" });
  const reason = page.getByLabel(/Reason \(required\)/);
  await expect(reason).toBeVisible();
  await page.getByLabel(/I confirm the administered time/).check();
  await expect(save).toBeDisabled();
  await reason.fill("Refused the morning dose and spat out the tablet.");
  await expect(save).toBeEnabled();
  await page.screenshot({
    path: shot("mar-administer-dropdown.png"),
    fullPage: true,
  });
  await save.click();

  // The dose itself stays unmarked; the exception is listed on the Other tab
  // with its reason.
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await expect(page.getByText(/Levetiracetam · Refused/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/Refused the morning dose/)).toBeVisible();
});

test("mobile ISP data: plan select, entries, and creating an entry", async ({
  page,
}) => {
  // Setup on the desktop surface (same context, same demo data): a progress
  // note cannot be saved until the plan carries its goal/outcome — a manager
  // step in the chart's ISP section. Set it, then shrink to the phone shell.
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.clock.setFixedTime(new Date("2026-09-12T13:30:00.000Z"));
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByRole("button", { name: "Individuals", exact: true })
    .click();
  await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
  const goal = page.getByLabel("Goal / service");
  await goal.scrollIntoViewIfNeeded();
  await goal.fill(
    "Daily living supports — habilitation, personal care, and supervision in the home.",
  );
  await page.getByRole("button", { name: "Save report header" }).click();
  await expect(goal).toHaveValue(/Daily living supports/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Select your home")).toBeVisible({
    timeout: 30_000,
  });
  await pickCedarHouse(page);

  await page.getByRole("button", { name: /ISP Data/ }).first().click();
  await page.screenshot({ path: shot("isp-people.png"), fullPage: true });
  await page.getByRole("button", { name: /Ellis Hart/ }).click();

  // Plan select: the active plan is offered; period and status are text.
  const plan = page.getByRole("button", {
    name: /2026 ISP — Daily living supports/,
  });
  await expect(plan).toContainText("Active");
  await page.screenshot({ path: shot("isp-plans.png"), fullPage: true });
  await plan.click();

  // Entries list: seeded entries grouped by day, authors named.
  await expect(
    page.getByRole("button", { name: "Create entry" }),
  ).toBeVisible();
  await expect(page.getByText(/Alex Morgan/).first()).toBeVisible();
  await page.screenshot({ path: shot("isp-entries.png"), fullPage: true });

  // Create: duration from start–end, one task scored, overall comment.
  await page.getByRole("button", { name: "Create entry" }).click();
  await expect(page.getByRole("heading", { name: "Task scores" })).toBeVisible();
  await page.getByLabel("Start time").fill("07:00");
  await page.getByLabel("End time").fill("15:00");
  await expect(page.getByText("Duration: 480 minutes")).toBeVisible();
  const task = page.locator(".msh-task", {
    hasText: "Complete morning hygiene routine",
  });
  await task.getByRole("button", { name: "Yes", exact: true }).click();
  await page
    .getByLabel(/What the person did/)
    .fill("Worked through the morning routine with verbal prompts only.");
  await page.screenshot({ path: shot("isp-entry-form.png"), fullPage: true });

  // A first progress note must be signed: adopt a signature if prompted.
  const addSignature = page.getByRole("button", {
    name: "Add your signature",
  });
  if (await addSignature.isVisible()) {
    await addSignature.click();
    await page
      .getByRole("tablist", { name: "Your signature" })
      .getByRole("tab", { name: "Type" })
      .click();
    await page
      .getByRole("tablist", { name: "Your initials" })
      .getByRole("tab", { name: "Type" })
      .click();
    await page.locator(".sig-consent input").check();
    await page.getByRole("button", { name: "Adopt signature" }).click();
    await expect(page.getByText(/Signature on file/)).toBeVisible({
      timeout: 10_000,
    });
  }

  await page.getByRole("button", { name: "Save entry" }).click();
  // The saved entry appears in the list under its author. (Filtered to the
  // scored row: the header avatar button also carries her name now.)
  const mine = page
    .getByRole("button", { name: /Sarah Mitchell/ })
    .filter({ hasText: "tasks scored" })
    .first();
  await expect(mine).toBeVisible({ timeout: 10_000 });
  await expect(mine).toContainText("1 of 6 tasks scored");
});

test("mobile ISP data: a draft plan is visible but not offered for entry", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);

  await page.getByRole("button", { name: /ISP Data/ }).first().click();
  await page.getByRole("button", { name: /Morgan Pruitt/ }).click();
  const draft = page.getByRole("button", {
    name: /2026 ISP — Community participation/,
  });
  await expect(draft).toContainText("Draft — not yet approved");
  await draft.click();
  await expect(
    page.getByRole("button", { name: "Create entry" }),
  ).toHaveCount(0);
});

test("mobile shift notes: the home's notes list and read view", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);

  await page.getByRole("button", { name: /Shift Notes/ }).first().click();
  await expect(
    page.getByRole("button", { name: "Create shift note" }),
  ).toBeVisible();
  const noteRow = page
    .getByRole("button", { name: /Ellis Hart/ })
    .first();
  await expect(noteRow).toBeVisible();
  await noteRow.click();
  await expect(page.getByText("Collection details")).toBeVisible();
  await expect(page.getByText("Task scores")).toBeVisible();
});

test("mobile home: donut math, up next, and the bottom navigation", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);

  // Donut card: the legend's fractions are the record; the center percent
  // must equal their sum — parse the texts and check the math, don't trust
  // the ring.
  const card = page.locator(".msh-donut-card");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "Today’s tracking" }),
  ).toBeVisible();
  const legendRows = card.locator(".msh-legend-row");
  await expect(legendRows.first()).toBeVisible({ timeout: 30_000 });
  const rowTexts = await legendRows.allTextContents();
  let completed = 0;
  let total = 0;
  let fractionRows = 0;
  for (const text of rowTexts) {
    const match = text.match(/(\d+) of (\d+)/);
    if (match) {
      completed += Number(match[1]);
      total += Number(match[2]);
      fractionRows += 1;
    }
  }
  expect(fractionRows).toBeGreaterThan(0);
  expect(total).toBeGreaterThan(0);
  await expect(page.locator(".msh-donut-center strong")).toHaveText(
    `${Math.round((completed / total) * 100)}%`,
  );
  await card.screenshot({ path: shot("home-donut.png") });
  await page.locator(".msh-upnext").screenshot({ path: shot("up-next.png") });
  await page.screenshot({ path: shot("home-clean.png"), fullPage: true });

  // Bottom navigation: Tasks and People are shell views, Meds opens the
  // MAR — where the pill steps aside for the MAR's own tab bar.
  const navBar = page.getByRole("navigation", { name: "Mobile" });
  await expect(navBar).toBeVisible();
  await navBar.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Your due and priority work")).toBeVisible();
  await navBar.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today at Cedar House" }),
  ).toBeVisible();
  await navBar.getByRole("button", { name: "Meds", exact: true }).click();
  await expect(
    page.getByText("Pick the person whose medications"),
  ).toBeVisible();
  await expect(navBar).toHaveCount(0);
  await page.getByRole("button", { name: "‹ Home" }).click();
  await expect(navBar).toBeVisible();
  await navBar.getByRole("button", { name: "People", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Ellis Hart/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "‹ Home" }).click();

  // More opens the sheet with the tiles the pill does not carry.
  await navBar.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Med Count/ })).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: /Switch home/ }),
  ).toBeVisible();
  await page.screenshot({ path: shot("more-sheet.png") });
  // Tap the dimmed backdrop above the sheet (its center is under the sheet).
  await page
    .getByRole("button", { name: "Close more menu" })
    .click({ position: { x: 20, y: 20 } });
  await expect(sheet).toHaveCount(0);
});
