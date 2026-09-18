/**
 * Site-dashboard trackable aggregation (issue #98).
 *
 * Pure functions that roll per-tab data into the dashboard tiles on the
 * program-site detail page. Kept side-effect free so the math is unit
 * tested; the data loading itself lives in useSiteTrackables.
 */

import {
  DRILL_LABELS,
  drillComplete,
  drillsForMonth,
  safetyComplete,
  type EmergencyDrill,
  type HomeSafetyReport,
} from "../../data/monthlyChecks";
import type {
  HmWeeklyChecklist,
  MedSupplyStatus,
  StaffCertificate,
} from "../../data/types";
import type { QaAuditItemState } from "../../data/qaAudit";
import type { SiteShiftNoteView } from "../../data/shiftNotes";
import type { Investigation } from "../../data/investigations";
import { summarizeInvestigations } from "../../data/investigations";

/** "YYYY-MM" for the current day. */
export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Whole calendar days from today until an ISO date (negative = expired). */
export function daysUntilExpiry(iso: string, now: Date = new Date()): number {
  const start = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00`);
  return Math.round((start(iso) - start(now.toISOString().slice(0, 10))) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Emergency drills                                                    */
/* ------------------------------------------------------------------ */

export interface DrillBucket {
  type: string;
  label: string;
  done: boolean;
  drillId: string | null;
  drillDate: string | null;
}

/**
 * Per drill-type completion for one month: every type the schedule expects
 * (drillsForMonth) gets a bucket; a bucket is done when a drill row exists
 * and is fully completed (date + time + leader + participants).
 */
export function bucketDrillCompletion(
  drills: EmergencyDrill[],
  monthKey: string,
): DrillBucket[] {
  const expected = drillsForMonth(monthKey);
  return expected.map((type) => {
    const row = drills.find(
      (d) => d.monthKey === monthKey && d.drillType === type,
    );
    return {
      type,
      label: DRILL_LABELS[type] ?? type,
      done: row ? drillComplete(row) : false,
      drillId: row?.id ?? null,
      drillDate: row?.date?.trim() ? row.date : null,
    };
  });
}

export function drillTileSummary(buckets: DrillBucket[]): {
  done: number;
  total: number;
  missing: number;
} {
  const done = buckets.filter((b) => b.done).length;
  return { done, total: buckets.length, missing: buckets.length - done };
}

/* ------------------------------------------------------------------ */
/* Home safety report                                                  */
/* ------------------------------------------------------------------ */

export type SafetyTileState = "complete" | "in_progress" | "not_started";

/** Completion state of this month's home safety report, if one exists. */
export function safetyTileState(
  report: HomeSafetyReport | null | undefined,
): SafetyTileState {
  if (!report) return "not_started";
  return safetyComplete(report) ? "complete" : "in_progress";
}

export function safetyLinesAnswered(report: HomeSafetyReport | null | undefined): {
  answered: number;
  total: number;
} {
  if (!report) return { answered: 0, total: 0 };
  const total = report.lines.length;
  const answered = report.lines.filter(
    (line) => line.dateChecked && line.checkedBy,
  ).length;
  return { answered, total };
}

/* ------------------------------------------------------------------ */
/* Training & certificates                                             */
/* ------------------------------------------------------------------ */

export interface TrainingRowInput {
  userId: string;
  name: string;
  profile: { clearedForInRatio: boolean } | null;
  failed: boolean;
}

/** Staff cleared vs not cleared for in-ratio work. */
export function trainingClearanceSummary(rows: TrainingRowInput[]): {
  total: number;
  cleared: number;
  notCleared: number;
} {
  const usable = rows.filter((r) => !r.failed);
  const cleared = usable.filter((r) => r.profile?.clearedForInRatio).length;
  return { total: usable.length, cleared, notCleared: usable.length - cleared };
}

export interface CertExpiryInput {
  userId: string;
  name: string;
  expiringCerts: StaffCertificate[];
}

export interface CertExpiryRow extends CertExpiryInput {
  cert: StaffCertificate;
  daysLeft: number;
}

/**
 * Certificates expiring within 60 days (already-expired included —
 * expiringCerts arrives pre-filtered to <= 60 days; this just orders them
 * worst first for the drawer).
 */
export function collectExpiringCerts(
  rows: CertExpiryInput[],
  now: Date = new Date(),
): CertExpiryRow[] {
  const out: CertExpiryRow[] = [];
  for (const row of rows) {
    for (const cert of row.expiringCerts) {
      out.push({
        userId: row.userId,
        name: row.name,
        expiringCerts: row.expiringCerts,
        cert,
        daysLeft: daysUntilExpiry(cert.expiresOn, now),
      });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ------------------------------------------------------------------ */
/* Medication supply                                                   */
/* ------------------------------------------------------------------ */

export function medAlertSummary(medStatus: MedSupplyStatus | null): {
  total: number;
  attention: number;
  allClear: boolean;
} {
  if (!medStatus) return { total: 0, attention: 0, allClear: false };
  const attention =
    medStatus.lowCount + medStatus.criticalCount + medStatus.outCount;
  return { total: medStatus.totalMeds, attention, allClear: medStatus.allClear };
}

/* ------------------------------------------------------------------ */
/* Shift notes                                                         */
/* ------------------------------------------------------------------ */

/** Notes entered in a given month (noteDate is YYYY-MM-DD). */
export function shiftNoteCoverage(
  notes: SiteShiftNoteView[],
  monthKey: string,
): SiteShiftNoteView[] {
  return notes
    .filter((n) => (n.noteDate ?? "").startsWith(monthKey))
    .sort((a, b) => b.noteDate.localeCompare(a.noteDate));
}

/* ------------------------------------------------------------------ */
/* Weekly checklists                                                   */
/* ------------------------------------------------------------------ */

/** Latest filed checklist; anything not submitted still counts as pending. */
export function checklistTileSummary(
  checklists: HmWeeklyChecklist[],
): { filed: number; pending: number; latestWeekOf: string | null } {
  const filed = checklists.filter((c) => c.status === "submitted").length;
  const pending = checklists.filter((c) => c.status !== "submitted").length;
  const latest = [...checklists].sort((a, b) =>
    b.weekOf.localeCompare(a.weekOf),
  )[0];
  return { filed, pending, latestWeekOf: latest?.weekOf ?? null };
}

/* ------------------------------------------------------------------ */
/* QA disputes                                                         */
/* ------------------------------------------------------------------ */

/**
 * Items still under dispute: a dispute was raised and the auditor has not
 * resolved it yet.
 */
export function openQaDisputes(
  items: QaAuditItemState[],
): QaAuditItemState[] {
  return items.filter(
    (item) => item.disputeRaisedBy != null && item.disputeResolution == null,
  );
}

/* ------------------------------------------------------------------ */
/* Investigations                                                      */
/* ------------------------------------------------------------------ */

/** Dashboard tile numbers for a site's investigations (overdue derived). */
export function investigationTileSummary(
  investigations: Array<Pick<Investigation, "storedStatus" | "dueOn">>,
  now: Date = new Date(),
): { open: number; overdue: number } {
  return summarizeInvestigations(investigations, now);
}
