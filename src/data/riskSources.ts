/**
 * Pluggable risk / deadline sources (frontend workstream).
 *
 * Any feature can register a source that contributes RiskItems and
 * DeadlineItems; consumers (dashboards, the audit-readiness work, scheduled
 * summaries) call collectRisks / collectDeadlines with a context and get one
 * merged, sorted list. Sources are synchronous and pure: they translate
 * already-loaded domain data into risk/deadline language. Fetching stays
 * with the caller.
 *
 * This module registers the `pcsp-extraction` source: approved PCSP
 * extractions contribute plan-expiry + annual-review deadlines, missing
 * signatures, and unactivated high-confidence items as risks.
 *
 * Consumer contract is documented in docs/risk-sources.md.
 */
import type { PcspExtraction } from "../features/documents/documents";
import { LOW_CONFIDENCE_THRESHOLD } from "../features/documents/documents";

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskItem {
  id: string;
  /** Source name, e.g. "pcsp-extraction". */
  source: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  siteId?: string;
  /** ISO date when the risk must be resolved by, when known. */
  dueDate?: string;
}

export interface DeadlineItem {
  id: string;
  /** Source name, e.g. "pcsp-extraction". */
  source: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  dueDate: string;
  siteId?: string;
  individualId?: string;
}

/** What a collector may draw on. Sources ignore fields they don't need. */
export interface RiskSourceContext {
  extractions?: PcspExtraction[];
  now?: number;
}

export type RiskSourceFn = (ctx: RiskSourceContext) => RiskItem[];
export type DeadlineSourceFn = (ctx: RiskSourceContext) => DeadlineItem[];

const riskSources = new Map<string, RiskSourceFn>();
const deadlineSources = new Map<string, DeadlineSourceFn>();

/** Register (or replace) a risk source. Idempotent by name. */
export function registerRiskSource(name: string, fn: RiskSourceFn): void {
  riskSources.set(name, fn);
}

/** Register (or replace) a deadline source. Idempotent by name. */
export function registerDeadlineSource(name: string, fn: DeadlineSourceFn): void {
  deadlineSources.set(name, fn);
}

/** Registered source names — useful for diagnostics. */
export function registeredRiskSources(): string[] {
  return [...riskSources.keys()];
}

export function registeredDeadlineSources(): string[] {
  return [...deadlineSources.keys()];
}

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function bySeverityThenDate(a: RiskItem, b: RiskItem): number {
  const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rank !== 0) return rank;
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
}

/** Merge every registered risk source; sorted high → low, then by due date. */
export function collectRisks(ctx: RiskSourceContext = {}): RiskItem[] {
  const items: RiskItem[] = [];
  for (const fn of riskSources.values()) {
    try {
      items.push(...fn(ctx));
    } catch {
      /* a broken source must not take down the dashboard */
    }
  }
  return items.sort(bySeverityThenDate);
}

/** Merge every registered deadline source; sorted soonest first. */
export function collectDeadlines(ctx: RiskSourceContext = {}): DeadlineItem[] {
  const items: DeadlineItem[] = [];
  for (const fn of deadlineSources.values()) {
    try {
      items.push(...fn(ctx));
    } catch {
      /* a broken source must not take down the dashboard */
    }
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* ------------------------------------------------------------------ */
/* pcsp-extraction source                                              */
/* ------------------------------------------------------------------ */

const PCSP_SOURCE = "pcsp-extraction";

/** Only approved extractions feed risks/deadlines — nothing is actionable before approval. */
function approvedExtractions(ctx: RiskSourceContext): PcspExtraction[] {
  return (ctx.extractions ?? []).filter((ex) => ex.status === "approved");
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return undefined;
  return trimmed.slice(0, 10);
}

/**
 * Deadlines from an approved extraction: plan expiry + annual review due.
 * Pure — tested directly in documentsUi.test.ts.
 */
export function pcspExtractionDeadlines(
  extraction: PcspExtraction,
): DeadlineItem[] {
  if (extraction.status !== "approved") return [];
  const items: DeadlineItem[] = [];
  const planEnd = dateOnly(extraction.structured.planEndDate.value);
  if (planEnd) {
    items.push({
      id: `${PCSP_SOURCE}:plan-expiry:${extraction.uploadId}`,
      source: PCSP_SOURCE,
      title: `PCSP plan expires — ${extraction.individualName}`,
      dueDate: planEnd,
      individualId: extraction.individualId,
    });
  }
  const reviewDue = dateOnly(extraction.structured.annualReviewDate.value);
  if (reviewDue && reviewDue !== planEnd) {
    items.push({
      id: `${PCSP_SOURCE}:annual-review:${extraction.uploadId}`,
      source: PCSP_SOURCE,
      title: `Annual plan review due — ${extraction.individualName}`,
      dueDate: reviewDue,
      individualId: extraction.individualId,
    });
  }
  return items;
}

/**
 * Risks from an approved extraction: missing signatures (high) and
 * unactivated high-confidence items (medium). Pure — tested directly.
 */
export function pcspExtractionRisks(
  extraction: PcspExtraction,
  _now: number = Date.now(),
): RiskItem[] {
  if (extraction.status !== "approved") return [];
  const items: RiskItem[] = [];
  const planEnd =
    dateOnly(extraction.structured.planEndDate.value) ??
    dateOnly(extraction.structured.annualReviewDate.value);

  for (const sig of extraction.structured.signatures) {
    if (sig.signed) continue;
    items.push({
      id: `${PCSP_SOURCE}:missing-signature:${extraction.uploadId}:${sig.role}`,
      source: PCSP_SOURCE,
      severity: "high",
      title: `Missing signature: ${sig.role} — ${extraction.individualName}`,
      detail: `${extraction.individualName}'s plan is missing the ${sig.role} signature. Plans without required signatures are a survey finding.`,
      dueDate: planEnd,
    });
  }

  for (const item of extraction.items) {
    if (item.status !== "proposed") continue;
    const conf = item.confidence;
    const highConfidence = conf == null || conf >= LOW_CONFIDENCE_THRESHOLD;
    if (!highConfidence) continue;
    items.push({
      id: `${PCSP_SOURCE}:unactivated:${item.id}`,
      source: PCSP_SOURCE,
      severity: "medium",
      title: `Not yet activated: ${item.title}`,
      detail: `Extracted from ${extraction.individualName}'s plan and approved for tracking, but not yet activated.`,
      dueDate: item.dueDate ?? undefined,
    });
  }
  return items;
}

// Register the pcsp-extraction source at module load (idempotent by name).
registerRiskSource(PCSP_SOURCE, (ctx) =>
  approvedExtractions(ctx).flatMap((ex) => pcspExtractionRisks(ex, ctx.now)),
);
registerDeadlineSource(PCSP_SOURCE, (ctx) =>
  approvedExtractions(ctx).flatMap((ex) => pcspExtractionDeadlines(ex)),
);
