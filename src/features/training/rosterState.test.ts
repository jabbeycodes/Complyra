import { test } from "node:test";
import assert from "node:assert/strict";
import type { StaffClearanceRow } from "../../data/types";
import { trainingRosterView } from "./rosterState";

/**
 * Wave 7N, defect 2 (simulation batches 75/76): the Training page said
 * "Everyone is cleared" over an EMPTY staff table. Pin the honest-state
 * contract: a clearance verdict exists only for a loaded, non-empty
 * roster, and it is computed from the very rows the page displays.
 */
function row(overrides: Partial<StaffClearanceRow>): StaffClearanceRow {
  return {
    userId: "user-1",
    fullName: "Quinn Newhire",
    siteName: "Maple House",
    clearedForInRatio: false,
    gateReasons: ["No training assigned yet"],
    pendingCount: 0,
    overdueCount: 0,
    hoursTotal: 0,
    hoursWithHm: 0,
    ...overrides,
  };
}

test("unloaded roster is an explicit loading state, never a verdict", () => {
  assert.deepEqual(trainingRosterView(null, false), { kind: "loading" });
});

test("failed load is an error state, never a verdict", () => {
  assert.deepEqual(trainingRosterView(null, true), { kind: "error" });
  assert.deepEqual(trainingRosterView([row({})], true), { kind: "error" });
});

test("loaded-empty roster is 'empty' — not 'everyone is cleared'", () => {
  assert.deepEqual(trainingRosterView([], false), { kind: "empty" });
});

test("ready roster derives its verdict from the displayed rows", () => {
  const uncleared = row({ userId: "user-quinn" });
  const cleared = row({
    userId: "user-avery",
    fullName: "Avery Cole",
    clearedForInRatio: true,
    gateReasons: [],
    pendingCount: 0,
  });
  const view = trainingRosterView([uncleared, cleared], false);
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.allCleared, false);
  assert.deepEqual(
    view.notCleared.map((r) => r.userId),
    ["user-quinn"],
  );
  assert.equal(view.rows.length, 2);
});

test("'all cleared' requires at least one row and zero uncleared", () => {
  const cleared = row({ clearedForInRatio: true, gateReasons: [] });
  const view = trainingRosterView([cleared], false);
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.allCleared, true);
  assert.equal(view.notCleared.length, 0);
});
