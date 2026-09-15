/**
 * Notification engine — shared contract between edge functions, the client,
 * and tests (Workstream 1).
 *
 * The `notifications` table is written only server-side: edge functions call
 * the `notify-event` function with the service key and pass a
 * NotificationPayload-shaped body. `buildNotificationRow()` maps a payload
 * to the exact DB row shape (snake_case), so insert code on both sides stays
 * identical.
 *
 * Client-side, rows are only READ: useNotifications() fetches the current
 * member's rows and lets them mark notifications read. The client never
 * invents notifications — `queueClientNotifications()` only derives rows
 * from REAL local/hosted data (certificate expiries, med inventory
 * projections), and the app calls it sparingly; scheduler-driven events
 * belong to `notify-event`.
 */

export type NotificationType =
  | "training.assigned"
  | "training.due_soon"
  | "training.overdue"
  | "certificate.expiring"
  | "certificate.expired"
  | "med.low_stock"
  | "checklist.assigned"
  | "checklist.late"
  | "checklist.missed"
  | "checklist.submitted"
  | "rating.changed"
  | "review.changed"
  | "recognition.hm_winner"
  | "recognition.dsp_winner"
  | "delegation.review_ready"
  | "delegation.published"
  | "delegation.ack_overdue"
  | "qa.dispute_raised"
  | "qa.dispute_resolved";

export const NOTIFICATION_TYPES: NotificationType[] = [
  "training.assigned",
  "training.due_soon",
  "training.overdue",
  "certificate.expiring",
  "certificate.expired",
  "med.low_stock",
  "checklist.assigned",
  "checklist.late",
  "checklist.missed",
  "checklist.submitted",
  "rating.changed",
  "review.changed",
  "recognition.hm_winner",
  "recognition.dsp_winner",
  "delegation.review_ready",
  "delegation.published",
  "delegation.ack_overdue",
  "qa.dispute_raised",
  "qa.dispute_resolved",
];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as string[]).includes(value)
  );
}

/**
 * What an event source must describe to raise a notification. `agencyId` is
 * required (notifications are agency-scoped); exactly one of `userId` or
 * `roleKey` must be set — userId targets one member, roleKey broadcasts to
 * everyone holding that role (e.g. "house_manager").
 */
export interface NotificationPayload {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
}

/**
 * Map a payload to the DB row shape (snake_case columns). Omits optional
 * columns entirely when unset so inserts only carry what the event provided.
 */
export function buildNotificationRow(
  payload: NotificationPayload,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    agency_id: payload.agencyId,
    user_id: payload.userId ?? null,
    role_key: payload.roleKey ?? null,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    deep_link: payload.deepLink,
    read_at: null,
  };
  if (payload.entityType != null && payload.entityType !== "") {
    row.entity_type = payload.entityType;
  }
  if (payload.entityId != null && payload.entityId !== "") {
    row.entity_id = payload.entityId;
  }
  if (payload.dedupeKey != null && payload.dedupeKey !== "") {
    row.dedupe_key = payload.dedupeKey;
  }
  return row;
}

/** One delivery attempt — dedupe_key present and unique per event. */
export function dedupeKeyFor(
  type: NotificationType,
  ...parts: Array<string | number>
): string {
  return [type, ...parts.map(String)].join(":");
}

/** Deep links must start with `/` and never contain a hostname. */
export function isWellFormedDeepLink(deepLink: string): boolean {
  if (typeof deepLink !== "string") return false;
  if (!deepLink.startsWith("/")) return false;
  return !deepLink.includes("://") && !deepLink.includes(" ");
}

/** DB row as the client reads it. */
export interface NotificationRow {
  id: string;
  agency_id: string;
  user_id: string | null;
  role_key: string | null;
  type: NotificationType;
  title: string;
  body: string;
  deep_link: string;
  entity_type: string | null;
  entity_id: string | null;
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
}

export function isUnread(row: NotificationRow): boolean {
  return row.read_at == null;
}

export function unreadCount(rows: NotificationRow[]): number {
  return rows.filter(isUnread).length;
}

export type NotificationStatus = "compliant" | "expiring" | "expired" | "missing" | "late" | "pending";

