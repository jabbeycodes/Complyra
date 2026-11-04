import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingRosterView } from "./rosterState";
import type { StaffClearanceRow } from "../../data/types";

/**
 * Wave 7S pins: the Training page may only print a clearance verdict
 * the loaded roster supports. "Everyone is cleared" requires a loaded,
 * non-empty roster whose every row carries the canonical profile
 * verdict (clearedForInRatio) — loading, failed, and empty rosters get
 * honest states instead (batches 75/76 + 103).
 */
function row(overrides: Partial<StaffClearanceRow>): StaffClearanceRow {
  return {
    userId: "user-quinn",
    fullName: "Quinn Newhire",
    siteName: "No site assigned",
    clearedForInRatio: false,
    gateReasons: ["No training assigned yet"],
    pendingCount: 0,
    overdueCount: 0,
    hoursTotal: 0,
    hoursWithHm: 0,
    ...overrides,
  };
}

test("not loaded yet → loading, no verdict", () => {
  assert.deepEqual(trainingRosterView(null, false), { kind: "loading" });
});

test("failed load → error, even if stale rows are around", () => {
  assert.deepEqual(trainingRosterView(null, true), { kind: "error" });
  assert.deepEqual(trainingRosterView([row({})], true), { kind: "error" });
});

test("loaded but empty → empty state, NEVER an all-cleared verdict", () => {
  const view = trainingRosterView([], false);
  assert.equal(view.kind, "empty");
  assert.ok(!("allCleared" in view), "an empty roster carries no clearance verdict");
});

test("loaded rows → the verdict is computed over exactly those rows", () => {
  const view = trainingRosterView(
    [row({}), row({ userId: "user-avery", fullName: "Avery Cole", clearedForInRatio: true, gateReasons: [] })],
    false,
  );
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.allCleared, false);
  assert.deepEqual(
    view.notCleared.map((entry) => entry.userId),
    ["user-quinn"],
  );
});

test("a loaded roster of only cleared rows → allCleared", () => {
  const view = trainingRosterView(
    [row({ clearedForInRatio: true, gateReasons: [] })],
    false,
  );
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.allCleared, true);
  assert.equal(view.notCleared.length, 0);
});
