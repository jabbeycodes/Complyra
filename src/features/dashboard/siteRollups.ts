/**
 * Issue #98 — agency-wide metrics: pure per-site rollup helpers.
 *
 * These functions aggregate already-loaded (or API-fetched) records into
 * per-site metric values plus a tone of "ok" | "warning" | "critical".
 * They are intentionally DOM-free so unit tests can exercise every rule
 * without a browser.
 *
 * Tone conventions:
 * - "critical" means something is already late, out, or expired.
 * - "warning" means it is due soon or partially incomplete.
 * - "ok" means complete / clear / nothing to show.
 */

import {
  DRILL_LABELS,
  drillComplete,
  drillsForMonth,
  monthlyTone,
  type DrillType,
  type EmergencyDrill,
} from "../../data/monthlyChecks";
import {
  summarizeInvestigations,
  type Investigation,
} from "../../data/investigations";
import { can } from "../../data/status";
import { canSeeMeds, todayIso } from "../../data/chart";
import { canSeeShiftNotes } from "../../data/permissions";
import type {
  ExpiringCertificate,
  MedSupplyStatus,
  SessionUser,
  StaffClearanceRow,
} from "../../data/types";
import type { SiteShiftNoteView } from "../../data/shiftNotes";

export type RollupTone = "ok" | "warning" | "critical";

export const TONE_RANK: Record<RollupTone, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
};

/** The worst (most severe) tone in the list; empty list is "ok". */
export function worstTone(tones: RollupTone[]): RollupTone {
  let worst: RollupTone = "ok";
  for (const tone of tones) {
    if (TONE_RANK[tone] > TONE_RANK[worst]) worst = tone;
  }
  return worst;
}

/** Badge status string for a rollup tone, reusing the app's solid-color Badge styles. */
export function toneBadgeStatus(tone: RollupTone): string {
  if (tone === "critical") return "Overdue";
  if (tone === "warning") return "Needs attention";
  return "On track";
}

// ---------------------------------------------------------------------------
// Drills (current month)
// ---------------------------------------------------------------------------

export interface DrillRollup {
  required: DrillType[];
  completed: DrillType[];
  missing: DrillType[];
  allDone: boolean;
  tone: RollupTone;
  /** e.g. "2 of 3 drills complete" */
  label: string;
  /** Human-readable names of the missing drill types. */
  missingLabels: string[];
}

/**
 * Per-site drill completion for one month. Mirrors how SiteMonthlyChecks
 * decides what is due: the required types come from drillsForMonth and a
 * drill counts only when drillComplete() passes; the tone reuses
 * monthlyTone() with the agency's drill due day.
 */
export function drillSiteRollup(
  drills: EmergencyDrill[],
  siteId: string,
  monthKey: string,
  today: string,
  dueDay: number,
): DrillRollup {
  const required = drillsForMonth(monthKey);
  const rows = drills.filter(
    (row) => row.siteId === siteId && row.monthKey === monthKey,
  );
  const completed = required.filter((type) =>
    rows.some((row) => row.drillType === type && drillComplete(row)),
  );
  const missing = required.filter((type) => !completed.includes(type));
  const allDone = required.length > 0 && missing.length === 0;
  const monthly = monthlyTone(allDone, today, monthKey, dueDay);
  const tone: RollupTone =
    monthly === "overdue" ? "critical" : monthly === "due_soon" ? "warning" : "ok";
  return {
    required,
    completed,
    missing,
    allDone,
    tone,
    label: `${completed.length} of ${required.length} drills complete`,
    missingLabels: missing.map((type) => DRILL_LABELS[type] ?? type),
  };
}

// ---------------------------------------------------------------------------
// Training / in-ratio clearance
// ---------------------------------------------------------------------------

export interface TrainingRollup {
  total: number;
  cleared: number;
  /** Staff with at least one overdue training line. */
  overdueStaff: number;
  tone: RollupTone;
  label: string;
}

/**
 * Aggregates one site's StaffClearanceRow list (from
 * api.listStaffNeedingClearance(siteId) — the lightest available source; the
 * per-staff gate evaluation happens server-side so the client issues a single
 * call per site).
 */
export function trainingSiteRollup(rows: StaffClearanceRow[]): TrainingRollup {
  const total = rows.length;
  const cleared = rows.filter((row) => row.clearedForInRatio).length;
  const overdueStaff = rows.filter((row) => row.overdueCount > 0).length;
  const tone: RollupTone =
    overdueStaff > 0 ? "critical" : cleared < total ? "warning" : "ok";
  return {
    total,
    cleared,
    overdueStaff,
    tone,
    label:
      total === 0
        ? "No staff assigned"
        : `${cleared} of ${total} cleared for in-ratio`,
  };
}

// ---------------------------------------------------------------------------
// Certificate expiries
// ---------------------------------------------------------------------------

export interface CertificateRollup {
  /** Expiring within the window (includes already-expired). */
  expiring: number;
  /** Already past the renewal date. */
  expired: number;
  tone: RollupTone;
  label: string;
}

