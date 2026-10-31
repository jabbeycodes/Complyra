/**
 * Issue #75 (missing Shift notes) + #76 (unmarked scheduled meds) — the
 * site-detail Overview "due items" detectors.
 *
 * This module is PURE: it takes plain data gathered by whichever backend
 * (local or hosted) and returns typed due-item rows. All time math lives here
 * so the same rules are unit-tested once and reused everywhere.
 *
 * Wording rules (never break): "Individual/Individuals" only — never client /
 * patient / people / T-Log.
 *
 * ── Cadence (#75) ────────────────────────────────────────────────────────
 * v1 unit = shift BLOCK, three per site-local day (not hourly logs):
 *   Default Day 06:00–14:00 · Evening 14:00–22:00 · Overnight 22:00–06:00.
 *   A site sets each shift's own start and end, so a 6:30–3:00 day shift can
 *   overlap a 2:00–10:30 evening shift. A note clears only its own shift.
 * A required note = one Shift note per (on-duty staff × Individual) per block,
 * minus any hours carved out as HM "alone time". Data dependency: without a
 * real clock-in we treat assigned house DSPs as the on-duty writers and 24/7
 * houses as staffed every hour ("Based on assigned house staff.").
 *
 * ── Window (#76) ─────────────────────────────────────────────────────────
 * For a scheduled dose at time T: before T−1h nothing; T−1h..T+1h "due now"
 * (quiet); after T+1h with no MAR status → "Unmarked medication" overdue. Any
 * status (Given / Missed / LOA / On hold) clears the row. PRN never appears.
 * Alone time does NOT exempt meds.
 */

import type {
  AloneTimeWindow,
  MedDoseMark,
  MedDoseMarkStatus,
} from "./types";

// ───────────────────────────── Shift blocks ─────────────────────────────

export type ShiftBlockId = "day" | "evening" | "overnight";

export interface ShiftBlockDef {
  id: ShiftBlockId;
  label: string;
  /** Start minute-of-day (0..1440). */
  startMin: number;
  /** End minute in an extended timeline; overnight ends at 1800 (06:00 +1d). */
  endMin: number;
}

export interface ShiftStarts {
  dayStart: string;
  /** Omitted ends keep the older "this shift runs until the next start" clock. */
  dayEnd?: string;
  eveningStart: string;
  eveningEnd?: string;
  overnightStart: string;
  overnightEnd?: string;
}

/** Unconfigured houses keep the original 6 a.m. / 2 p.m. / 10 p.m. cadence. */
export const DEFAULT_SHIFT_STARTS: ShiftStarts = {
  dayStart: "06:00",
  dayEnd: "14:00",
  eveningStart: "14:00",
  eveningEnd: "22:00",
  overnightStart: "22:00",
  overnightEnd: "06:00",
};

/** A handoff can overlap. A shift still cannot be a sliver or a whole day. */
const MIN_SHIFT_MINUTES = 60;
const MAX_SHIFT_MINUTES = 16 * 60;

/** "HH:MM" in 24-hour form, or null when it is not a clock time. */
export function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function hasExplicitEnds(starts: ShiftStarts): boolean {
  return Boolean(starts.dayEnd || starts.eveningEnd || starts.overnightEnd);
}

/** End is next-day when the shift crosses midnight. A same-minute end is 24 hours. */
function windowEnd(start: number, end: number): number {
  return end > start ? end : end + 1440;
}

function blocksFromMinutes(
  day: number,
  evening: number,
  overnight: number,
): Record<ShiftBlockId, ShiftBlockDef> {
  const overnightStart = overnight < day ? overnight + 1440 : overnight;
  return {
    day: { id: "day", label: "Day", startMin: day, endMin: evening },
    evening: { id: "evening", label: "Evening", startMin: evening, endMin: overnightStart },
    overnight: {
      id: "overnight",
      label: "Overnight",
      startMin: overnightStart,
      endMin: day + 1440,
    },
  };
}

function blocksFromEnds(starts: ShiftStarts): Record<ShiftBlockId, ShiftBlockDef> {
  const day = parseClockMinutes(starts.dayStart) ?? 6 * 60;
  const dayEnd = parseClockMinutes(starts.dayEnd ?? "") ?? 14 * 60;
  const evening = parseClockMinutes(starts.eveningStart) ?? 14 * 60;
  const eveningEnd = parseClockMinutes(starts.eveningEnd ?? "") ?? 22 * 60;
  const overnight = parseClockMinutes(starts.overnightStart) ?? 22 * 60;
  const overnightEnd = parseClockMinutes(starts.overnightEnd ?? "") ?? 6 * 60;
  return {
    day: { id: "day", label: "Day", startMin: day, endMin: windowEnd(day, dayEnd) },
    evening: {
      id: "evening",
      label: "Evening",
      startMin: evening,
      endMin: windowEnd(evening, eveningEnd),
    },
    overnight: {
      id: "overnight",
      label: "Overnight",
      startMin: overnight,
      endMin: windowEnd(overnight, overnightEnd),
    },
  };
}

