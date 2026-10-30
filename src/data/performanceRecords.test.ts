/**
 * performanceRecords.test.ts — pure domain tests for performance reviews
 * + corrective actions (src/data/performanceRecords.ts): validation,
 * the visibility/filing gate matrix, the merged timeline, and the
 * binder summary.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canFilePerformanceRecords,
  canSetCorrectiveActionOutcome,
  canViewPerformanceRecords,
  performanceTimeline,
  summarizePerformanceRecords,
  validateCorrectiveActionAck,
  validatePerformanceReviewInput,
  validateStaffCorrectiveActionInput,
  type PerformanceReview,
  type PerformanceReviewInput,
  type PerformanceViewer,
  type StaffCorrectiveAction,
  type StaffCorrectiveActionInput,
} from "./performanceRecords";

const CEDAR = "site-cedar";
const WILLOW = "site-willow";

function viewer(overrides: Partial<PerformanceViewer> = {}): PerformanceViewer {
  return {
    userId: "user-1",
    roleKey: "dsp",
    siteId: CEDAR,
    canViewTeam: false,
    ...overrides,
  };
}

const subject = { userId: "user-2", siteId: CEDAR };
const otherHomeSubject = { userId: "user-3", siteId: WILLOW };
const noHomeSubject = { userId: "user-4", siteId: null };

function reviewInput(
  overrides: Partial<PerformanceReviewInput> = {},
): PerformanceReviewInput {
  return {
    staffId: "user-2",
    reviewDate: "2026-10-20",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    reviewerName: "James Wilson",
    rating: "Meets expectations",
    strengths: "Reliable.",
    growthAreas: "Documentation timing.",
    goals: "Same-shift notes.",
    ...overrides,
  };
}

function actionInput(
  overrides: Partial<StaffCorrectiveActionInput> = {},
): StaffCorrectiveActionInput {
  return {
    staffId: "user-2",
    actionDate: "2026-10-20",
    issuerName: "Sarah Mitchell",
    level: "Written warning",
    description: "Late notes.",
    expectations: "Notes before shift end.",
    followUpDate: "2026-11-20",
    ...overrides,
  };
}

function reviewRow(overrides: Partial<PerformanceReview> = {}): PerformanceReview {
  return {
    id: "review-1",
    agencyId: "agency-1",
    staffId: "user-2",
    reviewDate: "2026-10-20",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    reviewerId: "user-9",
    reviewerName: "James Wilson",
    rating: "Meets expectations",
    strengths: "Reliable.",
    growthAreas: "Documentation timing.",
    goals: "Same-shift notes.",
    state: "filed",
    ackSignatureName: null,
    ackAt: null,
    responseNote: null,
    responseAt: null,
    supersedesId: null,
    createdAt: "2026-10-20T14:00:00.000Z",
    updatedAt: "2026-10-20T14:00:00.000Z",
    ...overrides,
  };
}

function actionRow(
  overrides: Partial<StaffCorrectiveAction> = {},
): StaffCorrectiveAction {
  return {
    id: "action-1",
    agencyId: "agency-1",
    staffId: "user-2",
    actionDate: "2026-10-10",
    issuerId: "user-8",
    issuerName: "Sarah Mitchell",
    level: "Written warning",
    description: "Late notes.",
    expectations: "Notes before shift end.",
    followUpDate: "2026-11-10",
    ackState: "pending",
    ackSignatureName: null,
    ackAt: null,
    witnessName: null,
    outcome: "open",
    outcomeNote: null,
    outcomeAt: null,
    outcomeByName: null,
    supersedesId: null,
    createdAt: "2026-10-10T14:00:00.000Z",
    updatedAt: "2026-10-10T14:00:00.000Z",
    ...overrides,
  };
}

describe("validation", () => {
  test("a complete review input passes; each gap names itself", () => {
    validatePerformanceReviewInput(reviewInput());
    assert.throws(() => validatePerformanceReviewInput(reviewInput({ rating: "Great" as never })), /rating/);
    assert.throws(() => validatePerformanceReviewInput(reviewInput({ strengths: " " })), /strengths/);
    assert.throws(() => validatePerformanceReviewInput(reviewInput({ growthAreas: "" })), /growth/);
    assert.throws(() => validatePerformanceReviewInput(reviewInput({ goals: "" })), /goals/);
    assert.throws(() => validatePerformanceReviewInput(reviewInput({ reviewDate: "10/20/2026" })), /review date/);
    assert.throws(
      () => validatePerformanceReviewInput(reviewInput({ periodStart: "2026-10-01", periodEnd: "2026-09-01" })),
      /ends before it starts/,
    );
  });

  test("a PIP needs a follow-up date; other levels do not", () => {
    validateStaffCorrectiveActionInput(actionInput());
    validateStaffCorrectiveActionInput(actionInput({ level: "Verbal warning", followUpDate: null }));
    assert.throws(
      () => validateStaffCorrectiveActionInput(actionInput({ level: "Performance improvement plan", followUpDate: null })),
      /follow-up date/,
    );
    assert.throws(() => validateStaffCorrectiveActionInput(actionInput({ description: "" })), /what happened/);
    assert.throws(() => validateStaffCorrectiveActionInput(actionInput({ expectations: "" })), /must change/);
  });

  test("acknowledgment: a signature, or a decline with a witness", () => {
    validateCorrectiveActionAck({ kind: "signed", signatureName: "Taylor Reed" });
    validateCorrectiveActionAck({ kind: "declined", witnessName: "Alex Morgan" });
    assert.throws(() => validateCorrectiveActionAck({ kind: "signed", signatureName: " " }), /full name/);
    assert.throws(() => validateCorrectiveActionAck({ kind: "declined", witnessName: "" }), /witness/);
  });
});

describe("visibility gates", () => {
  test("the subject always sees their own file; a peer never does", () => {
    assert.equal(canViewPerformanceRecords(viewer({ userId: "user-2" }), subject), true);
    assert.equal(canViewPerformanceRecords(viewer(), subject), false);
    // A peer with the team permission still needs the chain (site scope).
    assert.equal(
      canViewPerformanceRecords(viewer({ canViewTeam: true, roleKey: "dsp" }), subject),
      true, // same home + hub.view_team = the chain rule the hub uses
    );
    assert.equal(
      canViewPerformanceRecords(viewer({ canViewTeam: true, roleKey: "dsp" }), otherHomeSubject),
      false,
    );
  });

  test("HR, administrators, and auditors read agency-wide", () => {
    for (const roleKey of ["hr", "administrator", "auditor"]) {
      assert.equal(canViewPerformanceRecords(viewer({ roleKey, siteId: null }), otherHomeSubject), true, roleKey);
    }
  });

  test("house managers are scoped to their home; program managers are not", () => {
    const hm = viewer({ roleKey: "house_manager", canViewTeam: true });
    assert.equal(canViewPerformanceRecords(hm, subject), true);
    assert.equal(canViewPerformanceRecords(hm, otherHomeSubject), false);
    assert.equal(canViewPerformanceRecords(hm, noHomeSubject), false);
    const pm = viewer({ roleKey: "program_manager", canViewTeam: true, siteId: null });
    assert.equal(canViewPerformanceRecords(pm, otherHomeSubject), true);
    // Without hub.view_team, neither manager role reaches the file.
    assert.equal(canViewPerformanceRecords(viewer({ roleKey: "house_manager" }), subject), false);
    assert.equal(canViewPerformanceRecords(viewer({ roleKey: "program_manager", siteId: null }), subject), false);
  });
});

describe("filing gates", () => {
  test("nobody files on themselves; auditors never file", () => {
    assert.equal(canFilePerformanceRecords(viewer({ userId: "user-2", roleKey: "hr", siteId: null }), subject), false);
    assert.equal(canFilePerformanceRecords(viewer({ roleKey: "auditor", siteId: null }), subject), false);
  });

  test("HR/admin file anywhere; the chain files only in its scope", () => {
    assert.equal(canFilePerformanceRecords(viewer({ roleKey: "hr", siteId: null }), otherHomeSubject), true);
    const hm = viewer({ roleKey: "house_manager", canViewTeam: true });
    assert.equal(canFilePerformanceRecords(hm, subject), true);
    assert.equal(canFilePerformanceRecords(hm, otherHomeSubject), false);
    assert.equal(canFilePerformanceRecords(viewer({ canViewTeam: true }), otherHomeSubject), false);
  });

  test("outcomes belong to the issuer or HR/admin", () => {
    const action = actionRow();
    assert.equal(canSetCorrectiveActionOutcome(viewer({ userId: "user-8" }), action), true);
    assert.equal(canSetCorrectiveActionOutcome(viewer({ roleKey: "hr", siteId: null }), action), true);
    assert.equal(canSetCorrectiveActionOutcome(viewer({ roleKey: "administrator", siteId: null }), action), true);
    assert.equal(canSetCorrectiveActionOutcome(viewer({ roleKey: "house_manager", canViewTeam: true }), action), false);
    assert.equal(canSetCorrectiveActionOutcome(viewer({ roleKey: "auditor", siteId: null }), action), false);
  });
});

describe("timeline + summary", () => {
  test("reviews and actions interleave newest-first", () => {
    const entries = performanceTimeline(
      [reviewRow({ id: "r-old", reviewDate: "2026-04-01" }), reviewRow({ id: "r-new", reviewDate: "2026-10-20" })],
      [actionRow({ id: "a-mid", actionDate: "2026-07-15" })],
    );
    assert.deepEqual(
      entries.map((e) => (e.kind === "review" ? e.review.id : e.action.id)),
      ["r-new", "a-mid", "r-old"],
    );
  });

  test("the summary counts records and takes the latest dates", () => {
    const summary = summarizePerformanceRecords(
      [reviewRow({ reviewDate: "2026-04-01" }), reviewRow({ id: "r2", reviewDate: "2026-10-20" })],
      [actionRow({ actionDate: "2026-07-15" })],
    );
    assert.deepEqual(summary, {
      reviewCount: 2,
      latestReviewOn: "2026-10-20",
      actionCount: 1,
      latestActionOn: "2026-07-15",
    });
    assert.deepEqual(summarizePerformanceRecords([], []), {
      reviewCount: 0,
      latestReviewOn: null,
      actionCount: 0,
      latestActionOn: null,
    });
  });
});
