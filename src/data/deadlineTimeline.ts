/**
 * Deadline timeline — every compliance deadline in one chronological list,
 * answering "What is due next?"
 *
 * Sources: staff certificates, training renewals, plan/ISP renewals,
 * weekly checklist cycles, medication supply, corrective actions, and the
 * provider's own recertification. All inputs are plain data; nothing here
 * invents deadlines — each item names its source and deep link.
 *
 * Icons and text describe urgency; color alone never does.
 */

export type TimelineItemKind =
  | "certificate"
  | "training"
  | "plan-renewal"
  | "checklist"
  | "medication"
  | "corrective-action"
  | "provider-recertification";

export type TimelineUrgency = "overdue" | "today" | "this-week" | "upcoming";

export const TIMELINE_KIND_META: Record<
  TimelineItemKind,
  { label: string; icon: string }
> = {
  certificate: { label: "Certificate", icon: "🎓" },
  training: { label: "Training", icon: "📚" },
  "plan-renewal": { label: "Plan renewal", icon: "📋" },
  checklist: { label: "Checklist", icon: "✅" },
  medication: { label: "Medication supply", icon: "💊" },
  "corrective-action": { label: "Corrective action", icon: "🛠" },
  "provider-recertification": { label: "Provider recertification", icon: "🏛" },
};

export const TIMELINE_URGENCY_META: Record<
  TimelineUrgency,
  { label: string; icon: string }
> = {
  overdue: { label: "Overdue", icon: "⚠" },
  today: { label: "Due today", icon: "⏰" },
  "this-week": { label: "Due this week", icon: "📅" },
  upcoming: { label: "Upcoming", icon: "→" },
};

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  urgency: TimelineUrgency;
  /** Days from `now`: negative = overdue, 0 = today. */
  daysRemaining: number;
  title: string;
  detail: string;
  personName?: string;
  siteName?: string;
  dueOn: string;
  deepLink: string;
}

export interface TimelineFacts {
  now: Date;
  certificates: Array<{
    id: string;
    userId: string;
    staffName: string;
    kind: string;
    expiresOn: string;
  }>;
  trainings: Array<{
    id: string;
    userId: string;
    staffName: string;
    title: string;
    dueOn: string;
  }>;
  planRenewals: Array<{
    id: string;
    individualName: string;
    planTitle: string;
    dueOn: string;
  }>;
  checklists: Array<{
    id: string;
    siteName: string;
    checklistTitle: string;
    dueOn: string;
    submitted: boolean;
  }>;
  medications: Array<{
    id: string;
    medName: string;
    siteName: string;
    runsOutOn: string;
  }>;
  correctiveActions: Array<{
    id: string;
    title: string;
    assignedToName?: string;
    dueOn: string | null;
    status: "open" | "in_progress" | "resolved" | "overdue";
  }>;
  providerRecertification: {
    expiresOn: string | null;
    submitted: boolean;
  } | null;
}

const MS_PER_DAY = 86400000;

function daysFrom(todayIso: string, dateIso: string): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((start(dateIso) - start(todayIso)) / MS_PER_DAY);
}

function urgencyFor(daysRemaining: number): TimelineUrgency {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining === 0) return "today";
  if (daysRemaining <= 7) return "this-week";
  return "upcoming";
}