function durationProblem(label: string, start: number | null, end: number | null): string | null {
  if (start === null || end === null) return `Use a clock time for the ${label} shift.`;
  const span = windowEnd(start, end) - start;
  if (span < MIN_SHIFT_MINUTES) return `The ${label} shift has to last at least an hour.`;
  if (span > MAX_SHIFT_MINUTES) return `The ${label} shift can run at most 16 hours.`;
  return null;
}

/**
 * Why a site schedule cannot be used. Null means the clock is usable.
 * Explicit ends may overlap. Start-only clocks stay contiguous so older
 * saved houses do not change their windows.
 */
export function shiftScheduleProblem(starts: ShiftStarts): string | null {
  if (hasExplicitEnds(starts)) {
    if (!starts.dayEnd || !starts.eveningEnd || !starts.overnightEnd) {
      return "Each shift needs a start and an end.";
    }
    return (
      durationProblem("day", parseClockMinutes(starts.dayStart), parseClockMinutes(starts.dayEnd)) ??
      durationProblem(
        "evening",
        parseClockMinutes(starts.eveningStart),
        parseClockMinutes(starts.eveningEnd),
      ) ??
      durationProblem(
        "overnight",
        parseClockMinutes(starts.overnightStart),
        parseClockMinutes(starts.overnightEnd),
      )
    );
  }
  const day = parseClockMinutes(starts.dayStart);
  const evening = parseClockMinutes(starts.eveningStart);
  const overnight = parseClockMinutes(starts.overnightStart);
  if (day === null || evening === null || overnight === null) {
    return "Use a clock time for each shift.";
  }
  if (new Set([day, evening, overnight]).size < 3) {
    return "Each shift needs its own start time.";
  }
  if (evening <= day) return "Evening has to start after the day shift.";
  const overnightStart = overnight < day ? overnight + 1440 : overnight;
  if (overnightStart <= evening) {
    return "Overnight has to start after the evening shift.";
  }
  if (day + 1440 <= overnightStart) {
    return "Overnight has to finish when the next day shift starts.";
  }
  return null;
}

/** "HH:MM" for a minute on the extended timeline. */
export function minutesToHhmm(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Site facts use dayShiftStart; the detector uses dayStart. Ends may be absent. */
export function shiftClockFromFacts(facts: {
  dayShiftStart: string;
  dayShiftEnd?: string;
  eveningShiftStart: string;
  eveningShiftEnd?: string;
  overnightShiftStart: string;
  overnightShiftEnd?: string;
}): ShiftStarts {
  return {
    dayStart: facts.dayShiftStart,
    dayEnd: facts.dayShiftEnd,
    eveningStart: facts.eveningShiftStart,
    eveningEnd: facts.eveningShiftEnd,
    overnightStart: facts.overnightShiftStart,
    overnightEnd: facts.overnightShiftEnd,
  };
}

export function shiftBlocksForSite(facts: {
  dayShiftStart: string;
  dayShiftEnd?: string;
  eveningShiftStart: string;
  eveningShiftEnd?: string;
  overnightShiftStart: string;
  overnightShiftEnd?: string;
}): Record<ShiftBlockId, ShiftBlockDef> {
  return shiftBlocksFromStarts(shiftClockFromFacts(facts));
}

/** Site clock, or the default cadence when the saved times are unusable. */
export function shiftBlocksFromStarts(starts: ShiftStarts): Record<ShiftBlockId, ShiftBlockDef> {
  if (shiftScheduleProblem(starts)) {
    return blocksFromMinutes(6 * 60, 14 * 60, 22 * 60);
  }
  if (hasExplicitEnds(starts)) return blocksFromEnds(starts);
  const day = parseClockMinutes(starts.dayStart) ?? 6 * 60;
  const evening = parseClockMinutes(starts.eveningStart) ?? 14 * 60;
  const overnight = parseClockMinutes(starts.overnightStart) ?? 22 * 60;
  return blocksFromMinutes(day, evening, overnight);
}

/** Labels stored on a Shift note. The leading word is the block id. */
export function shiftNoteShiftOptions(starts: ShiftStarts): string[] {
  const blocks = shiftBlocksFromStarts(starts);
  return SHIFT_BLOCK_ORDER.map((id) => {
    const block = blocks[id];
    return `${block.label} ${formatRange(block.startMin, block.endMin)}`;
  });
}

export const SHIFT_BLOCKS: Record<ShiftBlockId, ShiftBlockDef> = shiftBlocksFromStarts(DEFAULT_SHIFT_STARTS);

/** "Day 6:00 a.m.–2:00 p.m. · Evening …" for the site facts row. */
export function shiftScheduleSummary(starts: ShiftStarts): string {
  const blocks = shiftBlocksFromStarts(starts);
  return SHIFT_BLOCK_ORDER.map((id) => {
    const block = blocks[id];
    return `${block.label} ${formatRange(block.startMin, block.endMin)}`;
  }).join(" · ");
}

export const SHIFT_BLOCK_ORDER: ShiftBlockId[] = ["day", "evening", "overnight"];

function localDayStart(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1).getTime();
}

