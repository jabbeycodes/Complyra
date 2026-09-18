/**
 * Investigations — assignable follow-ups raised from any site-dashboard
 * metric. An investigation links the flag that raised it (source metric +
 * source record) to an owner, a due date, and a tracked lifecycle.
 *
 * Stored lifecycle is open -> in_progress -> resolved. "Overdue" is DERIVED
 * (due date passed, not resolved), never stored.
 *
 * Reads: agency members with investigations.manage (administrator,
 * program_manager, house_manager), plus the creator and the assignee.
 * Writes: investigations.manage only.
 *
 * Persistence: public.investigations + public.investigation_events
 * (migration 20260918120000_issue98_investigations.sql). Who/when is stamped
 * on every row; investigations soft-delete.
 */

export type StoredInvestigationStatus = "open" | "in_progress" | "resolved";

/** Display status: "overdue" is derived from the due date. */
export type InvestigationStatus = StoredInvestigationStatus | "overdue";

export const INVESTIGATION_STATUSES: InvestigationStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "overdue",
];

export const INVESTIGATION_STATUS_META: Record<
  InvestigationStatus,
  { label: string; icon: string }
> = {
  open: { label: "Open", icon: "○" },
  in_progress: { label: "In progress", icon: "◐" },
  resolved: { label: "Resolved", icon: "✓" },
  overdue: { label: "Overdue", icon: "✕" },
};

/**
 * The site-dashboard metric that raised the investigation. Drawers offer
 * "Start investigation" from every tile; the metric key travels with the
 * record so the list can group and the tile can link back.
 */
export type InvestigationSourceMetric =
  | "requirements"
  | "drills"
  | "safety"
  | "training"
  | "certificates"
  | "meds"
  | "shiftnotes"
  | "qa_disputes"
  | "qa_score"
  | "checklists"
  | "general";

export const INVESTIGATION_SOURCE_LABELS: Record<InvestigationSourceMetric, string> = {
  requirements: "Requirements",
  drills: "Emergency drills",
  safety: "Home safety report",
  training: "Training & in-ratio",
  certificates: "Certificates",
  meds: "Medication supply",
  shiftnotes: "Shift notes",
  qa_disputes: "QA disputes",
  qa_score: "QA review score",
  checklists: "Weekly checklists",
  general: "General",
};

export function isInvestigationSourceMetric(
  value: unknown,
): value is InvestigationSourceMetric {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(INVESTIGATION_SOURCE_LABELS, value)
  );
}

export type InvestigationEventType =
  | "created"
  | "assigned"
  | "status_changed"
  | "note"
  | "reopened"
  | "deleted";

export interface InvestigationEvent {
  id: string;
  investigationId: string;
  eventType: InvestigationEventType;
  fromStatus: StoredInvestigationStatus | null;
  toStatus: StoredInvestigationStatus | null;
  note: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
}

export interface Investigation {
  id: string;
  agencyId: string;
  siteId: string;
  sourceMetric: InvestigationSourceMetric;
  /** Id of the underlying record (requirement id, cert id, etc.), when any. */
  sourceRecordId: string | null;
  /** Human-readable summary of the source (e.g. "Fire drill · Sep 2026 missing"). */
  sourceLabel: string;
  title: string;
  description: string;
  assignedToUserId: string | null;
  assignedToName?: string | null;
  dueOn: string | null;
  /** Stored lifecycle status; "overdue" is derived, never stored. */
  storedStatus: StoredInvestigationStatus;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
  history: InvestigationEvent[];
}

export interface AddInvestigationInput {
  siteId: string;
  sourceMetric: InvestigationSourceMetric;
  sourceRecordId?: string | null;
  sourceLabel?: string | null;
  title: string;
  description?: string | null;
  assignedToUserId?: string | null;
  dueOn?: string | null;
}

export interface UpdateInvestigationInput {
  title?: string;
  description?: string | null;
  assignedToUserId?: string | null;
  dueOn?: string | null;
  storedStatus?: StoredInvestigationStatus;
  sourceMetric?: InvestigationSourceMetric;
  sourceRecordId?: string | null;
  sourceLabel?: string | null;
}

/** Days as whole calendar days between two ISO dates (date part only). */
function daysBetween(fromIso: string, toIso: string): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((start(toIso) - start(fromIso)) / 86400000);
}

/**
 * Display status for an investigation at `now`: resolved stays resolved;
 * anything else past its due date is overdue.
 */
export function deriveInvestigationStatus(
  investigation: Pick<Investigation, "storedStatus" | "dueOn">,
  now: Date = new Date(),
): InvestigationStatus {
  if (investigation.storedStatus === "resolved") return "resolved";
  if (investigation.dueOn) {
    const todayIso = now.toISOString().slice(0, 10);
    if (daysBetween(todayIso, investigation.dueOn) < 0) return "overdue";
  }
  return investigation.storedStatus;
}

export function isInvestigationOverdue(
  investigation: Pick<Investigation, "storedStatus" | "dueOn">,
  now: Date = new Date(),
): boolean {
  return deriveInvestigationStatus(investigation, now) === "overdue";
}

/** Investigations that still need attention: open, in progress, or overdue. */
export function isInvestigationOpen(
  investigation: Pick<Investigation, "storedStatus" | "dueOn">,
  now: Date = new Date(),
): boolean {
  return deriveInvestigationStatus(investigation, now) !== "resolved";
}

