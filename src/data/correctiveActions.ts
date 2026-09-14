/**
 * Corrective actions — create, assign, track to resolution. A corrective
 * action links an owner, a due date, and (optionally) the risk item that
 * raised it. "Overdue" is DERIVED (due date passed, not resolved), never
 * stored — the stored lifecycle is open -> in_progress -> resolved.
 *
 * Persistence: public.corrective_actions (migration
 * 20260914070000_audit_readiness.sql). Writes require the
 * correctiveActions.manage permission.
 */

export type StoredCorrectiveActionStatus = "open" | "in_progress" | "resolved";

/** Display status: "overdue" is derived from the due date. */
export type CorrectiveActionStatus =
  | StoredCorrectiveActionStatus
  | "overdue";

export const CORRECTIVE_ACTION_STATUSES: CorrectiveActionStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "overdue",
];

export const CORRECTIVE_ACTION_STATUS_META: Record<
  CorrectiveActionStatus,
  { label: string; icon: string }
> = {
  open: { label: "Open", icon: "○" },
  in_progress: { label: "In progress", icon: "◐" },
  resolved: { label: "Resolved", icon: "✓" },
  overdue: { label: "Overdue", icon: "✕" },
};

export interface CorrectiveAction {
  id: string;
  agencyId: string;
  title: string;
  description: string;
  assignedToUserId: string | null;
  assignedToName?: string | null;
  dueOn: string | null;
  /** Stored lifecycle status; "overdue" is derived, never stored. */
  storedStatus: StoredCorrectiveActionStatus;
  linkedRiskId: string | null;
  linkedRiskSource: string | null;
  createdByUserId: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NewCorrectiveAction {
  title: string;
  description?: string;
  assignedToUserId?: string | null;
  dueOn?: string | null;
  linkedRiskId?: string | null;
  linkedRiskSource?: string | null;
}

/** API input for creating a corrective action. */
export interface AddCorrectiveActionInput {
  title: string;
  description?: string | null;
  assignedToUserId?: string | null;
  dueOn?: string | null;
  linkedRiskId?: string | null;
  linkedRiskSource?: string | null;
}

/** API input for updating a corrective action. */
export interface UpdateCorrectiveActionInput {
  title?: string;
  description?: string | null;
  assignedToUserId?: string | null;
  dueOn?: string | null;
  storedStatus?: StoredCorrectiveActionStatus;
  linkedRiskId?: string | null;
  linkedRiskSource?: string | null;
}

/** Days as whole calendar days between two ISO dates (date part only). */
function daysBetween(fromIso: string, toIso: string): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((start(toIso) - start(fromIso)) / 86400000);
}

/**
 * Display status for an action at `now`: resolved stays resolved; anything
 * else past its due date is overdue.
 */
export function deriveCorrectiveActionStatus(
  action: Pick<CorrectiveAction, "storedStatus" | "dueOn">,
  now: Date = new Date(),
): CorrectiveActionStatus {
  if (action.storedStatus === "resolved") return "resolved";
  if (action.dueOn) {
    const todayIso = now.toISOString().slice(0, 10);
    if (daysBetween(todayIso, action.dueOn) < 0) return "overdue";
  }
  return action.storedStatus;
}

export function isCorrectiveActionOverdue(
  action: Pick<CorrectiveAction, "storedStatus" | "dueOn">,
  now: Date = new Date(),
): boolean {
  return deriveCorrectiveActionStatus(action, now) === "overdue";
}

/** Validate a create/update input; returns human error messages (empty = ok). */
export function validateCorrectiveActionInput(input: {
  title?: string;
  dueOn?: string | null;
  assignedToUserId?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!input.title || !input.title.trim()) {
    errors.push("Give the corrective action a title.");
  } else if (input.title.trim().length > 200) {
    errors.push("Keep the title under 200 characters.");
  }
  if (input.dueOn != null && input.dueOn !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
      errors.push("The due date must be a calendar date (YYYY-MM-DD).");
    } else if (Number.isNaN(Date.parse(`${input.dueOn}T00:00:00`))) {
      errors.push("The due date is not a real calendar date.");
    }
  }
  return errors;
}

const STATUS_RANK: Record<CorrectiveActionStatus, number> = {
  overdue: 0,
  open: 1,
  in_progress: 2,
  resolved: 3,
};

/** Overdue first, then by soonest due date, resolved last. */
export function sortCorrectiveActions<T extends CorrectiveAction>(
  actions: T[],
  now: Date = new Date(),
): T[] {
  return [...actions].sort((a, b) => {
    const rank =
      STATUS_RANK[deriveCorrectiveActionStatus(a, now)] -
      STATUS_RANK[deriveCorrectiveActionStatus(b, now)];
    if (rank !== 0) return rank;
    const aDue = a.dueOn ? Date.parse(a.dueOn) : Number.POSITIVE_INFINITY;
    const bDue = b.dueOn ? Date.parse(b.dueOn) : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });
}

/** DB row (snake_case) for public.corrective_actions inserts/updates. */
export function buildCorrectiveActionRow(input: {
  agencyId: string;
  createdByUserId: string;
  data: AddCorrectiveActionInput;
}): Record<string, unknown> {
  return {
    agency_id: input.agencyId,
    title: input.data.title.trim(),
    description: (input.data.description ?? "").trim(),
    assigned_to_user_id: input.data.assignedToUserId ?? null,
    due_on: input.data.dueOn ?? null,
    status: "open",
    linked_risk_id: input.data.linkedRiskId ?? null,
    linked_risk_source: input.data.linkedRiskSource ?? null,
    created_by_user_id: input.createdByUserId,
  };
}

/** Map a DB row back to the app shape. Accepts a generic record so hosted
 *  queries (`.select("*")`) and joined profiles flow straight through. */
export function correctiveActionFromRow(row: Record<string, unknown>): CorrectiveAction {
  const status = row.status as string;
  const stored = status === "in_progress" || status === "resolved" ? status : "open";
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? "",
    assignedToUserId: (row.assigned_to_user_id as string | null) ?? null,
    assignedToName: (row.assigned_to_name as string | null | undefined) ?? null,
    dueOn: (row.due_on as string | null) ?? null,
    storedStatus: stored,
    linkedRiskId: (row.linked_risk_id as string | null) ?? null,
    linkedRiskSource: (row.linked_risk_source as string | null) ?? null,
    createdByUserId: row.created_by_user_id as string,
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}
