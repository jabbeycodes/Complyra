/**
 * GER (General Event Report) — Complyrer's simplified incident/event reporting
 * for a program site.
 *
 * This is Complyrer's own take on event reporting (not a copy of any other
 * system's form): a tight field set, a simple Draft → Submitted →
 * Approved/Returned workflow, and role-based gating. The data layer
 * (localApi/hostedApi + migration) stores the records; this module owns the
 * vocabulary, validation, workflow transitions, and notification payloads so
 * the UI and API share one source of truth.
 */

import type { SessionUser } from "./types";
import { can } from "./status";
import type { NotificationPayload } from "../features/notifications/notify";
import { dedupeKeyFor } from "../features/notifications/notify";

export const GER_EVENT_TYPES = [
  "fall",
  "injury",
  "illness",
  "er_visit",
  "behavior",
  "medication",
  "elopement",
  "property_damage",
  "other",
] as const;

export type GerEventType = (typeof GER_EVENT_TYPES)[number];

export const GER_EVENT_TYPE_LABELS: Record<GerEventType, string> = {
  fall: "Fall",
  injury: "Injury",
  illness: "Illness",
  er_visit: "ER / hospital visit",
  behavior: "Behavior incident",
  medication: "Medication issue",
  elopement: "Elopement / wandering",
  property_damage: "Property damage",
  other: "Other",
};

export const GER_SEVERITIES = ["low", "moderate", "high", "critical"] as const;

export type GerSeverity = (typeof GER_SEVERITIES)[number];

export const GER_SEVERITY_LABELS: Record<GerSeverity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};

export const GER_STATUSES = ["draft", "submitted", "approved", "returned"] as const;

export type GerStatus = (typeof GER_STATUSES)[number];

export const GER_STATUS_LABELS: Record<GerStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned for corrections",
};

/** Severities that page management the moment a report is submitted. */
export const GER_ESCALATING_SEVERITIES: readonly GerSeverity[] = ["high", "critical"];

export const GER_NOTIFICATION_CHANNELS = [
  "guardian",
  "nurse",
  "program_manager",
  "support_coordinator",
  "other",
] as const;

export type GerNotificationChannel = (typeof GER_NOTIFICATION_CHANNELS)[number];

export const GER_NOTIFICATION_CHANNEL_LABELS: Record<GerNotificationChannel, string> = {
  guardian: "Guardian / family",
  nurse: "Nurse",
  program_manager: "Program manager",
  support_coordinator: "Support coordinator",
  other: "Other",
};

export interface GerNotificationMade {
  channel: GerNotificationChannel;
  /** Who was notified (name). */
  name: string;
  /** When they were notified (free text or ISO datetime). */
  notifiedAt: string;
}

export interface GerReportCore {
  individualId: string;
  /** ISO yyyy-mm-dd */
  eventDate: string;
  /** HH:MM 24h, optional */
  eventTime: string;
  location: string;
  eventType: GerEventType;
  severity: GerSeverity;
  /** What happened — narrative. */
  description: string;
  /** Immediate actions taken / first aid. */
  actionsTaken: string;
  notificationsMade: GerNotificationMade[];
  witnesses: string;
  reportedByName: string;
  /** Electronic signature (typed name). */
  signatureName: string;
}

export interface GerValidationError {
  field: string;
  message: string;
}

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Validate a GER form. Drafts may be partial; submitting requires the full
 * required field set so a submitted report is always reviewable.
 */
export function validateGerInput(
  input: Partial<GerReportCore>,
  opts: { forSubmit: boolean },
): GerValidationError[] {
  const errors: GerValidationError[] = [];
  const required = (field: string, value: string | undefined, label: string) => {
    if (isBlank(value)) errors.push({ field, message: `${label} is required.` });
  };

  // Event type / severity may be unset in a draft (the form defaults
  // severity to Low and asks for a type before submit); when set they must
  // be valid, and submitting requires both.
  if (input.eventType || opts.forSubmit) {
    if (!input.eventType || !GER_EVENT_TYPES.includes(input.eventType as GerEventType)) {
      errors.push({ field: "eventType", message: "Choose an event type." });
    }
  }
  if (input.severity || opts.forSubmit) {
    if (!input.severity || !GER_SEVERITIES.includes(input.severity as GerSeverity)) {
      errors.push({ field: "severity", message: "Choose a severity." });
    }
  }
  if (input.eventDate && !isValidDate(input.eventDate)) {
    errors.push({ field: "eventDate", message: "Enter a valid event date." });
  }
  if (input.eventTime && !isValidTime(input.eventTime)) {
    errors.push({ field: "eventTime", message: "Enter a valid time (HH:MM)." });
  }
  for (const [index, note] of (input.notificationsMade ?? []).entries()) {
    if (!GER_NOTIFICATION_CHANNELS.includes(note.channel as GerNotificationChannel)) {
      errors.push({
        field: `notificationsMade[${index}].channel`,
        message: "Choose who was notified.",
      });
    }
  }

  if (opts.forSubmit) {
    required("individualId", input.individualId, "Individual");
    required("eventDate", input.eventDate, "Event date");
    required("location", input.location, "Location");
    required("description", input.description, "What happened");
    required("actionsTaken", input.actionsTaken, "Immediate actions taken");
    required("reportedByName", input.reportedByName, "Reporting staff name");
    required("signatureName", input.signatureName, "Electronic signature");
  }
  return errors;
}