/**
 * Icon + text presentation for each type, matching the StatusBadge status
 * union ('compliant'|'expiring'|'expired'|'missing'|'late'|'pending') so the
 * badge can be swapped in later. Status is never conveyed by color alone.
 */
export const NOTIFICATION_META: Record<
  NotificationType,
  { status: NotificationStatus; label: string }
> = {
  "training.assigned": { status: "pending", label: "Training assigned" },
  "training.due_soon": { status: "expiring", label: "Training due soon" },
  "training.overdue": { status: "late", label: "Training overdue" },
  "certificate.expiring": { status: "expiring", label: "Certificate expiring" },
  "certificate.expired": { status: "expired", label: "Certificate expired" },
  "med.low_stock": { status: "expiring", label: "Medication low stock" },
  "checklist.assigned": { status: "pending", label: "Checklist assigned" },
  "checklist.late": { status: "late", label: "Checklist late" },
  "checklist.missed": { status: "missing", label: "Checklist missed" },
  "checklist.submitted": { status: "compliant", label: "Checklist submitted" },
  "rating.changed": { status: "pending", label: "Rating updated" },
  "review.changed": { status: "pending", label: "Review updated" },
  "recognition.hm_winner": { status: "compliant", label: "House Manager of the Week" },
  "recognition.dsp_winner": { status: "compliant", label: "DSP of the Week" },
  "delegation.review_ready": { status: "pending", label: "Delegation ready for review" },
  "delegation.published": { status: "pending", label: "Delegation training published" },
  "delegation.ack_overdue": { status: "late", label: "Delegation acknowledgment overdue" },
  "qa.dispute_raised": { status: "pending", label: "QA finding disputed" },
  "qa.dispute_resolved": { status: "compliant", label: "QA dispute resolved" },
};

export function metaForType(type: NotificationType) {
  return NOTIFICATION_META[type] ?? { status: "pending" as const, label: type };
}

/**
 * Event-source factories: each builds a payload from a REAL event — a
 * training assignment, a certificate record, a med inventory projection, or
 * a checklist lifecycle transition. No fakes: every field traces to the
 * entity the event names.
 */
export function trainingAssignedPayload(input: {
  agencyId: string;
  userId: string;
  trainingId: string;
  trainingTitle: string;
  staffName?: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "training.assigned",
    title: "New training assigned",
    body: input.staffName
      ? `${input.staffName}, you've been assigned training: ${input.trainingTitle}.`
      : `You've been assigned training: ${input.trainingTitle}.`,
    deepLink: `/training/${input.trainingId}`,
    entityType: "training",
    entityId: input.trainingId,
    dedupeKey: dedupeKeyFor("training.assigned", input.trainingId, input.userId),
  };
}

export function trainingDueSoonPayload(input: {
  agencyId: string;
  userId: string;
  trainingId: string;
  trainingTitle: string;
  daysLeft: number;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "training.due_soon",
    title: "Training due soon",
    body: `${input.trainingTitle} is due in ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"}. Complete it before the deadline.`,
    deepLink: `/training/${input.trainingId}`,
    entityType: "training",
    entityId: input.trainingId,
    dedupeKey: dedupeKeyFor("training.due_soon", input.trainingId, input.userId),
  };
}

export function trainingOverduePayload(input: {
  agencyId: string;
  userId: string;
  trainingId: string;
  trainingTitle: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "training.overdue",
    title: "Training overdue",
    body: `${input.trainingTitle} is past its due date. Complete it now to stay compliant.`,
    deepLink: `/training/${input.trainingId}`,
    entityType: "training",
    entityId: input.trainingId,
    dedupeKey: dedupeKeyFor("training.overdue", input.trainingId, input.userId),
  };
}

export function certificateExpiringPayload(input: {
  agencyId: string;
  userId: string;
  certificateId: string;
  certName: string;
  daysRemaining: number;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "certificate.expiring",
    title: "Certificate expiring",
    body: `${input.certName} expires in ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"}. Renew it to keep clearance current.`,
    deepLink: `/certificates/${input.certificateId}`,
    entityType: "certificate",
    entityId: input.certificateId,
    dedupeKey: dedupeKeyFor("certificate.expiring", input.certificateId),
  };
}

