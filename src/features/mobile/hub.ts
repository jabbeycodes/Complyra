/**
 * Pure helpers for the mobile Employee Hub and manager reads (Phase 4b).
 * Display labels mirror the desktop Employee Hub page's own label maps
 * (which live inside that page module); every status, balance, and
 * score below is computed by the same data-layer functions the desktop
 * surfaces use, so the phone never disagrees with the hub or the QA
 * page about what a record says.
 */
import {
  approvedTimeOffHours,
  LEAVE_TYPES,
  timeOffBalanceView,
  type HrAccrualLedgerEntry,
  type HrAccrualPolicy,
  type HrDocumentAck,
  type HrTimeOffRequest,
  type LeaveType,
  type TimeOffBalanceView,
} from "../../data/hr";
import {
  QA_ITEM_BY_ID,
  QA_SECTIONS,
  type QaAuditItemState,
} from "../../data/qaAudit";
import {
  CORRECTIVE_ACTION_STATUS_META,
  deriveCorrectiveActionStatus,
  isCorrectiveActionOverdue,
  type CorrectiveAction,
} from "../../data/correctiveActions";

/** Word-for-word the desktop hub page's leave-type labels. */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  pto: "Earned Time Off",
  sick: "Sick",
  bereavement: "Bereavement",
  unpaid: "Unpaid",
};

/** Word-for-word the desktop hub page's request-status labels. */
export const TIME_OFF_STATUS_LABELS: Record<HrTimeOffRequest["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

export interface TimeOffBalanceCard {
  type: LeaveType;
  view: TimeOffBalanceView;
  used: number;
}

/**
 * The balance cards the desktop Time Off tab shows: a leave type gets a
 * card when an active policy covers it or the employee already has
 * ledger/request activity in it.
 */
export function timeOffBalanceCards(
  policies: HrAccrualPolicy[],
  ledger: HrAccrualLedgerEntry[],
  requests: HrTimeOffRequest[],
  userId: string,
): TimeOffBalanceCard[] {
  return LEAVE_TYPES.filter((type) => {
    const hasPolicy = policies.some((p) => p.leaveType === type && p.active);
    const hasActivity =
      ledger.some((entry) => entry.leaveType === type) ||
      requests.some((request) => request.kind === type);
    return hasPolicy || hasActivity;
  }).map((type) => ({
    type,
    view: timeOffBalanceView(ledger, requests, userId, type),
    used: approvedTimeOffHours(requests, userId, type),
  }));
}

/** The signed-in user's acknowledgment for one hub document, if any. */
export function myDocumentAck(
  acks: HrDocumentAck[],
  docId: string,
  userId: string,
): HrDocumentAck | undefined {
  return acks.find((ack) => ack.docId === docId && ack.staffId === userId);
}

/* ------------------------------ QA Review ------------------------------ */

const QA_RESULT_LABELS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  na: "Not applicable",
  skipped: "Skipped",
};

/** The checklist section title an audit item belongs to. */
export function qaSectionTitle(item: QaAuditItemState): string {
  const sectionId = QA_ITEM_BY_ID[item.itemId]?.sectionId ?? "home";
  return QA_SECTIONS.find((section) => section.id === sectionId)?.title ?? "Home environment";
}

/** The checklist wording for an audit item (per-Individual items name the person). */
export function qaItemTitle(item: QaAuditItemState): string {
  const title = QA_ITEM_BY_ID[item.itemId]?.text ?? item.itemId;
  return item.individualName ? `${title} — ${item.individualName}` : title;
}

/**
 * One factual status line for an audit item, in words: system-verified
 * items say so and carry their evidence; scored items state the result;
 * disputes and their resolutions are stated, never implied by color.
 */
export function qaItemStatusText(item: QaAuditItemState): string {
  if (item.status === "disputed") return "Disputed — awaiting the auditor's review";
  if (item.status === "resolved" && item.disputeResolution) {
    return item.disputeResolution.approved
      ? "Dispute approved — item corrected"
      : "Dispute not approved — original score stands";
  }
  if (item.locked) {
    return item.systemEvidence
      ? `System verified · ${item.systemEvidence}`
      : "System verified";
  }
  if (item.result) return `Scored: ${QA_RESULT_LABELS[item.result] ?? item.result}`;
  return "Not scored yet";
}

/** Whether every item is decided (the desktop finalize precondition). */
export function qaAllDecided(items: QaAuditItemState[]): boolean {
  return items.length > 0 && items.every((item) => item.result !== null || item.locked);
}

/* --------------------------- Corrective actions --------------------------- */

export interface CorrectiveActionLine {
  id: string;
  title: string;
  status: string;
  overdue: boolean;
  detail: string;
}

/** One read line per agency corrective action (the Audit center's list). */
export function correctiveActionLine(
  action: CorrectiveAction,
  now: Date = new Date(),
): CorrectiveActionLine {
  const status = deriveCorrectiveActionStatus(action, now);
  const overdue = isCorrectiveActionOverdue(action, now);
  const parts: string[] = [];
  if (action.assignedToName) parts.push(`Assigned to ${action.assignedToName}`);
  if (action.dueOn) parts.push(`Due ${action.dueOn}`);
  if (action.resolvedAt) parts.push(`Resolved ${action.resolvedAt.slice(0, 10)}`);
  return {
    id: action.id,
    title: action.title,
    status: CORRECTIVE_ACTION_STATUS_META[status].label,
    overdue,
    detail: parts.join(" · "),
  };
}
