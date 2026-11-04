import { test, expect, type Page } from "./fixtures";

/**
 * Scheduling tab + compliance-first Overview (founder directives,
 * 2026-10-28):
 *  1. The manager Overview LEADS with the house-compliance donuts — the
 *     donut panel is the first content section, scoped to the manager's
 *     own house(s), and the Right Now strip no longer sits on it.
 *  2. A top-level Scheduling tab (managers only) carries the strip plus
 *     the house coverage board, filterable by program site: switching
 *     the picker re-scopes every segment and the board.
 *
 * The strip segments reuse the seeded two-home state from
 * tests/right-now-strip.spec.ts (Willow + Cedar on Saturday 2026-09-12):
 * Jordan Lee (Willow) clocked in 6:45 AM; Alex Morgan (Cedar) expected
 * and not arrived; Taylor Reed (Cedar) out on approved Vacation.
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
    corrections: [],
    periods: [],
    approvals: [],
    documents: [],
    acks: [],
    timeOff: [
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
    missedReports: [],
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
      // twice in the right-now strip. Mark the bucket seeded so the
      // store stays hermetic: only this test's rows drive the strip.
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
        [agency]: { shifts: [], responses: [], awards: [] },
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

async function openScheduling(page: Page) {
  await page.getByRole("button", { name: "Scheduling" }).click();
  await expect(
    page.getByRole("heading", { name: "Scheduling" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("house manager Overview leads with their house's compliance donut", async ({
  page,
}) => {
  await signIn(page, "james.wilson");

  const donuts = page.locator("section.house-compliance");
  await expect(donuts).toBeVisible({ timeout: 15_000 });
  await expect(donuts.getByText("House compliance")).toBeVisible();

  // The donut card is for the manager's own house only, with the score in
  // words and numbers — never color alone.
  await expect(donuts.getByText("Willow House")).toBeVisible();
  await expect(donuts.getByText("Cedar House")).toHaveCount(0);
  await expect(donuts.getByText(/% current/)).toBeVisible();
  await expect(donuts.locator("figure.status-mix")).toHaveCount(1);

  // DOM order: the donut panel precedes the stat grid and the personal
  // queue — it is the first content on the page.
  const order = await page.evaluate(() => {
    const first = document.querySelector("section.house-compliance");
    const statGrid = document.querySelector(".stat-grid");
    const queue = document.querySelector("section.personal-queue");
    if (!first || !statGrid || !queue) return 0;
    const beforeStat =
      first.compareDocumentPosition(statGrid) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    const beforeQueue =
      first.compareDocumentPosition(queue) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    return beforeStat && beforeQueue ? 1 : -1;
  });
  expect(order).toBe(1);

  // The Right Now strip has moved off the Overview.
  await expect(page.locator("section.right-now")).toHaveCount(0);
});

test("administrator Overview shows every house's donut, filter narrows it", async ({
  page,
}) => {
  await signIn(page, "sarah.mitchell");

  const donuts = page.locator("section.house-compliance");
  await expect(donuts).toBeVisible({ timeout: 15_000 });
  await expect(donuts.locator(".house-compliance-card")).toHaveCount(2);
  await expect(donuts.getByText("Willow House")).toBeVisible();
  await expect(donuts.getByText("Cedar House")).toBeVisible();

  await page.getByLabel("Filter by site").selectOption({ label: "Cedar House" });
  await expect(donuts.locator(".house-compliance-card")).toHaveCount(1);
  await expect(donuts.getByText("Cedar House")).toBeVisible();
  await expect(donuts.getByText("Willow House")).toHaveCount(0);
});

test("Scheduling tab re-scopes the strip and the board by program site", async ({
  page,
}) => {
  await seedStores(page);
  await signIn(page, "sarah.mitchell");
  await openScheduling(page);

  const strip = page.locator("section.right-now");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  // All sites by default: both houses' people appear.
  await expect(strip.getByText("Jordan Lee")).toBeVisible();
  await expect(strip.getByText("Alex Morgan")).toBeVisible();
  await expect(strip.getByText("Taylor Reed")).toBeVisible();
  // No single house picked yet, so the board shows its choose-a-site state.
  await expect(
    page.locator("section.coverage-board").getByText("House coverage"),
  ).toBeVisible();

  const picker = page.getByLabel("Filter by program site");
  await picker.selectOption({ label: "Cedar House" });
  await expect(strip.getByText("Alex Morgan")).toBeVisible();
  await expect(strip.getByText("Taylor Reed")).toBeVisible();
  await expect(strip.getByText("Jordan Lee")).toHaveCount(0);
  await expect(
    page.locator("section.coverage-board").getByText("Cedar House coverage"),
  ).toBeVisible({ timeout: 15_000 });

  await picker.selectOption({ label: "Willow House" });
  await expect(strip.getByText("Jordan Lee")).toBeVisible();
  await expect(strip.getByText("Alex Morgan")).toHaveCount(0);
  await expect(strip.getByText("Taylor Reed")).toHaveCount(0);
  await expect(
    page.locator("section.coverage-board").getByText("Willow House coverage"),
  ).toBeVisible({ timeout: 15_000 });
});

test("house manager's Scheduling filter holds only their house, preselected", async ({
  page,
}) => {
  await seedStores(page);
  await signIn(page, "james.wilson");
  await openScheduling(page);

  const picker = page.getByLabel("Filter by program site");
  const options = await picker.locator("option").allTextContents();
  expect(options).toEqual(["Willow House"]);
  await expect(picker).toHaveValue("Willow House");

  const strip = page.locator("section.right-now");
  await expect(strip.getByText("Jordan Lee")).toBeVisible();
  await expect(strip.getByText("Alex Morgan")).toHaveCount(0);
  await expect(
    page.locator("section.coverage-board").getByText("Willow House coverage"),
  ).toBeVisible({ timeout: 15_000 });
});

test("Scheduling page does not overflow a phone-width viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStores(page);
  await signIn(page, "james.wilson");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await openScheduling(page);
  await expect(page.locator("section.right-now")).toBeVisible({
    timeout: 15_000,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
