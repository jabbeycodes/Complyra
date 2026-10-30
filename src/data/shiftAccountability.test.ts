import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIFT_BLOCKS } from "./dueItems";
import {
  accountabilityDates,
  checklistAccountabilityItems,
  computeShiftAccountability,
  ispAccountabilityItems,
  medicationAccountabilityItems,
  menuAccountabilityItems,
  shiftNoteAccountabilityItems,
  type AccountabilityDueItem,
  type AccountabilityShift,
} from "./shiftAccountability";
import type { HmWeeklyChecklist } from "./types";

// All instants below are UTC. 2026-01-15 is CST (UTC-6), so a 06:00–14:00
// Central shift is 12:00Z–20:00Z and Central midnight is 06:00Z.
const DAY_SHIFT: AccountabilityShift = {
  id: "shift-day",
  staffId: "alex",
  startsAt: "2026-01-15T12:00:00.000Z",
  endsAt: "2026-01-15T20:00:00.000Z",
  status: "published",
};
const EVENING_SHIFT: AccountabilityShift = {
  id: "shift-evening",
  staffId: "taylor",
  startsAt: "2026-01-15T20:00:00.000Z",
  endsAt: "2026-01-16T04:00:00.000Z",
  status: "published",
};
const OVERNIGHT_SHIFT: AccountabilityShift = {
  id: "shift-night",
  staffId: "casey",
  startsAt: "2026-01-16T04:00:00.000Z",
  endsAt: "2026-01-16T12:00:00.000Z",
  status: "published",
};
const NAMES = new Map([
  ["alex", "Alex Morgan"],
  ["taylor", "Taylor Reed"],
  ["casey", "Casey Adams"],
]);
const DURING_DAY = new Date("2026-01-15T16:00:00.000Z");

function item(partial: Partial<AccountabilityDueItem> & { dueAt: string }): AccountabilityDueItem {
  return {
    id: partial.id ?? `item-${partial.dueAt}`,
    kind: partial.kind ?? "medication",
    label: partial.label ?? "Dose",
    done: partial.done ?? false,
    dueAt: partial.dueAt,
    individualId: partial.individualId ?? null,
    individualName: partial.individualName ?? null,
  };
}

test("window boundaries: due at start belongs to the shift, due at end to the next", () => {
  const rows = computeShiftAccountability({
    shifts: [DAY_SHIFT, EVENING_SHIFT],
    ownerNameById: NAMES,
    now: DURING_DAY,
    items: [
      item({ id: "at-start", dueAt: "2026-01-15T12:00:00.000Z", done: true }),
      item({ id: "at-end", dueAt: "2026-01-15T20:00:00.000Z" }),
      item({ id: "before", dueAt: "2026-01-15T11:59:00.000Z" }),
    ],
  });
  const day = rows.find((r) => r.shiftId === "shift-day")!;
  assert.equal(day.totalDue, 1);
  assert.equal(day.doneCount, 1);
  const evening = rows.find((r) => r.shiftId === "shift-evening")!;
  assert.equal(evening.totalDue, 1);
  assert.equal(evening.missingItems[0].id, "at-end");
});

test("overnight shift owns the small hours, not its own end instant", () => {
  const rows = computeShiftAccountability({
    shifts: [OVERNIGHT_SHIFT],
    ownerNameById: NAMES,
    now: new Date("2026-01-16T08:00:00.000Z"),
    items: [
      item({ id: "late", dueAt: "2026-01-16T05:30:00.000Z", done: true }), // 11:30 p.m.
      item({ id: "early", dueAt: "2026-01-16T11:30:00.000Z" }), // 5:30 a.m.
      item({ id: "at-end", dueAt: "2026-01-16T12:00:00.000Z" }), // 6:00 a.m. = end
      item({ id: "before-start", dueAt: "2026-01-16T03:59:00.000Z" }),
    ],
  });
  assert.equal(rows[0].totalDue, 2);
  assert.equal(rows[0].doneCount, 1);
  assert.deepEqual(rows[0].missingItems.map((i) => i.id), ["early"]);
  assert.equal(rows[0].state, "in_progress");
});

test("open shift is unowned but still carries its obligations", () => {
  const open: AccountabilityShift = { ...DAY_SHIFT, id: "shift-open", staffId: null };
  const rows = computeShiftAccountability({
    shifts: [open],
    ownerNameById: NAMES,
    now: new Date("2026-01-16T16:00:00.000Z"), // after the window
    items: [item({ dueAt: "2026-01-15T14:00:00.000Z" })],
  });
  assert.equal(rows[0].state, "unowned");
  assert.equal(rows[0].ownerId, null);
  assert.equal(rows[0].ownerName, null);
  assert.equal(rows[0].totalDue, 1);
  assert.equal(rows[0].missingItems.length, 1);
});

