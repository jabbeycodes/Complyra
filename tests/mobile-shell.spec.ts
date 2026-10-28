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
  // No separate Shift Notes tile: a shift note is an ISP data entry, so
  // ISP Data is the single door for the home's notes.
  await expect(page.getByRole("button", { name: /Shift Notes/ })).toHaveCount(
    0,
  );
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

test("mobile ISP data: the entries list is the shift-notes record", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);

  // There is no separate Shift Notes destination on mobile anymore: a
  // shift note is an ISP data entry, so the home's notes are read in the
  // ISP flow, under the Individual's plan.
  await expect(page.getByRole("button", { name: /Shift Notes/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /ISP Data/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page
    .getByRole("button", { name: /2026 ISP — Daily living supports/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Create entry" }),
  ).toBeVisible();
  // Seeded entries (this plan's shift notes) list under day headings with
  // their authors named; opening one shows the note's read view.
  const noteRow = page.locator(".msh-day-group .msh-row").first();
  await expect(noteRow).toBeVisible();
  await noteRow.click();
  await expect(page.getByText("Collection details")).toBeVisible();
  await expect(page.getByText("Task scores")).toBeVisible();
  await page.getByRole("button", { name: "‹ All entries" }).click();
  await page.getByRole("button", { name: "‹ All plans" }).click();
  await page.getByRole("button", { name: "‹ All Individuals" }).click();

  // The home-wide history inside the ISP door is the audit path the
  // per-person list cannot be: it spans every Individual at the home,
  // including notes on plans that are not visible to the entry flow, and
  // it is not subject to the per-person 30-record read cap. Prove the
  // cap part with a backlog written through the app's own persisted
  // store: 31 extra notes for Ellis Hart across August 2026. His
  // per-person read then holds only the newest 30 — the oldest backlog
  // entries must still be reachable in the history.
  await page.evaluate(() => {
    const raw = localStorage.getItem("complyra-v2-meta");
    if (!raw) throw new Error("demo store was not persisted");
    const meta = JSON.parse(raw);
    const db = meta.db;
    const ellis = db.individuals.find(
      (p: { fullName: string }) => p.fullName === "Ellis Hart",
    );
    const alex = db.profiles.find(
      (p: { fullName: string }) => p.fullName === "Alex Morgan",
    );
    const plan = db.ispPrograms.find(
      (pr: { individualId: string; status: string }) =>
        pr.individualId === ellis.id && pr.status === "approved",
    );
    for (let day = 31; day >= 1; day -= 1) {
      const date = `2026-08-${String(day).padStart(2, "0")}`;
      db.shiftNotes.push({
        id: `sn-backlog-${date}`,
        agencyId: ellis.agencyId,
        individualId: ellis.id,
        programId: plan.id,
        noteDate: date,
        shift: "7a–3p",
        summary: `Backlog entry for ${date}.`,
        timeSpentMinutes: null,
        staffUserId: alex.id,
        staffName: "Alex Morgan",
        createdAt: `${date}T15:00:00.000Z`,
        updatedAt: `${date}T15:00:00.000Z`,
        deletedAt: null,
      });
    }
    localStorage.setItem("complyra-v2-meta", JSON.stringify(meta));
  });
  await page.reload();
  const picker = page.getByText("Select your home");
  try {
    await picker.waitFor({ timeout: 15_000 });
    await pickCedarHouse(page);
  } catch {
    await expect(
      page.getByRole("heading", { name: "Today at Cedar House" }),
    ).toBeVisible({ timeout: 30_000 });
  }

  // The per-person entries list is capped: 4 seeded + 31 backlog = 35
  // records, exactly 30 rows shown.
  await page.getByRole("button", { name: /ISP Data/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page
    .getByRole("button", { name: /2026 ISP — Daily living supports/ })
    .click();
  await expect(page.locator(".msh-day-group .msh-row")).toHaveCount(30, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "‹ All plans" }).click();
  await page.getByRole("button", { name: "‹ All Individuals" }).click();

  // The history spans the home: entries for both Individuals at Cedar
  // House (Morgan Pruitt's seeded notes sit on her draft plan — not
  // visible to the entry flow — yet they are part of the home's record),
  // newest first, and the beyond-cap backlog entry opens from here.
  await page
    .getByRole("button", { name: /All entries at Cedar House/ })
    .click();
  await expect(
    page.getByText("Shift notes at Cedar House, newest first."),
  ).toBeVisible({ timeout: 30_000 });
  // Newest first: the seeded notes are dated the last completed day.
  await expect(page.locator(".msh-day-heading").first()).toContainText(
    "Sep 11",
  );
  await expect(
    page.locator(".msh-row", { hasText: "Ellis Hart" }).first(),
  ).toBeVisible();
  await expect(
    page.locator(".msh-row", { hasText: "Morgan Pruitt" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: shot("isp-history.png"), fullPage: true });
  const beyondCap = page.locator(".msh-row", {
    hasText: "Backlog entry for 2026-08-01.",
  });
  await beyondCap.scrollIntoViewIfNeeded();
  await expect(beyondCap).toBeVisible();
  await beyondCap.click();
  await expect(page.getByText("Collection details")).toBeVisible();
  await expect(
    page.getByText("Backlog entry for 2026-08-01."),
  ).toBeVisible();
});

interface HomeTrackingSnapshot {
  /** Medications legend fraction, e.g. "2 of 5". */
  medFraction: string;
  medCompleted: number;
  medTotal: number;
  /** Donut center percent text, e.g. "88%". */
  centerPercent: string;
  /** Greeting summary's med line, e.g. "3 med doses left to record". */
  medsLeftText: string;
}

async function readHomeTracking(
  page: Page,
): Promise<HomeTrackingSnapshot> {
  const card = page.locator(".msh-donut-card");
  const medRow = card.locator(".msh-legend-row", { hasText: "Medications" });
  await expect(medRow).toBeVisible({ timeout: 30_000 });
  const medText = (await medRow.textContent()) ?? "";
  const fraction = medText.match(/(\d+) of (\d+)/);
  if (!fraction) throw new Error(`No fraction in legend row: ${medText}`);
  const centerPercent =
    (await page.locator(".msh-donut-center strong").textContent()) ?? "";
  const medsLeftText =
    (await page
      .getByText(/med doses? left to record|All med doses recorded/)
      .first()
      .textContent()) ?? "";
  return {
    medFraction: `${fraction[1]} of ${fraction[2]}`,
    medCompleted: Number(fraction[1]),
    medTotal: Number(fraction[2]),
    centerPercent: centerPercent.trim(),
    medsLeftText: medsLeftText.trim(),
  };
}

/**
 * The home tracking surface as one comparable string: the donut card
 * (legend fractions + center percent) plus the greeting's doses-left
 * line. `null` while the card is not on screen (e.g. mid-navigation).
 */
async function sampleHomeTrackingText(page: Page): Promise<string | null> {
  const cardText = await page
    .locator(".msh-donut-card")
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  if (cardText === null) return null;
  const medsLeftText = await page
    .getByText(/med doses? left to record|All med doses recorded/)
    .first()
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  if (medsLeftText === null) return null;
  return `${cardText}\n${medsLeftText}`;
}

/**
 * Go back to the shell home and wait until the tracking numbers the
 * return-triggered refetch produces have SETTLED.
 *
 * The previous version waited for the "Loading today’s tracking…"
 * indicator to paint and then clear. That flakes: on the exception path
 * the refetch often settles before the indicator ever paints, so the
 * wait failed even though the numbers were already fresh and correct.
 * Waiting on the paint tests the spinner, not the data.
 *
 * Instead, poll the tracking surface itself and require BOTH:
 *  - a minimum wait after the click (MIN_WAIT_MS), so at least one full
 *    refetch cycle has had its chance to land — the values asserted
 *    afterwards can never be the pre-return, session-start numbers; and
 *  - a stability window (STABLE_FOR_MS) in which the text does not
 *    change at all — any in-flight refetch that lands mid-window resets
 *    the clock, so we only return once the displayed values have stopped
 *    moving. Absent/unreadable samples also reset the clock.
 */
async function returnHomeRefreshed(page: Page) {
  const MIN_WAIT_MS = 2_500;
  const STABLE_FOR_MS = 1_250;
  const POLL_MS = 200;
  const TIMEOUT_MS = 30_000;

  await page.getByRole("button", { name: "‹ Home" }).click();
  await expect(page.locator(".msh-donut-card")).toBeVisible({
    timeout: 15_000,
  });

  const startedAt = Date.now();
  let lastText = await sampleHomeTrackingText(page);
  let stableSince = Date.now();
  for (;;) {
    await page.waitForTimeout(POLL_MS);
    const text = await sampleHomeTrackingText(page);
    const now = Date.now();
    if (text === null || text !== lastText) {
      lastText = text;
      stableSince = now;
    }
    const elapsed = now - startedAt;
    if (elapsed >= MIN_WAIT_MS && now - stableSince >= STABLE_FOR_MS) {
      return;
    }
    if (elapsed > TIMEOUT_MS) {
      throw new Error(
        `Home tracking never settled within ${TIMEOUT_MS}ms. Last text: ${lastText}`,
      );
    }
  }
}

test("mobile home: a Refused exception does NOT move the donut, and home refreshes on return", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);
  const before = await readHomeTracking(page);

  // Record a Refused exception on Ellis Hart's 8:00 AM dose — an exception
  // with no dose mark. The dose itself stays "Not yet given".
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await page.getByRole("button", { name: /Levetiracetam/ }).click();
  await page.getByLabel("Record type").selectOption("refused");
  await page
    .getByLabel(/Reason \(required\)/)
    .fill("Refused the morning dose and spat out the tablet.");
  await page.getByLabel(/I confirm the administered time/).check();
  await page.getByRole("button", { name: "Save record" }).click();
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await expect(page.getByText(/Levetiracetam · Refused/)).toBeVisible({
    timeout: 10_000,
  });

  // Back home (no reload): the refetch runs, and because exceptions never
  // complete a dose, the Medications fraction, the center percent, and
  // the greeting's doses-left line are all exactly as before.
  await returnHomeRefreshed(page);
  const after = await readHomeTracking(page);
  expect(after.medFraction).toBe(before.medFraction);
  expect(after.centerPercent).toBe(before.centerPercent);
  expect(after.medsLeftText).toBe(before.medsLeftText);
});

test("mobile home: a Given mark moves the donut on return, without a reload", async ({
  page,
}) => {
  await signInToShell(page);
  await pickCedarHouse(page);
  const before = await readHomeTracking(page);

  // Record the 8:00 AM Levetiracetam as Given (a real dose mark).
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await page.getByRole("button", { name: /8:00 AM/ }).click();
  await page.getByRole("button", { name: /Levetiracetam/ }).click();
  await page.getByLabel(/I confirm the administered time/).check();
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByText(/Given by Sarah Mitchell/)).toBeVisible({
    timeout: 10_000,
  });

  // Back home (no reload): the refetch picks the mark up — Medications
  // gains exactly one completed dose, the center percent is the legend's
  // new sum, and the greeting's doses-left drops by one.
  await returnHomeRefreshed(page);
  const card = page.locator(".msh-donut-card");
  const medRow = card.locator(".msh-legend-row", { hasText: "Medications" });
  await expect(medRow).toContainText(
    `${before.medCompleted + 1} of ${before.medTotal}`,
    { timeout: 30_000 },
  );
  const after = await readHomeTracking(page);
  expect(after.medCompleted).toBe(before.medCompleted + 1);
  expect(after.medTotal).toBe(before.medTotal);
  const rowTexts = await card.locator(".msh-legend-row").allTextContents();
  let completed = 0;
  let total = 0;
  for (const text of rowTexts) {
    const match = text.match(/(\d+) of (\d+)/);
    if (match) {
      completed += Number(match[1]);
      total += Number(match[2]);
    }
  }
  expect(after.centerPercent).toBe(
    `${Math.round((completed / total) * 100)}%`,
  );
  expect(after.centerPercent).not.toBe(before.centerPercent);
  const leftBefore = Number(before.medsLeftText.match(/\d+/)?.[0]);
  const leftAfter = Number(after.medsLeftText.match(/\d+/)?.[0]);
  expect(leftAfter).toBe(leftBefore - 1);
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
  // Unification: the legend carries no Shift Notes row — ISP Data is the
  // notes' only row — and for this pinned day the center percent is the
  // value it had before the count-only row was dropped (28 of 32 = 88%:
  // the count-only row never entered the math).
  expect(rowTexts.some((text) => text.includes("Shift Notes"))).toBe(false);
  await expect(page.locator(".msh-donut-center strong")).toHaveText("88%");
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