export function certificateExpiredPayload(input: {
  agencyId: string;
  userId: string;
  certificateId: string;
  certName: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "certificate.expired",
    title: "Certificate expired",
    body: `${input.certName} has expired. Upload a renewed certificate to restore clearance.`,
    deepLink: `/certificates/${input.certificateId}`,
    entityType: "certificate",
    entityId: input.certificateId,
    dedupeKey: dedupeKeyFor("certificate.expired", input.certificateId),
  };
}

export function medLowStockPayload(input: {
  agencyId: string;
  roleKey: string;
  medId: string;
  medName: string;
  siteName?: string;
  daysRemaining: number;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "med.low_stock",
    title: "Medication low stock",
    body: input.siteName
      ? `${input.medName} at ${input.siteName} has about ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"} left. Reorder now.`
      : `${input.medName} has about ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"} left. Reorder now.`,
    deepLink: `/meds/${input.medId}`,
    entityType: "med_inventory",
    entityId: input.medId,
    dedupeKey: dedupeKeyFor("med.low_stock", input.medId),
  };
}

export function checklistAssignedPayload(input: {
  agencyId: string;
  userId: string;
  checklistId: string;
  checklistTitle: string;
  houseName?: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "checklist.assigned",
    title: "Checklist assigned",
    body: input.houseName
      ? `You've been assigned the ${input.checklistTitle} for ${input.houseName}.`
      : `You've been assigned the ${input.checklistTitle}.`,
    deepLink: `/checklists/${input.checklistId}`,
    entityType: "checklist",
    entityId: input.checklistId,
    dedupeKey: dedupeKeyFor("checklist.assigned", input.checklistId, input.userId),
  };
}

export function checklistLatePayload(input: {
  agencyId: string;
  roleKey: string;
  checklistId: string;
  checklistTitle: string;
  houseName?: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "checklist.late",
    title: "Checklist running late",
    body: input.houseName
      ? `The ${input.checklistTitle} for ${input.houseName} is past due.`
      : `The ${input.checklistTitle} is past due.`,
    deepLink: `/checklists/${input.checklistId}`,
    entityType: "checklist",
    entityId: input.checklistId,
    dedupeKey: dedupeKeyFor("checklist.late", input.checklistId),
  };
}

export function checklistMissedPayload(input: {
  agencyId: string;
  roleKey: string;
  checklistId: string;
  checklistTitle: string;
  houseName?: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "checklist.missed",
    title: "Checklist missed",
    body: input.houseName
      ? `The ${input.checklistTitle} for ${input.houseName} was not completed this cycle.`
      : `The ${input.checklistTitle} was not completed this cycle.`,
    deepLink: `/checklists/${input.checklistId}`,
    entityType: "checklist",
    entityId: input.checklistId,
    dedupeKey: dedupeKeyFor("checklist.missed", input.checklistId),
  };
}

export function checklistSubmittedPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  checklistId: string;
  checklistTitle: string;
  submittedByName?: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "checklist.submitted",
    title: "Checklist submitted",
    body: input.submittedByName
      ? `${input.submittedByName} submitted the ${input.checklistTitle}.`
      : `The ${input.checklistTitle} was submitted.`,
    deepLink: `/checklists/${input.checklistId}`,
    entityType: "checklist",
    entityId: input.checklistId,
    dedupeKey: dedupeKeyFor("checklist.submitted", input.checklistId),
  };
}

/**
 * An HM/DPM disputed a scored QA item with photo evidence. Notifies the
 * agency's auditors so the dispute gets a ruling.
 */
export function qaDisputeRaisedPayload(input: {
  agencyId: string;
  roleKey: string;
  auditId: string;
  siteName: string;
  itemText: string;
  actorName: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "qa.dispute_raised",
    title: "QA finding disputed",
    body: `${input.actorName} disputed a QA finding at ${input.siteName}: ${input.itemText}. Review the photo evidence and rule on the dispute.`,
    deepLink: `/qa-audits/${input.auditId}`,
    entityType: "qa_audit",
    entityId: input.auditId,
    dedupeKey: dedupeKeyFor("qa.dispute_raised", input.auditId, input.itemText),
  };
}

