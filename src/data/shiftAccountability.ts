/**
 * Shift accountability — the published shift is the accountability unit.
 *
 * When a shift is published with a staff assignee, every tracked obligation
 * due inside that shift's window is attributed to the assignee: MAR med
 * passes (by dose time), ISP data collection (per Individual per day, the
 * same unit the mobile "today" tracking uses), the Shift note owed for the
 * shift (per Individual, mirroring the #75 detector), menu records for the
 * meals in the window, and weekly-checklist items due in the window.
 * Managers see, per shift: the owner, how many obligations were due, how
 * many are done, and what is missing — live during the shift and after it
 * ends.
 *
 * This module is PURE: the API layers (local + hosted) gather plain rows
 * from their own stores and hand them in; every due/done rule lives here or
 * is reused from the existing detectors (dueItems.ts) so the rules exist in
 * exactly one place.
 *
 * ── Attribution rules (the contract) ─────────────────────────────────────
 * - Window membership is half-open: an obligation due exactly at the shift
 *   start belongs to this shift; one due exactly at the shift end belongs
 *   to the NEXT shift. Adjacent shifts therefore never double-count a
 *   boundary instant, and an overnight shift owns everything from its
 *   start through (not including) its end the next morning.
 * - Overlapping shifts each own the obligations in the overlap (the
 *   coverage board already allows overlapping published shifts; both
 *   people on duty share the window's work).
 * - Owner = the shift's assignee of record (HrShift.staffId). The record
 *   carries ONE assignee per shift and no reassignment history, so a
 *   mid-window reassignment moves the ENTIRE window's accountability to
 *   the new assignee — there is no time-split. Whoever the shift names
 *   when it is read owns the whole window.
 * - An unassigned shift (staffId null) is "unowned": its obligations are
 *   still counted, so a manager can see the work an open shift carries.
 * - Cancelled shifts are excluded; scheduled and published shifts count.
 *
 * ── Due instants per kind ────────────────────────────────────────────────
 * - medication: the dose's scheduled instant (dose date + dose time,
 *   America/Chicago). Done when a MAR dose mark exists for that med +
 *   date + time — any status clears it (Given / Missed / LOA / On hold),
 *   the #76 rule. PRN meds have no dose times and never appear.
 * - isp_data: one collection per Individual per active program per
 *   service date (the product's existing per-person-per-day unit), due at
 *   the END of that Central service date. Done when a Shift note exists
 *   for that Individual + program on that date — the note IS the data
 *   collection (it carries the program's task scores).
 * - shift_note: one per Individual per shift, due in the shift's final
 *   minute (so the half-open rule keeps it on the shift it documents).
 *   Done when a note for that Individual counts toward this shift under
 *   the #75 matching rule (filed against the shift, or written by the
 *   assignee under the matching block/clock span). For an unowned shift
 *   only a note filed against the shift itself counts.
 * - menu: one record per Individual per meal slot per date. Menu records
 *   carry a date and a slot but no clock time, so the slot's due instant
 *   is the fixed meal time in MEAL_DUE_MINUTES (America/Chicago) — an
 *   attribution convention of this module, documented here. Done when a
 *   live (non-voided) menu entry exists for that Individual + date + slot.
 * - checklist: each item of the site's weekly checklist, due at the
 *   checklist's due instant (its stored dueAt; when absent, the end of
 *   its week). Done when the item has an answer.
 *
 * Wording rules (never break): "Individual/Individuals" only — never
 * client / patient. "Shift note", never T-Log.
 */

import {
  blockForShiftLabel,
  matchingShiftId,
  zonedWallTimeMs,
  type ScheduledDose,
  type ShiftBlockDef,
  type ShiftBlockId,
} from "./dueItems";
import { addDaysIso, MEAL_SLOT_LABELS, type MealSlot } from "./menuRecords";
import type { HmWeeklyChecklist } from "./types";

export const ACCOUNTABILITY_TIME_ZONE = "America/Chicago";

/** Fixed meal due times (minutes after Central midnight) — see header. */
export const MEAL_DUE_MINUTES: Record<MealSlot, number> = {
  breakfast: 8 * 60,
  lunch: 12 * 60 + 30,
  dinner: 17 * 60 + 30,
  snack: 20 * 60,
};

export type AccountabilityItemKind =
  | "medication"
  | "isp_data"
  | "shift_note"
  | "menu"
  | "checklist";

export interface AccountabilityDueItem {
  id: string;
  kind: AccountabilityItemKind;
  label: string;
  /** ISO instant the obligation falls due. */
  dueAt: string;
  done: boolean;
  individualId?: string | null;
  individualName?: string | null;
}

export type ShiftAccountabilityState =
  | "upcoming"
  | "in_progress"
  | "complete"
  | "has_missing"
  | "unowned";

export interface ShiftAccountability {
  shiftId: string;
  /** Assignee of record, or null for an open (unassigned) shift. */
  ownerId: string | null;
  ownerName: string | null;
  startsAt: string;
  endsAt: string;
  totalDue: number;
  doneCount: number;
  /** Obligations in the window with no completion yet, by due time. */
  missingItems: AccountabilityDueItem[];
  state: ShiftAccountabilityState;
}