/** Permission gates — mirror the role template defaults (see data/permissions). */
export function canCreateGerReport(session: SessionUser | null): boolean {
  return !!session && can(session, "ger.create");
}

export function canReviewGerReport(session: SessionUser | null): boolean {
  return !!session && can(session, "ger.review");
}

export function canViewGerReports(session: SessionUser | null): boolean {
  return (
    !!session &&
    (can(session, "ger.create") ||
      can(session, "ger.review") ||
      can(session, "individuals.view"))
  );
}

export type GerWorkflowAction = "submit" | "approve" | "return";

/**
 * Pure workflow transition. Throws on illegal moves so the API and UI share
 * the same rule set:
 *   draft → submit → submitted
 *   submitted → approve → approved
 *   submitted → return → returned
 *   returned → submit → submitted (resubmit after corrections)
 * Approved reports are final — corrections are new reports, never edits.
 */
export function transitionGerStatus(
  current: GerStatus,
  action: GerWorkflowAction,
): GerStatus {
  if (action === "submit" && (current === "draft" || current === "returned")) {
    return "submitted";
  }
  if (action === "approve" && current === "submitted") return "approved";
  if (action === "return" && current === "submitted") return "returned";
  throw new Error(
    `Cannot ${action} a report that is ${GER_STATUS_LABELS[current]}.`,
  );
}

/**
 * Who may edit the report body. Authors may edit their own draft/returned
 * reports; reviewers may edit any non-approved report (to fix details during
 * review); approved reports are locked.
 */
export function canEditGerReportBody(
  session: SessionUser | null,
  report: { status: GerStatus; createdBy: string },
): boolean {
  if (!session || report.status === "approved") return false;
  if (report.status === "submitted") return canReviewGerReport(session);
  // draft | returned
  if (report.createdBy === session.userId) return canCreateGerReport(session);
  return canReviewGerReport(session);
}

/** Review actions are reviewer-only and only on submitted reports. */
export function canDecideGerReport(
  session: SessionUser | null,
  report: { status: GerStatus },
): boolean {
  return report.status === "submitted" && canReviewGerReport(session);
}

export function gerEscalatesOnSubmit(severity: GerSeverity): boolean {
  return (GER_ESCALATING_SEVERITIES as readonly string[]).includes(severity);
}

/**
 * High/Critical submissions page the program manager and the nurse via the
 * existing "incident.followup" notification type — no new notification
 * infrastructure. One payload per target role; callers queue both.
 */
export function gerEscalationPayload(input: {
  agencyId: string;
  roleKey: string;
  gerId: string;
  siteId: string;
  individualName: string;
  eventType: GerEventType;
  severity: GerSeverity;
  eventDate: string;
}): NotificationPayload {
  const typeLabel = GER_EVENT_TYPE_LABELS[input.eventType];
  const severityLabel = GER_SEVERITY_LABELS[input.severity];
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "incident.followup",
    title: `${severityLabel} event report submitted`,
    body:
      `A ${severityLabel.toLowerCase()} severity ${typeLabel.toLowerCase()} was reported ` +
      `for ${input.individualName} on ${input.eventDate}. Review the event report and follow up.`,
    deepLink: `/reporting/${input.gerId}`,
    entityType: "ger_report",
    entityId: input.gerId,
    dedupeKey: dedupeKeyFor("incident.followup", input.gerId, input.roleKey),
  };
}

export interface GerReportFilters {
  individualId: string;
  eventType: "" | GerEventType;
  status: "" | GerStatus;
  /** ISO yyyy-mm-dd, inclusive. */
  from: string;
  /** ISO yyyy-mm-dd, inclusive. */
  to: string;
}

export const EMPTY_GER_FILTERS: GerReportFilters = {
  individualId: "",
  eventType: "",
  status: "",
  from: "",
  to: "",
};

/** Pure list filtering (shared by UI tests and any client-side filtering). */
export function filterGerReports<T extends { individualId: string; eventType: string; status: string; eventDate: string }>(
  reports: T[],
  filters: GerReportFilters,
): T[] {
  return reports.filter((r) => {
    if (filters.individualId && r.individualId !== filters.individualId) return false;
    if (filters.eventType && r.eventType !== filters.eventType) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.from && r.eventDate < filters.from) return false;
    if (filters.to && r.eventDate > filters.to) return false;
    return true;
  });
}

export function sortGerReports<T extends { eventDate: string; createdAt: string }>(
  reports: T[],
): T[] {
  return [...reports].sort((a, b) =>
    a.eventDate !== b.eventDate
      ? b.eventDate.localeCompare(a.eventDate)
      : b.createdAt.localeCompare(a.createdAt),
  );
}
