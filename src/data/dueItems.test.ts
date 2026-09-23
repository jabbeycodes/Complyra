import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSiteDueItems,
  computeMedDueItems,
  computeShiftNoteDueItems,
  formatClock,
  formatRange,
  SHIFT_BLOCKS,
  staffedRemainder,
  weekdayOf,
  type ShiftNoteDetectorInput,
  type MedDetectorInput,
} from "./dueItems";
import type { AloneTimeWindow } from "./types";

function aloneWindow(over: Partial<AloneTimeWindow>): AloneTimeWindow {
  return {
    id: over.id ?? "aw-1",
    agencyId: "agency-1",
    individualId: over.individualId ?? "ind-1",
    recurrence: over.recurrence ?? "once",
    weekday: over.weekday ?? null,
    onDate: over.onDate ?? null,
    startTime: over.startTime ?? "14:00",
    endTime: over.endTime ?? "16:00",
    note: over.note ?? "",
    createdBy: null,
    createdByName: "HM",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: over.deletedAt ?? null,
  };
}

describe("time formatting", () => {
  it("formats single clocks with meridiem", () => {
    assert.equal(formatClock(6 * 60), "6:00 a.m.");
    assert.equal(formatClock(14 * 60), "2:00 p.m.");
    assert.equal(formatClock(22 * 60), "10:00 p.m.");
    assert.equal(formatClock(30 * 60), "6:00 a.m."); // overnight end wraps
    assert.equal(formatClock(0), "12:00 a.m.");
    assert.equal(formatClock(12 * 60), "12:00 p.m.");
  });

  it("drops the leading meridiem when both sides share it", () => {
    assert.equal(formatRange(6 * 60, 14 * 60), "6:00 a.m.–2:00 p.m.");
    assert.equal(formatRange(14 * 60, 16 * 60), "2:00–4:00 p.m.");
    assert.equal(formatRange(22 * 60, 30 * 60), "10:00 p.m.–6:00 a.m.");
  });
});

describe("staffedRemainder", () => {
  it("returns the whole block when there is no alone time", () => {
    const { startMin, endMin } = SHIFT_BLOCKS.day;
    assert.deepEqual(staffedRemainder(startMin, endMin, []), [[360, 840]]);
  });
  it("shrinks the block around an alone-time carve-out", () => {
    const { startMin, endMin } = SHIFT_BLOCKS.evening; // 840..1320
    // alone 16:00–22:00 (960..1320) leaves staffed 14:00–16:00
    assert.deepEqual(staffedRemainder(startMin, endMin, [[960, 1320]]), [
      [840, 960],
    ]);
  });
  it("is empty when the whole block is alone time", () => {
    const { startMin, endMin } = SHIFT_BLOCKS.day;
    assert.deepEqual(staffedRemainder(startMin, endMin, [[360, 840]]), []);
  });
});

const CEDAR_INDIVIDUALS = [
  { id: "ellis", name: "Ellis Hart" },
  { id: "morgan", name: "Morgan Pruitt" },
];
const CEDAR_WRITERS = [
  { userId: "alex", name: "Alex Morgan" },
  { userId: "taylor", name: "Taylor Reed" },
];

function shiftInput(over: Partial<ShiftNoteDetectorInput>): ShiftNoteDetectorInput {
  return {
    serviceDate: "2026-09-21",
    staffed24h: true,
    individuals: CEDAR_INDIVIDUALS,
    requiredWriters: CEDAR_WRITERS,
    notes: [],
    aloneTime: [],
    ...over,
  };
}