/** Text label for a state — status is always carried in words, never color alone. */
export function accountabilityStateLabel(state: ShiftAccountabilityState): string {
  switch (state) {
    case "upcoming":
      return "Upcoming";
    case "in_progress":
      return "In progress";
    case "complete":
      return "Complete";
    case "has_missing":
      return "Has missing items";
    case "unowned":
      return "Unowned";
  }
}

/** The minimal shift shape the attribution math needs (HrShift satisfies it). */
export interface AccountabilityShift {
  id: string;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
}

/**
 * Attribute every due item to the shifts whose half-open window
 * [startsAt, endsAt) contains its due instant, and roll each shift up.
 *
 * State precedence: unowned (no assignee) → upcoming (window not started)
 * → complete (everything due in the window is done) → has_missing (window
 * ended with work undone) → in_progress.
 */
export function computeShiftAccountability(input: {
  shifts: AccountabilityShift[];
  ownerNameById: Map<string, string>;
  items: AccountabilityDueItem[];
  now: Date;
}): ShiftAccountability[] {
  const nowMs = input.now.getTime();
  const rows: ShiftAccountability[] = [];
  for (const shift of input.shifts) {
    if (shift.status === "cancelled") continue;
    const startMs = Date.parse(shift.startsAt);
    const endMs = Date.parse(shift.endsAt);
    if (!(endMs > startMs)) continue;
    const inWindow = input.items
      .filter((item) => {
        const dueMs = Date.parse(item.dueAt);
        return dueMs >= startMs && dueMs < endMs;
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.label.localeCompare(b.label));
    const doneCount = inWindow.filter((item) => item.done).length;
    const missingItems = inWindow.filter((item) => !item.done);
    const ownerId = shift.staffId ?? null;
    let state: ShiftAccountabilityState;
    if (!ownerId) state = "unowned";
    else if (nowMs < startMs) state = "upcoming";
    else if (missingItems.length === 0) state = "complete";
    else if (nowMs >= endMs) state = "has_missing";
    else state = "in_progress";
    rows.push({
      shiftId: shift.id,
      ownerId,
      ownerName: ownerId ? (input.ownerNameById.get(ownerId) ?? null) : null,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      totalDue: inWindow.length,
      doneCount,
      missingItems,
      state,
    });
  }
  return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Inclusive Central-date list from fromDate to toDate (YYYY-MM-DD). */
export function accountabilityDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate.slice(0, 10);
  const end = toDate.slice(0, 10);
  while (cursor <= end && dates.length < 62) {
    dates.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

/** ISO instant for a Central wall-clock minute on a Central date. */
function centralInstant(isoDate: string, minutesOfDay: number): string {
  return new Date(zonedWallTimeMs(isoDate, minutesOfDay, ACCOUNTABILITY_TIME_ZONE)).toISOString();
}

// ─────────────────────────── Item builders ───────────────────────────

/**
 * MAR med passes: one item per scheduled dose per date. Reuses the #76
 * scheduled-dose shape and mark rule (a mark of any status clears the dose).
 */
export function medicationAccountabilityItems(input: {
  scheduledDoses: ScheduledDose[];
  marks: Array<{ medicationId: string; doseDate: string; doseTime: string }>;
  dates: string[];
}): AccountabilityDueItem[] {
  const marked = new Set(
    input.marks.map((m) => `${m.medicationId}|${m.doseDate.slice(0, 10)}|${m.doseTime}`),
  );
  const items: AccountabilityDueItem[] = [];
  for (const date of input.dates) {
    for (const dose of input.scheduledDoses) {
      for (const time of dose.doseTimes) {
        const [h, m] = time.split(":").map(Number);
        items.push({
          id: `acc-med:${date}:${dose.medicationId}:${time}`,
          kind: "medication",
          label: `${dose.medName} ${dose.strength} — ${dose.individualName}`,
          dueAt: centralInstant(date, (h || 0) * 60 + (m || 0)),
          done: marked.has(`${dose.medicationId}|${date}|${time}`),
          individualId: dose.individualId,
          individualName: dose.individualName,
        });
      }
    }
  }
  return items;
}

/** Menu records: one item per Individual per meal slot per date. */
export function menuAccountabilityItems(input: {
  people: Array<{ id: string; name: string }>;
  entries: Array<{ individualId: string; entryDate: string; mealSlot: string }>;
  dates: string[];
}): AccountabilityDueItem[] {
  const recorded = new Set(
    input.entries.map((e) => `${e.individualId}|${e.entryDate.slice(0, 10)}|${e.mealSlot}`),
  );
  const items: AccountabilityDueItem[] = [];
  const slots = Object.keys(MEAL_DUE_MINUTES) as MealSlot[];
  for (const date of input.dates) {
    for (const person of input.people) {
      for (const slot of slots) {
        items.push({
          id: `acc-menu:${date}:${person.id}:${slot}`,
          kind: "menu",
          label: `${MEAL_SLOT_LABELS[slot]} record — ${person.name}`,
          dueAt: centralInstant(date, MEAL_DUE_MINUTES[slot]),
          done: recorded.has(`${person.id}|${date}|${slot}`),
          individualId: person.id,
          individualName: person.name,
        });
      }
    }
  }
  return items;
}

/**
 * ISP data collection: one item per Individual per ACTIVE program per
 * date, due at the end of the service date. Active mirrors the plan
 * pickers' rule (approved, and the date inside the effective range) — the
 * same rule planStatus/activeIspProgram apply. Done when a Shift note
 * exists for that Individual + program on that date.
 */
export function ispAccountabilityItems(input: {
  people: Array<{ id: string; name: string }>;
  programs: Array<{
    id: string;
    individualId: string;
    name: string;
    status: string;
    effectiveOn: string;
    expiresOn: string;
  }>;
  notes: Array<{ individualId: string; programId: string; noteDate: string }>;
  dates: string[];
}): AccountabilityDueItem[] {
  const nameById = new Map(input.people.map((p) => [p.id, p.name]));
  const noted = new Set(
    input.notes.map((n) => `${n.individualId}|${n.programId}|${n.noteDate.slice(0, 10)}`),
  );
  const items: AccountabilityDueItem[] = [];
  for (const date of input.dates) {
    for (const program of input.programs) {
      if (program.status !== "approved") continue;
      if (program.effectiveOn.slice(0, 10) > date) continue;
      if (program.expiresOn.slice(0, 10) < date) continue;
      const personName = nameById.get(program.individualId) ?? "";
      items.push({
        id: `acc-isp:${date}:${program.id}`,
        kind: "isp_data",
        label: `ISP data — ${program.name} · ${personName}`,
        dueAt: centralInstant(date, 1440),
        done: noted.has(`${program.individualId}|${program.id}|${date}`),
        individualId: program.individualId,
        individualName: personName,
      });
    }
  }
  return items;
}

/**
 * The Shift note owed for a shift: one item per Individual per shift, due
 * at the shift's end. Done under the #75 note-matching rule, reused via
 * matchingShiftId: a note filed against this shift counts for any writer;
 * otherwise the note must be the assignee's own and match by its block or
 * clock span. Unowned shifts only count notes filed against the shift.
 */
export function shiftNoteAccountabilityItems(input: {
  shifts: AccountabilityShift[];
  people: Array<{ id: string; name: string }>;
  notes: Array<{
    individualId: string;
    staffUserId: string;
    noteDate: string;
    shift: string;
    beginTime?: string;
    endTime?: string;
    hrShiftId?: string | null;
  }>;
  blocks: Record<ShiftBlockId, ShiftBlockDef>;
}): AccountabilityDueItem[] {
  const items: AccountabilityDueItem[] = [];
  for (const shift of input.shifts) {
    if (shift.status === "cancelled") continue;
    for (const person of input.people) {
      const personNotes = input.notes.filter(
        (note) => note.individualId === person.id,
      );
      const done = personNotes.some((note) => {
        if (note.hrShiftId && note.hrShiftId === shift.id) return true;
        if (!shift.staffId) return false;
        const blockId = blockForShiftLabel(note.shift);
        return (
          matchingShiftId({
            shifts: [
              {
                id: shift.id,
                staffUserId: shift.staffId,
                startsAt: shift.startsAt,
                endsAt: shift.endsAt,
              },
            ],
            staffUserId: note.staffUserId,
            noteDate: note.noteDate,
            beginTime: note.beginTime,
            endTime: note.endTime,
            block: blockId ? input.blocks[blockId] : null,
          }) === shift.id
        );
      });
      items.push({
        id: `acc-note:${shift.id}:${person.id}`,
        kind: "shift_note",
        label: `Shift note — ${person.name}`,
        // Due in the shift's final minute: the half-open window rule then
        // attributes the note to the shift it documents, not the next one.
        dueAt: new Date(Date.parse(shift.endsAt) - 60_000).toISOString(),
        done,
        individualId: person.id,
        individualName: person.name,
      });
    }
  }
  return items;
}

/**
 * Weekly-checklist items: one per checklist item, due at the checklist's
 * due instant (stored dueAt, else the end of its week). Done when answered.
 */
export function checklistAccountabilityItems(input: {
  checklists: HmWeeklyChecklist[];
}): AccountabilityDueItem[] {
  const items: AccountabilityDueItem[] = [];
  for (const checklist of input.checklists) {
    const anchor = (checklist.weekStart ?? checklist.weekOf).slice(0, 10);
    const dueAt = checklist.dueAt
      ? new Date(checklist.dueAt).toISOString()
      : centralInstant(addDaysIso(anchor, 7), 0);
    for (const item of checklist.items) {
      items.push({
        id: `acc-check:${checklist.id}:${item.key}`,
        kind: "checklist",
        label: `Checklist — ${item.prompt}`,
        dueAt,
        done: item.answer !== null,
      });
    }
  }
  return items;
}