function localIsoDate(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/** The wall-clock day and minute-of-day in a named zone. */
function zonedDayMinutes(when: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(when);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: hour * 60 + Number(read("minute")),
  };
}

/**
 * Wall-clock instant in a named zone, as UTC milliseconds.
 * Minutes may pass midnight (an overnight block ends the next morning).
 */
export function zonedWallTimeMs(isoDate: string, minutesOfDay: number, timeZone: string): number {
  const extraDays = Math.floor(minutesOfDay / 1440);
  const minuteOfDay = minutesOfDay - extraDays * 1440;
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const utcGuess = Date.UTC(
    year,
    (month || 1) - 1,
    (day || 1) + extraDays,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  let hour = read("hour");
  if (hour === 24) hour = 0;
  const shown = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return utcGuess - (shown - utcGuess);
}

/** True until this person's shift has ended plus the note grace. */
function shiftStillInGrace(
  startsAt: string,
  endsAt: string,
  serviceDate: string,
  now: Date | undefined,
  graceMinutes: number,
  timeZone?: string,
): boolean {
  if (!now || graceMinutes <= 0) return false;
  const span = shiftSpanOnServiceDate(startsAt, endsAt, serviceDate);
  if (!span) return false;
  const endMinutes = span.end + graceMinutes;
  const end = timeZone
    ? zonedWallTimeMs(serviceDate, endMinutes, timeZone)
    : localDayStart(serviceDate) + endMinutes * 60_000;
  return now.getTime() < end;
}

/** True until the block has ended plus the agency's note grace. */
function blockStillInGrace(
  serviceDate: string,
  block: ShiftBlockDef,
  now: Date | undefined,
  graceMinutes: number,
  timeZone?: string,
): boolean {
  if (!now || graceMinutes <= 0) return false;
  const endMinutes = block.endMin + graceMinutes;
  const end = timeZone
    ? zonedWallTimeMs(serviceDate, endMinutes, timeZone)
    : localDayStart(serviceDate) + endMinutes * 60_000;
  return now.getTime() < end;
}

// ───────────────────────────── Time helpers ─────────────────────────────

/** "HH:MM" (24-hour) → minutes-of-day. Tolerant of bad input (returns 0). */
export function hhmmToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return h * 60 + m;
}

