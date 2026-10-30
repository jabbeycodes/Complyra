/**
 * performanceStore.test.ts — local-store flows for performance reviews +
 * corrective actions on HrStore (src/data/hrStore.ts): filing, the
 * acknowledgment state machines, the one-response rule, outcomes, the
 * supersede chain, and the Evergreen demo seed. Local impl only; the
 * hosted impl is a thin mapper over hr_performance_reviews /
 * hr_staff_corrective_actions (RLS covered by
 * supabase/tests/performance_records.sql).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHrStore, type HrStore } from "./hrStore";
import { AGENCY_ID as EVERGREEN_AGENCY_ID } from "./seed";

const AGENCY = "agency-performance-test";
const MANAGER = "manager-1";
const SUBJECT = "staff-1";

function managerStore(): HrStore {
  return createHrStore({ agencyId: AGENCY, userId: MANAGER });
}

async function fileReview(store: HrStore) {
  return store.filePerformanceReview({
    staffId: SUBJECT,
    reviewDate: "2026-10-20",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    reviewerName: "Pat Manager",
    rating: "Meets expectations",
    strengths: "Reliable.",
    growthAreas: "Documentation timing.",
    goals: "Same-shift notes.",
  });
}

async function fileAction(store: HrStore) {
  return store.fileStaffCorrectiveAction({
    staffId: SUBJECT,
    actionDate: "2026-10-20",
    issuerName: "Pat Manager",
    level: "Written warning",
    description: "Late notes.",
    expectations: "Notes before shift end.",
    followUpDate: "2026-11-20",
  });
}

describe("performance reviews", () => {
  test("filing stamps the reviewer and starts in the filed state", async () => {
    const store = managerStore();
    const review = await fileReview(store);
    assert.equal(review.reviewerId, MANAGER);
    assert.equal(review.state, "filed");
    assert.equal(review.ackSignatureName, null);
    const listed = await store.listPerformanceReviews(SUBJECT);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, review.id);
    assert.deepEqual(await store.listPerformanceReviews("someone-else"), []);
  });

  test("acknowledgment is one-way; the response note lands exactly once", async () => {
    const store = managerStore();
    const review = await fileReview(store);
    await assert.rejects(
      () => store.addPerformanceReviewResponse(review.id, "Too soon."),
      /Acknowledge the review/,
    );
    const acked = await store.acknowledgePerformanceReview(review.id, "Sam Staffer");
    assert.equal(acked.state, "acknowledged");
    assert.equal(acked.ackSignatureName, "Sam Staffer");
    assert.ok(acked.ackAt);
    await assert.rejects(
      () => store.acknowledgePerformanceReview(review.id, "Sam Staffer"),
      /already been acknowledged/,
    );
    const withResponse = await store.addPerformanceReviewResponse(review.id, "Agreed — working on it.");
    assert.equal(withResponse.responseNote, "Agreed — working on it.");
    assert.ok(withResponse.responseAt);
    await assert.rejects(
      () => store.addPerformanceReviewResponse(review.id, "A second note."),
      /already been added/,
    );
    // Content never moved.
    const [final] = await store.listPerformanceReviews(SUBJECT);
    assert.equal(final.strengths, "Reliable.");
    assert.equal(final.rating, "Meets expectations");
  });

  test("a correction supersedes: the new review points at the old one", async () => {
    const store = managerStore();
    const first = await fileReview(store);
    const correction = await store.filePerformanceReview({
      staffId: SUBJECT,
      reviewDate: "2026-10-22",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      reviewerName: "Pat Manager",
      rating: "Developing",
      strengths: "Reliable.",
      growthAreas: "Documentation timing — corrected rating.",
      goals: "Same-shift notes.",
      supersedesId: first.id,
    });
    assert.equal(correction.supersedesId, first.id);
    const listed = await store.listPerformanceReviews(SUBJECT);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, correction.id); // newest first
  });
});

describe("corrective actions", () => {
  test("filing starts pending + open; signing is terminal", async () => {
    const store = managerStore();
    const action = await fileAction(store);
    assert.equal(action.issuerId, MANAGER);
    assert.equal(action.ackState, "pending");
    assert.equal(action.outcome, "open");
    const signed = await store.acknowledgeStaffCorrectiveAction(action.id, {
      kind: "signed",
      signatureName: "Sam Staffer",
    });
    assert.equal(signed.ackState, "signed");
    assert.equal(signed.ackSignatureName, "Sam Staffer");
    assert.equal(signed.witnessName, null);
    await assert.rejects(
      () =>
        store.acknowledgeStaffCorrectiveAction(action.id, {
          kind: "declined",
          witnessName: "Witness",
        }),
      /already been acknowledged/,
    );
  });

  test("declining to sign records the witness instead of a signature", async () => {
    const store = managerStore();
    const action = await fileAction(store);
    const declined = await store.acknowledgeStaffCorrectiveAction(action.id, {
      kind: "declined",
      witnessName: "Alex Morgan",
    });
    assert.equal(declined.ackState, "declined");
    assert.equal(declined.witnessName, "Alex Morgan");
    assert.equal(declined.ackSignatureName, null);
    assert.ok(declined.ackAt);
  });

  test("outcomes move with a dated note; content stays frozen", async () => {
    const store = managerStore();
    const action = await fileAction(store);
    const resolved = await store.setStaffCorrectiveActionOutcome(
      action.id,
      "resolved",
      "Four clean weeks of same-shift documentation.",
      "Pat Manager",
    );
    assert.equal(resolved.outcome, "resolved");
    assert.equal(resolved.outcomeByName, "Pat Manager");
    assert.ok(resolved.outcomeAt);
    assert.equal(resolved.description, "Late notes.");
    await assert.rejects(
      () => store.setStaffCorrectiveActionOutcome(action.id, "extended", " ", "Pat Manager"),
      /note/,
    );
  });
});

/* The Evergreen demo seed (ids from hrStore's DEMO_STAFF_IDS). */
const DEMO = {
  sarah: "00000000-0000-4000-8000-000000000201",
  james: "00000000-0000-4000-8000-000000000202",
  taylor: "00000000-0000-4000-8000-000000000204",
  jordan: "00000000-0000-4000-8000-000000000205",
  casey: "00000000-0000-4000-8000-000000000206",
} as const;

