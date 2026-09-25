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
  | "delegation.unacknowledged"
  | "isp.renewal_soon"
  | "incident.followup"
  | "qa.dispute_raised"
  | "qa.dispute_resolved"
  | "qa.schedule_due"
  | "qa.schedule_overdue"
  | "hr.swap_requested"
  | "hr.swap_approved"
  | "hr.swap_denied"
  | "hr.punch_exception"
  | "hr.overtime_alert"
  | "hr.overtime_approaching"
  | "hr.open_shift_posted"
  | "hr.open_shift_bid"
  | "hr.open_shift_picked_up"
  | "hr.open_shift_approved"
  | "hr.open_shift_denied";

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
  "delegation.unacknowledged",
  "isp.renewal_soon",
  "incident.followup",
  "qa.dispute_raised",
  "qa.dispute_resolved",
  "qa.schedule_due",
  "qa.schedule_overdue",
  "hr.swap_requested",
  "hr.swap_approved",
  "hr.swap_denied",
  "hr.punch_exception",
  "hr.overtime_alert",
  "hr.overtime_approaching",
  "hr.open_shift_posted",
  "hr.open_shift_bid",
  "hr.open_shift_picked_up",
  "hr.open_shift_approved",
  "hr.open_shift_denied",
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
  return !deepLink.startsWith("//") && !/[\\\s\u0000-\u001f]/.test(deepLink) && !deepLink.includes("://");
}

export function notificationPage(link: string): string | null {
  if (!isWellFormedDeepLink(link)) return null;
  const path = link.split(/[?#]/)[0];
  if (/^\/training(?:\/|$)/.test(path)) return "Training";
  if (/^\/certificates(?:\/|$)/.test(path)) return "Certificates";
  if (/^\/meds(?:\/|$)/.test(path)) return "Supply forecast";
  if (/^\/(?:checklists|weekly-checklist)(?:\/|$)/.test(path)) return "Weekly checklist";
  if (/^\/hub(?:\/|$)/.test(path)) return "Employee Hub";
  if (/^\/recognition(?:\/|$)/.test(path)) return "Recognition";
  if (/^\/plans(?:\/|$)/.test(path)) return "Individuals";
  if (/^\/requirements(?:\/|$)/.test(path)) return "Requirements";
  if (/^\/corrective-actions(?:\/|$)/.test(path)) return "Audit Me";
  if (/^\/audit(?:\/|$)/.test(path)) return "Audit Me";
  if (/^\/(?:qa|qa-audits)(?:\/|$)/.test(path)) return "QA Review";
  if (/^\/delegations(?:\/|$)/.test(path)) return "Delegations";
  if (/^\/documents\/extractions(?:\/|$)/.test(path)) return "Extraction review";
  return null;
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
  "delegation.unacknowledged": { status: "pending", label: "Delegation unacknowledged" },
  "isp.renewal_soon": { status: "expiring", label: "Plan renewal approaching" },
  "incident.followup": { status: "late", label: "Incident follow-up" },
  "qa.dispute_raised": { status: "pending", label: "QA finding disputed" },
  "qa.dispute_resolved": { status: "compliant", label: "QA dispute resolved" },
  "qa.schedule_due": { status: "expiring", label: "QA audit due" },
  "qa.schedule_overdue": { status: "late", label: "QA audit overdue" },
  "hr.swap_requested": { status: "pending", label: "Shift swap requested" },
  "hr.swap_approved": { status: "compliant", label: "Shift swap approved" },
  "hr.swap_denied": { status: "expired", label: "Shift swap denied" },
  "hr.punch_exception": { status: "pending", label: "Punch flagged for review" },
  "hr.overtime_alert": { status: "late", label: "Overtime" },
  "hr.overtime_approaching": { status: "expiring", label: "Approaching overtime" },
  "hr.open_shift_posted": { status: "pending", label: "Open shift posted" },
  "hr.open_shift_bid": { status: "pending", label: "Bid on an open shift" },
  "hr.open_shift_picked_up": { status: "compliant", label: "Open shift picked up" },
  "hr.open_shift_approved": { status: "compliant", label: "Open shift approved" },
  "hr.open_shift_denied": { status: "expired", label: "Open shift not approved" },
  "delegation.review_ready": { status: "pending", label: "Delegation ready for review" },
  "delegation.published": { status: "pending", label: "Delegation training published" },
  "delegation.ack_overdue": { status: "late", label: "Delegation acknowledgment overdue" },
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

export function delegationUnacknowledgedPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  acknowledgmentId: string;
  delegationTitle: string;
  staffName?: string;
  individualName?: string;
}): NotificationPayload {
  const who = input.staffName ? `${input.staffName}, ` : "";
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "delegation.unacknowledged",
    title: "Delegation needs your signature",
    body: input.individualName
      ? `${who}the delegation "${input.delegationTitle}" for ${input.individualName} is still unsigned. Review and sign it to stay compliant.`
      : `${who}the delegation "${input.delegationTitle}" is still unsigned. Review and sign it to stay compliant.`,
    deepLink: "/delegations",
    entityType: "delegation_acknowledgment",
    entityId: input.acknowledgmentId,
    dedupeKey: dedupeKeyFor("delegation.unacknowledged", input.acknowledgmentId),
  };
}

/**
 * A plan/ISP renewal is approaching. Targeted at the program manager
 * who owns renewals. Dedupe is per plan + due date so each renewal cycle
 * notifies once.
 */