/** minutes (mod 1440) → { text: "6:00", mer: "a.m." }. */
export function clockParts(minute: number): { text: string; mer: "a.m." | "p.m." } {
  const m = ((minute % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const mer = h24 < 12 ? "a.m." : "p.m.";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { text: `${h12}:${String(mm).padStart(2, "0")}`, mer };
}

/** Single clock label, e.g. "8:00 a.m.". */
export function formatClock(minute: number): string {
  const { text, mer } = clockParts(minute);
  return `${text} ${mer}`;
}

/** Range label; the leading meridiem is dropped when both sides share it. */
export function formatRange(startMin: number, endMin: number): string {
  const a = clockParts(startMin);
  const b = clockParts(endMin);
  if (a.mer === b.mer) return `${a.text}–${b.text} ${b.mer}`;
  return `${a.text} ${a.mer}–${b.text} ${b.mer}`;
}

/** 0=Sunday..6=Saturday for an ISO date, read at local noon to dodge tz edges. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00`).getDay();
}

type Interval = [number, number];

function intersect(a0: number, a1: number, b0: number, b1: number): Interval | null {
  const s = Math.max(a0, b0);
  const e = Math.min(a1, b1);
  return e > s ? [s, e] : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) return [...intervals];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [sorted[0]];
  for (const [s, e] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Alone-time hours that fall inside a block, mapped into the block timeline. */
function aloneIntervalsInBlock(
  windows: AloneTimeWindow[],
  blockStart: number,
  blockEnd: number,
): Interval[] {
  const hits: Interval[] = [];
  for (const w of windows) {
    let s = hhmmToMinutes(w.startTime);
    let e = hhmmToMinutes(w.endTime);
    if (e <= s) e += 1440; // wraps past midnight
    // Test the window at day offsets so overnight blocks (1320..1800) match.
    for (const off of [-1440, 0, 1440]) {
      const hit = intersect(s + off, e + off, blockStart, blockEnd);
      if (hit) hits.push(hit);
    }
  }
  return mergeIntervals(hits);
}

/** Block minus alone-time = the sub-intervals a note is still required for. */
export function staffedRemainder(
  blockStart: number,
  blockEnd: number,
  aloneMerged: Interval[],
): Interval[] {
  const res: Interval[] = [];
  let cursor = blockStart;
  for (const [s, e] of aloneMerged) {
    if (s > cursor) res.push([cursor, Math.min(s, blockEnd)]);
    cursor = Math.max(cursor, e);
    if (cursor >= blockEnd) break;
  }
  if (cursor < blockEnd) res.push([cursor, blockEnd]);
  return res.filter(([s, e]) => e > s);
}

/** Windows that apply to an Individual on a given service date. */
export function applicableAloneWindows(
  windows: AloneTimeWindow[],
  individualId: string,
  serviceDate: string,
): AloneTimeWindow[] {
  const wd = weekdayOf(serviceDate);
  const day = serviceDate.slice(0, 10);
  return windows.filter(
    (w) =>
      !w.deletedAt &&
      w.individualId === individualId &&
      ((w.recurrence === "weekly" && w.weekday === wd) ||
        (w.recurrence === "once" && (w.onDate ?? "").slice(0, 10) === day)),
  );
}

/**
 * Map a stored shift label onto a cadence block, or null.
 * New notes lead with the block name ("Day 6:30 a.m.–3:00 p.m.").
 * Older notes keep the fixed 7a–3p / 3p–11p / 11p–7a labels.
 */
export function blockForShiftLabel(shift: string): ShiftBlockId | null {
  const s = shift.trim().toLowerCase();
  if (s === "day" || s.startsWith("day ") || s === "7a–3p" || s === "7a-3p") return "day";
  if (s === "evening" || s.startsWith("evening ") || s === "3p–11p" || s === "3p-11p") return "evening";
  if (s === "overnight" || s.startsWith("overnight ") || s === "11p–7a" || s === "11p-7a") {
    return "overnight";
  }
  return null;
}

// ─────────────────────────── Shift-note detector ───────────────────────────

export interface ShiftNoteDetectorInput {
  /** Site-local calendar day being checked (the last completed day). */
  serviceDate: string;
  /**
   * When set with graceMinutes, a block is not missing until that many
   * minutes after it ends. Omitted keeps the original "day is complete" check.
   */
  now?: Date;
  graceMinutes?: number;
  /**
   * When set, grace is judged in this zone. The signed-in app omits it and
   * keeps the machine clock. The unattended job passes America/Chicago.
   */
  timeZone?: string;
  /** 24/7 houses require coverage every staffed hour; others are exempt in v1. */
  staffed24h: boolean;
  /** Individuals on the site roster for the day. */
  individuals: { id: string; name: string }[];
  /** On-duty writers — assigned house DSPs in the no-clock-in v1. */
  requiredWriters: { userId: string; name: string }[];
  /** Existing notes, already scoped to this site's Individuals. */
  notes: {
    individualId: string;
    staffUserId: string;
    blockId: ShiftBlockId | null;
    noteDate: string;
    /** Set when the note was filed against a staff shift. */
    hrShiftId?: string | null;
  }[];
  /**
   * Published or scheduled staff shifts for this house and service date.
   * A shift with a person covers only the hours it actually spans. A row with
   * an empty staff id is an open posting: it marks the day as scheduled and
   * the usual DSP for that block still owes the note until someone takes it.
   * An empty list means the house has no schedule, so every assigned DSP owes notes.
   */
  scheduledShifts?: Array<{
    id: string;
    staffUserId: string;
    staffName: string;
    startsAt: string;
    endsAt: string;
  }>;
  /** HM alone-time windows for this site's Individuals. */
  aloneTime: AloneTimeWindow[];
  /** This site's shift clock. Omitted houses use the 6 a.m. default. */
  blocks?: Record<ShiftBlockId, ShiftBlockDef>;
}

export interface ShiftNoteDueItem {
  id: string;
  individualId: string;
  individualName: string;
  blockId: ShiftBlockId;
  blockLabel: string;
  rangeLabel: string;
  staffUserId: string;
  staffName: string;
  reason: string;
  serviceDate: string;
}

function chicagoDateMinutes(iso: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: hour * 60 + Number(read("minute")),
  };
}

function minutesFromServiceDate(part: { date: string; minutes: number }, serviceDate: string): number {
  const [year, month, day] = serviceDate.slice(0, 10).split("-").map(Number);
  const [partYear, partMonth, partDay] = part.date.split("-").map(Number);
  const dayDiff = Math.round(
    (Date.UTC(partYear, (partMonth || 1) - 1, partDay || 1) - Date.UTC(year, (month || 1) - 1, day || 1)) / 86_400_000,
  );
  return dayDiff * 1440 + part.minutes;
}

/** The shift's start and end as minutes on the service-date timeline. */
export function shiftSpanOnServiceDate(
  startsAt: string,
  endsAt: string,
  serviceDate: string,
): { start: number; end: number } | null {
  const start = minutesFromServiceDate(chicagoDateMinutes(startsAt), serviceDate);
  const end = minutesFromServiceDate(chicagoDateMinutes(endsAt), serviceDate);
  if (!(end > start)) return null;
  return { start, end };
}

function rangesOverlap(start: number, end: number, blockStart: number, blockEnd: number): boolean {
  return start < blockEnd && blockStart < end;
}

/**
 * The assigned DSP who owes an open block once the house has published a week.
 * Day, evening, and overnight walk the roster in name order and wrap.
 */
export function usualOwnerForBlock(
  writers: { userId: string; name: string }[],
  blockId: ShiftBlockId,
): { userId: string; name: string } | null {
  if (writers.length === 0) return null;
  const index = blockId === "day" ? 0 : blockId === "evening" ? 1 : 2;
  return writers[index % writers.length] ?? writers[0];
}

/** True when the spans together cover the whole block. A partial shift does not. */
export function blockFullyCovered(
  spans: Array<{ start: number; end: number }>,
  blockStart: number,
  blockEnd: number,
): boolean {
  const pieces = spans
    .filter((span) => span.end > blockStart && span.start < blockEnd)
    .map((span) => [Math.max(span.start, blockStart), Math.min(span.end, blockEnd)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let cursor = blockStart;
  for (const [start, end] of pieces) {
    if (start > cursor) return false;
    cursor = Math.max(cursor, end);
    if (cursor >= blockEnd) return true;
  }
  return cursor >= blockEnd;
}

function writersForBlock(
  input: ShiftNoteDetectorInput,
  block: ShiftBlockDef,
): Array<{ userId: string; name: string; shiftId: string | null }> {
  const day = input.serviceDate.slice(0, 10);
  const blocks = input.blocks ?? SHIFT_BLOCKS;
  const dayStart = blocks.day.startMin;
  const dayEnd = blocks.overnight.endMin;
  // Only shifts that touch this service date count as "the house is on a schedule".
  // The hosted query loads a 36-hour window, so a shift published for the next
  // morning overlaps none of today's blocks and must not suppress the assigned-DSP
  // fallback for an otherwise unscheduled day.
  const scheduled = (input.scheduledShifts ?? []).filter((shift) => {
    const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, day);
    return span !== null && rangesOverlap(span.start, span.end, dayStart, dayEnd);
  });
  const covering = scheduled.flatMap((shift) => {
    if (!shift.staffUserId) return [];
    const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, day);
    if (!span || !rangesOverlap(span.start, span.end, block.startMin, block.endMin)) return [];
    return [{ userId: shift.staffUserId, name: shift.staffName, shiftId: shift.id, start: span.start, end: span.end }];
  });
  const dayHasSchedule = scheduled.some((shift) => {
    const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, day);
    return Boolean(span && span.start < 1440 && span.end > 0);
  });
  const owner = usualOwnerForBlock(input.requiredWriters, block.id);
  const unique = covering.filter((writer, index) => covering.findIndex((row) => row.userId === writer.userId) === index);
  if (unique.length > 0 && blockFullyCovered(unique, block.startMin, block.endMin)) {
    return unique.map(({ userId, name, shiftId }) => ({ userId, name, shiftId }));
  }
  if (unique.length > 0) {
    const writers: Array<{ userId: string; name: string; shiftId: string | null }> = unique.map(
      ({ userId, name, shiftId }) => ({ userId, name, shiftId }),
    );
    const gapOwner = owner && writers.some((writer) => writer.userId === owner.userId)
      ? input.requiredWriters.find((writer) => writer.userId !== owner.userId) ?? null
      : owner;
    if (gapOwner && !writers.some((writer) => writer.userId === gapOwner.userId)) {
      writers.push({ userId: gapOwner.userId, name: gapOwner.name, shiftId: null });
    }
    return writers;
  }
  // A published week names one person for the open block. An empty week stays
  // with every assigned DSP, which is how the demo gap is still Alex's.
  if (dayHasSchedule && owner) return [{ userId: owner.userId, name: owner.name, shiftId: null }];
  return input.requiredWriters.map((writer) => ({ userId: writer.userId, name: writer.name, shiftId: null }));
}

