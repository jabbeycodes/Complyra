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
 *   Day 06:00–14:00 · Evening 14:00–22:00 · Overnight 22:00–06:00 (next day).
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

/** Defaults ship; agency/HM edge retuning is a later concern (#75 lock). */
export const SHIFT_BLOCKS: Record<ShiftBlockId, ShiftBlockDef> = {
  day: { id: "day", label: "Day", startMin: 6 * 60, endMin: 14 * 60 },
  evening: { id: "evening", label: "Evening", startMin: 14 * 60, endMin: 22 * 60 },
  overnight: {
    id: "overnight",
    label: "Overnight",
    startMin: 22 * 60,
    endMin: 30 * 60, // 06:00 the next day
  },
};

export const SHIFT_BLOCK_ORDER: ShiftBlockId[] = ["day", "evening", "overnight"];

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

/** Map a stored / legacy shift label onto a cadence block, or null. */
export function blockForShiftLabel(shift: string): ShiftBlockId | null {
  const s = shift.trim().toLowerCase();
  if (s === "day" || s === "7a–3p" || s === "7a-3p") return "day";
  if (s === "evening" || s === "3p–11p" || s === "3p-11p") return "evening";
  if (s === "overnight" || s === "11p–7a" || s === "11p-7a") return "overnight";
  return null;
}

// ─────────────────────────── Shift-note detector ───────────────────────────

export interface ShiftNoteDetectorInput {
  /** Site-local calendar day being checked (the last completed day). */
  serviceDate: string;
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
  }[];
  /** HM alone-time windows for this site's Individuals. */
  aloneTime: AloneTimeWindow[];
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

/** One row per (Individual × block × required writer) with no covering note. */
export function computeShiftNoteDueItems(
  input: ShiftNoteDetectorInput,
): ShiftNoteDueItem[] {
  if (!input.staffed24h) return [];
  if (input.requiredWriters.length === 0) return [];
  const items: ShiftNoteDueItem[] = [];
  const day = input.serviceDate.slice(0, 10);
  const coStaffed = input.individuals.length > 1;

  for (const person of input.individuals) {
    const windows = applicableAloneWindows(input.aloneTime, person.id, day);
    for (const blockId of SHIFT_BLOCK_ORDER) {
      const def = SHIFT_BLOCKS[blockId];
      const alone = aloneIntervalsInBlock(windows, def.startMin, def.endMin);
      const remainder = staffedRemainder(def.startMin, def.endMin, alone);
      if (remainder.length === 0) continue; // 100% alone time → no requirement
      const rangeLabel = remainder
        .map(([s, e]) => formatRange(s, e))
        .join(", ");
      for (const writer of input.requiredWriters) {
        const covered = input.notes.some(
          (n) =>
            n.individualId === person.id &&
            n.staffUserId === writer.userId &&
            n.blockId === blockId &&
            n.noteDate.slice(0, 10) === day,
        );
        if (covered) continue;
        items.push({
          id: `sn:${day}:${person.id}:${blockId}:${writer.userId}`,
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
      if (input.nowMinutes < t - 60) continue; // before the window — future dose
      else if (input.nowMinutes <= t + 60) state = "due";
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
        windowEndLabel: formatClock(t + 60),
        state,
      });
    }
  }
  return items.sort((a, b) => {
    if (a.state !== b.state) return a.state === "overdue" ? -1 : 1;
    return hhmmToMinutes(a.doseTime) - hhmmToMinutes(b.doseTime);
  });
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
