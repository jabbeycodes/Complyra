/**
 * Automated workflows library — pre-built workflow templates with
 * professional wording. Each template has an id, name, description, trigger
 * condition, action, and ready-to-use message text (concise, professional,
 * actionable).
 *
 * Trigger evaluation (`evaluateWorkflowTriggers`) turns domain facts into
 * hits; each hit carries a dedupe key built with the Phase 1 notification
 * engine's `dedupeKeyFor`, so one event fires exactly one workflow action.
 * `workflowNotificationPayload` maps a hit onto a NotificationPayload from
 * src/features/notifications/notify.ts for delivery through the notify-event
 * pipeline.
 */

import {
  dedupeKeyFor,
  certificateExpiringPayload,
  certificateExpiredPayload,
  checklistMissedPayload,
  trainingOverduePayload,
  trainingDueSoonPayload,
  delegationUnacknowledgedPayload,
  ispRenewalSoonPayload,
  incidentFollowupPayload,
  type NotificationPayload,
  type NotificationType,
} from "../features/notifications/notify";

export type WorkflowAudience = "assignee" | "manager" | "role";

export interface WorkflowMessageVars {
  staffName?: string;
  certName?: string;
  daysRemaining?: number;
  checklistTitle?: string;
  siteName?: string;
  trainingTitle?: string;
  delegationTitle?: string;
  individualName?: string;
  planTitle?: string;
  dueOn?: string;
  incidentSummary?: string;
  occurredOn?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Human-readable trigger condition. */
  trigger: string;
  /** What the workflow does when the trigger fires. */
  action: string;
  audience: WorkflowAudience;
  /** Role key when audience is "role". */
  roleKey?: string;
  notificationType: NotificationType;
  /** Ready-to-use message text — direct, no fluff. */
  message: (vars: WorkflowMessageVars) => { title: string; body: string };
  deepLink: string;
}