/**
 * The staff shift this note documents, when the house published one.
 * Clock times win. A note without clocks uses the block it was filed under.
 */
export function matchingShiftId(input: {
  shifts: Array<{ id: string; staffUserId: string; startsAt: string; endsAt: string }>;
  staffUserId: string;
  noteDate: string;
  beginTime?: string;
  endTime?: string;
  block: ShiftBlockDef | null;
}): string | null {
  let noteStart: number | null = null;
  let noteEnd: number | null = null;
  if (input.beginTime && input.endTime) {
    noteStart = hhmmToMinutes(input.beginTime);
    noteEnd = hhmmToMinutes(input.endTime);
    if (noteEnd <= noteStart) noteEnd += 1440;
  } else if (input.block) {
    noteStart = input.block.startMin;
    noteEnd = input.block.endMin;
  }
  if (noteStart === null || noteEnd === null) return null;
  let best: { id: string; overlap: number } | null = null;
  for (const shift of input.shifts) {
    if (shift.staffUserId !== input.staffUserId) continue;
    const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, input.noteDate);
    if (!span) continue;
    const overlap = Math.min(span.end, noteEnd) - Math.max(span.start, noteStart);
    if (overlap <= 0) continue;
    if (!best || overlap > best.overlap) best = { id: shift.id, overlap };
  }
  return best?.id ?? null;
}

