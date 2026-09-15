/**
 * Risk registry — the "What is putting us at risk?" answer for the command
 * center. Risk sources are PLUGGABLE: each source is a small object with a
 * key, a label, and a collect() function that turns a RiskContext into
 * RiskItems. Built-in sources cover certificates, checklists, training,
 * medications, requirements, and corrective actions.
 *
 * DELEGATION PLUG POINT (for the lifepath/delegation-templates branch):
 * that branch owns delegation_templates / delegation_training_materials /
 * delegation_acknowledgments. To feed "unacknowledged delegations" and
 * "training overdue" into this registry WITHOUT touching this file, call
 *   registerDelegationRiskProvider(provider)
 * with a DelegationRiskProvider that returns RiskItems built from those
 * tables. Until then, the built-in delegation source yields nothing — the
 * registry never invents risks.
 */

export type RiskSeverity = "critical" | "warning" | "info";

export const RISK_SEVERITY_META: Record<
  RiskSeverity,
  { label: string; icon: string }
> = {
  critical: { label: "Critical", icon: "✕" },
  warning: { label: "Warning", icon: "!" },
  info: { label: "Watch", icon: "▲" },
};

export interface RiskItem {
  /** Stable id: `${source}:${entityId}`. */
  id: string;
  /** Source key, e.g. "certificates". */
  source: string;
  sourceLabel: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  dueOn?: string | null;
  daysRemaining?: number | null;
  siteId?: string | null;
  siteName?: string | null;
  personName?: string | null;
  /** In-app route, e.g. "/certificates". Never a hostname. */
  deepLink: string;
  correctiveActionId?: string | null;
}

/** Facts each source may need. Sources ignore what they don't use. */
export interface RiskContext {
  now: Date;
  certificates: Array<{
    id: string;
    userId: string;
    staffName: string;
    kind: string;
    expiresOn: string;
    daysRemaining: number;
    siteName?: string | null;
  }>;
  checklists: Array<{
    id: string;
    siteId: string;
    siteName: string;
    weekOf: string;
    dueAt: string | null;
    submitted: boolean;
    late: boolean;
  }>;
  training: Array<{
    id: string;
    staffName: string;
    title: string;
    status: "incomplete" | "overdue";
    dueOn?: string | null;
    siteName?: string | null;
  }>;
  medications: Array<{
    id: string;
    medName: string;
    siteName: string;
    siteId: string;
    daysRemaining: number | null;
    status: "low" | "critical" | "out";
  }>;
  requirements: Array<{
    id: string;
    title: string;
    person: string;
    site: string;
    status: "Overdue" | "Expired";
  }>;
  correctiveActions: Array<{
    id: string;
    title: string;
    assignedToName?: string | null;
    dueOn: string | null;
    overdue: boolean;
  }>;
}

export interface RiskSource {
  key: string;
  label: string;
  collect(ctx: RiskContext): RiskItem[];
}

const registry = new Map<string, RiskSource>();

/** Register (or replace) a risk source. Later calls win on key collision. */
export function registerRiskSource(source: RiskSource): void {
  registry.set(source.key, source);
}

export function registeredRiskSources(): RiskSource[] {
  return [...registry.values()];
}

export function unregisterRiskSource(key: string): boolean {
  return registry.delete(key);
}

/* ------------------------------------------------------------------ */
/* Built-in sources                                                    */
/* ------------------------------------------------------------------ */