function days(n: number | undefined): string {
  if (n == null) return "";
  return `${n} day${n === 1 ? "" : "s"}`;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "cert-expiring-30",
    name: "Certification expiring in 30 days",
    description: "First warning while there is still time to schedule renewal.",
    trigger: "A staff certificate has 30 or fewer days remaining and is not yet expired.",
    action: "Notify the staff member and their manager to schedule renewal.",
    audience: "assignee",
    notificationType: "certificate.expiring",
    message: (v) => ({
      title: "Certificate expiring",
      body: `Action required: ${v.staffName ?? "A staff member"}'s ${v.certName ?? "certification"} expires in ${days(v.daysRemaining)}. Renew now to avoid a compliance gap.`,
    }),
    deepLink: "/certificates",
  },
  {
    id: "cert-expiring-14",
    name: "Certification expiring in 14 days",
    description: "Escalated warning — renewal should already be scheduled.",
    trigger: "A staff certificate has 14 or fewer days remaining and is not yet expired.",
    action: "Notify the staff member and their manager; flag in the risk list.",
    audience: "assignee",
    notificationType: "certificate.expiring",
    message: (v) => ({
      title: "Certificate expiring soon",
      body: `Action required: ${v.staffName ?? "A staff member"}'s ${v.certName ?? "certification"} expires in ${days(v.daysRemaining)}. Confirm the renewal appointment today.`,
    }),
    deepLink: "/certificates",
  },
  {
    id: "cert-expiring-7",
    name: "Certification expiring in 7 days",
    description: "Final warning before the compliance gap opens.",
    trigger: "A staff certificate has 7 or fewer days remaining and is not yet expired.",
    action: "Notify the staff member, their manager, and HR immediately.",
    audience: "manager",
    notificationType: "certificate.expiring",
    message: (v) => ({
      title: "Certificate expiring this week",
      body: `Action required: ${v.staffName ?? "A staff member"}'s ${v.certName ?? "certification"} certification expires in ${days(v.daysRemaining)}. Renew now to avoid a compliance gap.`,
    }),
    deepLink: "/certificates",
  },
  {
    id: "cert-expired",
    name: "Certification expired",
    description: "The gap is open — clearance is lapsed until renewal is filed.",
    trigger: "A staff certificate's expiry date has passed.",
    action: "Notify the staff member and HR; add a critical risk until renewed.",
    audience: "manager",
    notificationType: "certificate.expired",
    message: (v) => ({
      title: "Certificate expired",
      body: `${v.staffName ?? "A staff member"}'s ${v.certName ?? "certification"} has expired. Upload a renewed certificate to restore clearance.`,
    }),
    deepLink: "/certificates",
  },
  {
    id: "checklist-missed",
    name: "Weekly checklist missed",
    description: "The week's checklist was never completed.",
    trigger: "An HM weekly checklist for a past week has no submission.",
    action: "Notify house managers; open a corrective action for the site.",
    audience: "role",
    roleKey: "house_manager",
    notificationType: "checklist.missed",
    message: (v) => ({
      title: "Checklist missed",
      body: v.siteName
        ? `The ${v.checklistTitle ?? "weekly checklist"} for ${v.siteName} was not completed this cycle. Submit it now or record why it was missed.`
        : `The ${v.checklistTitle ?? "weekly checklist"} was not completed this cycle. Submit it now or record why it was missed.`,
    }),
    deepLink: "/checklists",
  },
  {
    id: "delegation-unacknowledged",
    name: "Delegation unacknowledged",
    description: "A delegation or training material is still waiting on a signature.",
    trigger: "A delegation acknowledgment has no staff signature past its expected window.",
    action: "Notify the staffer to review and sign; escalate to the DPM after 7 days.",
    audience: "assignee",
    notificationType: "delegation.unacknowledged",
    message: (v) => ({
      title: "Delegation needs your signature",
      body: v.individualName
        ? `${v.staffName ? `${v.staffName}, ` : ""}the delegation "${v.delegationTitle ?? "assigned delegation"}" for ${v.individualName} is still unsigned. Review and sign it to stay compliant.`
        : `${v.staffName ? `${v.staffName}, ` : ""}the delegation "${v.delegationTitle ?? "assigned delegation"}" is still unsigned. Review and sign it to stay compliant.`,
    }),
    deepLink: "/delegations",
  },
  {
    id: "isp-renewal-approaching",
    name: "Plan renewal approaching",
    description: "A plan/ISP renewal date is coming up — start early to avoid a lapse.",
    trigger: "A plan renewal is due within 30 days.",
    action: "Notify the DPM/program manager to start the renewal.",
    audience: "role",
    roleKey: "degreed_professional_manager",
    notificationType: "isp.renewal_soon",
    message: (v) => ({
      title: "Plan renewal approaching",
      body: `Action required: ${v.planTitle ?? "A plan"} for ${v.individualName ?? "an individual"} renews in ${days(v.daysRemaining)} (${v.dueOn ?? "soon"}). Start the renewal now to avoid a lapse in the plan.`,
    }),
    deepLink: "/delegations",
  },
  {
    id: "training-due-soon",
    name: "Training due soon",
    description: "Heads-up before a training deadline.",
    trigger: "A training requirement is due within 14 days and incomplete.",
    action: "Notify the staff member to complete the training.",
    audience: "assignee",
    notificationType: "training.due_soon",
    message: (v) => ({
      title: "Training due soon",
      body: `${v.trainingTitle ?? "Training"} is due in ${days(v.daysRemaining)}. Complete it before the deadline.`,
    }),
    deepLink: "/training",
  },
  {
    id: "training-overdue",
    name: "Training overdue",
    description: "The training deadline passed with the requirement incomplete.",
    trigger: "A training requirement is past its due date and incomplete.",
    action: "Notify the staff member and manager; add a corrective action if still open after 7 days.",
    audience: "assignee",
    notificationType: "training.overdue",
    message: (v) => ({
      title: "Training overdue",
      body: `${v.trainingTitle ?? "Training"} is past its due date. Complete it now to stay compliant.`,
    }),
    deepLink: "/training",
  },
  {
    id: "incident-followup",
    name: "Incident follow-up due",
    description: "An incident was reported but the follow-up is still open.",
    trigger: "An incident has no follow-up record and the next-business-day filing window is closing.",
    action: "Notify managers to file the follow-up electronically.",
    audience: "role",
    roleKey: "degreed_professional_manager",
    notificationType: "incident.followup",
    message: (v) => ({
      title: "Incident follow-up due",
      body: `Action required: follow up on the incident from ${v.occurredOn ?? "recently"} (${v.incidentSummary ?? "see incident log"}) by ${v.dueOn ?? "end of next business day"}. File the follow-up electronically to meet the next-business-day requirement.`,
    }),
    deepLink: "/audit",
  },
];

