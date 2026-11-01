import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScoreFactsForData,
  type CommandCenterData,
} from "./CommandCenter";
import type { StaffClearanceRow } from "../data/types";

/**
 * Wave 7N, defect 2 (simulation batches 75/76): the Overview's training
 * score fact must key off clearedForInRatio. A staffer with NO training
 * assigned has 0 pending / 0 overdue lines, and the old counts-only
 * mapping scored them "complete" — one of the ways the Overview could
 * read 100% while the same people's Training pages said NOT CLEARED.
 */
function clearanceRow(overrides: Partial<StaffClearanceRow>): StaffClearanceRow {
  return {
    userId: "user-quinn",
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

function dataWith(clearance: StaffClearanceRow[]): CommandCenterData {
  return {
    actions: [],
    certs: [],
    clearance,
    checklists: [],
    snapshots: [],
    staff: [],
    sites: [],
    requirements: [],
    individuals: [],
    medications: [],
  };
}

function trainingFacts(clearance: StaffClearanceRow[]): string[] {
  return buildScoreFactsForData(dataWith(clearance)).flatMap(
    (facts) => facts.training,
  );
}

test("a not-cleared staffer with zero open lines is 'incomplete', never 'complete'", () => {
  assert.deepEqual(trainingFacts([clearanceRow({})]), ["incomplete"]);
});

test("a cleared staffer is 'complete'; an overdue not-cleared staffer is 'overdue'", () => {
  assert.deepEqual(
    trainingFacts([
      clearanceRow({ userId: "user-avery", clearedForInRatio: true, gateReasons: [] }),
    ]),
    ["complete"],
  );
  assert.deepEqual(
    trainingFacts([clearanceRow({ userId: "user-blake", overdueCount: 2 })]),
    ["overdue"],
  );
  assert.deepEqual(
    trainingFacts([clearanceRow({ userId: "user-casey", pendingCount: 3 })]),
    ["incomplete"],
  );
});
