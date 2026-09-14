/**
 * LIFEPATH-PHASE1-WS3 (accessible status system): the canonical compliance
 * status vocabulary plus pure mapping helpers from each domain's own status
 * representation into it.
 *
 * The vocabulary is deliberately PRESENTATIONAL — every domain keeps its own
 * thresholds and logic untouched; these helpers only translate the verdict
 * into the 7 shared statuses that <StatusBadge> renders. Because each status
 * carries its own icon + label + color, status is never conveyed by color
 * alone anywhere the badge is used.
 */

/** The one shared compliance vocabulary. */
export type ComplianceStatus =
  | "compliant"
  | "expiring"
  | "expired"
  | "missing"
  | "late"
  | "pending"
  | "attention";

export interface StatusMeta {
  /** Human label rendered next to the icon, e.g. "Expiring soon". */
  label: string;
  /**
   * A single text/unicode glyph shape per status — intentionally NOT emoji
   * pictographs, so they render consistently and are announced neutrally.
   * Every status gets a DIFFERENT shape; uniqueness is covered by test.
   */
  icon: string;
  /** One-line explanation of what this status means for screen-reader help. */
  description: string;
}

export const STATUS_META: Record<ComplianceStatus, StatusMeta> = {
  compliant: {
    label: "Compliant",
    icon: "✓",
    description: "Up to date — no action needed.",
  },
  expiring: {
    label: "Expiring soon",
    icon: "▲",
    description: "Still valid, but the deadline is approaching.",
  },
  expired: {
    label: "Expired",
    icon: "✕",
    description: "The deadline has passed without renewal or completion.",
  },
  missing: {
    label: "Missing",
    icon: "?",
    description: "No record on file — nothing has been submitted.",
  },
  late: {
    label: "Late",
    icon: "◷",
    description: "Past due — action was expected and has not happened yet.",
  },
  pending: {
    label: "Pending",
    icon: "…",
    description: "Waiting on someone else — not yet done, not yet overdue.",
  },
  attention: {
    label: "Needs attention",
    icon: "!",
    description: "Flagged for a human to review or intervene.",
  },
};

export const ALL_STATUSES = Object.keys(STATUS_META) as ComplianceStatus[];

/* ------------------------------------------------------------------ */
/* Requirement status (domain.ts Status + DB spellings + training)     */
/* ------------------------------------------------------------------ */

/**
 * Maps a domain requirement/training status string into the shared
 * vocabulary.
 *
 * - "Overdue"/"overdue"            -> "late"    (past due, action missing)
 * - "Expired"/"expired"            -> "expired" (deadline lapsed; delegation-style)
 * - "Due soon"/"due_soon"         -> "expiring"
 * - "Upcoming"/"upcoming"         -> "compliant" (far-out, nothing to do yet)
 * - "Compliant"/"compliant",
 *   "complete", "waived_na"       -> "compliant"
 * - "Pending review"/"pending_review",
 *   "pending", "in_progress"      -> "pending"
 * - "Cleared"/"Current"           -> "compliant"
 * - "Not cleared"/"Off"           -> "attention"
 *
 * Unknown strings fall back to "attention" so they are never rendered
 * silently as "fine".
 */
export function fromRequirementStatus(status: string): ComplianceStatus {
  const s = status.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  switch (s) {
    case "compliant":
    case "complete":
    case "waived na":
    case "upcoming":
    case "cleared":
    case "current":
    case "ok":
      return "compliant";
    case "due soon":
      return "expiring";
    case "expired":
      return "expired";
    case "overdue":
      return "late";
    case "pending review":
    case "pending":
    case "in progress":
      return "pending";
    case "not cleared":
    case "off":
      return "attention";
    default:
      return "attention";
  }
}

/* ------------------------------------------------------------------ */
/* Certificates — mirrors src/data/certificates.ts certExpiryStatus    */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000;