export function workflowTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

/* ------------------------------------------------------------------ */
/* Trigger evaluation                                                  */
/* ------------------------------------------------------------------ */

export interface WorkflowFacts {
  certificates: Array<{
    id: string;
    userId: string;
    staffName: string;
    certName: string;
    daysRemaining: number;
  }>;
  missedChecklists: Array<{
    id: string;
    checklistTitle: string;
    siteName?: string;
  }>;
  unacknowledgedDelegations: Array<{
    acknowledgmentId: string;
    delegationTitle: string;
    staffName?: string;
    individualName?: string;
    userId?: string | null;
  }>;
  planRenewals: Array<{
    planId: string;
    planTitle: string;
    individualName: string;
    dueOn: string;
    daysRemaining: number;
  }>;
  trainings: Array<{
    id: string;
    userId: string;
    trainingTitle: string;
    daysRemaining: number | null;
    overdue: boolean;
  }>;
  incidentsNeedingFollowup: Array<{
    incidentId: string;
    summary: string;
    occurredOn: string;
    followupDueOn: string;
  }>;
}

export interface WorkflowHit {
  templateId: string;
  /** Stable dedupe key: one event fires exactly one workflow action. */
  dedupeKey: string;
  vars: WorkflowMessageVars;
  entityType: string;
  entityId: string;
}

/**
 * Evaluate every template against the facts. Pure and deterministic:
 * thresholds are the template's own (30/14/7-day cert variants), and each
 * hit carries the dedupe key its notification payload will use.
 */