export function ispRenewalSoonPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  planId: string;
  planTitle: string;
  individualName: string;
  dueOn: string;
  daysRemaining: number;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "isp.renewal_soon",
    title: "Plan renewal approaching",
    body:
      `Action required: ${input.planTitle} for ${input.individualName} ` +
      `renews in ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"} ` +
      `(${input.dueOn}). Start the renewal now to avoid a lapse in the plan.`,
    deepLink: "/delegations",
    entityType: "plan_renewal",
    entityId: input.planId,
    dedupeKey: dedupeKeyFor("isp.renewal_soon", input.planId, input.dueOn),
  };
}

/**
 * An incident needs follow-up: reported but no follow-up record, or the
 * next-business-day filing window is closing. Targeted at managers.
 */
export function incidentFollowupPayload(input: {
  agencyId: string;
  roleKey: string;
  incidentId: string;
  summary: string;
  occurredOn: string;
  followupDueOn: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    roleKey: input.roleKey,
    type: "incident.followup",
    title: "Incident follow-up due",
    body:
      `Action required: follow up on the incident from ${input.occurredOn} ` +
      `(${input.summary}) by ${input.followupDueOn}. ` +
      `File the follow-up electronically to meet the next-business-day requirement.`,
    deepLink: "/audit",
    entityType: "incident",
    entityId: input.incidentId,
    dedupeKey: dedupeKeyFor("incident.followup", input.incidentId),
  };
}

/* ------------------------------------------------------------------ */
/* HR shift-swap payloads (request → manager decision)                  */
/* ------------------------------------------------------------------ */

/**
 * A staff member posted a shift for swap. Notifies the scheduling managers
 * (roleKey broadcast, e.g. "house_manager" / "program_manager") so they can
 * review and approve it.
 */
export function swapRequestedPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  swapId: string;
  title: string;
  body: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "hr.swap_requested",
    title: input.title,
    body: input.body,
    deepLink: "/hub",
    entityType: "hr_shift_swap",
    entityId: input.swapId,
    dedupeKey: dedupeKeyFor("hr.swap_requested", input.swapId),
  };
}

/**
 * A manager decided a shift swap (claim approval or a request decision).
 * Notifies the requester with the outcome; a claim is also routed through
 * this builder with approved=true.
 */
export function swapDecidedPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  swapId: string;
  approved: boolean;
  title: string;
  body: string;
}): NotificationPayload {
  const type: NotificationType = input.approved ? "hr.swap_approved" : "hr.swap_denied";
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type,
    title: input.title,
    body: input.body,
    deepLink: "/hub",
    entityType: "hr_shift_swap",
    entityId: input.swapId,
    dedupeKey: dedupeKeyFor(type, input.swapId),
  };
}

/* ------------------------------------------------------------------ */
/* Kiosk punch payloads (exception flagged → overtime trending)         */
/* ------------------------------------------------------------------ */

/**
 * A manager flagged a staff member's punch for correction from the
 * exceptions dashboard. Targeted at the staff member so they see why
 * their punch is under review. Emitted once per correction (the dedupe
 * key is the correction id).
 */
export function punchExceptionPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  correctionId: string;
  title: string;
  body: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "hr.punch_exception",
    title: input.title,
    body: input.body,
    deepLink: "/hub",
    entityType: "hr_punch_exception",
    entityId: input.correctionId,
    dedupeKey: dedupeKeyFor("hr.punch_exception", input.correctionId),
  };
}

/**
 * A staff member is approaching overtime this week (36h+ of the 40-hour
 * limit). Sent to the staff member and to the scheduling managers; dedupe is
 * per staff member + week + recipient.
 */
export function overtimeApproachingPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  staffId: string;
  staffName: string;
  hoursWorked: number;
  weekLabel: string;
  forStaffMember: boolean;
}): NotificationPayload {
  const hours = input.hoursWorked.toFixed(1);
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "hr.overtime_approaching",
    title: "Approaching overtime",
    body: input.forStaffMember
      ? `You're at ${hours}h this week (Sunday–Saturday). Past 41 hours needs your manager's approval.`
      : `${input.staffName} is at ${hours}h this week. Past 41 hours is overtime; check their upcoming shifts.`,
    deepLink: "/hub",
    entityType: "hr_punch_exception",
    entityId: input.staffId,
    dedupeKey: dedupeKeyFor(
      "hr.overtime_approaching",
      input.staffId,
      `${input.weekLabel}:${input.forStaffMember ? "self" : input.roleKey ?? input.userId ?? ""}`,
    ),
  };
}

/**
 * A staff member is trending toward overtime this week. Broadcast to the
 * scheduling managers (roleKey, e.g. "house_manager" / "program_manager")
 * so they can adjust upcoming shifts. Dedupe is per staff member + week
 * label so the dashboard's auto-refresh can't spam the same alert.
 */
export function overtimeAlertPayload(input: {
  agencyId: string;
  userId?: string | null;
  roleKey?: string | null;
  staffId: string;
  staffName: string;
  hoursWorked: number;
  thresholdHours: number;
  weekLabel: string;
}): NotificationPayload {
  return {
    agencyId: input.agencyId,
    userId: input.userId ?? null,
    roleKey: input.roleKey ?? null,
    type: "hr.overtime_alert",
    title: "Overtime",
    body:
      `${input.staffName} has worked ${input.hoursWorked.toFixed(1)}h this week ` +
      `(flagged past ${input.thresholdHours}h). Review their upcoming shifts.`,
    deepLink: "/hub",
    entityType: "hr_punch_exception",
    entityId: input.staffId,
    dedupeKey: dedupeKeyFor("hr.overtime_alert", input.staffId, input.weekLabel, input.roleKey ?? input.userId ?? ""),
  };
}