describe("Evergreen demo seed", () => {
  test("Jordan's review awaits him; Casey's carries his response; Taylor's warning is open", async () => {
    const jamesStore = createHrStore({ agencyId: EVERGREEN_AGENCY_ID, userId: DEMO.james });

    const jordanReviews = await jamesStore.listPerformanceReviews(DEMO.jordan);
    assert.equal(jordanReviews.length, 1);
    assert.equal(jordanReviews[0].state, "filed");
    assert.equal(jordanReviews[0].reviewerName, "James Wilson");

    const caseyReviews = await jamesStore.listPerformanceReviews(DEMO.casey);
    assert.equal(caseyReviews.length, 1);
    assert.equal(caseyReviews[0].rating, "Meets expectations");
    assert.equal(caseyReviews[0].state, "acknowledged");
    assert.ok(caseyReviews[0].responseNote?.includes("two-person count"));

    const taylorActions = await jamesStore.listStaffCorrectiveActions(DEMO.taylor);
    assert.equal(taylorActions.length, 1);
    assert.equal(taylorActions[0].level, "Written warning");
    assert.equal(taylorActions[0].issuerName, "Sarah Mitchell");
    assert.equal(taylorActions[0].ackState, "signed");
    assert.equal(taylorActions[0].outcome, "open");
    assert.ok(taylorActions[0].followUpDate);
  });

  test("Jordan can acknowledge his seeded review from his own store", async () => {
    const jordanStore = createHrStore({ agencyId: EVERGREEN_AGENCY_ID, userId: DEMO.jordan });
    const [review] = await jordanStore.listPerformanceReviews(DEMO.jordan);
    const acked = await jordanStore.acknowledgePerformanceReview(review.id, "Jordan Lee");
    assert.equal(acked.state, "acknowledged");
  });
});