function daysUntil(dateIso: string, now: Date): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((start(dateIso) - start(now.toISOString())) / MS_PER_DAY);
}

/**
 * Certificate status from a renewal date.
 *
 * Thresholds mirror `certExpiryStatus()` exactly, so the badge never
 * disagrees with the existing countdown logic:
 * - remaining < 0      -> "expired"   ("expired" band)
 * - remaining <= 30    -> "expiring"  ("due" band — renewal inside 30 days)
 * - remaining <= 90    -> "attention" ("watch" band — renewal inside 90 days;
 *                        worth watching, not yet urgent)
 * - remaining > 90     -> "compliant" ("ok" band)
 */
export function certificateStatus(
  expiresOn: string,
  now: Date = new Date(),
): ComplianceStatus {
  const remaining = daysUntil(expiresOn, now);
  if (remaining < 0) return "expired";
  if (remaining <= 30) return "expiring";
  if (remaining <= 90) return "attention";
  return "compliant";
}

/* ------------------------------------------------------------------ */
/* Med supply — mirrors src/data/medInventory.ts band logic            */
/* ------------------------------------------------------------------ */

import type { MedInventoryStatus as MedInvStatus } from "./types";

/**
 * Med-supply status from projected days remaining.
 *
 * Bands mirror `computeInventory()` in medInventory.ts:
 * - 0 pills (null or <= 0 days)           -> "expired"  ("out" band)
 * - <= 2 days                             -> "attention"("critical" band — reorder urgently)
 * - <= reorder threshold (default 7 days, the app default
 *   DEFAULT_MED_LOW_THRESHOLD_DAYS)       -> "expiring" ("low" band)
 * - above the threshold                   -> "compliant"("ok" band)
 *
 * Pass the medication's own `lowThresholdDays` when it has a custom one;
 * the badge then agrees with the app's own reorder alert.
 */
export function medSupplyStatus(
  daysRemaining: number | null,
  lowThresholdDays = 7,
): ComplianceStatus {
  if (daysRemaining === null || daysRemaining <= 0) return "expired";
  if (daysRemaining <= 2) return "attention";
  if (daysRemaining <= Math.max(1, Math.floor(lowThresholdDays)))
    return "expiring";
  return "compliant";
}

/** Convenience: map the stored MedInventoryStatus band directly. */
export function medSupplyStatusFromInventory(
  status: MedInvStatus,
): ComplianceStatus {
  switch (status) {
    case "ok":
      return "compliant";
    case "low":
      return "expiring";
    case "critical":
      return "attention";
    case "out":
      return "expired";
  }
}

/* ------------------------------------------------------------------ */
/* Checklists (HM weekly checklist surfaces, generic signature)        */
/* ------------------------------------------------------------------ */

/**
 * Checklist status from submission + lateness state.
 *
 * - submitted                         -> "compliant"
 * - not submitted and late            -> "late"
 * - not submitted, due within 7 days  -> "expiring"
 * - not submitted, due further out or no due date -> "pending"
 */
export function checklistStatus(
  submitted: boolean,
  dueAt: string | null,
  late: boolean,
  now: Date = new Date(),
): ComplianceStatus {
  if (submitted) return "compliant";
  if (late) return "late";
  if (dueAt) {
    const days = daysUntil(dueAt, now);
    if (days <= 7) return "expiring";
  }
  return "pending";
}

/* ------------------------------------------------------------------ */
/* Delegation forms                                                    */
/* ------------------------------------------------------------------ */

/**
 * Delegation-form status from the form verdict.
 *
 * - rescinded   -> "expired"   (the delegation is no longer valid)
 * - fullySigned -> "compliant" (RN signed and every named staffer signed)
 * - otherwise   -> "pending"   (still collecting signatures)
 */
export function delegationStatus(
  rescinded: boolean,
  fullySigned: boolean,
): ComplianceStatus {
  if (rescinded) return "expired";
  if (fullySigned) return "compliant";
  return "pending";
}
