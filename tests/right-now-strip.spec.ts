import { test, expect, type Page } from "./fixtures";

/**
 * Manager "Right Now" strip (Paycor idea #2).
 *
 * The demo HR stores are empty on a fresh browser, so each test seeds the
 * local HR bucket + open-shift board with a fixed Saturday (2026-09-12,
 * the fixtures pin local time to noon that day) at Willow House + Cedar
 * House, then asserts the strip against those exact rows:
 *  - Jordan Lee (Willow DSP) clocked in 6:45 AM, has a pending time-off
 *    request and a pending punch correction.
 *  - Casey Adams (Willow DSP) has 4h approved Sick today (partial) and a
 *    published 7 AM–3 PM shift he hasn't punched for, plus a pending
 *    missed-punch report.
 *  - Alex Morgan (Cedar DSP) has a published 7 AM shift and no punch.
 *  - Taylor Reed (Cedar DSP) is out all day on approved Vacation.
 *  - One uncovered Willow shift today, 3 PM–11 PM.
 */

const AGENCY = "00000000-0000-4000-8000-000000000001";
const CEDAR = "00000000-0000-4000-8000-000000000011";
const WILLOW = "00000000-0000-4000-8000-000000000012";
const SARAH = "00000000-0000-4000-8000-000000000201";
const JAMES = "00000000-0000-4000-8000-000000000202";
const ALEX = "00000000-0000-4000-8000-000000000203";
const TAYLOR = "00000000-0000-4000-8000-000000000204";
const JORDAN = "00000000-0000-4000-8000-000000000205";
const CASEY = "00000000-0000-4000-8000-000000000206";
const DAY = "2026-09-12";

function hrBucket() {
  return {
    shifts: [
      {
        id: "shift-jordan",
        agencyId: AGENCY,
        siteId: WILLOW,
        staffId: JORDAN,
        title: "Day shift",
        startsAt: `${DAY}T07:00:00`,
        endsAt: `${DAY}T15:00:00`,
        status: "published",
        notes: null,
        createdBy: JAMES,
      },
      {
        id: "shift-casey",
        agencyId: AGENCY,
        siteId: WILLOW,
        staffId: CASEY,
        title: "Day shift",
        startsAt: `${DAY}T07:00:00`,
        endsAt: `${DAY}T15:00:00`,
        status: "published",
        notes: null,
        createdBy: JAMES,
      },
      {
        id: "shift-alex",
        agencyId: AGENCY,
        siteId: CEDAR,
        staffId: ALEX,
        title: "Day shift",
        startsAt: `${DAY}T07:00:00`,
        endsAt: `${DAY}T15:00:00`,
        status: "published",
        notes: null,
        createdBy: SARAH,
      },
    ],
    punches: [
      {
        id: "punch-jordan-in",
        agencyId: AGENCY,
        siteId: WILLOW,
        staffId: JORDAN,
        kind: "in",
        punchedAt: `${DAY}T06:45:00`,
        source: "kiosk_pin",
        note: null,
        shiftId: "shift-jordan",
      },
    ],
    corrections: [
      {
        id: "corr-jordan",
        punchId: "punch-jordan-in",
        staffId: JORDAN,
        requestedKind: "in",
        requestedAt: `${DAY}T06:50:00`,
        reason: "Kiosk read my badge late",
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      },
    ],
    periods: [],
    approvals: [],
    documents: [],
    acks: [],
    timeOff: [
      {
        id: "to-casey-sick",
        agencyId: AGENCY,
        siteId: WILLOW,
        staffId: CASEY,
        kind: "sick",
        startsOn: DAY,
        endsOn: DAY,
        status: "approved",
        reason: "Morning appointment",
        days: [{ date: DAY, hours: 4 }],
        totalHours: 4,
        decidedBy: JAMES,
        decidedAt: `${DAY}T06:00:00`,
        decisionNote: null,
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
        createdAt: `${DAY}T05:00:00`,
        updatedAt: `${DAY}T06:00:00`,
      },
      {
        id: "to-taylor-vacation",
        agencyId: AGENCY,
        siteId: CEDAR,
        staffId: TAYLOR,
        kind: "vacation",
        startsOn: DAY,
        endsOn: DAY,
        status: "approved",
        reason: "",
        days: [{ date: DAY, hours: 8 }],
        totalHours: 8,
        decidedBy: SARAH,
        decidedAt: `${DAY}T06:00:00`,
        decisionNote: null,
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
        createdAt: `${DAY}T05:00:00`,
        updatedAt: `${DAY}T06:00:00`,
      },
      {
        id: "to-jordan-pending",
        agencyId: AGENCY,
        siteId: WILLOW,
        staffId: JORDAN,
        kind: "vacation",
        startsOn: "2026-09-20",
        endsOn: "2026-09-21",
        status: "pending",
        reason: "Family trip",
        days: [
          { date: "2026-09-20", hours: 8 },
          { date: "2026-09-21", hours: 8 },
        ],
        totalHours: 16,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        cancelledBy: null,
        cancelledAt: null,
        cancelReason: null,
        createdAt: `${DAY}T08:00:00`,
        updatedAt: `${DAY}T08:00:00`,
      },
    ],
    timeOffEvents: [],
    requirements: [],
    patterns: [],
    policies: [],
    ledger: [],
    overtimeRules: null,
    swaps: [],
    kioskTokens: [],
    credentials: [],
    missedReports: [
      {
        id: "missed-casey",
        agencyId: AGENCY,
        staffId: CASEY,
        siteId: WILLOW,
        workDate: "2026-09-11",
        claimedInAt: "2026-09-11T07:00:00",
        claimedOutAt: "2026-09-11T15:00:00",
        reason: "Forgot to punch at the kiosk",
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        createdAt: `${DAY}T08:30:00`,
      },
    ],
    punchRules: null,
    remoteGrants: [],
  };
}

