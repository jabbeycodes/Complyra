import {
  SHIFT_BLOCK_ORDER,
  blockFullyCovered,
  formatClock,
  shiftSpanOnServiceDate,
  usualOwnerForBlock,
  type ShiftBlockDef,
  type ShiftBlockId,
} from "../../data/dueItems";
import { addIsoDays, chicagoShiftInstants, chicagoWallClock, shiftTouchesDate } from "./coverageWeek";

export type PlanShift = {
  id: string;
  staffId: string | null;
  staffName: string;
  startsAt: string;
  endsAt: string;
};

export type HouseWriter = { userId: string; name: string };

export type OwedLine = {
  blockId: ShiftBlockId;
  text: string;
};

function dueLabel(endsAt: string, graceMinutes: number): string {
  const wall = chicagoWallClock(endsAt);
  const [hour, minute] = wall.hhmm.split(":").map(Number);
  const due = (hour * 60 + minute + graceMinutes) % 1440;
  return formatClock(due);
}

/**
 * One line per house block. A person on a published shift owes the note after
 * their own end. Hours nobody covers name the usual DSP once the week has any
 * schedule, and every assigned DSP when the week is still empty.
 */
export function owedLinesForDay(input: {
  date: string;
  blocks: Record<ShiftBlockId, ShiftBlockDef>;
  shifts: PlanShift[];
  writers: HouseWriter[];
  graceMinutes: number;
  weekHasSchedule: boolean;
}): OwedLine[] {
  const assigned = input.shifts.filter((shift) => shift.staffId);
  const open = input.shifts.filter((shift) => !shift.staffId);
  const dayHasSchedule = input.weekHasSchedule;
  return SHIFT_BLOCK_ORDER.map((blockId) => {
    const block = input.blocks[blockId];
    const covering = assigned.filter((shift) => {
      const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, input.date);
      return Boolean(span && span.start < block.endMin && block.startMin < span.end);
    });
    const openHere = open.some((shift) => {
      const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, input.date);
      return Boolean(span && span.start < block.endMin && block.startMin < span.end);
    });
    const spans = covering.flatMap((shift) => {
      const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, input.date);
      return span ? [span] : [];
    });
    const full = blockFullyCovered(spans, block.startMin, block.endMin);
    const owner = usualOwnerForBlock(input.writers, blockId);
    const names = input.writers.map((writer) => writer.name);
    if (covering.length > 0 && full) {
      const who = covering
        .map((shift) => `${shift.staffName}, note due ${dueLabel(shift.endsAt, input.graceMinutes)}`)
        .join(" · ");
      return { blockId, text: `${block.label} · ${who}` };
    }
    if (covering.length > 0) {
      const who = covering.map((shift) => shift.staffName).join(", ");
      const gapOwner = owner && covering.some((shift) => shift.staffId === owner.userId)
        ? input.writers.find((writer) => writer.userId !== owner.userId) ?? null
        : owner;
      const rest = gapOwner ? `${gapOwner.name} still owes the rest` : "the rest of this block is still open";
      return { blockId, text: `${block.label} · ${who} covers part · ${rest}` };
    }
    if (openHere && owner) {
      return { blockId, text: `${block.label} · Open for a PRN · still with ${owner.name} until someone takes it` };
    }
    if (dayHasSchedule && owner) {
      return { blockId, text: `${block.label} · still with ${owner.name}` };
    }
    if (names.length === 0) return { blockId, text: `${block.label} · nobody assigned` };
    return { blockId, text: `${block.label} · ${names.join(" and ")}` };
  });
}

export type FillRow = {
  date: string;
  staffId: string;
  start: string;
  end: string;
  title: string;
};

/** Usual DSP on each block the published week does not already cover. */
export function rowsToFill(input: {
  dates: string[];
  blocks: Record<ShiftBlockId, ShiftBlockDef>;
  existing: PlanShift[];
  writers: HouseWriter[];
}): FillRow[] {
  const rows: FillRow[] = [];
  for (const date of input.dates) {
    for (const blockId of SHIFT_BLOCK_ORDER) {
      const block = input.blocks[blockId];
      const owner = usualOwnerForBlock(input.writers, blockId);
      if (!owner) continue;
      const spans = input.existing.flatMap((shift) => {
        const span = shiftSpanOnServiceDate(shift.startsAt, shift.endsAt, date);
        return span ? [span] : [];
      });
      const already = spans.some((span) => span.start < block.endMin && block.startMin < span.end);
      if (already) continue;
      const start = `${String(Math.floor(block.startMin / 60)).padStart(2, "0")}:${String(block.startMin % 60).padStart(2, "0")}`;
      const endMinute = block.endMin % 1440;
      const end = `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
      rows.push({ date, staffId: owner.userId, start, end, title: `${block.label} coverage` });
    }
  }
  return rows;
}

export type CopyRow = {
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  title: string;
};

/** Move last week's published rows onto the target week, same Chicago clocks. */
export function rowsToCopy(input: {
  previous: PlanShift[];
  previousWeekStart: string;
  targetWeekStart: string;
  target: PlanShift[];
}): CopyRow[] {
  const previousDates = Array.from({ length: 7 }, (_, index) => addIsoDays(input.previousWeekStart, index));
  const rows: CopyRow[] = [];
  for (const shift of input.previous) {
    if (!shift.staffId) continue;
    if (!previousDates.some((date) => shiftTouchesDate(shift.startsAt, shift.endsAt, date))) continue;
    const start = chicagoWallClock(shift.startsAt);
    const end = chicagoWallClock(shift.endsAt);
    const dayOffset = previousDates.indexOf(start.date);
    if (dayOffset < 0) continue;
    const nextDate = addIsoDays(input.targetWeekStart, dayOffset);
    const times = chicagoShiftInstants(nextDate, start.hhmm, end.hhmm);
    const already = input.target.some(
      (row) => row.staffId === shift.staffId && row.startsAt === times.startsAt && row.endsAt === times.endsAt,
    );
    if (already) continue;
    rows.push({
      staffId: shift.staffId,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      title: "Coverage",
    });
  }
  return rows;
}
