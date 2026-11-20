import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementStatus, todayStamp } from "./status";
import { delegationReviewState, type DelegationForm } from "./types";
import { delegationStatusForObligation } from "./delegationStatus";
import { isObligationActive, renewalStatus, type ObligationItem } from "./planStack";
import { activeIspProgram } from "./shiftNotes";
import { resolveRequirementStatus, validateTrainingLineInput } from "../features/training/gate";
import { validateOpenShiftInput } from "./openShifts";
import { findMissing, type MissingInput } from "./missingRequirements";
import { currentPlanYear } from "../features/isp/useIspData";

/**
 * Central-day defaults wave — the remaining "today" derivations. Every
 * default below used to read the UTC day (`toISOString().slice(0, 10)`)
 * or the device-local day; each now reads the agency's America/Chicago
 * day. The pins run at the evening split —
 *   A: 2026-11-02T01:30Z = Sun Nov 1, 19:30 CST (Central Nov 1, UTC Nov 2)
 * when the old derivations already called it Nov 2.
 */
const EVENING_A = "2026-11-02T01:30:00.000Z";

function withMockedNow(iso: string, fn: () => void) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    fn();
  } finally {
    mock.timers.reset();
  }
}

test("wave: todayStamp is the Central day, not the device-local day", () => {
  assert.equal(todayStamp(new Date(EVENING_A)), "2026-11-01");
  withMockedNow(EVENING_A, () => {
    assert.equal(todayStamp(), "2026-11-01");
  });
});

test("wave: requirement status judges due dates on the Central day", () => {
  const evening = new Date(EVENING_A);
  assert.equal(computeRequirementStatus("2026-11-01", "Training", evening), "Due soon");
  assert.equal(computeRequirementStatus("2026-10-31", "Training", evening), "Overdue");
});

test("wave: delegation review + obligation expiry use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    const form = { reviewDate: "2026-11-01" } as unknown as DelegationForm;
    assert.deepEqual(delegationReviewState(form), {
      label: "Review due today",
      overdue: false,
      dueSoon: true,
    });
    const item = {
      delegationForm: null,
      expiresOn: "2026-11-01",
      discontinuedAt: null,
      enabled: true,
      rnSignedAt: "2026-10-01",
    } as unknown as Parameters<typeof delegationStatusForObligation>[0];
    assert.equal(
      delegationStatusForObligation(item, { delegationsExpire: true }),
      "active",
      "expiring today Central is still in effect (the UTC day called it expired)",
    );
    const obligation = {
      enabled: true,
      kind: "protocol",
      expiresOn: "2026-11-01",
    } as unknown as ObligationItem;
    assert.equal(isObligationActive(obligation), true);
    assert.equal(
      isObligationActive({ ...obligation, expiresOn: "2026-10-31" }),
      false,
      "a genuinely past expiry still deactivates",
    );
  });
});

test("wave: renewal status and ISP program coverage use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    assert.equal(renewalStatus("2026-11-01"), "due_soon");
    assert.equal(renewalStatus("2026-10-31"), "overdue");
    const program = {
      individualId: "p1",
      planYear: "2026",
      status: "approved",
      effectiveOn: "2026-10-01",
      expiresOn: "2026-11-01",
    };
    assert.equal(
      activeIspProgram(
        [program] as unknown as Parameters<typeof activeIspProgram>[0],
        "p1",
        "2026",
      )?.expiresOn,
      "2026-11-01",
      "a program expiring today Central still covers today",
    );
  });
});

test("wave: training sign-off validation and line status use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    const ok = validateTrainingLineInput({
      initials: "AB",
      trainerUserId: "u1",
      signedOn: "2026-11-01",
    });
    assert.equal(ok.signedOn, "2026-11-01", "signed today Central is not 'in the future'");
    assert.throws(
      () =>
        validateTrainingLineInput({
          initials: "AB",
          trainerUserId: "u1",
          signedOn: "2026-11-02",
        }),
      /cannot be in the future/,
      "Nov 2 is still the future at 19:30 CST on Nov 1",
    );
    assert.equal(resolveRequirementStatus("pending", "2026-11-01"), "pending");
    assert.equal(resolveRequirementStatus("pending", "2026-10-31"), "overdue");
  });
});

test("wave: permanent-shift start-date validation uses the Central day", () => {
  const problems = validateOpenShiftInput(
    {
      siteId: "s1",
      title: "Evening",
      kind: "permanent",
      days: [1],
      windowStart: "08:00",
      windowEnd: "16:00",
      effectiveFrom: "2026-11-01",
    } as Parameters<typeof validateOpenShiftInput>[0],
    new Date(EVENING_A),
  );
  assert.deepEqual(problems, [], "starting today Central is allowed");
});

test("wave: missing-requirements scan judges expiry on the Central day", () => {
  const input: MissingInput = {
    now: new Date(EVENING_A),
    requiredCertificateKinds: ["CPR"],
    certificates: [
      { userId: "u1", staffName: "Sam Staff", kind: "CPR", expiresOn: "2026-11-01" },
    ],
    requiredTrainingTopics: [],
    trainings: [],
    staff: [{ userId: "u1", name: "Sam Staff" }],
    individuals: [],
    requiredIndividualDocuments: [],
    individualDocuments: [],
    checklists: [],
  };
  assert.deepEqual(
    findMissing(input),
    [],
    "a certificate expiring today Central is not yet missing (the UTC day flagged it expired)",
  );
});

test("wave: the ISP plan year follows the Central calendar", () => {
  withMockedNow("2027-01-01T02:00:00.000Z", () => {
    // 20:00 CST on Dec 31, 2026 — UTC has rolled to 2027, Central has not.
    assert.equal(currentPlanYear(), "2026");
  });
  withMockedNow("2027-01-01T07:00:00.000Z", () => {
    // 01:00 CST on Jan 1, 2027.
    assert.equal(currentPlanYear(), "2027");
  });
});
