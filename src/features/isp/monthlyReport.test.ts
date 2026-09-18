/**
 * Issue #96 — unit tests for the monthly shift notes report aggregation:
 * day-grid bucketing, staff initials, signature log, CSV, summary gates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketNotesByDay,
  buildMonthlyScoreSummaryCsvRows,
  buildNotesCsv,
  buildObjectiveScoreSummary,
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
  scoreBucketForLevelCaption,
  weekDayRangeLabel,
  weekOfMonthIndex,
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

function weeklyNote(overrides: Partial<ShiftNoteView> = {}): ShiftNoteView {
  return note(overrides);
}

test("issue #96 score summary: week boundaries are plain 7-day chunks", () => {
  assert.equal(weekOfMonthIndex(1), 1);
  assert.equal(weekOfMonthIndex(7), 1);
  assert.equal(weekOfMonthIndex(8), 2);
  assert.equal(weekOfMonthIndex(14), 2);
  assert.equal(weekOfMonthIndex(21), 3);
  assert.equal(weekOfMonthIndex(22), 4);
  assert.equal(weekOfMonthIndex(28), 4);
  assert.equal(weekOfMonthIndex(29), 5);
  assert.equal(weekOfMonthIndex(30), 5);
  assert.equal(weekOfMonthIndex(31), 5);
});

test("issue #96 score summary: week day-range labels clip to the month", () => {
  assert.equal(weekDayRangeLabel("2026-09", 1), "1–7");
  assert.equal(weekDayRangeLabel("2026-09", 4), "22–28");
  assert.equal(weekDayRangeLabel("2026-09", 5), "29–30");
  assert.equal(weekDayRangeLabel("2026-02", 5), "");
  assert.equal(weekDayRangeLabel("2026-02", 4), "22–28");
});

test("issue #96 score summary: score captions map to buckets, unknown to other", () => {
  assert.equal(scoreBucketForLevelCaption("Yes"), "yes");
  assert.equal(scoreBucketForLevelCaption("  yes  "), "yes");
  assert.equal(scoreBucketForLevelCaption("No"), "no");
  assert.equal(scoreBucketForLevelCaption("Refused"), "refused");
  assert.equal(scoreBucketForLevelCaption("N/A"), "other");
  assert.equal(scoreBucketForLevelCaption("Not applicable"), "other");
  assert.equal(scoreBucketForLevelCaption("Partial"), "other");
  assert.equal(scoreBucketForLevelCaption(""), "other");
});

test("issue #96 score summary: month totals + per-week breakdown per objective", () => {
  const tasks = [
    { id: "t1", title: "Community" },
    { id: "t2", title: "Housework" },
  ];
  const captions = new Map([
    ["yes", "Yes"],
    ["no", "No"],
    ["ref", "Refused"],
    ["na", "N/A"],
  ]);
  const score = (id: string, taskId: string, levelId: string) => ({
    id,
    noteId: "x",
    taskId,
    taskTitle: "",
    levelId,
    comment: "",
  });
  const notes = [
    // Week 1 (Sep 3): t1 yes x2, t2 no x1
    weeklyNote({
      id: "w1",
      noteDate: "2026-09-03",
      scores: [score("a", "t1", "yes"), score("b", "t1", "yes"), score("c", "t2", "no")],
    }),
    // Week 2 (Sep 10): t1 no x1, refused x1; t2 n/a x1
    weeklyNote({
      id: "w2",
      noteDate: "2026-09-10",
      scores: [score("d", "t1", "no"), score("e", "t1", "ref"), score("f", "t2", "na")],
    }),
    // Week 5 (Sep 29): t1 yes x1 — but deleted, so it must be skipped
    weeklyNote({
      id: "w3",
      noteDate: "2026-09-29",
      deletedAt: "2026-09-30T00:00:00Z",
      scores: [score("g", "t1", "yes")],
    }),
    // Week 3 (Sep 17): score for an unknown task — ignored
    weeklyNote({
      id: "w4",
      noteDate: "2026-09-17",
      scores: [score("h", "t9", "yes")],
    }),
  ];
  const summary = buildObjectiveScoreSummary(notes, tasks, captions, "2026-09");
  assert.equal(summary.length, 2);

  // t1: month totals — 2 yes, 1 no, 1 refused (deleted note skipped).
  const t1 = summary[0];
  assert.equal(t1.taskId, "t1");
  assert.equal(t1.taskNumber, 1);
  assert.equal(t1.taskTitle, "Community");
  assert.equal(t1.yes, 2);
  assert.equal(t1.no, 1);
  assert.equal(t1.refused, 1);
  assert.equal(t1.other, 0);
  assert.equal(t1.yesPercent, 50); // 2 of 4 scored attempts
  assert.deepEqual(
    { ...t1.weeks[0], dayRange: undefined },
    { week: 1, yes: 2, no: 0, refused: 0, other: 0, dayRange: undefined },
  );
  assert.deepEqual(
    { ...t1.weeks[1], dayRange: undefined },
    { week: 2, yes: 0, no: 1, refused: 1, other: 0, dayRange: undefined },
  );
  assert.equal(t1.weeks[4].dayRange, "29–30");
  assert.equal(t1.weeks[4].yes, 0); // deleted note contributes nothing
  // Every task always gets five week entries.
  assert.equal(t1.weeks.length, 5);

  // t2: 1 no + 1 N/A.
  const t2 = summary[1];
  assert.equal(t2.yes, 0);
  assert.equal(t2.no, 1);
  assert.equal(t2.other, 1);
  assert.equal(t2.yesPercent, 0);
});

test("issue #96 score summary: days scored + days unscored cover the month", () => {
  const tasks = [{ id: "t1", title: "Community" }];
  const captions = new Map([["yes", "Yes"]]);
  const score = (id: string) => ({
    id,
    noteId: "x",
    taskId: "t1",
    taskTitle: "",
    levelId: "yes",
    comment: "",
  });
  const notes = [
    // Two scores on the same day count once for days-scored purposes.
    weeklyNote({ noteDate: "2026-09-03", scores: [score("a"), score("b")] }),
    weeklyNote({ noteDate: "2026-09-17", scores: [score("c")] }),
  ];
  const [summary] = buildObjectiveScoreSummary(notes, tasks, captions, "2026-09");
  assert.equal(summary.yes, 3);
  assert.equal(summary.daysScored, 2);
  assert.equal(summary.daysUnscored, 28);
  assert.equal(summary.daysScored + summary.daysUnscored, daysInMonth("2026-09"));

  // An objective with no scores at all is fully unscored — never hidden.
  const [empty] = buildObjectiveScoreSummary([], tasks, captions, "2026-09");
  assert.equal(empty.yes, 0);
  assert.equal(empty.yesPercent, 0);
  assert.equal(empty.daysScored, 0);
  assert.equal(empty.daysUnscored, 30);
});

test("issue #96 score summary: missing caption falls into the other bucket", () => {
  const summary = buildObjectiveScoreSummary(
    [weeklyNote({ scores: [{ id: "a", noteId: "w", taskId: "t1", taskTitle: "", levelId: "mystery", comment: "" }] })],
    [{ id: "t1", title: "Community" }],
    new Map(),
    "2026-09",
  );
  assert.equal(summary[0].other, 1);
  assert.equal(summary[0].yesPercent, 0);
  assert.equal(summary[0].daysScored, 1);
});

test("issue #96 score summary: February week 5 has no days", () => {
  const [summary] = buildObjectiveScoreSummary([], [{ id: "t1", title: "T" }], new Map(), "2026-02");
  assert.equal(summary.weeks[4].dayRange, "");
  assert.equal(summary.weeks[3].dayRange, "22–28");
  assert.equal(summary.daysUnscored, 28);
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

test("issue #96 follow-up: CSV carries the monthly score summary", () => {
  const csv = buildNotesCsv([], "2026 ISP", [], [
    {
      taskId: "t1",
      taskTitle: "Community",
      taskNumber: 1,
      yes: 4,
      no: 1,
      refused: 0,
      other: 1,
      daysScored: 5,
      daysUnscored: 25,
      yesPercent: 67,
      weeks: [
        { week: 1, dayRange: "1–7", yes: 2, no: 0, refused: 0, other: 0 },
        { week: 2, dayRange: "8–14", yes: 1, no: 1, refused: 0, other: 1 },
        { week: 3, dayRange: "15–21", yes: 0, no: 0, refused: 0, other: 0 },
        { week: 4, dayRange: "22–28", yes: 1, no: 0, refused: 0, other: 0 },
        { week: 5, dayRange: "29–30", yes: 0, no: 0, refused: 0, other: 0 },
      ],
    },
  ]);
  assert.ok(csv.includes("Monthly score summary"));
  assert.ok(csv.includes('"Objective","Yes (month)","No (month)","Refused","N/A or other","Days scored","Days without scores","Yes %"'));
  assert.ok(csv.includes('"1. Community","4","1","0","1","5","25","67%"'));
  assert.ok(csv.includes("Weekly breakdown"));
  assert.ok(csv.includes('"1. Community","Week 2","8–14","1","1","0","1"'));
  // buildMonthlyScoreSummaryCsvRows mirrors the same section rows directly.
  const rows = buildMonthlyScoreSummaryCsvRows([]);
  assert.ok(rows.length > 0);
  assert.equal(rows[1][0], "Monthly score summary");
});
