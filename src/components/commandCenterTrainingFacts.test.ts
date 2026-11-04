import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildScoreFactsForData,
  CommandCenterView,
  type CommandCenterData,
} from "./CommandCenter";
import type { StaffClearanceRow } from "../data/types";

/**
 * Wave 7S pins (simulation batches 75/76 + batch 103 / Pass 7 roll-up):
 * the Overview's training verdict must be the canonical gate verdict,
 * clearedForInRatio. A staffer with NO training assigned has 0 pending
 * / 0 overdue lines, and the old counts-only mapping scored them
 * "complete" and hid them from the risk list — one of the ways the
 * Overview could read 100% while the same people's Training pages
 * said NOT CLEARED.
 */
function clearanceRow(overrides: Partial<StaffClearanceRow>): StaffClearanceRow {
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

test("the Overview risk list names a not-cleared staffer even with zero open lines", () => {
  const noopAsync = async () => {};
  const html = renderToStaticMarkup(
    React.createElement(CommandCenterView, {
      data: dataWith([clearanceRow({})]),
      canManage: false,
      onAddAction: noopAsync,
      onResolveAction: noopAsync,
    }),
  );
  assert.ok(html.includes("Quinn Newhire"), "the risk list names Quinn");
  assert.ok(html.includes("Training clearance"), "as a training clearance risk");
});

test("a cleared staffer appears in no training risk row", () => {
  const noopAsync = async () => {};
  const html = renderToStaticMarkup(
    React.createElement(CommandCenterView, {
      data: dataWith([
        clearanceRow({ clearedForInRatio: true, gateReasons: [] }),
      ]),
      canManage: false,
      onAddAction: noopAsync,
      onResolveAction: noopAsync,
    }),
  );
  assert.ok(!html.includes("Training clearance"), "no training risk rows");
});