/**
 * Aggregates one site's slice of api.certificatesExpiringSoon(days). Callers
 * group the agency-wide list by staff site; daysRemaining <= 0 means the
 * certificate is already expired.
 */
export function certificateSiteRollup(certs: ExpiringCertificate[]): CertificateRollup {
  const expiring = certs.length;
  const expired = certs.filter((cert) => cert.daysRemaining <= 0).length;
  const tone: RollupTone =
    expired > 0 ? "critical" : expiring > 0 ? "warning" : "ok";
  return {
    expiring,
    expired,
    tone,
    label:
      expiring === 0
        ? "No expiries in 60 days"
        : expired > 0
          ? `${expired} expired · ${expiring - expired} expiring`
          : `${expiring} expiring in 60 days`,
  };
}

// ---------------------------------------------------------------------------
// Medication supply
// ---------------------------------------------------------------------------

export interface MedRollup {
  alerts: number;
  critical: number;
  allClear: boolean;
  tone: RollupTone;
  label: string;
}

/** Aggregates one site's MedSupplyStatus from api.getMedicationSupplyStatus. */
export function medSiteRollup(status: MedSupplyStatus): MedRollup {
  const critical = status.criticalCount + status.outCount;
  const alerts = critical + status.lowCount;
  const tone: RollupTone =
    critical > 0 ? "critical" : status.lowCount > 0 ? "warning" : "ok";
  return {
    alerts,
    critical,
    allClear: status.allClear,
    tone,
    label: status.allClear ? "All meds in stock" : `${alerts} med alert${alerts === 1 ? "" : "s"}`,
  };
}

// ---------------------------------------------------------------------------
// Shift-note coverage (current month)
// ---------------------------------------------------------------------------

export interface ShiftNoteRollup {
  notes: number;
  individuals: number;
  tone: RollupTone;
  label: string;
}

/**
 * Coverage rule (documented judgment call): a site is fully covered when the
 * current month has at least one shift note per individual living there.
 * Zero notes with individuals present is critical; partial coverage warns.
 */
export function shiftNoteSiteRollup(
  notes: SiteShiftNoteView[],
  monthKey: string,
  individualCount: number,
): ShiftNoteRollup {
  const count = notes.filter(
    (note) => note.noteDate.slice(0, 7) === monthKey,
  ).length;
  const tone: RollupTone =
    individualCount > 0 && count === 0
      ? "critical"
      : count < individualCount
        ? "warning"
        : "ok";
  return {
    notes: count,
    individuals: individualCount,
    tone,
    label: `${count} note${count === 1 ? "" : "s"} this month · ${individualCount} individual${individualCount === 1 ? "" : "s"}`,
  };
}

// ---------------------------------------------------------------------------
// Investigations
// ---------------------------------------------------------------------------

export interface InvestigationRollup {
  open: number;
  overdue: number;
  tone: RollupTone;
  label: string;
}

/** Per-site slice of api.listInvestigations(), summarized with the shared helper. */
export function investigationSiteRollup(
  investigations: Investigation[],
  siteId: string,
  now: Date = new Date(),
): InvestigationRollup {
  const { open, overdue } = summarizeInvestigations(
    investigations.filter((row) => row.siteId === siteId),
    now,
  );
  const tone: RollupTone =
    overdue > 0 ? "critical" : open > 0 ? "warning" : "ok";
  return {
    open,
    overdue,
    tone,
    label:
      open === 0
        ? "No open investigations"
        : overdue > 0
          ? `${open} open · ${overdue} overdue`
          : `${open} open`,
  };
}

// ---------------------------------------------------------------------------
// Role gating — which rollup columns the session may read
// ---------------------------------------------------------------------------

export interface RollupMetricVisibility {
  drills: boolean;
  training: boolean;
  certificates: boolean;
  meds: boolean;
  shiftNotes: boolean;
  investigations: boolean;
}

/**
 * Mirrors the API read gates so the panel never widens access:
 * - drills ride in the preloaded workspace payload (no separate read gate);
 *   every Overview viewer already receives them.
 * - training rows require hr.view_staff (asserted by listStaffNeedingClearance).
 * - certificates require certificates.manage or hr.view_staff (assertCertificateRead).
 * - med supply requires canSeeMeds.
 * - shift notes require canSeeShiftNotes.
 * - investigation rollups require investigations.manage (the site counts are a
 *   management view; the API only exposes own rows to everyone else).
 */
export function rollupMetricVisibility(session: SessionUser): RollupMetricVisibility {
  return {
    drills: true,
    training: can(session, "hr.view_staff"),
    certificates:
      can(session, "certificates.manage") || can(session, "hr.view_staff"),
    meds: canSeeMeds(session.roleKey),
    shiftNotes: canSeeShiftNotes(session.roleKey),
    investigations: can(session, "investigations.manage"),
  };
}

/** True when the role may see at least one rollup metric. */
export function anyRollupVisible(visibility: RollupMetricVisibility): boolean {
  return Object.values(visibility).some(Boolean);
}

/** Current-month key ("yyyy-MM") for the rollup view. */
export function currentMonthKey(today: string = todayIso()): string {
  return today.slice(0, 7);
}
