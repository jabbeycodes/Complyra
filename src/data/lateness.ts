/**
 * Running lateness balance, recognition-point cap, and reminder slots.
 *
 * Pure on purpose: LocalApi keeps the rows, HostedApi keeps an audit line.
 * A write-up can reset the balance the next event sees. The history stays.
 */
import { SHIFT_BLOCKS, blockForShiftLabel, type ShiftBlockDef, type ShiftBlockId } from "./dueItems";

export type LatenessKind = "late_recording" | "late_note" | "late_clock_in";

export interface LatenessEntry {
  id: string;
  agencyId: string;
  userId: string;
  kind: LatenessKind;
  points: number;
  occurredAt: string;
  sourceKey: string;
  /** True when this event is the one that reached the write-up line. */
  writeup: boolean;
}

export interface LatenessRules {
  pointsPerLateItem: number;
  warningLevels: number[];
  writeupThreshold: number;
  disputeWindowDays: number;
  resetAfterWriteup: boolean;
}

export interface LatenessPostResult {
  added: boolean;
  points: number;
  /** Balance after this event. 0 when a write-up reset it. */
  balance: number;
  previousBalance: number;
  /** Warning level this event crossed. Null when it issued a write-up instead. */
  crossedWarning: number | null;
  writeupIssued: boolean;
  disputeUntil: string;
}

export function latenessBalance(
  entries: LatenessEntry[],
  userId: string,
  resetAfterWriteup: boolean,
): number {
  const mine = entries
    .filter((row) => row.userId === userId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  if (!resetAfterWriteup) return mine.reduce((sum, row) => sum + row.points, 0);
  let lastWriteup = -1;
  mine.forEach((row, index) => {
    if (row.writeup) lastWriteup = index;
  });
  return mine.slice(lastWriteup + 1).reduce((sum, row) => sum + row.points, 0);
}

export function applyLatenessPoint(
  entries: LatenessEntry[],
  draft: Omit<LatenessEntry, "points" | "writeup">,
  rules: LatenessRules,
): { entries: LatenessEntry[]; result: LatenessPostResult } {
  const points = Math.max(1, Math.trunc(rules.pointsPerLateItem));
  const disputeUntil = addUtcDays(draft.occurredAt, rules.disputeWindowDays);
  const previousBalance = latenessBalance(entries, draft.userId, rules.resetAfterWriteup);
  if (entries.some((row) => row.agencyId === draft.agencyId && row.sourceKey === draft.sourceKey)) {
    return {
      entries,
      result: {
        added: false,
        points: 0,
        balance: previousBalance,
        previousBalance,
        crossedWarning: null,
        writeupIssued: false,
        disputeUntil,
      },
    };
  }
  const next = previousBalance + points;
  const writeupIssued = next >= rules.writeupThreshold;
  const entry: LatenessEntry = { ...draft, points, writeup: writeupIssued };
  const crossed = writeupIssued ? null : highestNewlyCrossed(previousBalance, next, rules.warningLevels);
  return {
    entries: [...entries, entry],
    result: {
      added: true,
      points,
      balance: writeupIssued && rules.resetAfterWriteup ? 0 : next,
      previousBalance,
      crossedWarning: crossed,
      writeupIssued,
      disputeUntil,
    },
  };
}

/** Which reminder bucket `now` falls in. A new bucket is a new reminder. */
export function reminderSlot(nowMs: number, intervalMinutes: number): number {
  const interval = Math.max(1, intervalMinutes) * 60_000;
  return Math.floor(nowMs / interval);
}

/** Local calendar date plus an "HH:MM" window start, as an ISO timestamp. */
export function scheduledStartIso(dateStamp: string, hhmm: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const [year, month, day] = dateStamp.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** True when the punch is after the scheduled start plus the saved minutes. */
export function clockInIsLate(
  scheduledStartIso: string,
  punchedAtIso: string,
  lateAfterMinutes: number,
): boolean {
  const start = Date.parse(scheduledStartIso);
  const punched = Date.parse(punchedAtIso);
  if (!Number.isFinite(start) || !Number.isFinite(punched)) return false;
  return punched > start + Math.max(0, lateAfterMinutes) * 60_000;
}

/**
 * A note saved after its shift block has ended, plus the agency's grace.
 * Unknown shift labels are not charged.
 */
export function notePastGrace(input: {
  noteDate: string;
  shift: string;
  now: Date;
  graceMinutes: number;
  blocks?: Record<ShiftBlockId, ShiftBlockDef>;
}): boolean {
  const blockId = blockForShiftLabel(input.shift);
  if (!blockId) return false;
  const blocks = input.blocks ?? SHIFT_BLOCKS;
  const [year, month, day] = input.noteDate.slice(0, 10).split("-").map(Number);
  const start = new Date(year, (month || 1) - 1, day || 1).getTime();
  const end = start + blocks[blockId].endMin * 60_000 + Math.max(0, input.graceMinutes) * 60_000;
  return input.now.getTime() > end;
}

export function prnFollowupStillOpen(
  events: { action: string; targetId: string | null; createdAt: string }[],
  medicationId: string,
  givenAt: string,
): boolean {
  return !events.some(
    (event) =>
      event.action === "medication.prn_effectiveness" &&
      event.targetId === medicationId &&
      event.createdAt > givenAt,
  );
}

export interface RecognitionAward {
  id: string;
  agencyId: string;
  managerId: string;
  recipientId: string;
  points: number;
  reason: string;
  month: string;
  createdAt: string;
}

export function recognitionUsedThisMonth(
  awards: RecognitionAward[],
  agencyId: string,
  managerId: string,
  month: string,
): number {
  return awards
    .filter((row) => row.agencyId === agencyId && row.managerId === managerId && row.month === month)
    .reduce((sum, row) => sum + row.points, 0);
}

export function recognitionAwardProblem(used: number, points: number, cap: number): string | null {
  if (!Number.isInteger(points) || points < 1) return "Award at least 1 point.";
  const left = Math.max(0, cap - used);
  if (used + points > cap) {
    return left === 0
      ? `You have used all ${cap} recognition points for this month.`
      : `That award is over this month's cap of ${cap}. You have ${left} left.`;
  }
  return null;
}

function highestNewlyCrossed(before: number, after: number, levels: number[]): number | null {
  const crossed = levels.filter((level) => Number.isFinite(level) && level > before && level <= after);
  if (crossed.length === 0) return null;
  return Math.max(...crossed);
}

function addUtcDays(iso: string, days: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(days)));
  return date.toISOString().slice(0, 10);
}
