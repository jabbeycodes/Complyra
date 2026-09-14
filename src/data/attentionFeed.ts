/**
 * Management attention feed — what needs management attention TODAY.
 *
 * Three buckets, in this order:
 *   1. overdue — things already past due
 *   2. due-today — things due today
 *   3. escalations — patterns that need a manager's judgment (repeated
 *      misses, expiring credentials, unowned corrective actions)
 *
 * Built on top of the risk registry and the deadline timeline so the
 * feed never invents its own facts — it only re-presents items that
 * already exist as risks or deadlines.
 */

import { collectRisks, type RiskContext, type RiskItem } from "./riskRegistry";
import { buildTimeline, type TimelineFacts, type TimelineItem } from "./deadlineTimeline";

export type AttentionKind = "overdue" | "due-today" | "escalation";

export const ATTENTION_KIND_META: Record<
  AttentionKind,
  { label: string; icon: string; description: string }
> = {
  overdue: {
    label: "Overdue",
    icon: "⚠",
    description: "Already past due — act first.",
  },
  "due-today": {
    label: "Due today",
    icon: "⏰",
    description: "Due before the day ends.",
  },
  escalation: {
    label: "Escalation",
    icon: "📣",
    description: "Needs a manager's judgment.",
  },
};

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  personName?: string;
  siteName?: string;
  daysPastDue?: number;
  deepLink: string;
  /** The underlying risk or timeline item, for traceability. */
  sourceId: string;
}

export interface AttentionInput {
  riskContext: RiskContext;
  timelineFacts: TimelineFacts;
}

/** How many times a site has missed checklists — repeated misses escalate. */
function repeatedMissSites(timeline: TimelineItem[]): Set<string> {
  const missed = new Map<string, number>();
  for (const item of timeline) {
    if (item.kind === "checklist" && item.daysRemaining < 0 && item.siteName) {
      missed.set(item.siteName, (missed.get(item.siteName) ?? 0) + 1);
    }
  }
  return new Set([...missed.entries()].filter(([, count]) => count >= 2).map(([site]) => site));
}

export function buildAttentionFeed(input: AttentionInput): AttentionItem[] {
  const risks = collectRisks(input.riskContext);
  const timeline = buildTimeline(input.timelineFacts);
  const items: AttentionItem[] = [];

  // 1. Overdue — from critical risks and past-due deadlines.
  const overdueTimeline = timeline.filter((item) => item.daysRemaining < 0);
  for (const item of overdueTimeline) {
    items.push({
      id: `attention:overdue:${item.id}`,
      kind: "overdue",
      severity: item.kind === "corrective-action" || item.kind === "certificate" ? "critical" : "warning",
      title: item.title,
      detail: `${Math.abs(item.daysRemaining)} day${Math.abs(item.daysRemaining) === 1 ? "" : "s"} past due`,
      personName: item.personName,
      siteName: item.siteName,
      daysPastDue: Math.abs(item.daysRemaining),
      deepLink: item.deepLink,
      sourceId: item.id,
    });
  }
  for (const risk of risks) {
    if (risk.severity !== "critical") continue;
    if (items.some((existing) => existing.sourceId === risk.id)) continue;
    items.push({
      id: `attention:critical:${risk.id}`,
      kind: "overdue",
      severity: "critical",
      title: risk.title,
      detail: risk.detail,
      personName: risk.personName ?? undefined,
      siteName: risk.siteName ?? undefined,
      deepLink: risk.deepLink,
      sourceId: risk.id,
    });
  }

  // 2. Due today.
  for (const item of timeline) {
    if (item.daysRemaining !== 0) continue;
    items.push({
      id: `attention:today:${item.id}`,
      kind: "due-today",
      severity: item.kind === "certificate" || item.kind === "medication" ? "warning" : "info",
      title: item.title,
      detail: `Due today (${item.dueOn})`,
      personName: item.personName,
      siteName: item.siteName,
      deepLink: item.deepLink,
      sourceId: item.id,
    });
  }

  // 3. Escalations — judgment calls.
  for (const site of repeatedMissSites(timeline)) {
    items.push({
      id: `attention:escalation:misses:${site}`,
      kind: "escalation",
      severity: "warning",
      title: `${site} missed checklists twice or more`,
      detail: "A pattern is forming — a manager should check in with the house manager.",
      siteName: site,
      deepLink: "/checklists",
      sourceId: `escalation:misses:${site}`,
    });
  }

  const unownedActions = input.timelineFacts.correctiveActions.filter(
    (action) => action.status !== "resolved" && !action.assignedToName,
  );
  for (const action of unownedActions) {
    items.push({
      id: `attention:escalation:unowned:${action.id}`,
      kind: "escalation",
      severity: "warning",
      title: `Corrective action has no owner: ${action.title}`,
      detail: "Unowned actions stall — assign one before it slips.",
      deepLink: "/audit/actions",
      sourceId: `corrective-action:${action.id}`,
    });
  }

  const criticalRiskCount = risks.filter((risk) => risk.severity === "critical").length;
  if (criticalRiskCount >= 3) {
    items.push({
      id: "attention:escalation:critical-mass",
      kind: "escalation",
      severity: "critical",
      title: `${criticalRiskCount} critical risks open`,
      detail: "Three or more critical risks is a pattern, not a coincidence — review the full risk list.",
      deepLink: "/audit",
      sourceId: "escalation:critical-mass",
    });
  }

  const order: Record<AttentionKind, number> = { overdue: 0, "due-today": 1, escalation: 2 };
  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
    if (a.severity !== b.severity) return severityRank[a.severity] - severityRank[b.severity];
    return a.title.localeCompare(b.title);
  });
}

export function attentionCounts(
  items: AttentionItem[],
): Record<AttentionKind, number> {
  const counts: Record<AttentionKind, number> = {
    overdue: 0,
    "due-today": 0,
    escalation: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/** The single most urgent thing, or null when nothing needs attention. */
export function topAttention(items: AttentionItem[]): AttentionItem | null {
  return items[0] ?? null;
}
