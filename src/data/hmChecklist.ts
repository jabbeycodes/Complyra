/**
 * HM Weekly Checklist — pure logic (Phase 5).
 *
 * The 26 line items below cover the same ground as the legacy agency's weekly
 * checklist (Y / N / N/A per item, "Home:" header, Monday 4pm turn-in), but in
 * Complyrer's own wording and with nothing copied. Row keys ("c1".."c26")
 * are stable for data compatibility. See docs/coverage-map.md for the
 * original → new wording map.
 */
import type {
  ChecklistAnswer,
  ChecklistItem,
  ServiceLogKind,
} from "./types";

/** Stable keys for the 26 checklist rows: "c1" .. "c26". */
export const ITEM_21_KEY = "c21";

/** Complyrer's own wording for the 26 weekly checklist rows (same coverage). */
export const WEEKLY_CHECKLIST_ITEMS: Array<{ key: string; prompt: string }> = [
  {
    key: "c1",
    prompt:
      "Daily staff documentation reviewed \u2014 gaps addressed, then re-verified",
  },
  {
    key: "c2",
    prompt:
      "Timesheets verified \u2014 all hours logged, errors fixed, no early or late clock-ins",
  },
  {
    key: "c3",
    prompt:
      "Medication Administration Record (MAR) checked daily for missing initials and PRN entries",
  },
  {
    key: "c4",
    prompt:
      "Enough medications and medical supplies on hand in the home",
  },
  { key: "c5", prompt: "PRN medications present in the home and unexpired" },
  {
    key: "c6",
    prompt:
      "Doctor-ordered vital signs charted in Therap as prescribed (* List ordered vitals: ___)",
  },
  {
    key: "c7",
    prompt:
      "Bowel movements charted in Therap on each shift and PRN medications given per bowel protocol",
  },
  {
    key: "c8",
    prompt: "General home walkthrough \u2014 clean, pathways clear, no hazards",
  },
  {
    key: "c9",
    prompt:
      "Maintenance issues \u2014 file a work order for any outstanding items (* List outstanding issues)",
  },
  {
    key: "c10",
    prompt: "Vehicle checked \u2014 clean (inside and out), maintenance up to date",
  },
  { key: "c11", prompt: "House mailbox checked \u2014 admin mail delivered to the office" },
  {
    key: "c12",
    prompt:
      "Medical appointment records scanned into Therap within 24 hours of the appointment",
  },
  {
    key: "c13",
    prompt:
      "Appointment notes filed in the individual's office record book and copied to the home record book",
  },
  { key: "c14", prompt: "Groceries and household supplies well stocked" },
  { key: "c15", prompt: "Adaptive equipment logs current" },
  { key: "c16", prompt: "Daily census logs and variance reports up to date" },
  { key: "c17", prompt: "Emails and texts checked \u2014 replies sent promptly" },
  {
    key: "c18",
    prompt:
      "All spending cards in the home and available to the individual \u2014 every receipt accounted for",
  },
  {
    key: "c19",
    prompt: "Pharmacy pickups checked for medication changes \u2014 RN contacted if anything changed",
  },
  {
    key: "c20",
    prompt: "Monthly reviews and RN assessments filed in the home record book",
  },
  {
    key: "c21",
    prompt:
      "All staff fully trained and signed off on trainings and delegations",
  },
  {
    key: "c22",
    prompt:
      "Smoke detectors, water temperature, CO monitors, and fire extinguishers checked",
  },
  { key: "c23", prompt: "Drills completed per the drill schedule" },
  {
    key: "c24",
    prompt:
      "First aid kits and CPR face shields in home and vehicle \u2014 nothing expired",
  },
  {
    key: "c25",
    prompt:
      "Time spent with staff and individuals \u2014 building rapport, providing oversight, addressing concerns",
  },
  {
    key: "c26",
    prompt:
      "Rights restrictions visibly followed (e.g., knives secured, internet limited)",
  },
];

/** Complyrer's own attestation wording (same compliance meaning). */
export const CHECKLIST_ATTESTATION_TEXT =
  "By signing, I confirm I visited the home in person and reviewed each item above for compliance.";

/** Complyrer's own deadline wording. */
export const CHECKLIST_DEADLINE_TEXT = "Due Monday by 4:00 p.m.";

/**
 * The checklist's second page ("service logs") as structured entry kinds,
 * each with Complyrer's own fill-in prompt (same information captured).
 */
export const SERVICE_LOG_PROMPTS: Record<ServiceLogKind, string> = {
  class_reminder:
    "List staff reminded of upcoming classes and flexed off to avoid overtime (who, and which class):",
  call_in: "List any call-ins or late arrivals:",
  direct_care: "List dates and times the HM worked direct care (in ratio):",
  off_shift:
    "List staff who worked outside their assigned shifts (dates/times) and confirm their Therap documentation is complete:",
  issue:
    "Note any issues in the home and when they were addressed with the DSPs.",
};

