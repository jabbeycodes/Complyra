import { test } from "node:test";
import assert from "node:assert/strict";
import type { IspProgramView, ShiftNoteView } from "../../data/shiftNotes";
import {
  groupNotesByDay,
  orderPlans,
  planStatus,
  windowHistory,
} from "./isp";

function program(partial: Partial<IspProgramView>): IspProgramView {
  return {
    id: "program-1",
    agencyId: "agency",
    individualId: "person-1",
    planYear: "2026",
    name: "2026 ISP",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    schedule: "per_shift",
    maxEntriesPerDay: 3,
    scoringMethodId: "method-1",
    status: "approved",
    approvedBy: "user-1",
    approvedByName: "Sarah Mitchell",
    approvedAt: "2026-01-06T10:00:00.000Z",
    createdBy: "user-1",
    createdByName: "Sarah Mitchell",
    createdAt: "2026-01-05T15:30:00.000Z",
    updatedAt: "2026-01-06T10:00:00.000Z",
    tasks: [],
    scoringMethod: null,
    ...partial,
  };
}

function note(partial: Partial<ShiftNoteView>): ShiftNoteView {
  return {
    id: "note-1",
    agencyId: "agency",
    individualId: "person-1",
    programId: "program-1",
    noteDate: "2026-09-12",
    shift: "7a–3p",
    summary: "Worked on morning routine.",
    timeSpentMinutes: 480,
    staffUserId: "user-2",
    staffName: "Alex Morgan",
    createdAt: "2026-09-12T20:00:00.000Z",
    updatedAt: "2026-09-12T20:00:00.000Z",
    deletedAt: null,
    programName: "2026 ISP",
    scoringMethodName: "Daily ISP scoring",
    scores: [],
    ...partial,
  };
}

const TODAY = "2026-09-12";

test("an approved plan inside its period is Active and selectable", () => {
  const status = planStatus(program({}), TODAY);
  assert.equal(status.selectable, true);
  assert.equal(status.text, "Active");
});

test("a draft plan is never selectable and says it is not yet approved", () => {
  const status = planStatus(program({ status: "draft" }), TODAY);
  assert.equal(status.selectable, false);
  assert.match(status.text, /not yet approved/i);
});

test("approved plans outside their period are not selectable and say why", () => {
  const future = planStatus(
    program({ effectiveOn: "2026-10-01", expiresOn: "2027-09-30" }),
    TODAY,
  );
  assert.equal(future.selectable, false);
  assert.match(future.text, /^Starts /);
  const ended = planStatus(
    program({ effectiveOn: "2025-01-01", expiresOn: "2025-12-31" }),
    TODAY,
  );
  assert.equal(ended.selectable, false);
  assert.match(ended.text, /^Ended /);
  const superseded = planStatus(program({ status: "superseded" }), TODAY);
  assert.equal(superseded.selectable, false);
});

test("orderPlans puts the active plan first", () => {
  const ordered = orderPlans(
    [
      program({ id: "draft", status: "draft" }),
      program({ id: "active" }),
      program({ id: "old", effectiveOn: "2025-01-01", expiresOn: "2025-12-31" }),
    ],
    TODAY,
  );
  assert.equal(ordered[0].id, "active");
});

test("groupNotesByDay groups newest first with Today/Yesterday/weekday labels", () => {
  const groups = groupNotesByDay(
    [
      note({ id: "a", noteDate: "2026-09-12" }),
      note({ id: "b", noteDate: "2026-09-12" }),
      note({ id: "c", noteDate: "2026-09-11" }),
      note({ id: "d", noteDate: "2026-09-09" }), // Wednesday
      note({ id: "e", noteDate: "2026-08-30" }),
    ],
    TODAY,
  );
  assert.equal(groups.length, 4);
  assert.equal(groups[0].dateIso, "2026-09-12");
  assert.equal(groups[0].label, "Today");
  assert.equal(groups[0].notes.length, 2);
  assert.equal(groups[1].label, "Yesterday");
  assert.equal(groups[2].label, "Wednesday");
  assert.equal(groups[3].label, "");
  assert.match(groups[3].dateText, /Aug 30/);
});

test("windowHistory keeps the newest entries and reports the true total", () => {
  const notes = Array.from({ length: 5 }, (_, i) =>
    note({ id: `n-${i}` }),
  );
  const all = windowHistory(notes);
  assert.equal(all.total, 5);
  assert.equal(all.truncated, false);
  assert.deepEqual(
    all.visible.map((row) => row.id),
    ["n-0", "n-1", "n-2", "n-3", "n-4"],
  );
  const cut = windowHistory(notes, 3);
  assert.equal(cut.total, 5);
  assert.equal(cut.truncated, true);
  assert.deepEqual(
    cut.visible.map((row) => row.id),
    ["n-0", "n-1", "n-2"],
  );
});

test("windowHistory reaches past one person's 30-cap inside the home window", () => {
  // 35 notes for one Individual, newest first, plus 2 for another. The
  // per-person entries read caps the first Individual at 30; the home
  // history window (100) still contains their 31st-newest note.
  const mine = Array.from({ length: 35 }, (_, i) =>
    note({ id: `mine-${i}` }),
  );
  const theirs = Array.from({ length: 2 }, (_, i) =>
    note({ id: `theirs-${i}`, individualId: "person-2" }),
  );
  const win = windowHistory([...mine, ...theirs]);
  assert.equal(win.total, 37);
  assert.equal(win.truncated, false);
  assert.ok(win.visible.some((row) => row.id === "mine-30"));
  assert.ok(win.visible.some((row) => row.id === "mine-34"));
});
