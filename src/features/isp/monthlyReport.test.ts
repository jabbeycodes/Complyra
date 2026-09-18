/**
 * Issue #96 — unit tests for the monthly shift notes report aggregation:
 * day-grid bucketing, staff initials, signature log, CSV, summary gates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketNotesByDay,
  buildNotesCsv,
  canReopenMonthlySummary,
  canSignMonthlySummary,
  canWriteMonthlySummary,
  collectSignatureLog,
  dayCellEntries,
  daysInMonth,
  initialsForName,
  isValidMonthKey,
  monthDisplayLabel,
  monthEndOf,
  monthKeyOf,
  monthStartOf,
  notesInMonth,
  reportProgramForMonth,
} from "./monthlyReport";
import type { IspProgramView, ShiftNoteView } from "../../data/shiftNotes";

function note(overrides: Partial<ShiftNoteView> = {}): ShiftNoteView {
  return {
    id: "n1",
    agencyId: "a1",
    individualId: "i1",
    programId: "p1",
    noteDate: "2026-09-05",
    shift: "7a–3p",
    summary: "Calm shift.",
    timeSpentMinutes: 120,
    staffUserId: "u1",
    staffName: "Jean Masumbuko",
    createdAt: "2026-09-05T15:00:00Z",
    updatedAt: "2026-09-05T15:00:00Z",
    deletedAt: null,
    programName: "2026 ISP",
    scoringMethodName: "Yes/No",
    scores: [
      {
        id: "s1",
        noteId: "n1",
        taskId: "t1",
        taskTitle: "Community",
        levelId: "yes",
        comment: "",
      },
    ],
    ...overrides,
  };
}

function program(overrides: Partial<IspProgramView> = {}): IspProgramView {
  return {
    id: "p1",
    agencyId: "a1",
    individualId: "i1",
    planYear: "2026",
    name: "2026 ISP",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    schedule: "per_shift",
    maxEntriesPerDay: 3,
    scoringMethodId: "m1",
    status: "approved",
    approvedBy: "u9",
    approvedByName: "Pat Manager",
    approvedAt: "2026-01-02T00:00:00Z",
    createdBy: "u9",
    createdByName: "Pat Manager",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    tasks: [],
    scoringMethod: null,
    ...overrides,
  };
}

test("issue #96 month helpers", () => {
  assert.equal(monthKeyOf("2026-09-17"), "2026-09");
  assert.equal(isValidMonthKey("2026-09"), true);
  assert.equal(isValidMonthKey("2026-13"), false);
  assert.equal(isValidMonthKey("2026-9"), false);
  assert.equal(monthStartOf("2026-09"), "2026-09-01");
  assert.equal(monthEndOf("2026-09"), "2026-09-30");
  assert.equal(monthEndOf("2026-02"), "2026-02-28");
  assert.equal(daysInMonth("2026-09"), 30);
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(monthDisplayLabel("2026-09"), "September 2026");
});

test("issue #96 reportProgramForMonth picks the approved program covering the month", () => {
  const draft = program({ id: "draft", status: "draft" });
  const current = program({ id: "p1" });
  const otherPerson = program({ id: "px", individualId: "i9" });
  const expired = program({
    id: "old",
    effectiveOn: "2025-01-01",
    expiresOn: "2025-12-31",
    approvedAt: "2026-05-01T00:00:00Z",
  });
  // Past month resolves against the program active then, not "today".
  assert.equal(reportProgramForMonth([draft, current, otherPerson, expired], "i1", "2026-09")?.id, "p1");
  assert.equal(reportProgramForMonth([draft, expired], "i1", "2026-09"), null);
  assert.equal(reportProgramForMonth([current], "i1", "2025-06"), null);
});

test("issue #96 notesInMonth + bucketNotesByDay bucket and sort", () => {
  const notes = [
    note({ id: "n1", noteDate: "2026-09-05", shift: "3p–11p", createdAt: "2026-09-05T23:00:00Z" }),
    note({ id: "n2", noteDate: "2026-09-05", shift: "7a–3p", createdAt: "2026-09-05T15:00:00Z" }),
    note({ id: "n3", noteDate: "2026-08-31" }),
    note({ id: "n4", noteDate: "2026-09-12", deletedAt: "2026-09-13T00:00:00Z" }),
  ];
  const inMonth = notesInMonth(notes, "2026-09");
  assert.deepEqual(
    inMonth.map((n) => n.id).sort(),
    ["n1", "n2"],
  );
  const buckets = bucketNotesByDay(inMonth);
  assert.equal(buckets.size, 1);
  // Sorted by shift first: 3p–11p sorts before 7a–3p ("3" < "7").
  assert.deepEqual(
    buckets.get(5)!.map((n) => n.id),
    ["n1", "n2"],
  );
});

test("issue #96 initialsForName", () => {
  assert.equal(initialsForName("Jean Masumbuko"), "JM");
  assert.equal(initialsForName("Sam"), "SA");
  assert.equal(initialsForName("  "), "");
  assert.equal(initialsForName("Mary Jane Watson"), "MW");
});

test("issue #96 collectSignatureLog dedupes staff and sorts by name", () => {
  const notes = [
    note({ staffUserId: "u2", staffName: "Zed Staff" }),
    note({ staffUserId: "u1", staffName: "Jean Masumbuko" }),
    note({ staffUserId: "u1", staffName: "Jean Masumbuko" }),
  ];
  const titles = new Map([["u1", "Direct Support Professional"]]);
  const log = collectSignatureLog(notes, titles);
  assert.equal(log.length, 2);
  assert.equal(log[0].name, "Jean Masumbuko");
  assert.equal(log[0].initials, "JM");
  assert.equal(log[0].title, "Direct Support Professional");
  assert.equal(log[1].initials, "ZS");
  assert.equal(log[1].title, "");
});

test("issue #96 dayCellEntries renders score short label + initials", () => {
  const dayNotes = [
    note({ staffName: "Jean Masumbuko" }),
    note({
      id: "n2",
      staffUserId: "u2",
      staffName: "Zed Staff",
      scores: [
        { id: "s2", noteId: "n2", taskId: "t2", taskTitle: "Other", levelId: "no", comment: "" },
      ],
    }),
  ];
  const shortById = new Map([
    ["yes", "Y"],
    ["no", "N"],
  ]);
  assert.deepEqual(dayCellEntries("t1", dayNotes, shortById), ["Y · JM"]);
  assert.deepEqual(dayCellEntries("t2", dayNotes, shortById), ["N · ZS"]);
  assert.deepEqual(dayCellEntries("t9", dayNotes, shortById), []);
});

test("issue #96 buildNotesCsv emits one row per score with stable columns", () => {
  const notes = [
    note({ noteDate: "2026-09-05", shift: "7a–3p", staffName: "Jean Masumbuko" }),
    note({
      id: "n2",
      noteDate: "2026-09-04",
      shift: "3p–11p",
      staffName: "Zed Staff",
      summary: "",
      timeSpentMinutes: null,
      scores: [],
    }),
  ];
  const csv = buildNotesCsv(
    notes,
    "2026 ISP",
    [
      { id: "yes", caption: "Yes", shortLabel: "Y" },
      { id: "no", caption: "No", shortLabel: "N" },
    ],
  );
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('"Program","Date","Shift","Staff","Task","Score"'));
  // Sorted by date: the score-less 2026-09-04 note comes first.
  assert.ok(lines[1].includes('"2026-09-04"'));
  assert.ok(lines[2].includes('"2026-09-05"'));
  assert.ok(lines[2].includes('"Community"'));
  assert.ok(lines[2].includes('"Yes"'));
  assert.ok(lines[2].includes('"Y"'));
});

test("issue #96 monthly summary gates: PM/administrator only", () => {
  assert.equal(canWriteMonthlySummary("program_manager"), true);
  assert.equal(canWriteMonthlySummary("administrator"), true);
  assert.equal(canWriteMonthlySummary("house_manager"), false);
  assert.equal(canWriteMonthlySummary("dsp"), false);
  assert.equal(canWriteMonthlySummary("nurse"), false);
  // Sign requires unsigned; re-open requires signed.
  assert.equal(canSignMonthlySummary("program_manager", ""), true);
  assert.equal(canSignMonthlySummary("program_manager", "2026-10-01T00:00:00Z"), false);
  assert.equal(canSignMonthlySummary("dsp", ""), false);
  assert.equal(canReopenMonthlySummary("administrator", "2026-10-01T00:00:00Z"), true);
  assert.equal(canReopenMonthlySummary("administrator", ""), false);
  assert.equal(canReopenMonthlySummary("house_manager", "2026-10-01T00:00:00Z"), false);
});
