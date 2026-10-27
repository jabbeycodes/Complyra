/**
 * Event reports (GER) — a structured record of something significant that
 * happened to or around an Individual: a fall, an injury, a hospital visit,
 * a behavior incident, and so on. Reports move draft -> submitted ->
 * approved (or returned for corrections), and every submitted report then
 * carries a follow-up lifecycle — unaddressed -> in progress -> resolved —
 * owned by a named manager with a due date, so nothing significant is filed
 * and forgotten.
 *
 * Pure domain module: types, validation, permission gates, lifecycle and
 * notification-target helpers, and DB row mappers. The API layers
 * (localApi / hostedApi) persist through these helpers so local and hosted
 * behavior cannot drift.
 *
 * Wording rules: "Individual/Individuals" only. Severity is always shown as
 * a text label, never by color alone.
 */

import type { SessionUser } from "./types";

export const GER_EVENT_TYPES = [
  "Fall",
  "Injury",
  "Illness",
  "ER/Hospital visit",
  "Behavior incident",
  "Medication issue",
  "Elopement/Wandering",
  "Property damage",
  "Other",
] as const;
export type GerEventType = (typeof GER_EVENT_TYPES)[number];

export const GER_SEVERITIES = ["Low", "Moderate", "High", "Critical"] as const;
export type GerSeverity = (typeof GER_SEVERITIES)[number];

export type GerStatus = "draft" | "submitted" | "approved" | "returned";

/** Stored follow-up lifecycle. "Overdue" is derived from the due date. */
export type GerResolutionStatus = "unaddressed" | "in_progress" | "resolved";
export type GerResolutionDisplay =
  | GerResolutionStatus
  | "overdue";

export interface GerNotificationMade {
  /** Who was notified, e.g. "Guardian", "Physician", "Program manager". */
  party: string;
  /** Name of the person notified. */
  name: string;
  /** When they were notified (free text time or ISO). */
  atTime: string;
}

