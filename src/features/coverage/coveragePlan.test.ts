import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIFT_BLOCKS, shiftBlocksFromStarts } from "../../data/dueItems";
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

  it("names the person on the shift; an open block reads not covered and names the usual DSP as owing the note", () => {
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
    const evening = lines.find((line) => line.blockId === "evening")?.text ?? "";
    assert.match(evening, /Not covered · no one is scheduled/);
    assert.match(evening, /Taylor Reed owes the note/);
    assert.doesNotMatch(evening, /still with/);
  });

  it("batch 80/85: an uncovered overnight names nobody as covering — the usual DSP owes the note only", () => {
    const juniperWriters = [
      { userId: "casey", name: "Casey Dunn" },
      { userId: "drew", name: "Drew Ellis" },
      { userId: "quinn", name: "Quinn Newhire" },
    ];
    // The sim house's own cadence: day 7–3, evening 3–11, overnight 11–7.
    const juniperBlocks = shiftBlocksFromStarts({
      dayStart: "07:00",
      eveningStart: "15:00",
      overnightStart: "23:00",
    });
    const day = chicagoShiftInstants("2026-11-01", "07:00", "15:00");
    const evening = chicagoShiftInstants("2026-11-01", "15:00", "23:00");
    const lines = owedLinesForDay({
      date: "2026-11-01",
      blocks: juniperBlocks,
      shifts: [
        { id: "day", staffId: "casey", staffName: "Casey Dunn", ...day },
        { id: "evening", staffId: "drew", staffName: "Drew Ellis", ...evening },
      ],
      writers: juniperWriters,
      graceMinutes: 5,
      weekHasSchedule: true,
    });
    const overnight = lines.find((line) => line.blockId === "overnight")?.text ?? "";
    assert.match(overnight, /Not covered · no one is scheduled/);
    assert.match(overnight, /Quinn Newhire owes the note/);
    assert.doesNotMatch(overnight, /still with Quinn/);
  });

  it("flags a covering DSP who is not cleared to work alone, and only then", () => {
    const juniperWriters = [
      { userId: "casey", name: "Casey Dunn" },
      { userId: "drew", name: "Drew Ellis" },
      { userId: "quinn", name: "Quinn Newhire" },
    ];
    const overnightShift = chicagoShiftInstants("2026-11-01", "22:00", "06:00");
    const shifts = [
      { id: "overnight", staffId: "quinn", staffName: "Quinn Newhire", ...overnightShift },
    ];
    const flagged = owedLinesForDay({
      date: "2026-11-01",
      blocks: SHIFT_BLOCKS,
      shifts,
      writers: juniperWriters,
      graceMinutes: 5,
      weekHasSchedule: true,
      unclearedStaffIds: new Set(["quinn"]),
    });
    assert.match(
      flagged.find((line) => line.blockId === "overnight")?.text ?? "",
      /Quinn Newhire \(not cleared to work alone\), note due 6:05 a.m./,
    );
    const unflagged = owedLinesForDay({
      date: "2026-11-01",
      blocks: SHIFT_BLOCKS,
      shifts,
      writers: juniperWriters,
      graceMinutes: 5,
      weekHasSchedule: true,
    });
    assert.doesNotMatch(
      unflagged.find((line) => line.blockId === "overnight")?.text ?? "",
      /not cleared/,
    );
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
