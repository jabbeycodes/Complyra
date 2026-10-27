import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIFT_BLOCKS } from "../../data/dueItems";
import { chicagoShiftInstants } from "./coverageWeek";
import { owedLinesForDay, rowsToCopy, rowsToFill } from "./coveragePlan";

const writers = [
  { userId: "alex", name: "Alex Morgan" },
  { userId: "taylor", name: "Taylor Reed" },
];

describe("house coverage plan", () => {
  it("names every assigned DSP when the week is still empty", () => {
    const lines = owedLinesForDay({
      date: "2026-10-25",
      blocks: SHIFT_BLOCKS,
      shifts: [],
      writers,
      graceMinutes: 5,
      weekHasSchedule: false,
    });
    assert.match(lines[0]?.text ?? "", /Alex Morgan and Taylor Reed/);
  });

  it("names the person on the shift and the usual DSP for the open blocks", () => {
    const day = chicagoShiftInstants("2026-10-25", "06:00", "14:00");
    const lines = owedLinesForDay({
      date: "2026-10-25",
      blocks: SHIFT_BLOCKS,
      shifts: [{ id: "day", staffId: "casey", staffName: "Casey Adams", ...day }],
      writers,
      graceMinutes: 5,
      weekHasSchedule: true,
    });
    assert.match(lines.find((line) => line.blockId === "day")?.text ?? "", /Casey Adams, note due 2:05 p.m./);
    assert.match(lines.find((line) => line.blockId === "evening")?.text ?? "", /still with Taylor Reed/);
  });

  it("keeps an open posting with the usual DSP until someone takes it", () => {
    const evening = chicagoShiftInstants("2026-10-25", "14:00", "22:00");
    const lines = owedLinesForDay({
      date: "2026-10-25",
      blocks: SHIFT_BLOCKS,
      shifts: [{ id: "open", staffId: null, staffName: "Open", ...evening }],
      writers,
      graceMinutes: 5,
      weekHasSchedule: true,
    });
    assert.match(lines.find((line) => line.blockId === "evening")?.text ?? "", /Open for a PRN/);
    assert.match(lines.find((line) => line.blockId === "evening")?.text ?? "", /Taylor Reed/);
  });

  it("fills only the blocks nobody is on", () => {
    const day = chicagoShiftInstants("2026-10-25", "06:00", "14:00");
    const rows = rowsToFill({
      dates: ["2026-10-25"],
      blocks: SHIFT_BLOCKS,
      existing: [{ id: "day", staffId: "alex", staffName: "Alex Morgan", ...day }],
      writers,
    });
    assert.deepEqual(rows.map((row) => row.title), ["Evening coverage", "Overnight coverage"]);
    assert.equal(rows[0]?.staffId, "taylor");
    assert.equal(rows[1]?.staffId, "alex");
  });

  it("copies last week onto the same clocks", () => {
    const previous = chicagoShiftInstants("2026-10-18", "06:00", "15:00");
    const rows = rowsToCopy({
      previous: [{ id: "old", staffId: "casey", staffName: "Casey Adams", ...previous }],
      previousWeekStart: "2026-10-18",
      targetWeekStart: "2026-10-25",
      target: [],
    });
    const expected = chicagoShiftInstants("2026-10-25", "06:00", "15:00");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.staffId, "casey");
    assert.equal(rows[0]?.startsAt, expected.startsAt);
    assert.equal(rows[0]?.endsAt, expected.endsAt);
  });
});
