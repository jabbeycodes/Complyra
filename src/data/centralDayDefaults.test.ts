import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { todayIso } from "./chart";
import { centralTodayIso } from "./menuRecords";
import { monthStart, thirtyDayRange } from "./appointments";
import { daysRemaining } from "./certificates";
import { overdueCare, screeningStatus, validateScreening } from "./careScreening";
import { isImmunizationOverdue, lowFluidDays } from "./healthTrack";
import {
  deriveCorrectiveActionStatus,
  isCorrectiveActionOverdue,
} from "./correctiveActions";
import { deriveGerResolutionDisplay } from "./ger";
import { buildTimeline, type TimelineFacts } from "./deadlineTimeline";
import { CHECK_RULES, type ReadinessEvidence } from "./auditReadiness";
import { weekOfSundayIso } from "./hmChecklist";
import { monthKeyFrom } from "./monthlyChecks";

/**
 * Wave 7Q — the UTC-day class, user-facing defaults. Every "today" a user
 * sees (a form default, a calendar's opening day, a due/overdue judgment, a
 * list filter) is the agency's America/Chicago day, never the UTC day.
 * The split opens every evening: at 19:30 CST the UTC clock is already
 * tomorrow. These pins run at exactly that instant —
 *   A: 2026-11-02T01:30Z = Sun Nov 1, 19:30 CST (Central Nov 1, UTC Nov 2)
 *   B: 2026-11-01T01:30Z = Sat Oct 31, 19:30 CST (Central Oct 31, UTC Nov 1)
 * Each assertion names the surface whose derivation it pins. Form-default
 * surfaces whose whole default is `centralTodayIso()` verbatim (GER event
 * date, health-track occurred-on, performance review/action dates, the
 * add-Individual enrolled-on date, alone-time on-date, appointment
 * starts-on, mileage trip date, the reports "to" date) are pinned by the
 * first test plus the per-surface derivations below.
 */
const EVENING_A = "2026-11-02T01:30:00.000Z";
const EVENING_B = "2026-11-01T01:30:00.000Z";

function withMockedNow(iso: string, fn: () => void) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    fn();
  } finally {
    mock.timers.reset();
  }
}

test("7Q: at 19:30 CST the UTC day is already tomorrow; the Central day is not", () => {
  withMockedNow(EVENING_A, () => {
    assert.equal(todayIso(), "2026-11-02", "the old UTC derivation");
    assert.equal(centralTodayIso(), "2026-11-01", "the agency day every surface now uses");
  });
});

test("7Q: Appointments opens on the Central day (batch 93: it opened on Nov 2)", () => {
  withMockedNow(EVENING_A, () => {
    // The page's exact derivations: the 30-day range behind the From/To
    // defaults, the calendar month, and the highlighted selected day.
    assert.deepEqual(thirtyDayRange(centralTodayIso()), {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    assert.equal(monthStart(centralTodayIso()), "2026-11-01");
    assert.equal(thirtyDayRange(todayIso()).from, "2026-11-02", "the batch-93 defect, for contrast");
  });
});

test("7Q: certificate countdowns judge expiry on the Central day", () => {
  withMockedNow(EVENING_A, () => {
    // daysRemaining's default today also backs the certificate bell events.
    assert.equal(daysRemaining("2026-11-02"), 1);
    assert.equal(daysRemaining("2026-11-01"), 0, "expires today Central: not yet expired");
  });
});

test("7Q: care screening status, overdue and future-date checks use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    const screening = {
      type_id: "x",
      last_completed_on: null,
      due_on: "2026-11-01",
      completed_on: null,
      result_note: "",
      follow_up: "",
    };
    assert.equal(
      screeningStatus(screening, { due_soon_days: 7 }),
      "due soon",
      "due today Central is not overdue (the UTC day called it overdue)",
    );
    const plan = {
      status: "active",
      items: [{ review_on: "2026-11-01" }],
    } as unknown as Parameters<typeof overdueCare>[0];
    assert.equal(overdueCare(plan), false, "a review dated today Central is not overdue care");
    assert.throws(
      () =>
        validateScreening({
          ...screening,
          completed_on: "2026-11-02",
          result_note: "Recorded.",
        }),
      /cannot be in the future/,
      "Nov 2 is still the future at 19:30 CST on Nov 1",
    );
  });
});