/** One row per (Individual × block × required writer) with no covering note. */
export function computeShiftNoteDueItems(
  input: ShiftNoteDetectorInput,
): ShiftNoteDueItem[] {
  if (!input.staffed24h) return [];
  if ((input.scheduledShifts?.length ?? 0) === 0 && input.requiredWriters.length === 0) return [];
  const items: ShiftNoteDueItem[] = [];
  const day = input.serviceDate.slice(0, 10);
  const coStaffed = input.individuals.length > 1;
  const blocks = input.blocks ?? SHIFT_BLOCKS;

  for (const person of input.individuals) {
    const windows = applicableAloneWindows(input.aloneTime, person.id, day);
    for (const blockId of SHIFT_BLOCK_ORDER) {
      const def = blocks[blockId];
      const alone = aloneIntervalsInBlock(windows, def.startMin, def.endMin);
      const remainder = staffedRemainder(def.startMin, def.endMin, alone);
      if (remainder.length === 0) continue; // 100% alone time → no requirement
      const rangeLabel = remainder
        .map(([s, e]) => formatRange(s, e))
        .join(", ");
      const scheduled = input.scheduledShifts ?? [];
      const writers = writersForBlock(input, def);
      const coveredBySchedule = writers.some((writer) => writer.shiftId);
      if (!coveredBySchedule && blockStillInGrace(day, def, input.now, input.graceMinutes ?? 0, input.timeZone)) continue;
      for (const writer of writers) {
        if (writer.shiftId) {
          const shift = scheduled.find((row) => row.id === writer.shiftId);
          if (
            shift &&
            shiftStillInGrace(
              shift.startsAt,
              shift.endsAt,
              day,
              input.now,
              input.graceMinutes ?? 0,
              input.timeZone,
            )
          ) {
            continue;
          }
        }
        const covered = input.notes.some(
          (n) =>
            n.individualId === person.id &&
            n.noteDate.slice(0, 10) === day &&
            (writer.shiftId
              ? n.hrShiftId === writer.shiftId ||
                (!n.hrShiftId && n.staffUserId === writer.userId && n.blockId === blockId)
              : !n.hrShiftId && n.staffUserId === writer.userId && n.blockId === blockId),
        );
        if (covered) continue;
        items.push({
          id: writer.shiftId
            ? `sn:${day}:${person.id}:${blockId}:${writer.shiftId}`
            : `sn:${day}:${person.id}:${blockId}:${writer.userId}`,
          individualId: person.id,
          individualName: person.name,
          blockId,
          blockLabel: def.label,
          rangeLabel,
          staffUserId: writer.userId,
          staffName: writer.name,
          reason: coStaffed
            ? `Co-documentation — ${writer.name} is on duty with the house`
            : "Staffed 24/7 · no note for this window",
          serviceDate: day,
        });
      }
    }
  }
  return items;
}