test("states: upcoming, in progress, complete, has missing", () => {
  const dose = item({ dueAt: "2026-01-15T14:00:00.000Z" });
  const doneDose = item({ dueAt: "2026-01-15T14:00:00.000Z", done: true });
  const run = (now: Date, items: AccountabilityDueItem[]) =>
    computeShiftAccountability({ shifts: [DAY_SHIFT], ownerNameById: NAMES, now, items })[0];
  assert.equal(run(new Date("2026-01-15T10:00:00.000Z"), [dose]).state, "upcoming");
  assert.equal(run(DURING_DAY, [dose]).state, "in_progress");
  assert.equal(run(DURING_DAY, [doneDose]).state, "complete");
  assert.equal(run(new Date("2026-01-15T21:00:00.000Z"), [dose]).state, "has_missing");
  assert.equal(run(new Date("2026-01-15T21:00:00.000Z"), [doneDose]).state, "complete");
  // A shift with nothing due in its window is complete once it has started.
  assert.equal(run(DURING_DAY, []).state, "complete");
});

test("multiple Individuals' items aggregate into one window", () => {
  const rows = computeShiftAccountability({
    shifts: [DAY_SHIFT],
    ownerNameById: NAMES,
    now: DURING_DAY,
    items: [
      item({ id: "a", dueAt: "2026-01-15T14:00:00.000Z", done: true, individualName: "Ellis Hart" }),
      item({ id: "b", dueAt: "2026-01-15T15:00:00.000Z", individualName: "Morgan Pruitt" }),
      item({ id: "c", dueAt: "2026-01-15T16:00:00.000Z", done: true, individualName: "Morgan Pruitt" }),
    ],
  });
  assert.equal(rows[0].totalDue, 3);
  assert.equal(rows[0].doneCount, 2);
  assert.equal(rows[0].ownerName, "Alex Morgan");
});

test("overlapping shifts each own the shared window's items; cancelled shifts vanish", () => {
  const overlap: AccountabilityShift = {
    id: "shift-overlap",
    staffId: "taylor",
    startsAt: "2026-01-15T18:00:00.000Z",
    endsAt: "2026-01-15T22:00:00.000Z",
    status: "scheduled",
  };
  const cancelled: AccountabilityShift = { ...DAY_SHIFT, id: "shift-x", status: "cancelled" };
  const rows = computeShiftAccountability({
    shifts: [DAY_SHIFT, overlap, cancelled],
    ownerNameById: NAMES,
    now: DURING_DAY,
    items: [item({ dueAt: "2026-01-15T19:00:00.000Z" })],
  });
  assert.deepEqual(rows.map((r) => r.shiftId), ["shift-day", "shift-overlap"]);
  assert.ok(rows.every((r) => r.totalDue === 1));
});

test("accountabilityDates walks an inclusive range", () => {
  assert.deepEqual(accountabilityDates("2026-01-30", "2026-02-02"), [
    "2026-01-30",
    "2026-01-31",
    "2026-02-01",
    "2026-02-02",
  ]);
});

test("medication items: a mark of record completes the dose; PRN contributes none", () => {
  const items = medicationAccountabilityItems({
    dates: ["2026-01-15"],
    scheduledDoses: [
      {
        individualId: "ellis",
        individualName: "Ellis Hart",
        medicationId: "med-1",
        medName: "Vitamin D",
        strength: "1000 IU",
        doseTimes: ["08:00", "20:00"],
      },
      {
        individualId: "ellis",
        individualName: "Ellis Hart",
        medicationId: "med-prn",
        medName: "Ibuprofen",
        strength: "200 mg",
        doseTimes: [],
      },
    ],
    marks: [{ medicationId: "med-1", doseDate: "2026-01-15", doseTime: "08:00" }],
  });
  assert.equal(items.length, 2);
  const morning = items.find((i) => i.dueAt === "2026-01-15T14:00:00.000Z")!;
  assert.equal(morning.done, true); // 08:00 CST = 14:00Z
  const evening = items.find((i) => i.dueAt === "2026-01-16T02:00:00.000Z")!;
  assert.equal(evening.done, false); // 20:00 CST = 02:00Z next day
  assert.match(morning.label, /Vitamin D 1000 IU — Ellis Hart/);
});

test("menu items: one per slot per person per day, done by a live entry", () => {
  const items = menuAccountabilityItems({
    dates: ["2026-01-15"],
    people: [{ id: "ellis", name: "Ellis Hart" }],
    entries: [{ individualId: "ellis", entryDate: "2026-01-15", mealSlot: "breakfast" }],
  });
  assert.equal(items.length, 4);
  const breakfast = items.find((i) => i.label.startsWith("Breakfast"))!;
  assert.equal(breakfast.done, true);
  assert.equal(breakfast.dueAt, "2026-01-15T14:00:00.000Z"); // 08:00 CST
  assert.equal(items.filter((i) => !i.done).length, 3);
});

