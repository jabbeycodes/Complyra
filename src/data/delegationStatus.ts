/**
 * SIM-WAVE6-ITEM5 (simulation batch 33): ONE status vocabulary for nursing
 * delegations, shared by every surface that renders a delegation.
 *
 * Before this module the same delegation carried a different word on each
 * screen: the site list said "On track" (and its empty state said "No
 * active delegations"), the template library said "Active" / "In
 * preparation" / "Ended", the Individual chart said "Current" / "Off", and
 * the RN delegation forms said "Current" / "Pending" / "Off". Every surface
 * now derives its badge from the helpers below, so a given delegation
 * record produces the identical label everywhere.
 *
 * Canonical label set — ONE word per meaning:
 * - "Pending"   — assigned / created but not yet in effect: the RN form is
 *                 not fully signed yet, the obligation is not turned on,
 *                 the training material is still a draft / in review, or
 *                 the template is not active.
 * - "Active"    — in effect: an enabled RN delegation whose form is fully
 *                 signed, a site activation in effect, an assignment whose
 *                 training material is published, an available template.
 * - "Completed" — the delegation's run finished and was closed out: the
 *                 assignment was ended, the site activation was
 *                 deactivated, or the obligation was discontinued by order.
 * - "Expired"   — no longer valid: the RN rescinded the delegation, or its
 *                 expiry date passed while the agency's delegations.expire
 *                 rule is on (mirrors isObligationActive in planStack.ts).
 *
 * This module is presentational only: it reads the existing record fields
 * and changes no data model and no signing logic. Per-person signing /
 * acknowledgment states ("Signed", "Outstanding", "Overdue", "Waiting for
 * RN") are a different dimension — whether one staffer has signed — and are
 * deliberately NOT part of this vocabulary.
 */
import type {
  DelegationActivationStatus,
  DelegationAssignmentStatus,
  DelegationTemplate,
  DelegationTrainingMaterial,
  SiteDelegationActivation,
  IndividualDelegationAssignment,
} from "../delegation/delegation";
import type { ObligationItem } from "./planStack";
import { delegationFormStatus, type DelegationForm } from "./types";

export type DelegationStatus = "pending" | "active" | "completed" | "expired";

/** The single label for each canonical delegation status. */
export const DELEGATION_STATUS_LABELS: Record<DelegationStatus, string> = {
  pending: "Pending",
  active: "Active",
  completed: "Completed",
  expired: "Expired",
};

export function delegationStatusLabel(status: DelegationStatus): string {
  return DELEGATION_STATUS_LABELS[status];
}

/* ------------------------------------------------------------------ */
/* RN delegation forms (ObligationItem with kind "delegation")         */
/* ------------------------------------------------------------------ */

/** The delegation fields the status derivation reads off an obligation. */
export type DelegationObligationRecord = Pick<
  ObligationItem,
  "enabled" | "expiresOn" | "discontinuedAt" | "rnSignedAt" | "delegationForm"
>;

/**
 * Status of one RN delegation (the obligation record behind the RN forms,
 * the Delegations page list, and the Individual chart delegation block).
 *
 * Precedence: a rescinded or date-expired delegation is "Expired" even if
 * it was once fully signed; a discontinued one is "Completed" (closed out
 * by order); only an enabled, RN-signed delegation whose form every named
 * staffer has signed is in effect ("Active"). Everything else — created,
 * turned off, waiting on the RN, waiting on staff signatures — is
 * "Pending": assigned, not yet effective.
 *
 * `delegationsExpire` mirrors the agency rule of the same name used by
 * isObligationActive: off (the default), a delegation does not lapse on
 * its expiresOn date. `today` is an ISO yyyy-mm-dd date.
 */
export function delegationStatusForObligation(
  item: DelegationObligationRecord,
  options?: { today?: string; delegationsExpire?: boolean },
): DelegationStatus {
  const form: DelegationForm | null | undefined = item.delegationForm;
  if (form && delegationFormStatus(form).rescinded) return "expired";
  const today = options?.today ?? new Date().toISOString().slice(0, 10);
  if (options?.delegationsExpire && item.expiresOn && item.expiresOn < today) {
    return "expired";
  }
  if (item.discontinuedAt) return "completed";
  // A form-less legacy delegation is in effect once the RN has signed and
  // it is turned on; a formed one must also be fully signed (the gate the
  // RN forms list always used) so the chart can no longer call an
  // unsigned delegation "Current" while the forms list calls it "Pending".
  const fullySigned = form
    ? delegationFormStatus(form).fullySigned
    : Boolean(item.rnSignedAt);
  if (item.enabled && fullySigned) return "active";
  return "pending";
}

/** Convenience: the canonical label for an obligation delegation. */
export function delegationObligationLabel(
  item: DelegationObligationRecord,
  options?: { today?: string; delegationsExpire?: boolean },
): string {
  return delegationStatusLabel(delegationStatusForObligation(item, options));
}

/* ------------------------------------------------------------------ */
/* Template library records                                            */
/* ------------------------------------------------------------------ */

/** Status of a delegation template itself: available or not yet in effect. */
export function delegationStatusForTemplate(
  template: Pick<DelegationTemplate, "active">,
): DelegationStatus {
  return template.active ? "active" : "pending";
}

/** Status of a template activated for a site. */
export function delegationStatusForActivation(
  activation: Pick<SiteDelegationActivation, "status"> & {
    status: DelegationActivationStatus;
  },
): DelegationStatus {
  return activation.status === "active" ? "active" : "completed";
}

/**
 * Status of a template assigned to one Individual. An assignment is only
 * in effect once its training material is published; an ended assignment
 * is "Completed". Assignments carry no rescind/expiry fields, so they
 * never derive "Expired".
 */
export function delegationStatusForAssignment(
  assignment: Pick<IndividualDelegationAssignment, "status"> & {
    status: DelegationAssignmentStatus;
  },
  material?: Pick<DelegationTrainingMaterial, "status"> | null,
): DelegationStatus {
  if (assignment.status === "ended") return "completed";
  if (material?.status === "published") return "active";
  return "pending";
}