// ─────────────────────────── Unmarked-meds detector ───────────────────────────

export interface ScheduledDose {
  individualId: string;
  individualName: string;
  medicationId: string;
  medName: string;
  strength: string;
  /** Scheduled dose times "HH:MM"; PRN meds contribute none. */
  doseTimes: string[];
}

export interface MedDetectorInput {
  /** Site-local calendar day whose doses are being checked (today). */
  doseDate: string;
  /** Site-local minutes-of-day "now" (0..1440). */
  nowMinutes: number;
  scheduledDoses: ScheduledDose[];
  marks: Pick<MedDoseMark, "medicationId" | "doseDate" | "doseTime" | "status">[];
  /** Minutes before the dose time the window opens. Default 60. */
  windowBeforeMinutes?: number;
  /** Minutes after the dose time the window stays open. Default 60. */
  windowAfterMinutes?: number;
}

export type MedDueState = "overdue" | "due";

export interface MedDueItem {
  id: string;
  individualId: string;
  individualName: string;
  medicationId: string;
  medName: string;
  strength: string;
  doseTime: string;
  doseDate: string;
  scheduledLabel: string;
  windowEndLabel: string;
  state: MedDueState;
}

/** One row per unmarked scheduled dose once its window is open or elapsed. */
export function computeMedDueItems(input: MedDetectorInput): MedDueItem[] {
  const day = input.doseDate.slice(0, 10);
  const before = input.windowBeforeMinutes ?? 60;
  const after = input.windowAfterMinutes ?? 60;
  const items: MedDueItem[] = [];
  for (const dose of input.scheduledDoses) {
    for (const time of dose.doseTimes) {
      const t = hhmmToMinutes(time);
      const marked = input.marks.some(
        (m) =>
          m.medicationId === dose.medicationId &&
          m.doseDate.slice(0, 10) === day &&
          m.doseTime === time,
      );
      if (marked) continue;
      let state: MedDueState;
      if (input.nowMinutes < t - before) continue; // before the window — future dose
      else if (input.nowMinutes <= t + after) state = "due";
      else state = "overdue";
      items.push({
        id: `md:${day}:${dose.medicationId}:${time}`,
        individualId: dose.individualId,
        individualName: dose.individualName,
        medicationId: dose.medicationId,
        medName: dose.medName,
        strength: dose.strength,
        doseTime: time,
        doseDate: day,
        scheduledLabel: formatClock(t),
        windowEndLabel: formatClock(t + after),
        state,
      });
    }
  }
  return items.sort((a, b) => {
    if (a.state !== b.state) return a.state === "overdue" ? -1 : 1;
    return hhmmToMinutes(a.doseTime) - hhmmToMinutes(b.doseTime);
  });
}

/**
 * Why a MAR mark is too early, or null when recording is allowed.
 * Past dates stay open so a late mark can still be recorded.
 */
export function marRecordingProblem(input: {
  doseDate: string;
  doseTime: string;
  now: Date;
  windowBeforeMinutes: number;
  blockEarly: boolean;
  /**
   * Judge "now" in this zone so the gate matches the Central dose clock the
   * Overview and Notifications use. Omitted keeps the device's local clock.
   */
  timeZone?: string;
}): string | null {
  if (!input.blockEarly) return null;
  const doseDay = input.doseDate.slice(0, 10);
  const nowClock = input.timeZone
    ? zonedDayMinutes(input.now, input.timeZone)
    : { date: localIsoDate(input.now), minutes: input.now.getHours() * 60 + input.now.getMinutes() };
  const nowDay = nowClock.date;
  if (doseDay < nowDay) return null;
  if (doseDay > nowDay) return "That dose is not open yet.";
  const scheduled = hhmmToMinutes(input.doseTime);
  const nowMinutes = nowClock.minutes;
  if (nowMinutes < scheduled - input.windowBeforeMinutes) {
    return `This dose opens ${input.windowBeforeMinutes} minutes before ${formatClock(scheduled)}.`;
  }
  return null;
}

/**
 * True when a mark recorded at `now` falls after the dose window's end
 * (dose time + windowAfterMinutes), judged on the same zoned clock as
 * marRecordingProblem. A dose dated before today is always late; a dose
 * dated after today is never late. Late marks stay allowed, but the APIs
 * require a brief reason and stamp the mark Late.
 */
