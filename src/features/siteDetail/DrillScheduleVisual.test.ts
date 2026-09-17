import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monthScheduleStatus, monthStatusLabel } from "./DrillScheduleVisual";
import { drillScheduleYearSummary } from "../../data/drillSchedule";
import type { EmergencyDrill } from "../../data/monthlyChecks";

function drill(id: string, drillType: "fire" | "intruder", monthKey: string): EmergencyDrill {
  return {
    id,
    agencyId: "a1",
    siteId: "s1",
    monthKey,
    drillType,
    date: `${monthKey}-05`,
    time: "10:00",
    evacTime: "2:00",
    leaderName: "Alex Morgan",
    participants: "Alex Morgan",
    awakeOrSleep: "awake",
  };
}

function summaryFor(month: number, records: EmergencyDrill[]) {
  const found = drillScheduleYearSummary(2026, records).find(
    (s) => s.month.month === month,
  );
  assert.ok(found, `summary for month ${month}`);
  return found;
}

describe("monthScheduleStatus", () => {
  it("reports complete when every required drill is logged (beats due_soon)", () => {
    const records = [
      drill("d1", "fire", "2026-01"),
      drill("d2", "intruder", "2026-01"),
    ];
    const summary = summaryFor(1, records);
    assert.equal(summary.allComplete, true);
    assert.equal(monthScheduleStatus(summary, true), "complete");
    assert.equal(monthStatusLabel("complete"), "Complete");
  });

  it("reports due_soon for the current month with drills missing", () => {
    const summary = summaryFor(9, []);
    assert.equal(monthScheduleStatus(summary, true), "due_soon");
    assert.equal(monthStatusLabel("due_soon"), "Due soon");
  });

  it("reports not_logged for other incomplete months", () => {
    const summary = summaryFor(3, []);
    assert.equal(monthScheduleStatus(summary, false), "not_logged");
    assert.equal(monthStatusLabel("not_logged"), "Not logged");
  });

  it("reports complete for a partial month only when all its drills are logged", () => {
    const summary = summaryFor(11, [drill("d1", "fire", "2026-11")]);
    assert.equal(summary.allComplete, false);
    assert.equal(monthScheduleStatus(summary, false), "not_logged");
  });
});