export const SERVICE_LOG_KINDS: ServiceLogKind[] = [
  "class_reminder",
  "call_in",
  "direct_care",
  "off_shift",
  "issue",
];

export const SERVICE_LOG_KIND_LABELS: Record<ServiceLogKind, string> = {
  class_reminder: "Class reminders / flex-off",
  call_in: "Call-ins / tardies",
  direct_care: "HM direct care (in-ratio)",
  off_shift: "Staff outside assigned shifts",
  issue: "Issues in the home",
};

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Normalize any ISO date to the Sunday that opens its checklist week. */
export function weekOfSundayIso(iso: string): string {
  const d = parseIsoDate(iso);
  return addDaysIso(iso, -d.getUTCDay());
}

/** The Monday on which a Sunday-opened week is due ("Turn in Monday by 4pm"). */
export function deadlineMondayIso(weekOfSunday: string): string {
  return addDaysIso(weekOfSunday, 1);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Sep 13 – Sep 19, 2026" style label for a Sunday-opened week. */
export function weekRangeLabel(weekOfSunday: string): string {
  const end = addDaysIso(weekOfSunday, 6);
  const [sy, sm, sd] = weekOfSunday.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey || sy}`;
}

/**
 * Whether the Monday-4pm deadline for a week has passed.
 * `now` is injectable for tests.
 */
export function deadlinePassed(
  weekOfSunday: string,
  now: Date = new Date(),
): boolean {
  const monday = deadlineMondayIso(weekOfSunday);
  const deadline = new Date(`${monday}T16:00:00`);
  return now.getTime() >= deadline.getTime();
}

export function checklistPdfFileName(siteName: string, weekOf: string): string {
  const slug = siteName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
  return `complyrer-hm-weekly-checklist-${slug || "home"}-${weekOf}.pdf`;
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

/** Fresh 26-row item set for a new week instance (all unanswered). */
export function buildChecklistItems(): ChecklistItem[] {
  return WEEKLY_CHECKLIST_ITEMS.map((def) => ({
    key: def.key,
    prompt: def.prompt,
    answer: null,
    note: "",
    autoComputed: def.key === ITEM_21_KEY,
  }));
}

/** Item numbers (1-based) that are still blank — the paper's "do not leave blanks" rule. */
export function blankItemNumbers(items: ChecklistItem[]): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (item.answer === null) out.push(i + 1);
  });
  return out;
}

export function isChecklistComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.answer !== null);
}

export function applyItemAnswer(
  items: ChecklistItem[],
  itemKey: string,
  answer: ChecklistAnswer,
  note?: string,
): ChecklistItem[] {
  return items.map((item) =>
    item.key === itemKey
      ? { ...item, answer, note: note ?? item.note }
      : item,
  );
}

/* ------------------------------------------------------------------ */
/* Item 21 auto-compute                                                */
/* ------------------------------------------------------------------ */

/**
 * Per-staff training readiness feed for item 21.
 *
 * LIFEPATH-P5 → P2 HOOK: until the Phase 2 training engine merges, the APIs
 * build these snapshots from the legacy training-checklist data
 * (signTrainingChecklist / initialTrainingLine). When Phase 2 lands, replace
 * the snapshot builders with the engine's readiness feed — this shape and
 * computeItem21 stay the same. Delegation sign-offs should come from the
 * Phase 2 engine as well.
 */
export interface TrainingReadiness {
  staffId: string;
  staffName: string;
  /** True when the staff member is signed off on ALL of their trainings. */
  fullySignedOff: boolean;
}

/**
 * Auto-compute item 21 ("All staff have been properly trained and signed off
 * on all trainings/delegations") from per-staff readiness.
 */
export function computeItem21(staff: TrainingReadiness[]): {
  answer: ChecklistAnswer;
  note: string;
} {
  if (staff.length === 0) {
    return {
      answer: "N",
      note: "No staff roster on file for this home — verify training manually before answering Yes.",
    };
  }
  const pending = staff.filter((s) => !s.fullySignedOff);
  if (pending.length === 0) {
    return {
      answer: "Y",
      note: `All ${staff.length} staff fully signed off on trainings.`,
    };
  }
  const names = pending.map((s) => s.staffName).join(", ");
  return {
    answer: "N",
    note: `${pending.length} of ${staff.length} staff not fully signed off: ${names}.`,
  };
}

/** Stamp the computed item-21 answer + note onto an item set. */
export function applyItem21(
  items: ChecklistItem[],
  computed: { answer: ChecklistAnswer; note: string },
): ChecklistItem[] {
  return items.map((item) =>
    item.key === ITEM_21_KEY
      ? { ...item, answer: computed.answer, note: computed.note, autoComputed: true }
      : item,
  );
}

/* ------------------------------------------------------------------ */
/* Scheduler + late flags (Phase 1, Workstream 2)                       */
/* ------------------------------------------------------------------ */

/**
 * The scheduler-managed lifecycle status of a checklist:
 *  - "compliant" — submitted (on time or otherwise; it was turned in).
 *  - "late"      — past due_at and not submitted (or flagged by the
 *                  scheduler's late sweep).
 *  - "pending"   — open and not yet due.
 */
export type ChecklistComputedStatus = "compliant" | "pending" | "late";

/**
 * Minimal shape the scheduler/status helpers need. Accepts the client
 * HmWeeklyChecklist model (fields optional there) or a raw DB row mapping.
 */
export interface ChecklistScheduleInfo {
  submittedAt?: string | null;
  dueAt?: string | null;
  late?: boolean;
}

/**
 * Whether a checklist counts as late right now. Submitted checklists are
 * never late; otherwise the DB `late` flag wins, falling back to the
 * due_at comparison for rows the scheduler hasn't swept yet.
 * `now` is injectable for tests.
 */
export function isLate(
  checklist: ChecklistScheduleInfo,
  now: Date = new Date(),
): boolean {
  if (checklist.submittedAt) return false;
  if (checklist.late) return true;
  if (!checklist.dueAt) return false;
  const due = new Date(checklist.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

/** Lifecycle status for badges and banners. `now` is injectable for tests. */
export function computeChecklistStatus(
  checklist: ChecklistScheduleInfo,
  now: Date = new Date(),
): ChecklistComputedStatus {
  if (checklist.submittedAt) return "compliant";
  if (isLate(checklist, now)) return "late";
  return "pending";
}

/**
 * The next Monday strictly after `iso` (ISO date). The Sunday scheduler run
 * creates the upcoming week's row, so a Sunday input yields tomorrow's
 * Monday; a Monday input yields the Monday a week out (never re-targets the
 * current week).
 */
export function nextMondayIso(iso: string): string {
  const dow = parseIsoDate(iso).getUTCDay();
  const delta = dow === 1 ? 7 : (8 - dow) % 7;
  return addDaysIso(iso, delta);
}

/** due_at for a Monday week_start: Sunday 23:59 UTC (see migration notes). */
export function dueAtIsoForWeekStart(weekStart: string): string {
  return `${addDaysIso(weekStart, 6)}T23:59:00.000Z`;
}

/** "Sun, Sep 20, 2026 · 11:59 PM UTC" label for a due_at instant. */
export function formatDueAt(dueAt: string | null | undefined): string {
  if (!dueAt) return "—";
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return "—";
  // Rendered in UTC to stay honest about the stored instant.
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = d.getUTCHours();
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${weekdays[d.getUTCDay()]}, ${formatShortDate(d.toISOString().slice(0, 10))} · ${h12}:${mm} ${hh >= 12 ? "PM" : "AM"} UTC`;
}

