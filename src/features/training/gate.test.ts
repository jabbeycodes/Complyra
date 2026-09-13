import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateInRatioGate,
  resolveRequirementStatus,
  computeNextDueOn,
  sumHours,
} from "./gate";

test("gate fails when everything is missing, listing each reason", () => {
  const result = evaluateInRatioGate({
    signoffs: [],
    requiredTotal: 53,
    completeCount: 0,
    pendingCount: 53,
    overdueCount: 0,
    staffCountersigned: false,
    hmCountersigned: false,
  });
  assert.equal(result.cleared, false);
  assert.ok(result.reasons.some((r) => r.includes("20")));
  assert.ok(result.reasons.some((r) => r.includes("house manager")));
  assert.ok(result.reasons.some((r) => r.includes("53 of 53")));
  assert.ok(result.reasons.some((r) => r.includes("Staff signature")));
  assert.ok(result.reasons.some((r) => r.includes("House manager countersignature")));
});

test("gate clears at exactly 20 hours and 8 HM hours with all lines done and signed", () => {
  const signoffs = [
    { hoursTotal: 12, hoursWithHm: 8, na: false },
    { hoursTotal: 8, hoursWithHm: 0, na: false },
  ];
  const result = evaluateInRatioGate({
    signoffs,
    requiredTotal: 53,
    completeCount: 53,
    pendingCount: 0,
    overdueCount: 0,
    staffCountersigned: true,
    hmCountersigned: true,
  });
  assert.equal(result.cleared, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.hoursTotal, 20);
  assert.equal(result.hoursWithHm, 8);
});

test("N/A lines do not count toward training hours", () => {
  const { hoursTotal, hoursWithHm } = sumHours([
    { hoursTotal: 20, hoursWithHm: 8, na: true },
    { hoursTotal: 1, hoursWithHm: 0, na: false },
  ]);
  assert.equal(hoursTotal, 1);
  assert.equal(hoursWithHm, 0);
});

test("overdue lines block clearance even when hours are met", () => {
  const result = evaluateInRatioGate({
    signoffs: [{ hoursTotal: 30, hoursWithHm: 10, na: false }],
    requiredTotal: 10,
    completeCount: 9,
    pendingCount: 0,
    overdueCount: 1,
    staffCountersigned: true,
    hmCountersigned: true,
  });
  assert.equal(result.cleared, false);
  assert.ok(result.reasons.some((r) => r.includes("overdue")));
});

test("resolveRequirementStatus derives overdue from a past due date", () => {
  assert.equal(resolveRequirementStatus("pending", "2020-01-01", "2026-09-13"), "overdue");
  assert.equal(resolveRequirementStatus("in_progress", "2020-01-01", "2026-09-13"), "overdue");
  assert.equal(resolveRequirementStatus("pending", "2026-09-14", "2026-09-13"), "pending");
  assert.equal(resolveRequirementStatus("complete", "2020-01-01", "2026-09-13"), "complete");
  assert.equal(resolveRequirementStatus("waived_na", null, "2026-09-13"), "waived_na");
});

test("computeNextDueOn handles annual and 6-month renewal rules", () => {
  assert.equal(computeNextDueOn("annual", "2026-09-13"), "2027-09-13");
  assert.equal(computeNextDueOn("6-month", "2026-09-13"), "2027-03-13");
  assert.equal(computeNextDueOn(null, "2026-09-13"), null);
  assert.equal(computeNextDueOn("whenever", "2026-09-13"), null);
});
