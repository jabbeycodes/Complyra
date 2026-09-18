/**
 * Issue #96 — pure aggregation logic for the monthly shift notes report.
 *
 * All functions here are side-effect free so the report math (day-grid
 * bucketing, staff initials, signature log, CSV) is unit-testable without
 * the API layer.
 *
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */

import { canConfigureIspTasks } from "../../data/permissions";
import {
  type IspProgramView,
  type ShiftNoteView,
} from "../../data/shiftNotes";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-17" -> "2026-09". */
export function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function isValidMonthKey(monthKey: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey);
}

export function monthStartOf(monthKey: string): string {
  return `${monthKey}-01`;
}

export function monthEndOf(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

export function daysInMonth(monthKey: string): number {
  return Number(monthEndOf(monthKey).slice(8, 10));
}

/** "2026-09" -> "September 2026". */
export function monthDisplayLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

/**
 * The ISP program the monthly report covers: the latest approved program for
 * the Individual whose effective range covers the selected month (not
 * necessarily "today", so past months report against the program that was
 * active then). Draft programs are never returned.
 */
export function reportProgramForMonth(
  programs: IspProgramView[],
  individualId: string,
  monthKey: string,
): IspProgramView | null {
  const start = monthStartOf(monthKey);
  const end = monthEndOf(monthKey);
  const candidates = programs.filter(
    (program) =>
      program.individualId === individualId &&
      program.status === "approved" &&
      program.effectiveOn.slice(0, 10) <= end &&
      program.expiresOn.slice(0, 10) >= start,
  );
  candidates.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  return candidates[0] ?? null;
}

/** Shift notes (non-deleted) whose note date falls in the given month. */
export function notesInMonth(notes: ShiftNoteView[], monthKey: string): ShiftNoteView[] {
  return notes.filter(
    (note) => !note.deletedAt && monthKeyOf(note.noteDate) === monthKey,
  );
}

/**
 * Bucket notes by day-of-month. Each day's notes are sorted by shift then
 * creation time so the grid is stable.
 */
export function bucketNotesByDay(notes: ShiftNoteView[]): Map<number, ShiftNoteView[]> {
  const buckets = new Map<number, ShiftNoteView[]>();
  for (const note of notes) {
    const day = Number(note.noteDate.slice(8, 10));
    if (!Number.isFinite(day) || day < 1) continue;
    const list = buckets.get(day) ?? [];
    list.push(note);
    buckets.set(day, list);
  }
  for (const list of buckets.values()) {
    list.sort(
      (a, b) => a.shift.localeCompare(b.shift) || a.createdAt.localeCompare(b.createdAt),
    );
  }
  return buckets;
}

/** "Jean Masumbuko" -> "JM"; "Sam" -> "SA"; "" -> "". */
export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface SignatureEntry {
  staffUserId: string;
  name: string;
  initials: string;
  title: string;
}

/**
 * Every staff member who recorded notes in the set, deduplicated, sorted by
 * name. Titles come from the agency staff directory when available.
 */
export function collectSignatureLog(
  notes: ShiftNoteView[],
  staffTitleByUserId?: Map<string, string>,
): SignatureEntry[] {
  const byUser = new Map<string, SignatureEntry>();
  for (const note of notes) {
    if (!byUser.has(note.staffUserId)) {
      byUser.set(note.staffUserId, {
        staffUserId: note.staffUserId,
        name: note.staffName || "Staff member",
        initials: initialsForName(note.staffName),
        title: staffTitleByUserId?.get(note.staffUserId) ?? "",
      });
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Cell text for one task on one day: "Y · JM" entries stacked per note. */
export function dayCellEntries(
  taskId: string,
  dayNotes: ShiftNoteView[],
  shortLabelByLevelId: Map<string, string>,
): string[] {
  const entries: string[] = [];
  for (const note of dayNotes) {
    for (const score of note.scores) {
      if (score.taskId !== taskId) continue;
      const label = shortLabelByLevelId.get(score.levelId) ?? "?";
      entries.push(`${label} · ${initialsForName(note.staffName)}`);
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Weekly task score summary chart (founder request: clarity over the  */
/* Therap-style grid — per-task Yes/No counts for each week).          */
/* ------------------------------------------------------------------ */

/**
 * The chart bucket a score level falls into. Scoring levels are
 * agency-defined, so this maps by caption: anything not recognizably
 * Yes/No/Refused (e.g. "N/A", "Not applicable", custom levels) lands in
 * "other" and is rendered as a muted segment so nothing is hidden.
 */
export type ScoreBucket = "yes" | "no" | "refused" | "other";

export function scoreBucketForLevelCaption(caption: string): ScoreBucket {
  const text = caption.trim().toLowerCase();
  if (text === "yes") return "yes";
  if (text === "no") return "no";
  if (text === "refused") return "refused";
  return "other";
}

/**
 * Week of the month, 1–5, as plain 7-day chunks: days 1–7 → week 1,
 * 8–14 → week 2, 15–21 → week 3, 22–28 → week 4, 29–end → week 5.
 * Simple and unambiguous on a printed report.
 */
export function weekOfMonthIndex(day: number): number {
  return Math.min(5, Math.max(1, Math.ceil(day / 7)));
}

/**
 * Day-range label for a week, e.g. "1–7". Returns "" when the week has no
 * days in the month (week 5 of February); the UI skips those rows.
 */
export function weekDayRangeLabel(monthKey: string, week: number): string {
  const days = daysInMonth(monthKey);
  const start = (week - 1) * 7 + 1;
  if (start > days) return "";
  return `${start}–${Math.min(week * 7, days)}`;
}

export interface WeeklyScoreCounts {
  yes: number;
  no: number;
  refused: number;
  other: number;
  total: number;
}

export interface TaskWeeklySummary {
  taskId: string;
  taskTitle: string;
  /** Five entries: weeks 1–5. */
  weeks: WeeklyScoreCounts[];
}

export interface WeeklyTaskRef {
  id: string;
  title: string;
}

function emptyWeeklyCounts(): WeeklyScoreCounts {
  return { yes: 0, no: 0, refused: 0, other: 0, total: 0 };
}

/**
 * Per-task, per-week score counts for the chart. Pass notes already filtered
 * to the month (notesInMonth). Scores for tasks not in `tasks` are ignored;
 * deleted notes are skipped.
 */
export function buildWeeklyScoreSummary(
  notes: ShiftNoteView[],
  tasks: WeeklyTaskRef[],
  levelCaptionById: Map<string, string>,
): TaskWeeklySummary[] {
  const indexByTaskId = new Map(tasks.map((task, index) => [task.id, index]));
  const perTask: WeeklyScoreCounts[][] = tasks.map(() =>
    Array.from({ length: 5 }, emptyWeeklyCounts),
  );
  for (const note of notes) {
    if (note.deletedAt) continue;
    const day = Number(note.noteDate.slice(8, 10));
    if (!Number.isFinite(day) || day < 1) continue;
    const week = weekOfMonthIndex(day) - 1;
    for (const score of note.scores) {
      const taskIndex = indexByTaskId.get(score.taskId);
      if (taskIndex === undefined) continue;
      const bucket = scoreBucketForLevelCaption(
        levelCaptionById.get(score.levelId) ?? "",
      );
      perTask[taskIndex][week][bucket] += 1;
      perTask[taskIndex][week].total += 1;
    }
  }
  return tasks.map((task, index) => ({
    taskId: task.id,
    taskTitle: task.title,
    weeks: perTask[index],
  }));
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export interface ReportLevel {
  id: string;
  caption: string;
  shortLabel: string;
}

/**
 * Raw month's notes as CSV: one row per task score so every data point is
 * preserved. Column order is stable for case-manager handoffs.
 */
export function buildNotesCsv(
  notes: ShiftNoteView[],
  programName: string,
  levels: ReportLevel[],
): string {
  const captionById = new Map(levels.map((level) => [level.id, level.caption]));
  const shortById = new Map(levels.map((level) => [level.id, level.shortLabel]));
  const header = [
    "Program",
    "Date",
    "Shift",
    "Staff",
    "Task",
    "Score",
    "Score short",
    "Score comment",
    "Shift summary",
    "Time spent (min)",
  ];
  const rows: string[][] = [header];
  const sorted = [...notes].sort(
    (a, b) => a.noteDate.localeCompare(b.noteDate) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const note of sorted) {
    if (note.scores.length === 0) {
      rows.push([
        programName,
        note.noteDate,
        note.shift,
        note.staffName,
        "",
        "",
        "",
        "",
        note.summary,
        note.timeSpentMinutes === null ? "" : String(note.timeSpentMinutes),
      ]);
      continue;
    }
    for (const score of note.scores) {
      rows.push([
        programName,
        note.noteDate,
        note.shift,
        note.staffName,
        score.taskTitle,
        captionById.get(score.levelId) ?? score.levelId,
        shortById.get(score.levelId) ?? "",
        score.comment,
        note.summary,
        note.timeSpentMinutes === null ? "" : String(note.timeSpentMinutes),
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Writing/signing the monthly summary is gated to PMs and administrators. */
export function canWriteMonthlySummary(roleKey: string): boolean {
  return canConfigureIspTasks(roleKey);
}

export function canSignMonthlySummary(
  roleKey: string,
  signedAt: string,
): boolean {
  return canWriteMonthlySummary(roleKey) && signedAt === "";
}

export function canReopenMonthlySummary(
  roleKey: string,
  signedAt: string,
): boolean {
  return canWriteMonthlySummary(roleKey) && signedAt !== "";
}
