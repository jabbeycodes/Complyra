import type { SessionUser } from "./types";

/**
 * Client-side mirror of the queue_operating_notice ACL
 * (migration 20261025120200_missing_note_notice_acl.sql).
 *
 * The RPC raises P0001 "Not allowed" (HTTP 400) for calls the signed-in
 * user could never make: the function's guard is doing its job, but the
 * client used to fire the calls anyway — the notifications sweep re-queues
 * notices on behalf of other users on every bell open, so ordinary DSP/HM
 * sessions logged 12–26 console 400s per session. The delivered behavior
 * is unchanged when we skip: those notices never arrived. Permitted calls
 * still go through exactly as before.
 *
 * Keep this list in step with the SQL allow-list — a type missing from
 * the SQL list fails for EVERY caller ("Unsupported notice").
 */
export const OPERATING_NOTICE_TYPES: ReadonlySet<string> = new Set([
  "med.refusal_review",
  "med.prn_followup",
  "med.prn_frequency",
  "med.late_recording",
  "med.unrecorded",
  "med.prn_repeat",
  "documentation.missing_note",
  "accountability.warning",
  "accountability.writeup",
  "recognition.awarded",
]);

/** Notice types the RPC lets any agency member queue for someone else. */
const OTHER_RECIPIENT_EXEMPT_TYPE = "documentation.missing_note";

/** Permissions that let a caller queue a notice for another user. */
const NOTIFY_OTHER_PERMISSIONS = [
  "clinical.view",
  "hub.view_team",
  "recognition.manage",
  "recognition.review_dsp",
] as const;

export interface OperatingNoticeInput {
  type: string;
  userId?: string | null;
  roleKey?: string | null;
}

/**
 * Why queue_operating_notice would refuse this call for this session, or
 * null when the RPC will accept it. The SQL guard also requires an active
 * agency membership; private.has_agency is false while the account still
 * has must_change_password set, so first-sign-in sessions are blocked
 * here too (their calls 403/400 until the password is changed).
 */
export function operatingNoticeBlockReason(
  session: Pick<
    SessionUser,
    "userId" | "permissions" | "mustChangePassword"
  >,
  input: OperatingNoticeInput,
): string | null {
  if (session.mustChangePassword) return "password change pending";
  if (!OPERATING_NOTICE_TYPES.has(input.type)) return "unsupported notice type";
  const userId = input.userId ?? null;
  const roleKey = input.roleKey ?? null;
  if (userId === null && !roleKey) return "notice has no recipient";
  const forSomeoneElse = userId !== session.userId;
  if (
    forSomeoneElse &&
    input.type !== OTHER_RECIPIENT_EXEMPT_TYPE &&
    !NOTIFY_OTHER_PERMISSIONS.some((key) => session.permissions?.[key])
  ) {
    return "signed-in user cannot notify other users";
  }
  return null;
}

/**
 * Roles the retire_stale_missing_note_notices RPC accepts for a
 * non-service-role caller (migration 20261025120000): membership roles
 * outside this set (hr, compliance_admin, auditor,
 * degreed_professional_manager) are refused with a 400, so the client
 * must not call it for them. Retiring still happens whenever an eligible
 * role runs the sweep.
 */
const RETIRE_NOTICE_ROLES: ReadonlySet<string> = new Set([
  "administrator",
  "program_manager",
  "house_manager",
  "nurse",
  "dsp",
]);

export function canRetireStaleMissingNoteNotices(
  session: Pick<SessionUser, "roleKey" | "mustChangePassword">,
): boolean {
  return !session.mustChangePassword && RETIRE_NOTICE_ROLES.has(session.roleKey);
}