export function evaluateWorkflowTriggers(facts: WorkflowFacts): WorkflowHit[] {
  const hits: WorkflowHit[] = [];
  const push = (hit: WorkflowHit) => {
    if (!hits.some((row) => row.dedupeKey === hit.dedupeKey)) hits.push(hit);
  };

  for (const cert of facts.certificates) {
    const vars: WorkflowMessageVars = {
      staffName: cert.staffName,
      certName: cert.certName,
      daysRemaining: Math.max(0, cert.daysRemaining),
    };
    if (cert.daysRemaining < 0) {
      push({
        templateId: "cert-expired",
        dedupeKey: dedupeKeyFor("certificate.expired", cert.id),
        vars,
        entityType: "certificate",
        entityId: cert.id,
      });
    } else if (cert.daysRemaining <= 7) {
      push({
        templateId: "cert-expiring-7",
        dedupeKey: dedupeKeyFor("certificate.expiring", cert.id, "7d"),
        vars,
        entityType: "certificate",
        entityId: cert.id,
      });
    } else if (cert.daysRemaining <= 14) {
      push({
        templateId: "cert-expiring-14",
        dedupeKey: dedupeKeyFor("certificate.expiring", cert.id, "14d"),
        vars,
        entityType: "certificate",
        entityId: cert.id,
      });
    } else if (cert.daysRemaining <= 30) {
      push({
        templateId: "cert-expiring-30",
        dedupeKey: dedupeKeyFor("certificate.expiring", cert.id, "30d"),
        vars,
        entityType: "certificate",
        entityId: cert.id,
      });
    }
  }

  for (const row of facts.missedChecklists) {
    push({
      templateId: "checklist-missed",
      dedupeKey: dedupeKeyFor("checklist.missed", row.id),
      vars: { checklistTitle: row.checklistTitle, siteName: row.siteName },
      entityType: "checklist",
      entityId: row.id,
    });
  }

  for (const row of facts.unacknowledgedDelegations) {
    push({
      templateId: "delegation-unacknowledged",
      dedupeKey: dedupeKeyFor("delegation.unacknowledged", row.acknowledgmentId),
      vars: {
        delegationTitle: row.delegationTitle,
        staffName: row.staffName,
        individualName: row.individualName,
      },
      entityType: "delegation_acknowledgment",
      entityId: row.acknowledgmentId,
    });
  }

  for (const row of facts.planRenewals) {
    if (row.daysRemaining < 0 || row.daysRemaining > 30) continue;
    push({
      templateId: "isp-renewal-approaching",
      dedupeKey: dedupeKeyFor("isp.renewal_soon", row.planId, row.dueOn),
      vars: {
        planTitle: row.planTitle,
        individualName: row.individualName,
        dueOn: row.dueOn,
        daysRemaining: row.daysRemaining,
      },
      entityType: "plan_renewal",
      entityId: row.planId,
    });
  }

  for (const row of facts.trainings) {
    if (row.overdue) {
      push({
        templateId: "training-overdue",
        dedupeKey: dedupeKeyFor("training.overdue", row.id, row.userId),
        vars: { trainingTitle: row.trainingTitle, staffName: undefined },
        entityType: "training",
        entityId: row.id,
      });
    } else if (row.daysRemaining != null && row.daysRemaining <= 14 && row.daysRemaining >= 0) {
      push({
        templateId: "training-due-soon",
        dedupeKey: dedupeKeyFor("training.due_soon", row.id, row.userId),
        vars: { trainingTitle: row.trainingTitle, daysRemaining: row.daysRemaining },
        entityType: "training",
        entityId: row.id,
      });
    }
  }

  for (const row of facts.incidentsNeedingFollowup) {
    push({
      templateId: "incident-followup",
      dedupeKey: dedupeKeyFor("incident.followup", row.incidentId),
      vars: {
        incidentSummary: row.summary,
        occurredOn: row.occurredOn,
        dueOn: row.followupDueOn,
      },
      entityType: "incident",
      entityId: row.incidentId,
    });
  }

  return hits;
}

/** Render a hit's ready-to-use message text. */
export function buildWorkflowMessage(hit: WorkflowHit): {
  title: string;
  body: string;
} {
  const template = workflowTemplateById(hit.templateId);
  if (!template) throw new Error(`Unknown workflow template: ${hit.templateId}`);
  return template.message(hit.vars);
}

/**
 * Map a hit onto a Phase 1 NotificationPayload for delivery through the
 * notify-event pipeline (dedupe_key = the hit's dedupe key).
 *
 * The caller resolves the audience: templates with audience "role" target
 * the template's roleKey; "assignee"/"manager" templates need
 * target.userId (the staffer or their manager). Throws when no target can
 * be resolved — a notification with neither user nor role is rejected by
 * the notifications table's target check.
 */
/**
 * The payload factories generate their own message text and dedupe keys, but
 * the WORKFLOW's rendered message is the canonical wording (the automated
 * workflow wording library) and the hit's dedupe key carries the
 * threshold-specific identity (e.g. cert:7d vs cert:30d). So after each
 * factory builds the correctly-typed payload, we restore the workflow's
 * rendered title/body and the hit's dedupe key.
 */