/** HM-per-site assignment the scheduler consumes (from memberships). */
export interface SchedulerSiteAssignment {
  agencyId: string;
  siteId: string;
  hmUserId: string;
}

/**
 * Build the DB insert row the Sunday scheduler upserts for one site/week.
 * week_of is the Sunday opening the week (week_start - 1); due_at is Sunday
 * 23:59 UTC. Mirrors the supabase/functions/schedule-hm-checklists row
 * shape (which duplicates this for the Deno runtime).
 */
export function buildWeeklyChecklistRow(
  assignment: SchedulerSiteAssignment,
  weekStart: string,
): Record<string, unknown> {
  return {
    agency_id: assignment.agencyId,
    site_id: assignment.siteId,
    week_of: addDaysIso(weekStart, -1),
    week_start: weekStart,
    due_at: dueAtIsoForWeekStart(weekStart),
    assigned_to_user_id: assignment.hmUserId,
    assigned_by_user_id: null,
    status: "open",
    items: buildChecklistItems(),
    service_logs: [],
    late: false,
    late_flagged_at: null,
    submitted_at: null,
  };
}

/**
 * Notification dedupe keys — unique per (event, checklist) so scheduler
 * reruns never queue duplicates.
 */
export function assignedNotificationDedupeKey(checklistId: string): string {
  return `checklist.assigned:${checklistId}`;
}

export function lateNotificationDedupeKey(checklistId: string): string {
  return `checklist.late:${checklistId}`;
}