export function buildTimeline(facts: TimelineFacts): TimelineItem[] {
  const today = facts.now.toISOString().slice(0, 10);
  const items: TimelineItem[] = [];

  for (const cert of facts.certificates) {
    const daysRemaining = daysFrom(today, cert.expiresOn);
    items.push({
      id: `certificate:${cert.id}`,
      kind: "certificate",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `${cert.staffName} — ${cert.kind} ${daysRemaining < 0 ? "expired" : "expires"}`,
      detail: `${cert.kind} certification for ${cert.staffName}`,
      personName: cert.staffName,
      dueOn: cert.expiresOn,
      deepLink: "/certificates",
    });
  }

  for (const training of facts.trainings) {
    const daysRemaining = daysFrom(today, training.dueOn);
    items.push({
      id: `training:${training.id}`,
      kind: "training",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `${training.staffName} — ${training.title} ${daysRemaining < 0 ? "overdue" : "due"}`,
      detail: `${training.title} training for ${training.staffName}`,
      personName: training.staffName,
      dueOn: training.dueOn,
      deepLink: "/training",
    });
  }

  for (const plan of facts.planRenewals) {
    const daysRemaining = daysFrom(today, plan.dueOn);
    items.push({
      id: `plan-renewal:${plan.id}`,
      kind: "plan-renewal",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `${plan.planTitle} for ${plan.individualName} renews`,
      detail: `${plan.planTitle} — ${plan.individualName}`,
      personName: plan.individualName,
      dueOn: plan.dueOn,
      deepLink: "/plans",
    });
  }

  for (const checklist of facts.checklists) {
    if (checklist.submitted) continue;
    const daysRemaining = daysFrom(today, checklist.dueOn);
    items.push({
      id: `checklist:${checklist.id}`,
      kind: "checklist",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `${checklist.checklistTitle} — ${checklist.siteName} ${daysRemaining < 0 ? "missed" : "due"}`,
      detail: `${checklist.checklistTitle} at ${checklist.siteName}`,
      siteName: checklist.siteName,
      dueOn: checklist.dueOn,
      deepLink: "/checklists",
    });
  }

  for (const med of facts.medications) {
    const daysRemaining = daysFrom(today, med.runsOutOn);
    items.push({
      id: `medication:${med.id}`,
      kind: "medication",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `${med.medName} at ${med.siteName} runs out`,
      detail: `${med.medName} — ${med.siteName}`,
      siteName: med.siteName,
      dueOn: med.runsOutOn,
      deepLink: "/meds",
    });
  }

  for (const action of facts.correctiveActions) {
    if (action.status === "resolved" || !action.dueOn) continue;
    const daysRemaining = daysFrom(today, action.dueOn);
    items.push({
      id: `corrective-action:${action.id}`,
      kind: "corrective-action",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: `Corrective action: ${action.title}`,
      detail: action.assignedToName
        ? `Assigned to ${action.assignedToName}`
        : "No owner assigned yet",
      personName: action.assignedToName,
      dueOn: action.dueOn,
      deepLink: "/audit/actions",
    });
  }

  if (facts.providerRecertification?.expiresOn) {
    const expiresOn = facts.providerRecertification.expiresOn;
    // The filing deadline is 60 days before expiry.
    const filingDeadline = new Date(Date.parse(`${expiresOn}T00:00:00`) - 60 * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    const daysRemaining = daysFrom(today, filingDeadline);
    items.push({
      id: "provider-recertification:filing",
      kind: "provider-recertification",
      urgency: urgencyFor(daysRemaining),
      daysRemaining,
      title: "Recertification application filing deadline",
      detail: facts.providerRecertification.submitted
        ? `Application filed (certificate expires ${expiresOn})`
        : `File the recertification application (certificate expires ${expiresOn})`,
      dueOn: filingDeadline,
      deepLink: "/audit",
    });
  }

  // Chronological: soonest first; ties break by kind then title for a
  // stable, predictable order.
  return items.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.title.localeCompare(b.title);
  });
}

/** The next N deadlines, however urgent — the "due next" strip. */
export function dueNext(facts: TimelineFacts, limit = 5): TimelineItem[] {
  return buildTimeline(facts).slice(0, limit);
}

export function timelineCounts(
  items: TimelineItem[],
): Record<TimelineUrgency, number> {
  const counts: Record<TimelineUrgency, number> = {
    overdue: 0,
    today: 0,
    "this-week": 0,
    upcoming: 0,
  };
  for (const item of items) counts[item.urgency] += 1;
  return counts;
}