function withWorkflowRendering(
  payload: NotificationPayload,
  rendered: { title: string; body: string },
  dedupeKey: string,
): NotificationPayload {
  return { ...payload, title: rendered.title, body: rendered.body, dedupeKey };
}

export function workflowNotificationPayload(
  agencyId: string,
  hit: WorkflowHit,
  target: { userId?: string | null; roleKey?: string | null } = {},
): NotificationPayload {
  const template = workflowTemplateById(hit.templateId);
  if (!template) throw new Error(`Unknown workflow template: ${hit.templateId}`);
  const rendered = template.message(hit.vars);
  const userId = target.userId ?? null;
  const roleKey =
    template.audience === "role" ? (template.roleKey ?? null) : (target.roleKey ?? null);
  if (!userId && !roleKey) {
    throw new Error(
      `Workflow ${template.id} (audience ${template.audience}) needs a userId or roleKey target`,
    );
  }
  const base = {
    agencyId,
    userId,
    roleKey,
    deepLink: template.deepLink,
    entityType: hit.entityType,
    entityId: hit.entityId,
  };
  const assigneeId = (label: string): string => {
    if (!userId) throw new Error(`Workflow ${template.id} needs a userId target (${label})`);
    return userId;
  };
  const map = (): NotificationPayload => {
    switch (template.notificationType) {
      case "certificate.expiring":
        return certificateExpiringPayload({
          ...base,
          userId: assigneeId("certificate holder"),
          certificateId: hit.entityId,
          certName: hit.vars.certName ?? "certification",
          daysRemaining: hit.vars.daysRemaining ?? 0,
        });
      case "certificate.expired":
        return certificateExpiredPayload({
          ...base,
          userId: assigneeId("certificate holder"),
          certificateId: hit.entityId,
          certName: hit.vars.certName ?? "certification",
        });
      case "checklist.missed":
        return checklistMissedPayload({
          ...base,
          roleKey: template.roleKey ?? "house_manager",
          checklistId: hit.entityId,
          checklistTitle: hit.vars.checklistTitle ?? "weekly checklist",
          houseName: hit.vars.siteName,
        });
      case "training.overdue":
        return trainingOverduePayload({
          ...base,
          userId: assigneeId("trainee"),
          trainingId: hit.entityId,
          trainingTitle: hit.vars.trainingTitle ?? "Training",
        });
      case "training.due_soon":
        return trainingDueSoonPayload({
          ...base,
          userId: assigneeId("trainee"),
          trainingId: hit.entityId,
          trainingTitle: hit.vars.trainingTitle ?? "Training",
          daysLeft: hit.vars.daysRemaining ?? 0,
        });
      case "delegation.unacknowledged":
        return delegationUnacknowledgedPayload({
          ...base,
          userId: assigneeId("signer"),
          acknowledgmentId: hit.entityId,
          delegationTitle: hit.vars.delegationTitle ?? "delegation",
          staffName: hit.vars.staffName,
          individualName: hit.vars.individualName,
        });
      case "isp.renewal_soon":
        return ispRenewalSoonPayload({
          ...base,
          planId: hit.entityId,
          planTitle: hit.vars.planTitle ?? "Plan",
          individualName: hit.vars.individualName ?? "individual",
          dueOn: hit.vars.dueOn ?? "",
          daysRemaining: hit.vars.daysRemaining ?? 0,
        });
      case "incident.followup":
        return incidentFollowupPayload({
          ...base,
          roleKey: template.roleKey ?? "degreed_professional_manager",
          incidentId: hit.entityId,
          summary: hit.vars.incidentSummary ?? "see incident log",
          occurredOn: hit.vars.occurredOn ?? "",
          followupDueOn: hit.vars.dueOn ?? "",
        });
      default:
        throw new Error(
          `Workflow template ${template.id} has no payload mapping`,
        );
    }
  };
  return withWorkflowRendering(map(), rendered, hit.dedupeKey);
}
