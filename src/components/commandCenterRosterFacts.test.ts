import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScoreFactsForData, type CommandCenterData } from "./CommandCenter";
import type { StaffClearanceRow } from "../data/types";

/**
 * The membership roster (simulation batches 195/196/197) hands the Overview
 * staff with no training lines. They have 0 pending and 0 overdue, and must
 * still score as not cleared rather than complete.
 */
function row(overrides: Partial<StaffClearanceRow>): StaffClearanceRow {
  return {
    userId: "user-1",
    fullName: "New Hire",
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

function trainingFacts(clearance: StaffClearanceRow[]) {
  const data = {
    actions: [],
    certs: [],
    clearance,
    checklists: [],
    snapshots: [],
    staff: [],
    sites: [],
    requirements: [],
    individuals: [],
  } as unknown as CommandCenterData;
  return buildScoreFactsForData(data).flatMap((facts) => facts.training);
}

test("a staffer with no training lines scores incomplete, not complete", () => {
  assert.deepEqual(trainingFacts([row({})]), ["incomplete"]);
});

test("a cleared staffer scores complete and an overdue one overdue", () => {
  assert.deepEqual(trainingFacts([row({ clearedForInRatio: true, gateReasons: [] })]), ["complete"]);
  assert.deepEqual(trainingFacts([row({ overdueCount: 2 })]), ["overdue"]);
});