/**
 * The auditor ruled on a disputed QA item. Notifies the disputing side
 * (HM/DPM) with the outcome visible on the QA Review page.
 */
export function qaDisputeResolvedPayload(input: {
  agencyId: string;
  roleKey: string;
  auditId: string;
  siteName: string;
  itemText: string;
  actorName: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "qa.dispute_resolved",
    title: "QA dispute resolved",
    body: `${input.actorName} ruled on the disputed QA finding at ${input.siteName}: ${input.itemText}. See the QA Review page for the ruling and reason.`,
    deepLink: `/qa-audits/${input.auditId}`,
    entityType: "qa_audit",
    entityId: input.auditId,
    dedupeKey: dedupeKeyFor("qa.dispute_resolved", input.auditId, input.itemText),
  };
}

/** Sort newest first, unread before read when equal — the panel's order. */
export function sortNotifications(rows: NotificationRow[]): NotificationRow[] {
  return [...rows].sort((a, b) => {
    if (isUnread(a) !== isUnread(b)) return isUnread(a) ? -1 : 1;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
}

/**
 * Mark-as-read state transitions, pure so the hook and tests share them.
 * - markOneRead: stamps read_at on the matching row (others untouched).
 * - markAllRead: stamps read_at on every unread row with `now`.
 */
export function markOneRead(
  rows: NotificationRow[],
  id: string,
  now: string,
): NotificationRow[] {
  return rows.map((row) =>
    row.id === id && isUnread(row) ? { ...row, read_at: now } : row,
  );
}

export function markAllRead(
  rows: NotificationRow[],
  now: string,
): NotificationRow[] {
  return rows.map((row) => (isUnread(row) ? { ...row, read_at: now } : row));
}

/* ------------------------------------------------------------------ */
/* Recognition payloads (winners-only recognition)                     */
/* ------------------------------------------------------------------ */

/**
 * A DSP changed their 1–5 rating of a house manager. Targeted at the HM.
 * The dedupe key is the individual history row id, so every change notifies
 * exactly once and later legitimate changes are never suppressed.
 */
export function dspRatingChangedPayload(input: {
  agencyId: string;
  hmUserId: string;
  historyId: string;
  ratingId: string;
  dspName: string;
  rating: number;
  ratingLabel: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.hmUserId,
    type: "rating.changed",
    title: "Your rating was updated",
    body: `${input.dspName} updated their rating of you to ${input.rating} of 5 (${input.ratingLabel}).`,
    deepLink: "/recognition",
    entityType: "dsp_hm_rating",
    entityId: input.ratingId,
    dedupeKey: dedupeKeyFor("rating.changed", input.historyId),
  };
}

/**
 * A house manager changed their 1–5 review of a DSP. Targeted at the DSP.
 * Dedupe is per history row, same as ratings.
 */
export function hmReviewChangedPayload(input: {
  agencyId: string;
  dspUserId: string;
  historyId: string;
  reviewId: string;
  hmName: string;
  rating: number;
  ratingLabel: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.dspUserId,
    type: "review.changed",
    title: "Your review was updated",
    body: `${input.hmName} updated their review of you to ${input.rating} of 5 (${input.ratingLabel}).`,
    deepLink: "/recognition",
    entityType: "hm_dsp_review",
    entityId: input.reviewId,
    dedupeKey: dedupeKeyFor("review.changed", input.historyId),
  };
}

function winnerPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  category: "recognition.hm_winner" | "recognition.dsp_winner";
  winnerName: string;
  weekStart: string;
  weekLabel: string;
  self: boolean;
}): NotificationPayload {
  const hm = input.category === "recognition.hm_winner";
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: input.category,
    title: input.self
      ? hm
        ? "You're House Manager of the Week"
        : "You're DSP of the Week"
      : hm
        ? "House Manager of the Week"
        : "DSP of the Week",
    body: input.self
      ? `Congratulations, ${input.winnerName}. Your work stood out for the week of ${input.weekLabel}.`
      : `${input.winnerName} is ${hm ? "House Manager" : "DSP"} of the Week for the week of ${input.weekLabel}.`,
    deepLink: "/recognition",
    entityType: "recognition_winner",
    entityId: `${input.category}:${input.weekStart}`,
    dedupeKey: dedupeKeyFor(
      input.category,
      input.weekStart,
      input.userId ?? input.roleKey ?? "all",
    ),
  };
}