export interface GerReport {
  id: string;
  agencyId: string;
  siteId: string;
  individualId: string;
  /** Other Individuals involved in the same event, if any. */
  linkedIndividualIds: string[];
  eventDate: string;
  eventTime: string;
  location: string;
  eventType: GerEventType;
  severity: GerSeverity;
  description: string;
  immediateActions: string;
  notificationsMade: GerNotificationMade[];
  witnesses: string;
  reporterName: string;
  reporterSignature: string;
  reporterDate: string;
  status: GerStatus;
  reviewNote: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  // Follow-up / resolution lifecycle.
  resolutionStatus: GerResolutionStatus;
  investigationRequired: boolean;
  investigationNotes: string;
  assignedManagerUserId: string | null;
  resolutionDueOn: string | null;
  closureNote: string;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GerReportDraft {
  siteId: string;
  individualId: string;
  linkedIndividualIds?: string[];
  eventDate: string;
  eventTime: string;
  location: string;
  eventType: GerEventType;
  severity: GerSeverity;
  description: string;
  immediateActions: string;
  notificationsMade?: GerNotificationMade[];
  witnesses?: string;
  reporterName: string;
  reporterSignature: string;
  reporterDate: string;
}

export interface GerResolutionPatch {
  resolutionStatus?: GerResolutionStatus;
  investigationRequired?: boolean;
  investigationNotes?: string;
  assignedManagerUserId?: string | null;
  resolutionDueOn?: string | null;
  closureNote?: string;
}

// ───────────────────────────── Permission gates ─────────────────────────────

/** DSP/HM/PM/nurse (and admins) may file reports. Auditors and HR may not. */
export function canCreateGerReport(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "dsp" ||
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** HM/PM/nurse review submitted reports. DSPs and auditors do not. */
export function canReviewGerReport(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** HM/PM/nurse work a report's follow-up to resolution. */
export function canResolveGerReport(roleKey: string | null | undefined): boolean {
  return canReviewGerReport(roleKey);
}

/**
 * Who may open the Reporting tab and read reports: anyone who can work with
 * Individuals at a site, plus auditors — auditors see everything, read-only
 * (Joshua, 2026-09-19). HR is excluded (HR holds no clinical permissions).
 */
export function canViewGerReports(session: SessionUser | null): boolean {
  if (!session) return false;
  if (session.permissions["individuals.view"] !== true) return false;
  return session.roleKey !== "hr";
}

// ───────────────────────────── Validation ─────────────────────────────

/**
 * Where the report's Individuals actually live, resolved by the API layer
 * (server-side in hosted mode). A report must be filed under the home its
 * Individual lives at — otherwise the chart, the dashboard, and the alert
 * fan-out disagree about which home's managers own the follow-up.
 */
export interface GerDraftSiteContext {
  /** The home the primary Individual lives at; null when not found. */
  individualSiteId: string | null;
  /** Home per linked Individual id; null when not found. */
  linkedSiteIds?: Record<string, string | null>;
}

export function validateGerDraft(
  draft: GerReportDraft,
  siteContext?: GerDraftSiteContext,
): string[] {
  const errors: string[] = [];
  if (!draft.individualId) errors.push("Choose the Individual this report is about.");
  if (siteContext) {
    if (draft.individualId && siteContext.individualSiteId === null) {
      errors.push("The Individual on this report could not be found.");
    } else if (
      draft.individualId &&
      siteContext.individualSiteId !== draft.siteId
    ) {
      errors.push(
        "This report must be filed under the home its Individual lives at.",
      );
    }
    for (const linkedId of draft.linkedIndividualIds ?? []) {
      const linkedSite = siteContext.linkedSiteIds?.[linkedId];
      if (linkedSite === null || linkedSite === undefined) {
        errors.push("A linked Individual on this report could not be found.");
      } else if (linkedSite !== draft.siteId) {
        errors.push(
          "A linked Individual must live at the same home as this report.",
        );
      }
    }
  }
  if (!draft.eventDate) errors.push("The event date is required.");
  if (!draft.eventType || !GER_EVENT_TYPES.includes(draft.eventType)) {
    errors.push("Choose an event type.");
  }
  if (!draft.severity || !GER_SEVERITIES.includes(draft.severity)) {
    errors.push("Choose a severity.");
  }
  if (!draft.description?.trim()) errors.push("Describe what happened.");
  if (!draft.reporterName?.trim()) errors.push("The reporting staff name is required.");
  if (!draft.reporterSignature?.trim()) {
    errors.push("The reporting staff member must sign the report.");
  }
  if (!draft.reporterDate) errors.push("The report date is required.");
  return errors;
}

/** A resolution may be closed only with a closure note. */
export function validateGerResolution(
  patch: GerResolutionPatch,
  current: Pick<GerReport, "resolutionStatus">,
): string[] {
  const errors: string[] = [];
  const next = patch.resolutionStatus ?? current.resolutionStatus;
  if (next === "resolved" && !(patch.closureNote ?? "").trim()) {
    errors.push("Add a closure note before marking this report resolved.");
  }
  if (
    patch.resolutionDueOn != null &&
    patch.resolutionDueOn !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(patch.resolutionDueOn)
  ) {
    errors.push("The follow-up due date must be a calendar date (YYYY-MM-DD).");
  }
  return errors;
}

// ───────────────────────────── Lifecycle ─────────────────────────────

/** Drafts and returned reports may be edited by their author or a reviewer. */
export function canEditGerReportBody(
  report: Pick<GerReport, "status" | "createdByUserId">,
  session: SessionUser,
): boolean {
  if (report.status === "approved") return false;
  if (report.status === "submitted") return false;
  return (
    report.createdByUserId === session.userId ||
    canReviewGerReport(session.roleKey)
  );
}

/** Only submitted reports can be decided, and only by a reviewer. */
export function canDecideGerReport(
  report: Pick<GerReport, "status">,
  session: SessionUser,
): boolean {
  return report.status === "submitted" && canReviewGerReport(session.roleKey);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((start(toIso) - start(fromIso)) / 86400000);
}

/** Display status for the follow-up lifecycle at `now`. */
export function deriveGerResolutionDisplay(
  report: Pick<GerReport, "resolutionStatus" | "resolutionDueOn" | "status">,
  now: Date = new Date(),
): GerResolutionDisplay {
  if (report.status === "draft" || report.status === "returned") return "unaddressed";
  if (report.resolutionStatus === "resolved") return "resolved";
  if (report.resolutionDueOn) {
    const todayIso = now.toISOString().slice(0, 10);
    if (daysBetweenIso(todayIso, report.resolutionDueOn) < 0) return "overdue";
  }
  return report.resolutionStatus;
}

/** Follow-up still needs a manager's attention. */
export function gerNeedsFollowUp(
  report: Pick<GerReport, "resolutionStatus" | "resolutionDueOn" | "status">,
  now: Date = new Date(),
): boolean {
  if (report.status !== "submitted" && report.status !== "approved") return false;
  return deriveGerResolutionDisplay(report, now) !== "resolved";
}

/** Unaddressed first, then overdue, then in progress; newest events first. */
export function sortGerReports<T extends GerReport>(reports: T[]): T[] {
  const rank: Record<GerResolutionDisplay, number> = {
    unaddressed: 0,
    overdue: 1,
    in_progress: 2,
    resolved: 3,
  };
  return [...reports].sort((a, b) => {
    const r = rank[deriveGerResolutionDisplay(a)] - rank[deriveGerResolutionDisplay(b)];
    if (r !== 0) return r;
    return a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0;
  });
}

// ───────────────────────────── Notifications ─────────────────────────────

export interface GerSubmitNotificationTarget {
  /** Direct user id for the home's house manager; null for role broadcasts. */
  userId: string | null;
  roleKey: "program_manager" | "nurse" | null;
  dedupeKey: string;
}

/** Every submitted report alerts (all severities). */
export function gerEscalationSeverity(severity: GerSeverity): boolean {
  return severity === "High" || severity === "Critical";
}

/**
 * Notification targets when a report is submitted: the home's house manager
 * directly, plus program-manager and nurse role broadcasts. Deduped per
 * report + target so a resubmission never double-alerts the same target.
 */
export function gerSubmitNotificationTargets(input: {
  gerId: string;
  houseManagerUserIds: string[];
}): GerSubmitNotificationTarget[] {
  const targets: GerSubmitNotificationTarget[] = [];
  for (const userId of [...new Set(input.houseManagerUserIds)]) {
    targets.push({
      userId,
      roleKey: null,
      dedupeKey: `incident.followup:ger:${input.gerId}:hm:${userId}`,
    });
  }
  targets.push({
    userId: null,
    roleKey: "program_manager",
    dedupeKey: `incident.followup:ger:${input.gerId}:role:program_manager`,
  });
  targets.push({
    userId: null,
    roleKey: "nurse",
    dedupeKey: `incident.followup:ger:${input.gerId}:role:nurse`,
  });
  return targets;
}

// ───────────────────────────── DB row mapping ─────────────────────────────

export function buildGerReportRow(input: {
  agencyId: string;
  createdByUserId: string;
  draft: GerReportDraft;
  status: GerStatus;
}): Record<string, unknown> {
  const d = input.draft;
  return {
    agency_id: input.agencyId,
    site_id: d.siteId,
    individual_id: d.individualId,
    linked_individual_ids: d.linkedIndividualIds ?? [],
    event_date: d.eventDate,
    event_time: d.eventTime,
    location: d.location ?? "",
    event_type: d.eventType,
    severity: d.severity,
    description: d.description.trim(),
    immediate_actions: d.immediateActions ?? "",
    notifications_made: d.notificationsMade ?? [],
    witnesses: d.witnesses ?? "",
    reporter_name: d.reporterName.trim(),
    reporter_signature: d.reporterSignature.trim(),
    reporter_date: d.reporterDate,
    status: input.status,
    created_by_user_id: input.createdByUserId,
  };
}

export function gerReportFromRow(row: Record<string, unknown>): GerReport {
  const status = row.status as string;
  const resolution = row.resolution_status as string;
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    siteId: row.site_id as string,
    individualId: row.individual_id as string,
    linkedIndividualIds: (row.linked_individual_ids as string[] | null) ?? [],
    eventDate: row.event_date as string,
    eventTime: (row.event_time as string | null) ?? "",
    location: (row.location as string | null) ?? "",
    eventType: (row.event_type as GerEventType) ?? "Other",
    severity: (row.severity as GerSeverity) ?? "Moderate",
    description: (row.description as string | null) ?? "",
    immediateActions: (row.immediate_actions as string | null) ?? "",
    notificationsMade: (row.notifications_made as GerNotificationMade[] | null) ?? [],
    witnesses: (row.witnesses as string | null) ?? "",
    reporterName: (row.reporter_name as string | null) ?? "",
    reporterSignature: (row.reporter_signature as string | null) ?? "",
    reporterDate: (row.reporter_date as string | null) ?? "",
    status:
      status === "submitted" || status === "approved" || status === "returned"
        ? status
        : "draft",
    reviewNote: (row.review_note as string | null) ?? "",
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    resolutionStatus:
      resolution === "in_progress" || resolution === "resolved"
        ? resolution
        : "unaddressed",
    investigationRequired: row.investigation_required === true,
    investigationNotes: (row.investigation_notes as string | null) ?? "",
    assignedManagerUserId: (row.assigned_manager_user_id as string | null) ?? null,
    resolutionDueOn: (row.resolution_due_on as string | null) ?? null,
    closureNote: (row.closure_note as string | null) ?? "",
    resolvedByUserId: (row.resolved_by_user_id as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    createdByUserId: row.created_by_user_id as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? (row.created_at as string),
  };
}
