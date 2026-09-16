/**
 * hr.test.ts — unit tests for the Employee Hub domain logic (src/data/hr.ts).
 *
 * Style follows src/data/mileage.test.ts: node:test + assert/strict, fake
 * names only, no network, no clock reads (every "now" is passed in).
 *
 * Run: node --import tsx --import ./src/testSupport/cssStub.mts --test src/data/hr.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUE_SOON_DAYS,
  LATE_GRACE_MINUTES,
  MISSED_PUNCH_GRACE_MINUTES,
  OVERTIME_WEEKLY_HOURS,
  buildPayrollCsvExport,
  dailyTotals,
  detectExceptions,
  pairPunches,
  rollupCompliance,
  summarizeTimecard,
  validateClockIn,
  validateClockOut,
  weeklyTotals,
} from "./hr";
import type {
  ComplianceEvidence,
  HrPayPeriod,
  HrPunch,
  HrReadinessRequirement,
  HrShift,
  HrTimecardApproval,
  PayrollRow,
} from "./hr";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultPermissions,
  hasPermission,
} from "./permissions";

// ---------------------------------------------------------------------------
// Builders (fake data only)
// ---------------------------------------------------------------------------

let punchSeq = 0;

function punch(overrides: Partial<HrPunch> = {}): HrPunch {
  punchSeq += 1;
  return {
    id: `punch-test-${punchSeq}`,
    agencyId: "agency-test",
    siteId: "site-test",
    staffId: "staff-test-1",
    kind: "in",
    punchedAt: "2026-09-14T08:00:00",
    source: "kiosk",
    note: null,
    shiftId: null,
    ...overrides,
  };
}

let shiftSeq = 0;

function shift(overrides: Partial<HrShift> = {}): HrShift {
  shiftSeq += 1;
  return {
    id: `shift-test-${shiftSeq}`,
    agencyId: "agency-test",
    siteId: "site-test",
    staffId: "staff-test-1",
    title: "Day shift",
    startsAt: "2026-09-14T08:00:00",
    endsAt: "2026-09-14T16:00:00",
    status: "published",
    notes: null,
    createdBy: "manager-test-1",
    ...overrides,
  };
}

function requirement(
  overrides: Partial<HrReadinessRequirement> = {},
): HrReadinessRequirement {
  return {
    id: "req-test-1",
    agencyId: "agency-test",
    key: "cpr",
    label: "CPR certification",
    kind: "certificate",
    dueEveryDays: null,
    requiredRoleKeys: [],
    active: true,
    ...overrides,
  };
}

const EMPTY_EVIDENCE: ComplianceEvidence = {
  certs: [],
  trainings: [],
  delegations: [],
  docAcks: [],
};

const NOW = "2026-09-16T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("policy constants carry the documented values", () => {
  assert.equal(OVERTIME_WEEKLY_HOURS, 40);
  assert.equal(DUE_SOON_DAYS, 30);
  assert.equal(LATE_GRACE_MINUTES, 5);
  assert.equal(MISSED_PUNCH_GRACE_MINUTES, 15);
});

// ---------------------------------------------------------------------------
// pairPunches
// ---------------------------------------------------------------------------

test("pairPunches pairs each in with the next out, in minutes", () => {
  const segments = pairPunches([
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].staffId, "staff-test-1");
  assert.equal(segments[0].clockIn, "2026-09-14T08:00:00");
  assert.equal(segments[0].clockOut, "2026-09-14T16:00:00");
  assert.equal(segments[0].minutes, 480);
});

test("pairPunches handles an overnight shift as one 8-hour segment", () => {
  const segments = pairPunches([
    punch({ kind: "in", punchedAt: "2026-09-15T22:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-16T06:00:00" }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].minutes, 480);
});

test("pairPunches sorts by time even when input is shuffled", () => {
  const segments = pairPunches([
    punch({ kind: "out", punchedAt: "2026-09-14T12:00:00" }),
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].minutes, 240);
});

test("pairPunches leaves an open in with clockOut null and 0 minutes", () => {
  const segments = pairPunches([
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].clockOut, null);
  assert.equal(segments[0].minutes, 0);
});

test("pairPunches ignores an orphan out and never pairs across staff", () => {
  const segments = pairPunches([
    punch({ kind: "out", punchedAt: "2026-09-14T12:00:00", staffId: "staff-test-1" }),
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00", staffId: "staff-test-2" }),
  ]);
  // The out has no open in for staff-test-1; the in for staff-test-2 stays open.
  assert.equal(segments.length, 1);
  assert.equal(segments[0].staffId, "staff-test-2");
  assert.equal(segments[0].clockOut, null);
});

test("pairPunches pairs a split shift into two segments", () => {
  const segments = pairPunches([
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-14T12:00:00" }),
    punch({ kind: "in", punchedAt: "2026-09-14T13:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-14T17:00:00" }),
  ]);
  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map((s) => s.minutes),
    [240, 240],
  );
});

// ---------------------------------------------------------------------------
// dailyTotals / weeklyTotals
// ---------------------------------------------------------------------------

test("dailyTotals attributes a night shift to the clock-in date", () => {
  const totals = dailyTotals([
    punch({ kind: "in", punchedAt: "2026-09-15T22:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-16T06:00:00" }),
  ]);
  assert.deepEqual(totals, { "2026-09-15": 480 });
});

test("dailyTotals sums multiple days independently", () => {
  const totals = dailyTotals([
    punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
    punch({ kind: "in", punchedAt: "2026-09-15T08:00:00" }),
    punch({ kind: "out", punchedAt: "2026-09-15T12:00:00" }),
  ]);
  assert.deepEqual(totals, { "2026-09-14": 480, "2026-09-15": 240 });
});

test("dailyTotals with a timeZone converts UTC instants to the agency zone", () => {
  // 01:30 UTC is 20:30 the previous day in America/Chicago (CDT, UTC-5).
  const totals = dailyTotals(
    [
      punch({ kind: "in", punchedAt: "2026-09-16T01:30:00Z" }),
      punch({ kind: "out", punchedAt: "2026-09-16T09:30:00Z" }),
    ],
    "America/Chicago",
  );
  assert.deepEqual(totals, { "2026-09-15": 480 });
});

test("dailyTotals without a timeZone uses the date parts in the string", () => {
  const totals = dailyTotals([
    punch({ kind: "in", punchedAt: "2026-09-16T01:30:00Z" }),
    punch({ kind: "out", punchedAt: "2026-09-16T09:30:00Z" }),
  ]);
  assert.deepEqual(totals, { "2026-09-16": 480 });
});

test("weeklyTotals counts only the 7-day window starting on weekStart", () => {
  const punches: HrPunch[] = [];
  for (const day of ["14", "15", "16", "17", "18"]) {
    punches.push(punch({ kind: "in", punchedAt: `2026-09-${day}T08:00:00` }));
    punches.push(punch({ kind: "out", punchedAt: `2026-09-${day}T16:00:00` }));
  }
  // Next Monday's shift belongs to the following week.
  punches.push(punch({ kind: "in", punchedAt: "2026-09-21T08:00:00" }));
  punches.push(punch({ kind: "out", punchedAt: "2026-09-21T16:00:00" }));
  assert.equal(weeklyTotals(punches, "2026-09-14"), 2400);
  assert.equal(weeklyTotals(punches, "2026-09-21"), 480);
});

// ---------------------------------------------------------------------------
// summarizeTimecard
// ---------------------------------------------------------------------------

function fiveNineHourDays(): HrPunch[] {
  const punches: HrPunch[] = [];
  for (const day of ["14", "15", "16", "17", "18"]) {
    punches.push(punch({ kind: "in", punchedAt: `2026-09-${day}T08:00:00` }));
    punches.push(punch({ kind: "out", punchedAt: `2026-09-${day}T17:00:00` }));
  }
  return punches;
}

test("summarizeTimecard splits a 45-hour week into 40 regular + 5 overtime", () => {
  const summary = summarizeTimecard(fiveNineHourDays(), {
    unpaidBreakMinutesPerDay: 0,
  });
  assert.equal(summary.totalMinutes, 2700);
  assert.equal(summary.regularMinutes, 2400);
  assert.equal(summary.overtimeMinutes, 300);
});

test("summarizeTimecard deducts unpaid breaks per day worked", () => {
  const summary = summarizeTimecard(
    [
      punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
      punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
    ],
    { unpaidBreakMinutesPerDay: 30 },
  );
  assert.equal(summary.totalMinutes, 450);
  assert.equal(summary.regularMinutes, 450);
  assert.equal(summary.overtimeMinutes, 0);
});

test("summarizeTimecard never deducts a break below zero for a short day", () => {
  const summary = summarizeTimecard(
    [
      punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
      punch({ kind: "out", punchedAt: "2026-09-14T08:20:00" }),
    ],
    { unpaidBreakMinutesPerDay: 30 },
  );
  assert.equal(summary.totalMinutes, 0);
});

test("summarizeTimecard reports zero overtime for exactly 40 hours", () => {
  const punches: HrPunch[] = [];
  for (const day of ["14", "15", "16", "17", "18"]) {
    punches.push(punch({ kind: "in", punchedAt: `2026-09-${day}T08:00:00` }));
    punches.push(punch({ kind: "out", punchedAt: `2026-09-${day}T16:00:00` }));
  }
  const summary = summarizeTimecard(punches, { unpaidBreakMinutesPerDay: 0 });
  assert.equal(summary.totalMinutes, 2400);
  assert.equal(summary.overtimeMinutes, 0);
  assert.equal(summary.regularMinutes, 2400);
});

// ---------------------------------------------------------------------------
// Punch guards
// ---------------------------------------------------------------------------

test("validateClockIn throws on a double clock-in, passes after clock-out", () => {
  const open = [punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" })];
  assert.throws(
    () => validateClockIn(open, "2026-09-14T09:00:00"),
    /Already clocked in — clock out first\./,
  );
  const closed = [
    ...open,
    punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
  ];
  assert.doesNotThrow(() => validateClockIn(closed, "2026-09-14T17:00:00"));
  assert.doesNotThrow(() => validateClockIn([], "2026-09-14T08:00:00"));
});

test("validateClockIn ignores a future-dated in that is not an open session", () => {
  const future = [punch({ kind: "in", punchedAt: "2026-09-14T18:00:00" })];
  assert.doesNotThrow(() => validateClockIn(future, "2026-09-14T09:00:00"));
});

test("validateClockOut throws with no open in, passes with one", () => {
  assert.throws(() => validateClockOut([]), /No open clock-in to close\./);
  assert.throws(
    () =>
      validateClockOut([
        punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
        punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
      ]),
    /No open clock-in to close\./,
  );
  assert.doesNotThrow(() =>
    validateClockOut([punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" })]),
  );
});

// ---------------------------------------------------------------------------
// detectExceptions
// ---------------------------------------------------------------------------

function emptyInput(overrides: Partial<Parameters<typeof detectExceptions>[0]> = {}) {
  return {
    punches: [],
    shifts: [],
    timecardApprovals: [],
    payPeriods: [],
    nowIso: "2026-09-14T18:00:00",
    ...overrides,
  };
}

test("detectExceptions flags a missed punch once the 15-minute grace passes", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" })],
      nowIso: "2026-09-14T18:00:00", // shift ended 16:00, grace passed
    }),
  );
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].kind, "missed_punch");
  assert.equal(exceptions[0].staffId, "staff-test-1");
  assert.equal(exceptions[0].at, "2026-09-14T16:00:00");
});

test("detectExceptions does not flag a missed punch inside the grace window", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" })],
      nowIso: "2026-09-14T16:10:00", // 10 min after shift end: still grace
    }),
  );
  assert.deepEqual(exceptions, []);
});

test("detectExceptions flags a late clock-in past the 5-minute grace", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [
        punch({ kind: "in", punchedAt: "2026-09-14T08:07:00" }),
        punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
      ],
    }),
  );
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].kind, "late_clock_in");
  assert.equal(exceptions[0].at, "2026-09-14T08:07:00");
});

test("detectExceptions stays quiet for an on-time shift", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [
        punch({ kind: "in", punchedAt: "2026-09-14T08:03:00" }), // within grace
        punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
      ],
    }),
  );
  assert.deepEqual(exceptions, []);
});

test("detectExceptions flags an early clock-out before the grace window", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [
        punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
        punch({ kind: "out", punchedAt: "2026-09-14T15:50:00" }), // before 15:55
      ],
    }),
  );
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].kind, "early_clock_out");
  assert.equal(exceptions[0].at, "2026-09-14T15:50:00");
});

test("detectExceptions flags an overlapping second clock-in", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift({ startsAt: "2026-09-14T08:00:00", endsAt: "2026-09-14T20:00:00" })],
      punches: [
        punch({ kind: "in", punchedAt: "2026-09-14T08:00:00" }),
        punch({ kind: "in", punchedAt: "2026-09-14T13:00:00" }),
        punch({ kind: "out", punchedAt: "2026-09-14T17:00:00" }),
      ],
      nowIso: "2026-09-14T18:00:00",
    }),
  );
  const kinds = exceptions.map((e) => e.kind);
  assert.ok(kinds.includes("overlapping_punch"), `kinds: ${kinds}`);
  const overlap = exceptions.find((e) => e.kind === "overlapping_punch")!;
  assert.equal(overlap.at, "2026-09-14T13:00:00");
});

test("detectExceptions raises late AND missed for one bad open punch", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift()],
      punches: [punch({ kind: "in", punchedAt: "2026-09-14T08:10:00" })],
      nowIso: "2026-09-14T18:00:00",
    }),
  );
  assert.deepEqual(
    exceptions.map((e) => e.kind),
    ["late_clock_in", "missed_punch"],
  );
});

test("detectExceptions ignores draft and cancelled shifts", () => {
  for (const status of ["scheduled", "cancelled"] as const) {
    const exceptions = detectExceptions(
      emptyInput({
        shifts: [shift({ status })],
        punches: [
          punch({ kind: "in", punchedAt: "2026-09-14T09:00:00" }),
          punch({ kind: "out", punchedAt: "2026-09-14T15:00:00" }),
        ],
      }),
    );
    assert.deepEqual(exceptions, [], `status ${status} should not anchor exceptions`);
  }
});

test("detectExceptions matches an unassigned shift by site", () => {
  const exceptions = detectExceptions(
    emptyInput({
      shifts: [shift({ staffId: null })], // open shift at the same site
      punches: [
        punch({ kind: "in", punchedAt: "2026-09-14T08:07:00" }),
        punch({ kind: "out", punchedAt: "2026-09-14T16:00:00" }),
      ],
    }),
  );
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].kind, "late_clock_in");
});

function payPeriod(overrides: Partial<HrPayPeriod> = {}): HrPayPeriod {
  return {
    id: "period-test-1",
    agencyId: "agency-test",
    startsOn: "2026-09-01",
    endsOn: "2026-09-15",
    status: "locked",
    lockedBy: "manager-test-1",
    lockedAt: "2026-09-16T08:00:00",
    ...overrides,
  };
}

function approval(overrides: Partial<HrTimecardApproval> = {}): HrTimecardApproval {
  return {
    id: "approval-test-1",
    payPeriodId: "period-test-1",
    staffId: "staff-test-1",
    status: "submitted",
    submittedAt: "2026-09-15T18:00:00",
    decidedBy: null,
    decidedAt: null,
    note: null,
    ...overrides,
  };
}

test("detectExceptions flags unapproved timecards on locked/exported periods", () => {
  const locked = detectExceptions(
    emptyInput({ payPeriods: [payPeriod()], timecardApprovals: [approval()] }),
  );
  assert.equal(locked.length, 1);
  assert.equal(locked[0].kind, "timecard_unapproved_at_lock");
  assert.equal(locked[0].staffId, "staff-test-1");
  assert.equal(locked[0].at, "2026-09-16T08:00:00");

  const exported = detectExceptions(
    emptyInput({
      payPeriods: [payPeriod({ status: "exported" })],
      timecardApprovals: [approval({ status: "changes_requested" })],
    }),
  );
  assert.equal(exported.length, 1);
  assert.equal(exported[0].kind, "timecard_unapproved_at_lock");
});

test("detectExceptions stays quiet for open periods and approved timecards", () => {
  const openPeriod = detectExceptions(
    emptyInput({
      payPeriods: [payPeriod({ status: "open" })],
      timecardApprovals: [approval({ status: "pending" })],
    }),
  );
  assert.deepEqual(openPeriod, []);

  const approved = detectExceptions(
    emptyInput({
      payPeriods: [payPeriod()],
      timecardApprovals: [approval({ status: "approved" })],
    }),
  );
  assert.deepEqual(approved, []);
});

// ---------------------------------------------------------------------------
// rollupCompliance
// ---------------------------------------------------------------------------

test("rollupCompliance marks a far-future cert complete", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], {
    ...EMPTY_EVIDENCE,
    certs: [{ key: "cpr", name: "CPR Certification", expiresOn: "2026-11-15" }],
  }, NOW);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "complete");
  assert.ok(results[0].evidenceNote?.includes("CPR Certification"));
  assert.equal(results[0].dueOn, "2026-11-15");
});

test("rollupCompliance matches keys case-insensitively with contains-match", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [requirement({ key: "bls" })],
    {
      ...EMPTY_EVIDENCE,
      certs: [{ key: "bls-card", name: "BLS Provider Card", expiresOn: "2027-01-01" }],
    },
    NOW,
  );
  assert.equal(results[0].status, "complete");
});

test("rollupCompliance marks a soon-due training due_soon", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [requirement({ key: "hipaa", label: "HIPAA training", kind: "training" })],
    {
      ...EMPTY_EVIDENCE,
      trainings: [
        {
          key: "hipaa",
          label: "HIPAA training",
          completedOn: "2025-09-26",
          nextDueOn: "2026-09-26", // 10 days out
        },
      ],
    },
    NOW,
  );
  assert.equal(results[0].status, "due_soon");
  assert.equal(results[0].dueOn, "2026-09-26");
});

test("rollupCompliance marks missing evidence missing_or_expired", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], EMPTY_EVIDENCE, NOW);
  assert.equal(results[0].status, "missing_or_expired");
  assert.equal(results[0].evidenceNote, "No evidence on file");
  assert.equal(results[0].dueOn, null);
});

test("rollupCompliance marks an expired cert missing_or_expired, never due_soon", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], {
    ...EMPTY_EVIDENCE,
    certs: [{ key: "cpr", name: "CPR Certification", expiresOn: "2026-09-10" }],
  }, NOW);
  assert.equal(results[0].status, "missing_or_expired");
  assert.ok(results[0].evidenceNote?.includes("expired"));
});

test("rollupCompliance treats a due date exactly at now as expired", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], {
    ...EMPTY_EVIDENCE,
    certs: [{ key: "cpr", name: "CPR Certification", expiresOn: NOW }],
  }, NOW);
  assert.equal(results[0].status, "missing_or_expired");
});

test("rollupCompliance treats a due date exactly 30 days out as due_soon", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], {
    ...EMPTY_EVIDENCE,
    certs: [
      { key: "cpr", name: "CPR Certification", expiresOn: "2026-10-16T12:00:00.000Z" },
    ],
  }, NOW);
  assert.equal(results[0].status, "due_soon");
});

test("rollupCompliance filters out requirements scoped to other roles", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [
      requirement({ id: "req-nurse", key: "rn-license", requiredRoleKeys: ["nurse"] }),
      requirement({ id: "req-dsp", key: "cpr", requiredRoleKeys: ["dsp"] }),
      requirement({ id: "req-all", key: "handbook", kind: "document" }),
    ],
    EMPTY_EVIDENCE,
    NOW,
  );
  assert.deepEqual(
    results.map((r) => r.requirement.id),
    ["req-dsp", "req-all"],
  );
});

test("rollupCompliance derives next due from dueEveryDays when no nextDueOn", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [
      requirement({
        key: "annual-safety",
        label: "Annual safety training",
        kind: "training",
        dueEveryDays: 365,
      }),
    ],
    {
      ...EMPTY_EVIDENCE,
      trainings: [
        {
          key: "annual-safety",
          label: "Annual safety training",
          completedOn: "2025-10-10",
          nextDueOn: null,
        },
      ],
    },
    NOW,
  );
  assert.equal(results[0].status, "due_soon"); // 2026-10-10 is 24 days out
  assert.ok(results[0].dueOn?.startsWith("2026-10-10"));
});

test("rollupCompliance lets delegation training satisfy a training requirement", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [requirement({ key: "g-tube", label: "G-tube training", kind: "training" })],
    {
      ...EMPTY_EVIDENCE,
      delegations: [
        {
          key: "g-tube",
          label: "G-tube training",
          completedOn: "2026-01-10",
          nextDueOn: "2027-01-10",
        },
      ],
    },
    NOW,
  );
  assert.equal(results[0].status, "complete");
});

test("rollupCompliance marks an acknowledged document complete with no due date", () => {
  const results = rollupCompliance(
    "staff-test-1",
    "dsp",
    [requirement({ key: "handbook", label: "Handbook", kind: "document" })],
    { ...EMPTY_EVIDENCE, docAcks: [{ docKey: "handbook", ackedAt: "2026-08-01T10:00:00" }] },
    NOW,
  );
  assert.equal(results[0].status, "complete");
  assert.equal(results[0].dueOn, null);
});

test("rollupCompliance picks the latest evidence when several rows match", () => {
  const results = rollupCompliance("staff-test-1", "dsp", [requirement()], {
    ...EMPTY_EVIDENCE,
    certs: [
      { key: "cpr", name: "CPR Certification", expiresOn: "2026-09-10" }, // expired
      { key: "cpr", name: "CPR Certification", expiresOn: "2027-06-01" }, // current
    ],
  }, NOW);
  assert.equal(results[0].status, "complete");
  assert.equal(results[0].dueOn, "2027-06-01");
});

// ---------------------------------------------------------------------------
// buildPayrollCsvExport
// ---------------------------------------------------------------------------

function payrollRow(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    employeeId: "emp-test-1",
    employeeEmail: "test.staff@example.com",
    employeeName: "Test Staff",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    regularHours: 40,
    overtimeHours: 5,
    ptoHours: 8,
    sickHours: 0,
    totalHours: 53,
    ...overrides,
  };
}

test("buildPayrollCsvExport writes the exact header row", () => {
  const csv = buildPayrollCsvExport([]);
  assert.equal(
    csv,
    "employee_id,employee_email,employee_name,period_start,period_end,regular_hours,overtime_hours,pto_hours,sick_hours,total_hours",
  );
});

test("buildPayrollCsvExport serializes hour buckets with totals math intact", () => {
  const csv = buildPayrollCsvExport([payrollRow()]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[1],
    "emp-test-1,test.staff@example.com,Test Staff,2026-09-01,2026-09-15,40,5,8,0,53",
  );
});

test("buildPayrollCsvExport escapes commas and quotes in text fields", () => {
  const csv = buildPayrollCsvExport([
    payrollRow({ employeeName: 'Doe, "Test" Staff' }),
  ]);
  const line = csv.split("\n")[1];
  assert.ok(line.includes('"Doe, ""Test"" Staff"'), line);
});

test("buildPayrollCsvExport trims hour decimals instead of forcing .00", () => {
  const csv = buildPayrollCsvExport([
    payrollRow({ regularHours: 37.5, overtimeHours: 0, ptoHours: 0, totalHours: 37.5 }),
  ]);
  const line = csv.split("\n")[1];
  assert.ok(line.includes(",37.5,0,0,0,37.5"), line);
});

test("buildPayrollCsvExport carries summarizeTimecard hours end to end", () => {
  const summary = summarizeTimecard(fiveNineHourDays(), { unpaidBreakMinutesPerDay: 0 });
  const regularHours = summary.regularMinutes / 60;
  const overtimeHours = summary.overtimeMinutes / 60;
  const csv = buildPayrollCsvExport([
    payrollRow({
      regularHours,
      overtimeHours,
      ptoHours: 0,
      sickHours: 0,
      totalHours: regularHours + overtimeHours,
    }),
  ]);
  const line = csv.split("\n")[1];
  assert.ok(line.endsWith(",40,5,0,0,45"), line);
});

// ---------------------------------------------------------------------------
// hub.* permission defaults (repo convention: feature test asserts grants)
// ---------------------------------------------------------------------------

const HUB_KEYS = [
  "hub.access",
  "hub.manage_schedule",
  "hub.review_timecards",
  "hub.approve_time_off",
  "hub.view_team",
  "hub.approve_payroll",
  "hub.manage_documents",
] as const;

test("HR-HUB: all hub keys are declared with labels", () => {
  for (const key of HUB_KEYS) {
    assert.ok((PERMISSION_KEYS as readonly string[]).includes(key), key);
    assert.ok(PERMISSION_LABELS[key].length > 0, key);
  }
  assert.equal(PERMISSION_LABELS["hub.access"], "Open Employee Hub");
  assert.equal(
    PERMISSION_LABELS["hub.manage_schedule"],
    "Create and publish staff schedules",
  );
  assert.equal(
    PERMISSION_LABELS["hub.review_timecards"],
    "Review and correct staff timecards",
  );
  assert.equal(
    PERMISSION_LABELS["hub.approve_time_off"],
    "Approve or deny time-off requests",
  );
  assert.equal(PERMISSION_LABELS["hub.view_team"], "View team schedules and attendance");
  assert.equal(
    PERMISSION_LABELS["hub.approve_payroll"],
    "Lock pay periods and prepare payroll",
  );
  assert.equal(PERMISSION_LABELS["hub.manage_documents"], "Manage HR documents");
});

test("HR-HUB: hub.access defaults on for all 8 roles", () => {
  for (const role of [
    "administrator",
    "compliance_admin",
    "house_manager",
    "program_manager",
    "dsp",
    "nurse",
    "hr",
    "auditor",
  ]) {
    assert.equal(defaultPermissions(role)["hub.access"], true, role);
  }
});

test("HR-HUB: scheduling/timecard/time-off/team grants for managers only", () => {
  for (const key of [
    "hub.manage_schedule",
    "hub.review_timecards",
    "hub.approve_time_off",
    "hub.view_team",
  ] as const) {
    for (const role of ["administrator", "program_manager", "house_manager"]) {
      assert.equal(defaultPermissions(role)[key], true, `${role}.${key}`);
    }
    for (const role of ["compliance_admin", "dsp", "nurse", "hr", "auditor"]) {
      assert.equal(defaultPermissions(role)[key], false, `${role}.${key}`);
    }
  }
});

test("HR-HUB: payroll lock and HR documents for administrator/PM only", () => {
  for (const key of ["hub.approve_payroll", "hub.manage_documents"] as const) {
    assert.equal(defaultPermissions("administrator")[key], true);
    assert.equal(defaultPermissions("program_manager")[key], true);
    for (const role of [
      "compliance_admin",
      "house_manager",
      "dsp",
      "nurse",
      "hr",
      "auditor",
    ]) {
      assert.equal(defaultPermissions(role)[key], false, `${role}.${key}`);
    }
  }
});

test("HR-HUB: hasPermission honors hub keys from role templates", () => {
  assert.equal(hasPermission({ role: "dsp" }, "hub.access"), true);
  assert.equal(hasPermission({ role: "dsp" }, "hub.manage_schedule"), false);
  assert.equal(hasPermission({ role: "house_manager" }, "hub.manage_schedule"), true);
  assert.equal(
    hasPermission({ permissions: { "hub.approve_payroll": true } }, "hub.approve_payroll"),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* HR-STAFFING: recurring staffing patterns                            */