/** Personal celebration notification for the winner. */
export function hmWinnerSelfPayload(input: {
  agencyId: string;
  winnerUserId: string;
  winnerName: string;
  weekStart: string;
  weekLabel: string;
}): NotificationPayload {
  return winnerPayload({ ...input, userId: input.winnerUserId, category: "recognition.hm_winner", self: true });
}

/** Personal celebration notification for the winner. */
export function dspWinnerSelfPayload(input: {
  agencyId: string;
  winnerUserId: string;
  winnerName: string;
  weekStart: string;
  weekLabel: string;
}): NotificationPayload {
  return winnerPayload({ ...input, userId: input.winnerUserId, category: "recognition.dsp_winner", self: true });
}

/** Role-broadcast celebration so the team hears about the winner. */
export function hmWinnerBroadcastPayload(input: {
  agencyId: string;
  roleKey: string;
  winnerName: string;
  weekStart: string;
  weekLabel: string;
}): NotificationPayload {
  return winnerPayload({ ...input, category: "recognition.hm_winner", self: false });
}

/** Role-broadcast celebration so the team hears about the winner. */
export function dspWinnerBroadcastPayload(input: {
  agencyId: string;
  roleKey: string;
  winnerName: string;
  weekStart: string;
  weekLabel: string;
}): NotificationPayload {
  return winnerPayload({ ...input, category: "recognition.dsp_winner", self: false });
}

/* ------------------------------------------------------------------ */
/* Delegation payloads (delegation lifecycle: review → publish → ack)   */
/* ------------------------------------------------------------------ */

/**
 * An assignment was created and is waiting on a reviewer. Notifies the
 * reviewer — template activation itself notifies nobody.
 */
export function delegationReviewReadyPayload(input: {
  agencyId: string;
  userId: string;
  assignmentId: string;
  templateName: string;
  individualName: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "delegation.review_ready",
    title: "Delegation ready for review",
    body: `The ${input.templateName} delegation for ${input.individualName} is ready for review.`,
    deepLink: "/delegations/templates",
    entityType: "delegation_assignment",
    entityId: input.assignmentId,
    dedupeKey: dedupeKeyFor("delegation.review_ready", input.assignmentId, input.userId),
  };
}

/**
 * A delegation template was published and is now in effect. Notifies site
 * staff so they review and sign the new training.
 */
export function delegationPublishedPayload(input: {
  agencyId: string;
  userId: string;
  assignmentId: string;
  templateName: string;
  individualName: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "delegation.published",
    title: "New delegation training to review",
    body: `New delegation training published: ${input.templateName} for ${input.individualName}. Please review and sign.`,
    deepLink: "/delegations/templates",
    entityType: "delegation_assignment",
    entityId: input.assignmentId,
    dedupeKey: dedupeKeyFor("delegation.published", input.assignmentId, input.userId),
  };
}

/**
 * The overdue sweep fired: a staff member's acknowledgment is past due.
 * Notifies the staff member (and managers), naming the days overdue.
 */
export function delegationAckOverduePayload(input: {
  agencyId: string;
  userId: string;
  assignmentId: string;
  templateName: string;
  individualName: string;
  daysOverdue: number;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    type: "delegation.ack_overdue",
    title: "Delegation acknowledgment overdue",
    body: `${input.individualName}'s acknowledgment of ${input.templateName} is ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} overdue. Complete and sign it now.`,
    deepLink: "/delegations/templates",
    entityType: "delegation_assignment",
    entityId: input.assignmentId,
    dedupeKey: dedupeKeyFor("delegation.ack_overdue", input.assignmentId, input.userId),
  };
}