async function seedStores(page: Page) {
  await page.addInitScript(
    ({ agency, james, sarah, bucket }) => {
      // The local HR store self-seeds demo hub/staffing/readiness rows
      // into any bucket missing its seeded flags (hrStore load gates) —
      // including extra shifts for these same demo people on this same
      // day, which merged with the rows below and listed Alex Morgan
      // twice in the strip. Mark the bucket seeded so the store stays
      // hermetic: only this test's rows drive the strip.
      const hermetic = {
        ...bucket,
        staffingSeeded: true,
        demoHubSeeded: true,
        demoAccountabilitySeeded: true,
        demoReadinessSeeded: true,
        demoBinderSeeded: true,
        demoPerformanceSeeded: true,
      };
      const hr = {
        [agency]: { [james]: hermetic, [sarah]: hermetic },
      };
      localStorage.setItem("complyrer.hr.v1", JSON.stringify(hr));
      const open = {
        [agency]: {
          shifts: [
            {
              id: "open-willow-today",
              agencyId: agency,
              siteId: "00000000-0000-4000-8000-000000000012",
              kind: "temporary",
              audience: "site",
              title: "Evening coverage",
              startsAt: "2026-09-12T15:00:00",
              endsAt: "2026-09-12T23:00:00",
              days: [],
              windowStart: null,
              windowEnd: null,
              effectiveFrom: null,
              weeklyHours: 8,
              notes: "",
              slots: 1,
              filledCount: 0,
              pickupMode: "first_come",
              status: "open",
              postedBy: james,
              postedByName: "James Wilson",
              createdAt: "2026-09-12T06:00:00",
            },
          ],
          responses: [],
          awards: [],
        },
      };
      localStorage.setItem("complyra.openShifts.v1", JSON.stringify(open));
    },
    { agency: AGENCY, james: JAMES, sarah: SARAH, bucket: hrBucket() },
  );
}