export function marLateRecording(input: {
  doseDate: string;
  doseTime: string;
  now: Date;
  windowAfterMinutes: number;
  /** Judge "now" in this zone (the Central dose clock). Omitted = device local. */
  timeZone?: string;
}): boolean {
  const doseDay = input.doseDate.slice(0, 10);
  const nowClock = input.timeZone
    ? zonedDayMinutes(input.now, input.timeZone)
    : { date: localIsoDate(input.now), minutes: input.now.getHours() * 60 + input.now.getMinutes() };
  if (doseDay < nowClock.date) return true;
  if (doseDay > nowClock.date) return false;
  return nowClock.minutes > hhmmToMinutes(input.doseTime) + input.windowAfterMinutes;
}

/** True once the dose window has been closed longer than the late-recording allowance. */
export function recordingCostsAPoint(input: {
  doseDate: string;
  doseTime: string;
  now: Date;
  windowAfterMinutes: number;
  lateAfterHours: number;
}): boolean {
  const scheduled = localDayStart(input.doseDate) + hhmmToMinutes(input.doseTime) * 60_000;
  const deductAt = scheduled + input.windowAfterMinutes * 60_000 + input.lateAfterHours * 3_600_000;
  return input.now.getTime() > deductAt;
}

/** Leading refused rows for one medication, newest first. A non-refusal breaks the streak. */
export function consecutiveRefusals(
  rows: { medicationId: string; kind: string; createdAt: string }[],
  medicationId: string,
): number {
  const mine = rows
    .filter((row) => row.medicationId === medicationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let count = 0;
  for (const row of mine) {
    if (row.kind !== "refused") break;
    count += 1;
  }
  return count;
}

// ─────────────────────────── Combined typed rows ───────────────────────────

export type SiteDueItemKind = "shift_note" | "medication";

export interface SiteDueItem {
  id: string;
  kind: SiteDueItemKind;
  /** "overdue" uses the attention color; "due" is the quiet in-window cue. */
  severity: MedDueState;
  individualId: string;
  individualName: string;
  title: string;
  line2: string;
  line3: string;
  reason?: string;
  /** Prefill payload for the "Add note" CTA. */
  shift?: {
    blockId: ShiftBlockId;
    blockLabel: string;
    serviceDate: string;
    staffUserId: string;
    staffName: string;
  };
  /** Focus payload for the "Open MAR" CTA. */
  med?: { medicationId: string; doseTime: string; doseDate: string };
}

/** Empty-state copy for the Overview due-items list (#75 lock). */
export const DUE_ITEMS_EMPTY_COPY = "No missing Shift notes.";

export interface SiteDueItemsResult {
  items: SiteDueItem[];
  shiftNoteCount: number;
  medCount: number;
  /** True when writers were inferred from assignments (no real clock-in). */
  basedOnAssignedStaff: boolean;
  serviceDate: string;
  doseDate: string;
}

export function buildSiteDueItems(
  shiftNoteItems: ShiftNoteDueItem[],
  medItems: MedDueItem[],
): SiteDueItem[] {
  const rows: SiteDueItem[] = [];

  for (const s of shiftNoteItems) {
    rows.push({
      id: s.id,
      kind: "shift_note",
      severity: "overdue",
      individualName: s.individualName,
      individualId: s.individualId,
      title: "Missing Shift note",
      line2: `${firstName(s.individualName)} · ${s.blockLabel} · ${s.rangeLabel}`,
      line3: `Needed from ${s.staffName}`,
      reason: s.reason,
      shift: {
        blockId: s.blockId,
        blockLabel: s.blockLabel,
        serviceDate: s.serviceDate,
        staffUserId: s.staffUserId,
        staffName: s.staffName,
      },
    });
  }

  for (const m of medItems) {
    const overdue = m.state === "overdue";
    rows.push({
      id: m.id,
      kind: "medication",
      severity: m.state,
      individualName: m.individualName,
      individualId: m.individualId,
      title: overdue ? "Unmarked medication" : "Due now",
      line2: `${firstName(m.individualName)} · ${m.medName} ${m.strength} · ${m.scheduledLabel}`,
      line3: overdue
        ? `Window ended ${m.windowEndLabel} · still not marked`
        : `Mark by ${m.windowEndLabel}`,
      med: { medicationId: m.medicationId, doseTime: m.doseTime, doseDate: m.doseDate },
    });
  }

  // Attention (overdue) rows first, then the quiet in-window "due now" cues.
  return rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "overdue" ? -1 : 1;
    return 0;
  });
}

/** Goes-by / legal first name for the compact due-item line. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Issue #75 — who may create / edit / delete HM alone-time windows. House
 * manager + Admin only; DSP / Nurse / PM are read-only (they see the windows
 * so they don't over-document, but cannot change them).
 */
export function canEditAloneTime(roleKey: string): boolean {
  return ["administrator", "house_manager"].includes(roleKey);
}