test("7Q: health-track finished-day and immunization judgments use the Central day", () => {
  const evening = new Date(EVENING_A);
  assert.equal(
    isImmunizationOverdue(
      {
        kind: "immunization",
        occurredOn: "2026-10-01",
        details: { vaccineName: "Flu", nextDueOn: "2026-11-01" },
      },
      [],
      evening,
    ),
    false,
    "due today Central is not yet overdue (the UTC day called it overdue)",
  );
  withMockedNow(EVENING_A, () => {
    const entries = [
      { kind: "intake" as const, occurredOn: "2026-11-01", details: { entryType: "fluid", fluidOz: "4" } },
      { kind: "intake" as const, occurredOn: "2026-10-31", details: { entryType: "fluid", fluidOz: "4" } },
    ];
    assert.deepEqual(
      lowFluidDays(entries),
      [{ date: "2026-10-31", fluidOz: 4 }],
      "today Central (Nov 1) is not a finished day yet; Oct 31 is",
    );
  });
});

test("7Q: corrective-action and GER overdue judgments use the Central day", () => {
  const evening = new Date(EVENING_A);
  const action = { storedStatus: "open" as const, dueOn: "2026-11-01" };
  assert.equal(deriveCorrectiveActionStatus(action, evening), "open");
  assert.equal(isCorrectiveActionOverdue(action, evening), false);
  assert.equal(
    deriveCorrectiveActionStatus({ storedStatus: "open", dueOn: "2026-10-31" }, evening),
    "overdue",
    "a genuinely past due date still derives overdue",
  );
  const report = {
    status: "submitted" as const,
    resolutionStatus: "unaddressed" as const,
    resolutionDueOn: "2026-11-01",
  };
  assert.equal(deriveGerResolutionDisplay(report, evening), "unaddressed");
  assert.equal(
    deriveGerResolutionDisplay({ ...report, resolutionDueOn: "2026-10-31" }, evening),
    "overdue",
  );
});

test("7Q: the deadline timeline's 'today' urgency uses the Central day", () => {
  const facts: TimelineFacts = {
    now: new Date(EVENING_A),
    certificates: [
      { id: "c1", userId: "u1", staffName: "Sam Staff", kind: "CPR", expiresOn: "2026-11-01" },
    ],
    trainings: [],
    planRenewals: [],
    checklists: [],
    medications: [],
    correctiveActions: [],
    providerRecertification: null,
  };
  const items = buildTimeline(facts);
  const cert = items.find((item) => item.kind === "certificate");
  assert.ok(cert);
  assert.equal(cert.daysRemaining, 0);
  assert.equal(cert.urgency, "today", "expiring today Central is 'today', not 'overdue'");
});

test("7Q: Audit Me readiness rules judge ages and windows on the Central day", () => {
  const evening = new Date(EVENING_A);
  const trainingEvidence = {
    staffTraining: [{ name: "Sam Staff", abuseNeglectOn: "2025-11-01", hireDate: null }],
  } as unknown as ReadinessEvidence;
  assert.equal(
    CHECK_RULES.abuseNeglectTrainingCurrent(trainingEvidence, evening).status,
    "met",
    "365 days old at the Central day is current; the UTC day aged it to 366",
  );
  const pocEvidence = {
    pocSurveyExitOn: "2026-05-05",
    pocSubmittedOn: "2026-06-01",
    pocFinalCorrectionOn: null,
  } as unknown as ReadinessEvidence;
  assert.equal(
    CHECK_RULES.planOfCorrectionOnTrack(pocEvidence, evening).status,
    "at-risk",
    "180 days since exit at the Central day is inside the window; the UTC day made it 181 and unmet",
  );
});

test("7Q: the checklist week and month filters open on the Central week/month", () => {
  withMockedNow(EVENING_B, () => {
    // ChecklistAssigner's current-week derivation (week of the Central day).
    assert.equal(weekOfSundayIso(centralTodayIso()), "2026-10-25");
    assert.equal(weekOfSundayIso(todayIso()), "2026-11-01", "the UTC week, for contrast");
    // The month key behind the mileage / reports / monthly-checks defaults.
    assert.equal(monthKeyFrom(centralTodayIso()), "2026-10");
    assert.equal(monthKeyFrom(todayIso()), "2026-11", "the UTC month, for contrast");
  });
});
