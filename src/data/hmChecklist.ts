/**
 * HM Weekly Checklist — pure logic (Phase 5, LifePath).
 *
 * The 26 line items below are transcribed VERBATIM from
 * ~/workspace/lifepath-docs/EXTRACTION_NOTES.md section B8
 * ("HM Weekly Checklist" — Y / N / N/A per item, header field "Home:",
 * turned in Monday by 4pm). Do not reword them.
 */
import type {
  ChecklistAnswer,
  ChecklistItem,
  ServiceLogKind,
} from "./types";

/** Stable keys for the 26 checklist rows: "c1" .. "c26". */
export const ITEM_21_KEY = "c21";

/** Verbatim prompts for the 26 weekly checklist rows. */
export const WEEKLY_CHECKLIST_ITEMS: Array<{ key: string; prompt: string }> = [
  {
    key: "c1",
    prompt:
      "Staff daily documentation is check – if missing, addressed and then re-verified",
  },
  {
    key: "c2",
    prompt:
      "Timesheets checked – all staff hours are logged and errors addressed – verify that staff are not clocking in early or late",
  },
  {
    key: "c3",
    prompt:
      "Medication Administration Record (MAR) checked daily for missing initials and PRN documentation",
  },
  {
    key: "c4",
    prompt:
      "Adequate supply of medications in the home – adequate medical supplies in the home",
  },
  { key: "c5", prompt: "PRN medications in the home and not expired" },
  {
    key: "c6",
    prompt:
      "Physician ordered vital signs are documented in Therap as prescribed (* List physician-ordered vital(s): ___)",
  },
  {
    key: "c7",
    prompt:
      "BMs documented in Therap on each shift and PRN medications administered per BM protocol",
  },
  {
    key: "c8",
    prompt: "General environmental inspection – home clean, pathways clear, etc.",
  },
  {
    key: "c9",
    prompt:
      "Maintenance issues – complete work order if Yes (* List any outstanding maintenance issues)",
  },
  {
    key: "c10",
    prompt: "Vehicle inspection – clean (inside and out), maintenance completed",
  },
  { key: "c11", prompt: "Check the house mailbox – deliver mail to Admin office" },
  {
    key: "c12",
    prompt:
      "Scan and enter med appointment records into Therap w/in 24 hours of appointment",
  },
  {
    key: "c13",
    prompt:
      "Appointment notes in individual's office record book and copied to home record book",
  },
  { key: "c14", prompt: "Groceries and household supplies are well stocked" },
  { key: "c15", prompt: "Adaptive equipment logs completed" },
  { key: "c16", prompt: "Daily census logs & variance reports are up-to-date" },
  { key: "c17", prompt: "Check emails and texts – respond in timely manner" },
  {
    key: "c18",
    prompt:
      "All spend cards are in the home/available to the client – all receipts are accounted for",
  },
  {
    key: "c19",
    prompt:
      "When medications are picked up from pharmacy, verified no changes or contact RN",
  },
  {
    key: "c20",
    prompt: "Monthly reviews and RN assessments in individual's home record book",
  },
  {
    key: "c21",
    prompt:
      "All staff have been properly trained and signed off on all trainings/delegations",
  },
  {
    key: "c22",
    prompt:
      "Smoke detectors/water temp/CO2 monitors/fire extinguishers checked",
  },
  { key: "c23", prompt: "Drills completed according to drill schedule" },
  {
    key: "c24",
    prompt:
      "First Aid Kit and CPR face shields in home and car – no products expired",
  },
  {
    key: "c25",
    prompt:
      "Spent time with staff and individuals to build rapport, provide oversight, and address concerns",
  },
  {
    key: "c26",
    prompt:
      "Evidence that rights restrictions are being followed (i.e. knives are locked up, internet is restricted)",
  },
];

/** Verbatim attestation from the paper form. */
export const CHECKLIST_ATTESTATION_TEXT =
  "By signing below I verify that I have personally visited the home and assessed the above-listed items for compliance.";

/** Verbatim deadline from the paper form. */
export const CHECKLIST_DEADLINE_TEXT = "Turn in Monday by 4pm";

/**
 * The paper form's second page ("service logs") as structured entry kinds,
 * each with its verbatim fill-in prompt.
 */
export const SERVICE_LOG_PROMPTS: Record<ServiceLogKind, string> = {
  class_reminder:
    "Were staff reminded of scheduled classes and flexed off to avoid OT? If so, list who was reminded and for which class:",
  call_in: "List any call ins/tardies:",
  direct_care: "List dates/times HM worked direct care (in-ratio):",
  off_shift:
    "List staff who worked (dates/times), outside of assigned shifts, and verify that Therap documentation was completed:",
  issue:
    "Make note of any issues in the home and when it was addressed with the DSP(s).",
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