describe("computeShiftNoteDueItems (#75)", () => {
  it("non-24/7 houses never flag", () => {
    assert.equal(
      computeShiftNoteDueItems(shiftInput({ staffed24h: false })).length,
      0,
    );
  });

  it("flags every (Individual × block × writer) when nothing is documented", () => {
    // 2 individuals × 3 blocks × 2 writers = 12 rows.
    assert.equal(computeShiftNoteDueItems(shiftInput({})).length, 12);
  });

  it("a note clears only its own author's requirement (co-documentation)", () => {
    const notes = [
      { individualId: "ellis", staffUserId: "alex", blockId: "day" as const, noteDate: "2026-09-21" },
    ];
    const items = computeShiftNoteDueItems(shiftInput({ notes }));
    // Only Alex's Ellis/Day gap is cleared; Taylor's Ellis/Day still flags.
    assert.equal(items.length, 11);
    assert.ok(
      !items.some(
        (i) => i.individualId === "ellis" && i.blockId === "day" && i.staffUserId === "alex",
      ),
    );
    assert.ok(
      items.some(
        (i) => i.individualId === "ellis" && i.blockId === "day" && i.staffUserId === "taylor",
      ),
    );
  });

  it("full-block alone time suppresses the row entirely; partial shrinks the range", () => {
    const aloneTime = [
      // Ellis alone the whole Day block → no Day rows for Ellis.
      aloneWindow({ id: "aw-day", individualId: "ellis", recurrence: "once", onDate: "2026-09-21", startTime: "06:00", endTime: "14:00" }),
      // Ellis alone 16:00–22:00 in Evening → staffed remainder 14:00–16:00.
      aloneWindow({ id: "aw-eve", individualId: "ellis", recurrence: "once", onDate: "2026-09-21", startTime: "16:00", endTime: "22:00" }),
    ];
    const items = computeShiftNoteDueItems(shiftInput({ aloneTime }));
    const ellisDay = items.filter((i) => i.individualId === "ellis" && i.blockId === "day");
    assert.equal(ellisDay.length, 0, "full-block alone time removes the row");
    const ellisEvening = items.filter((i) => i.individualId === "ellis" && i.blockId === "evening");
    assert.equal(ellisEvening.length, 2); // both writers still owe
    assert.equal(ellisEvening[0].rangeLabel, "2:00–4:00 p.m.");
    // Morgan (no alone time) is untouched.
    assert.ok(items.some((i) => i.individualId === "morgan" && i.blockId === "day"));
  });

  it("recurring weekly alone time applies on the matching weekday", () => {
    const serviceDate = "2026-09-21"; // a Monday
    assert.equal(weekdayOf(serviceDate), 1);
    const aloneTime = [
      aloneWindow({ id: "aw-mon", individualId: "ellis", recurrence: "weekly", weekday: 1, startTime: "06:00", endTime: "14:00" }),
    ];
    const items = computeShiftNoteDueItems(shiftInput({ serviceDate, aloneTime }));
    assert.equal(items.filter((i) => i.individualId === "ellis" && i.blockId === "day").length, 0);
    // Different weekday → the window does not apply.
    const other = computeShiftNoteDueItems(shiftInput({ serviceDate: "2026-09-22", aloneTime }));
    assert.equal(other.filter((i) => i.individualId === "ellis" && i.blockId === "day").length, 2);
  });
});

function medInput(over: Partial<MedDetectorInput>): MedDetectorInput {
  return {
    doseDate: "2026-09-22",
    nowMinutes: 14 * 60, // 2:00 p.m.
    scheduledDoses: [
      {
        individualId: "ellis",
        individualName: "Ellis Hart",
        medicationId: "med-lev",
        medName: "Levetiracetam",
        strength: "500 mg",
        doseTimes: ["08:00", "20:00"],
      },
    ],
    marks: [],
    ...over,
  };
}

describe("computeMedDueItems (#76)", () => {
  it("overdue after T+1h, future doses stay silent", () => {
    const items = computeMedDueItems(medInput({}));
    // 08:00 window ended 09:00 → overdue; 20:00 is future at 2pm → silent.
    assert.equal(items.length, 1);
    assert.equal(items[0].state, "overdue");
    assert.equal(items[0].scheduledLabel, "8:00 a.m.");
    assert.equal(items[0].windowEndLabel, "9:00 a.m.");
  });

  it("inside ±1h is 'due', not overdue", () => {
    // now 07:30, dose 08:00 → inside window.
    const items = computeMedDueItems(medInput({ nowMinutes: 7 * 60 + 30 }));
    const eight = items.find((i) => i.doseTime === "08:00");
    assert.equal(eight?.state, "due");
  });

  it("any status clears the dose (Given/Missed/LOA/On hold)", () => {
    for (const status of ["given", "missed", "loa", "on_hold"] as const) {
      const items = computeMedDueItems(
        medInput({
          marks: [{ medicationId: "med-lev", doseDate: "2026-09-22", doseTime: "08:00", status }],
        }),
      );
      assert.ok(
        !items.some((i) => i.doseTime === "08:00"),
        `${status} should clear the 08:00 dose`,
      );
    }
  });
});

describe("buildSiteDueItems typed rows", () => {
  it("emits craft copy and orders overdue before due-now", () => {
    const shiftItems = computeShiftNoteDueItems(
      shiftInput({
        notes: [], // leave one clean gap by trimming to a single writer/individual
        individuals: [{ id: "morgan", name: "Morgan Pruitt" }],
        requiredWriters: [{ userId: "alex", name: "Alex Morgan" }],
        aloneTime: [],
      }),
    ).filter((i) => i.blockId === "day");
    const medItems = computeMedDueItems(medInput({ nowMinutes: 7 * 60 + 30 }));
    const rows = buildSiteDueItems(shiftItems, medItems);
    const shiftRow = rows.find((r) => r.kind === "shift_note")!;
    assert.equal(shiftRow.title, "Missing Shift note");
    assert.equal(shiftRow.line2, "Morgan · Day · 6:00 a.m.–2:00 p.m.");
    assert.equal(shiftRow.line3, "Needed from Alex Morgan");
    // Overdue shift row sorts before a due-now med row.
    assert.equal(rows[0].severity, "overdue");
  });
});