test("ISP items: only approved programs inside their effective range; a note completes the day", () => {
  const base = {
    people: [{ id: "ellis", name: "Ellis Hart" }],
    dates: ["2026-01-15"],
    notes: [] as Array<{ individualId: string; programId: string; noteDate: string }>,
  };
  const program = {
    id: "prog-1",
    individualId: "ellis",
    name: "Community integration",
    status: "approved",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
  };
  const items = ispAccountabilityItems({ ...base, programs: [program] });
  assert.equal(items.length, 1);
  assert.equal(items[0].done, false);
  assert.equal(items[0].dueAt, "2026-01-16T06:00:00.000Z"); // end of the Central day
  const done = ispAccountabilityItems({
    ...base,
    programs: [program],
    notes: [{ individualId: "ellis", programId: "prog-1", noteDate: "2026-01-15" }],
  });
  assert.equal(done[0].done, true);
  assert.equal(
    ispAccountabilityItems({ ...base, programs: [{ ...program, status: "draft" }] }).length,
    0,
  );
  assert.equal(
    ispAccountabilityItems({ ...base, programs: [{ ...program, expiresOn: "2026-01-10" }] }).length,
    0,
  );
});

test("shift-note items: filed-against counts for anyone; otherwise the assignee's own matching note", () => {
  const people = [{ id: "ellis", name: "Ellis Hart" }];
  const note = {
    individualId: "ellis",
    staffUserId: "alex",
    noteDate: "2026-01-15",
    shift: "Day 6:00 a.m.–2:00 p.m.",
    hrShiftId: null as string | null,
  };
  const build = (notes: (typeof note)[], shifts: AccountabilityShift[] = [DAY_SHIFT]) =>
    shiftNoteAccountabilityItems({ shifts, people, notes, blocks: SHIFT_BLOCKS });
  // The assignee's note under the Day label covers the day shift.
  assert.equal(build([note])[0].done, true);
  // Another staff member's note does not clear the assignee's obligation…
  assert.equal(build([{ ...note, staffUserId: "taylor" }])[0].done, false);
  // …unless it was filed against this shift.
  assert.equal(build([{ ...note, staffUserId: "taylor", hrShiftId: "shift-day" }])[0].done, true);
  // Unowned shift: only a note filed against the shift counts.
  const open: AccountabilityShift = { ...DAY_SHIFT, id: "shift-open", staffId: null };
  assert.equal(build([note], [open])[0].done, false);
  assert.equal(build([{ ...note, hrShiftId: "shift-open" }], [open])[0].done, true);
  // The note item sits inside its own shift's window (final minute).
  const own = build([]);
  assert.equal(own[0].dueAt, "2026-01-15T19:59:00.000Z");
  const attributed = computeShiftAccountability({
    shifts: [DAY_SHIFT, EVENING_SHIFT],
    ownerNameById: NAMES,
    now: DURING_DAY,
    items: own,
  });
  assert.equal(attributed.find((r) => r.shiftId === "shift-day")!.totalDue, 1);
  assert.equal(attributed.find((r) => r.shiftId === "shift-evening")!.totalDue, 0);
});

test("checklist items: stored dueAt wins; otherwise the item falls due at week end", () => {
  const checklist = {
    id: "cl-1",
    agencyId: "ag",
    siteId: "cedar",
    weekOf: "2026-01-11",
    weekStart: "2026-01-12",
    dueAt: null,
    assignedToUserId: "james",
    assignedByUserId: null,
    status: "open",
    submittedAt: null,
    items: [
      { key: "i1", prompt: "Check the fire extinguisher", answer: null, note: "" },
      { key: "i2", prompt: "Review the med fridge log", answer: "yes", note: "" },
    ],
    serviceLogs: [],
    attestation: null,
    createdAt: "2026-01-12T00:00:00.000Z",
    updatedAt: "2026-01-12T00:00:00.000Z",
  } as unknown as HmWeeklyChecklist;
  const items = checklistAccountabilityItems({ checklists: [checklist] });
  assert.equal(items.length, 2);
  // Monday anchor + 7 days at Central midnight = 2026-01-19T06:00Z.
  assert.equal(items[0].dueAt, "2026-01-19T06:00:00.000Z");
  assert.equal(items[0].done, false);
  assert.equal(items[1].done, true);
  const withDue = checklistAccountabilityItems({
    checklists: [{ ...checklist, dueAt: "2026-01-18T23:00:00.000Z" }],
  });
  assert.equal(withDue[0].dueAt, "2026-01-18T23:00:00.000Z");
});