function daysLabel(daysRemaining: number | null | undefined): string {
  if (daysRemaining == null) return "";
  if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d overdue`;
  if (daysRemaining === 0) return "due today";
  return `${daysRemaining}d left`;
}

const certificatesSource: RiskSource = {
  key: "certificates",
  label: "Staff certifications",
  collect(ctx) {
    return ctx.certificates
      .filter((cert) => cert.daysRemaining <= 30)
      .map((cert) => ({
        id: `certificates:${cert.id}`,
        source: "certificates",
        sourceLabel: "Staff certifications",
        severity: (cert.daysRemaining < 0 ? "critical" : "warning") as RiskSeverity,
        title: `${cert.staffName} — ${cert.kind} ${cert.daysRemaining < 0 ? "expired" : "expiring"}`,
        detail:
          cert.daysRemaining < 0
            ? `Expired ${daysLabel(cert.daysRemaining)} ago. Upload a renewed certificate to restore clearance.`
            : `Expires in ${cert.daysRemaining}d (${cert.expiresOn}). Renew now to avoid a compliance gap.`,
        dueOn: cert.expiresOn,
        daysRemaining: cert.daysRemaining,
        personName: cert.staffName,
        siteName: cert.siteName ?? undefined,
        deepLink: "/certificates",
      }));
  },
};

const checklistsSource: RiskSource = {
  key: "checklists",
  label: "Weekly checklists",
  collect(ctx) {
    return ctx.checklists
      .filter((row) => !row.submitted && (row.late || row.dueAt == null))
      .map((row) => ({
        id: `checklists:${row.id}`,
        source: "checklists",
        sourceLabel: "Weekly checklists",
        severity: "critical" as RiskSeverity,
        title: `Weekly checklist ${row.late ? "late" : "open"} — ${row.siteName}`,
        detail: `Week of ${row.weekOf}${row.dueAt ? ` was due ${row.dueAt.slice(0, 10)}` : " has no due date set"}. Submit it to close the gap.`,
        dueOn: row.dueAt,
        siteId: row.siteId,
        siteName: row.siteName,
        deepLink: "/checklists",
      }));
  },
};

const trainingSource: RiskSource = {
  key: "training",
  label: "Training",
  collect(ctx) {
    return ctx.training.map((row) => ({
      id: `training:${row.id}`,
      source: "training",
      sourceLabel: "Training",
      severity: (row.status === "overdue" ? "critical" : "warning") as RiskSeverity,
      title: `${row.title} — ${row.status === "overdue" ? "overdue" : "incomplete"} (${row.staffName})`,
      detail:
        row.status === "overdue"
          ? "Past its due date. Complete it now to stay compliant."
          : `Due${row.dueOn ? ` ${row.dueOn}` : " soon"}. Complete it before the deadline.`,
      dueOn: row.dueOn ?? null,
      personName: row.staffName,
      siteName: row.siteName ?? undefined,
      deepLink: "/training",
    }));
  },
};

const medicationsSource: RiskSource = {
  key: "medications",
  label: "Medication supply",
  collect(ctx) {
    return ctx.medications.map((row) => ({
      id: `medications:${row.id}`,
      source: "medications",
      sourceLabel: "Medication supply",
      severity: (row.status === "out" ? "critical" : "warning") as RiskSeverity,
      title: `${row.medName} — ${row.status === "out" ? "out of stock" : "low stock"} (${row.siteName})`,
      detail:
        row.daysRemaining == null
          ? "No supply projection available. Count the stock to get a forecast."
          : `About ${row.daysRemaining}d of supply left. Reorder now.`,
      daysRemaining: row.daysRemaining,
      siteId: row.siteId,
      siteName: row.siteName,
      deepLink: "/meds",
    }));
  },
};

const requirementsSource: RiskSource = {
  key: "requirements",
  label: "Requirements",
  collect(ctx) {
    return ctx.requirements.map((row) => ({
      id: `requirements:${row.id}`,
      source: "requirements",
      sourceLabel: "Requirements",
      severity: "critical" as RiskSeverity,
      title: `${row.title} — ${row.status.toLowerCase()}`,
      detail: `${row.person} · ${row.site}. Record the completion or update the due date.`,
      personName: row.person === "Site-wide" ? undefined : row.person,
      siteName: row.site,
      deepLink: "/requirements",
    }));
  },
};

const correctiveActionsSource: RiskSource = {
  key: "corrective-actions",
  label: "Corrective actions",
  collect(ctx) {
    return ctx.correctiveActions
      .filter((row) => row.overdue)
      .map((row) => ({
        id: `corrective-actions:${row.id}`,
        source: "corrective-actions",
        sourceLabel: "Corrective actions",
        severity: "critical" as RiskSeverity,
        title: `Corrective action overdue — ${row.title}`,
        detail: row.assignedToName
          ? `Assigned to ${row.assignedToName}${row.dueOn ? `, due ${row.dueOn}` : ""}. Follow up today.`
          : `No owner assigned${row.dueOn ? `, due ${row.dueOn}` : ""}. Assign an owner today.`,
        dueOn: row.dueOn,
        personName: row.assignedToName ?? undefined,
        correctiveActionId: row.id,
        deepLink: "/corrective-actions",
      }));
  },
};

/* ------------------------------------------------------------------ */
/* Delegation plug point                                               */
/* ------------------------------------------------------------------ */

/**
 * Implemented by the delegation-templates workstream when its tables
 * exist. Returns risk items for unacknowledged delegations and overdue
 * delegation training — or an empty array when there is nothing to report.
 */
export interface DelegationRiskProvider {
  collect(ctx: RiskContext): RiskItem[];
}

let delegationProvider: DelegationRiskProvider | null = null;

/** The delegation workstream calls this to plug its stats into the registry. */
export function registerDelegationRiskProvider(
  provider: DelegationRiskProvider,
): void {
  delegationProvider = provider;
}

export function clearDelegationRiskProvider(): void {
  delegationProvider = null;
}

const delegationsSource: RiskSource = {
  key: "delegations",
  label: "Delegations",
  collect(ctx) {
    if (!delegationProvider) return [];
    return delegationProvider.collect(ctx);
  },
};

registerRiskSource(certificatesSource);
registerRiskSource(checklistsSource);
registerRiskSource(trainingSource);
registerRiskSource(medicationsSource);
registerRiskSource(requirementsSource);
registerRiskSource(correctiveActionsSource);
registerRiskSource(delegationsSource);

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** All risks across sources, worst severity first, then soonest due. */
export function collectRisks(ctx: RiskContext): RiskItem[] {
  const items = registeredRiskSources().flatMap((source) => {
    try {
      return source.collect(ctx);
    } catch {
      // One broken source must never take down the whole risk list.
      return [];
    }
  });
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severity !== 0) return severity;
      const aDue = a.dueOn ? Date.parse(a.dueOn) : Number.POSITIVE_INFINITY;
      const bDue = b.dueOn ? Date.parse(b.dueOn) : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });
}

export function riskCounts(items: RiskItem[]): Record<RiskSeverity, number> {
  const counts: Record<RiskSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}