/* ------------------------------------------------------------------ */

import {
  computePatternWeeklyHours,
  expandStaffingPattern,
  formatWindowLabel,
  patternCoversDate,
  staffingWindowMinutes,
  validateStaffingPattern,
} from "./hr";

test("staffing: weekly hours from days x windows (CSS split-shift style)", () => {
  // Mon-Fri 7:30a-8:30a & 4:30p-5:30p = 2h/day x 5 = 10h
  const hours = computePatternWeeklyHours(
    [1, 2, 3, 4, 5],
    [
      { start: "07:30", end: "08:30" },
      { start: "16:30", end: "17:30" },
    ],
  );
  assert.equal(hours, 10);
});

test("staffing: overnight window spans midnight (11pm-7am = 8h)", () => {
  assert.equal(staffingWindowMinutes({ start: "23:00", end: "07:00" }), 480);
  // Sat & Sun overnight: 8h x 2 = 16h
  assert.equal(
    computePatternWeeklyHours([0, 6], [{ start: "23:00", end: "07:00" }]),
    16,
  );
});

test("staffing: overlapping windows fail validation", () => {
  const errors = validateStaffingPattern({
    staffId: "staff-1",
    days: [1, 2, 3],
    windows: [
      { start: "07:00", end: "15:00" },
      { start: "14:00", end: "22:00" },
    ],
    weeklyHours: 48,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.ok(errors.some((e) => /overlap/i.test(e)));
});

test("staffing: overnight vs evening windows that truly overlap are caught", () => {
  const errors = validateStaffingPattern({
    staffId: "staff-1",
    days: [4],
    windows: [
      { start: "22:00", end: "06:00" },
      { start: "04:00", end: "12:00" },
    ],
    weeklyHours: 16,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.ok(errors.some((e) => /overlap/i.test(e)));
});

test("staffing: adjacent windows (end == start) do not overlap", () => {
  const errors = validateStaffingPattern({
    staffId: "staff-1",
    days: [1],
    windows: [
      { start: "07:00", end: "15:00" },
      { start: "15:00", end: "23:00" },
    ],
    weeklyHours: 16,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.deepEqual(errors, []);
});

test("staffing: weekly-hours mismatch is flagged", () => {
  const errors = validateStaffingPattern({
    staffId: "staff-1",
    days: [1, 2, 3, 4, 5],
    windows: [{ start: "09:00", end: "17:00" }],
    weeklyHours: 20, // should be 40
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.ok(errors.some((e) => /40/.test(e)));
});

test("staffing: bad time format and zero-length window rejected", () => {
  const errors = validateStaffingPattern({
    staffId: "staff-1",
    days: [1],
    windows: [{ start: "9am", end: "5pm" }],
    weeklyHours: 0,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.ok(errors.some((e) => /HH:MM/.test(e)));
  const zero = validateStaffingPattern({
    staffId: "staff-1",
    days: [1],
    windows: [{ start: "09:00", end: "09:00" }],
    weeklyHours: 0,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  });
  assert.ok(zero.some((e) => /same time/.test(e)));
});

test("staffing: effective-date window respected", () => {
  const pattern = {
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-30",
    active: true,
  };
  assert.equal(patternCoversDate(pattern, "2026-09-15"), true);
  assert.equal(patternCoversDate(pattern, "2026-10-01"), false);
  assert.equal(patternCoversDate({ ...pattern, active: false }, "2026-09-15"), false);
});

test("staffing: expand pattern into occurrences for a week", () => {
  const occ = expandStaffingPattern(
    {
      days: [1, 3, 5],
      windows: [{ start: "07:30", end: "08:30" }],
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      active: true,
    },
    "2026-09-14",
    "2026-09-20",
  );
  assert.deepEqual(
    occ.map((o) => o.date),
    ["2026-09-14", "2026-09-16", "2026-09-18"],
  );
  assert.equal(occ[0].dayOfWeek, 1);
});

test("staffing: window label formats like the spreadsheet pills", () => {
  assert.equal(formatWindowLabel({ start: "07:30", end: "08:30" }), "7:30a\u20138:30a");
  assert.equal(formatWindowLabel({ start: "16:30", end: "17:30" }), "4:30p\u20135:30p");
  assert.equal(formatWindowLabel({ start: "23:00", end: "07:00" }), "11:00p\u20137:00a");
});

test("staffing: hub.manage_staffing permission gating per role", () => {
  assert.ok(PERMISSION_KEYS.includes("hub.manage_staffing"));
  assert.ok(PERMISSION_LABELS["hub.manage_staffing"].length > 0);
  for (const role of ["administrator", "program_manager", "hr", "house_manager"]) {
    assert.equal(
      hasPermission({ role }, "hub.manage_staffing"),
      true,
      `${role} can configure staffing`,
    );
  }
  for (const role of ["compliance_admin", "dsp", "nurse", "auditor"]) {
    assert.equal(
      hasPermission({ role }, "hub.manage_staffing"),
      false,
      `${role} is read-only`,
    );
    assert.equal(hasPermission({ role }, "hub.access"), true, `${role} can view`);
  }
  // Explicit session permissions win over the role default.
  assert.equal(
    hasPermission(
      { role: "dsp", permissions: { hub: true, "hub.manage_staffing": true } as never },
      "hub.manage_staffing",
    ),
    true,
  );
});