async function signIn(page: Page, username: string) {
  // These specs assert on the desktop layout, including at phone
  // width. Since PR #134 a phone sign-in lands in the mobile shell;
  // the desktop layout is what a user gets after picking "Desktop
  // view" once — the pick persists (the app reads
  // complyrer.viewMode at boot), so seed it before the app loads.
  await page.addInitScript(() => {
    localStorage.setItem("complyrer.viewMode", "desktop");
  });
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  // At phone width sign-in lands in the mobile shell (PR #134) — its
  // header is the banner landmark; the desktop topbar only exists in
  // the desktop layout. Accept either.
  await expect(
    page.getByRole("banner").or(page.locator(".topbar")),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

function strip(page: Page) {
  return page.locator("section.right-now");
}

/** The strip moved from the Overview to the Scheduling tab (2026-10-28). */
async function openScheduling(page: Page) {
  await page.getByRole("button", { name: "Scheduling" }).click();
  await expect(
    page.getByRole("heading", { name: "Scheduling" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("house manager sees the strip scoped to their home", async ({ page }) => {
  await seedStores(page);
  await signIn(page, "james.wilson");

  // The Overview is compliance-first now — the strip no longer lives there.
  await expect(strip(page)).toHaveCount(0);
  await openScheduling(page);

  const el = strip(page);
  await expect(el).toBeVisible({ timeout: 15_000 });
  await expect(el.getByText("Right now")).toBeVisible();
  await expect(el.getByText("As of")).toBeVisible();

  // Clocked in: Jordan punched at 6:45 AM (seeded punch) — matches the store row.
  const clocked = el.locator(".right-now-segment", { hasText: "Clocked in now" });
  await expect(clocked.getByText("Jordan Lee")).toBeVisible();
  await expect(clocked.getByText("since 6:45 AM")).toBeVisible();

  // Out today: Casey's approved 4h Sick is a partial day — matches the seeded request.
  const out = el.locator(".right-now-segment", { hasText: "Out today" });
  await expect(out.getByText("Casey Adams")).toBeVisible();
  await expect(out.getByText("Out part of today · 4h · Sick")).toBeVisible();

  // Not arrived: Casey's 7 AM shift started, no punch, and 4h of leave does
  // not cover an 8h shift.
  const late = el.locator(".right-now-segment", { hasText: "Expected, not arrived" });
  await expect(late.getByText("Casey Adams")).toBeVisible();
  await expect(late.getByText("shift started 7:00 AM")).toBeVisible();

  // Open shifts: the seeded uncovered Willow shift.
  const openSeg = el.locator(".right-now-segment", { hasText: "Open shifts today" });
  await expect(openSeg.getByText("3:00 PM – 11:00 PM")).toBeVisible();

  // Decisions: one of each seeded pending item.
  const decisions = el.locator(".right-now-segment", { hasText: "Needs your decision" });
  await expect(decisions.getByText("1 time-off request")).toBeVisible();
  await expect(decisions.getByText("1 punch correction")).toBeVisible();
  await expect(decisions.getByText("1 missed-punch report")).toBeVisible();

  // Cedar rows stay out of the Willow manager's strip.
  await expect(el.getByText("Alex Morgan")).toHaveCount(0);
  await expect(el.getByText("Taylor Reed")).toHaveCount(0);
});

test("DSP does not see the strip", async ({ page }) => {
  await seedStores(page);
  await signIn(page, "alex.morgan");
  // A DSP has no Overview in their navigation — they land on Individuals.
  // The strip is manager-only, so it must not exist anywhere in their app,
  // and neither must the Scheduling tab that now carries it.
  await expect(page.getByRole("heading", { name: "Individuals" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scheduling" })).toHaveCount(0);
});

test("administrator focus change re-scopes the strip", async ({ page }) => {
  await seedStores(page);
  await signIn(page, "sarah.mitchell");
  await openScheduling(page);

  const el = strip(page);
  await expect(el).toBeVisible({ timeout: 15_000 });
  // All sites: Cedar's not-arrived and out-today rows show alongside Willow's.
  await expect(el.getByText("Alex Morgan")).toBeVisible();
  const out = el.locator(".right-now-segment", { hasText: "Out today" });
  await expect(out.getByText("Taylor Reed")).toBeVisible();
  await expect(out.getByText("Vacation")).toBeVisible();

  await page.getByLabel("Filter by program site").selectOption({ label: "Willow House" });
  await expect(el.getByText("Jordan Lee")).toBeVisible();
  await expect(el.getByText("Alex Morgan")).toHaveCount(0);
  await expect(el.getByText("Taylor Reed")).toHaveCount(0);
});

test("strip does not overflow a phone-width viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStores(page);
  await signIn(page, "james.wilson");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await openScheduling(page);
  const el = strip(page);
  await expect(el).toBeVisible({ timeout: 15_000 });
  await expect(el.getByText("Jordan Lee")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
