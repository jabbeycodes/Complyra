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