/** Validate a create/update input; returns human error messages (empty = ok). */
export function validateInvestigationInput(input: {
  title?: string;
  dueOn?: string | null;
  sourceMetric?: unknown;
}): string[] {
  const errors: string[] = [];
  if (!input.title || !input.title.trim()) {
    errors.push("Give the investigation a title.");
  } else if (input.title.trim().length > 200) {
    errors.push("Keep the title under 200 characters.");
  }
  if (
    input.sourceMetric !== undefined &&
    input.sourceMetric !== null &&
    !isInvestigationSourceMetric(input.sourceMetric)
  ) {
    errors.push("Pick a valid source for the investigation.");
  }
  if (input.dueOn != null && input.dueOn !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
      errors.push("The due date must be a calendar date (YYYY-MM-DD).");
    } else if (
      Number.isNaN(Date.parse(`${input.dueOn}T00:00:00Z`)) ||
      new Date(`${input.dueOn}T00:00:00Z`).toISOString().slice(0, 10) !== input.dueOn
    ) {
      errors.push("The due date is not a real calendar date.");
    }
  }
  return errors;
}

const STATUS_RANK: Record<InvestigationStatus, number> = {
  overdue: 0,
  open: 1,
  in_progress: 2,
  resolved: 3,
};

/** Overdue first, then by soonest due date, resolved last. */
export function sortInvestigations<T extends Investigation>(
  investigations: T[],
  now: Date = new Date(),
): T[] {
  return [...investigations].sort((a, b) => {
    const rank =
      STATUS_RANK[deriveInvestigationStatus(a, now)] -
      STATUS_RANK[deriveInvestigationStatus(b, now)];
    if (rank !== 0) return rank;
    const aDue = a.dueOn ? Date.parse(a.dueOn) : Number.POSITIVE_INFINITY;
    const bDue = b.dueOn ? Date.parse(b.dueOn) : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });
}

/** A stable draft title for "Start investigation" from a dashboard tile. */
export function investigationDraftTitle(
  sourceMetric: InvestigationSourceMetric,
  sourceLabel: string,
): string {
  const label = INVESTIGATION_SOURCE_LABELS[sourceMetric];
  const detail = sourceLabel.trim();
  return detail ? `Look into: ${label} — ${detail}` : `Look into: ${label}`;
}

/** Build the events row for a lifecycle transition. */
export function buildInvestigationEvent(
  investigationId: string,
  agencyId: string,
  createdByUserId: string,
  createdByName: string,
  event: {
    eventType: InvestigationEventType;
    fromStatus?: StoredInvestigationStatus | null;
    toStatus?: StoredInvestigationStatus | null;
    note?: string | null;
  },
): InvestigationEvent {
  return {
    id: "",
    investigationId,
    eventType: event.eventType,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    note: (event.note ?? "").trim(),
    createdByUserId,
    createdByName,
    createdAt: new Date().toISOString(),
  };
}

/** DB row (snake_case) for public.investigations inserts. */
export function buildInvestigationRow(input: {
  agencyId: string;
  createdByUserId: string;
  createdByName: string;
  data: AddInvestigationInput;
}): Record<string, unknown> {
  return {
    agency_id: input.agencyId,
    site_id: input.data.siteId,
    source_metric: input.data.sourceMetric,
    source_record_id: input.data.sourceRecordId ?? null,
    source_label: (input.data.sourceLabel ?? "").trim(),
    title: input.data.title.trim(),
    description: (input.data.description ?? "").trim(),
    assigned_to_user_id: input.data.assignedToUserId ?? null,
    due_on: input.data.dueOn?.trim() || null,
    status: "open",
    created_by_user_id: input.createdByUserId,
    created_by_name: input.createdByName,
  };
}

/** Map a DB row back to the app shape. */
export function investigationFromRow(
  row: Record<string, unknown>,
  history: InvestigationEvent[] = [],
): Investigation {
  const status = row.status as string;
  const stored: StoredInvestigationStatus =
    status === "in_progress" || status === "resolved" ? status : "open";
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    siteId: row.site_id as string,
    sourceMetric: isInvestigationSourceMetric(row.source_metric)
      ? (row.source_metric as InvestigationSourceMetric)
      : "general",
    sourceRecordId: (row.source_record_id as string | null) ?? null,
    sourceLabel: (row.source_label as string | null) ?? "",
    title: row.title as string,
    description: (row.description as string | null) ?? "",
    assignedToUserId: (row.assigned_to_user_id as string | null) ?? null,
    assignedToName: (row.assigned_to_name as string | null | undefined) ?? null,
    dueOn: (row.due_on as string | null) ?? null,
    storedStatus: stored,
    createdByUserId: row.created_by_user_id as string,
    createdByName: (row.created_by_name as string | null) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    deletedAt: (row.deleted_at as string | null) ?? null,
    history: [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/** Map a DB row back to an investigation event. */
export function investigationEventFromRow(
  row: Record<string, unknown>,
): InvestigationEvent {
  return {
    id: row.id as string,
    investigationId: row.investigation_id as string,
    eventType: row.event_type as InvestigationEventType,
    fromStatus: (row.from_status as StoredInvestigationStatus | null) ?? null,
    toStatus: (row.to_status as StoredInvestigationStatus | null) ?? null,
    note: (row.note as string | null) ?? "",
    createdByUserId: row.created_by_user_id as string,
    createdByName: (row.created_by_name as string | null) ?? "",
    createdAt: row.created_at as string,
  };
}

/**
 * Summarize a list of investigations for dashboard tiles: how many are still
 * open (overdue counted separately for the tile tone).
 */
export function summarizeInvestigations(
  investigations: Array<Pick<Investigation, "storedStatus" | "dueOn">>,
  now: Date = new Date(),
): { open: number; overdue: number } {
  let open = 0;
  let overdue = 0;
  for (const item of investigations) {
    const status = deriveInvestigationStatus(item, now);
    if (status === "overdue") {
      open += 1;
      overdue += 1;
    } else if (status !== "resolved") {
      open += 1;
    }
  }
  return { open, overdue };
}
