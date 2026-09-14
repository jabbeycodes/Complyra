/**
 * Compliance scoring — the "Are we compliant?" answer for the command
 * center. Pure functions: feed them domain facts, get a 0–100 score with a
 * per-category breakdown and per-site scores. Nothing here touches the
 * network or the database; persistence lives in the
 * compliance_score_snapshots table (see buildScoreSnapshotRow + the
 * 20260914070000_audit_readiness.sql migration).
 *
 * Weights (sum to 1):
 *   requirements  0.30  — share of requirements not overdue/expired
 *   certificates  0.25  — staff certs current (partial credit when expiring)
 *   checklists    0.15  — HM weekly checklists submitted on time
 *   training      0.15  — training requirements complete
 *   medications   0.15  — med supply above reorder threshold
 */

export type ScoreBand = "compliant" | "at-risk" | "non-compliant";

export const SCORE_BAND_META: Record<
  ScoreBand,
  { label: string; icon: string; description: string }
> = {
  compliant: {
    label: "Compliant",
    icon: "✓",
    description: "Score 90 or above — no systemic risk.",
  },
  "at-risk": {
    label: "At risk",
    icon: "!",
    description: "Score 70–89 — gaps need a plan.",
  },
  "non-compliant": {
    label: "Non-compliant",
    icon: "✕",
    description: "Score below 70 — act now.",
  },
};

/** 90+ compliant, 70–89 at risk, below 70 non-compliant. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "compliant";
  if (score >= 70) return "at-risk";
  return "non-compliant";
}

export type CertFact = "ok" | "expiring" | "expired" | "missing";
export type ChecklistFact = "submitted" | "due" | "late" | "missed";
export type TrainingFact = "complete" | "incomplete" | "overdue";
export type MedFact = "ok" | "low" | "critical" | "out";
export type RequirementFact = "ok" | "due" | "overdue";

export interface ScoreFacts {
  siteId: string | null;
  siteName?: string | null;
  requirements: RequirementFact[];
  certificates: CertFact[];
  checklists: ChecklistFact[];
  training: TrainingFact[];
  medications: MedFact[];
}

export interface CategoryBreakdown {
  score: number;
  weight: number;
  good: number;
  partial: number;
  bad: number;
  total: number;
}

export interface ComplianceScore {
  /** 0–100, rounded. */
  score: number;
  band: ScoreBand;
  breakdown: Record<string, CategoryBreakdown>;
  /** Facts that contributed (for "why" explanations). */
  factCount: number;
}

/**
 * Category credit: good = 1, partial (expiring/due/low/incomplete) = 0.5,
 * bad = 0. Empty categories are EXCLUDED from the average (no data must
 * never drag a score down, and never inflate it either) — weights of the
 * remaining categories are renormalized.
 */
function categoryScore(
  facts: Array<"good" | "partial" | "bad">,
  weight: number,
): CategoryBreakdown {
  let good = 0;
  let partial = 0;
  let bad = 0;
  for (const fact of facts) {
    if (fact === "good") good += 1;
    else if (fact === "partial") partial += 1;
    else bad += 1;
  }
  const total = facts.length;
  const score =
    total === 0 ? 0 : Math.round((100 * (good + 0.5 * partial)) / total);
  return { score, weight, good, partial, bad, total };
}

const CATEGORY_WEIGHTS = {
  requirements: 0.3,
  certificates: 0.25,
  checklists: 0.15,
  training: 0.15,
  medications: 0.15,
} as const;

export function computeComplianceScore(facts: ScoreFacts): ComplianceScore {
  const breakdown: Record<string, CategoryBreakdown> = {
    requirements: categoryScore(
      facts.requirements.map((fact) =>
        fact === "ok" ? "good" : fact === "due" ? "partial" : "bad",
      ),
      CATEGORY_WEIGHTS.requirements,
    ),
    certificates: categoryScore(
      facts.certificates.map((fact) =>
        fact === "ok" ? "good" : fact === "expiring" ? "partial" : "bad",
      ),
      CATEGORY_WEIGHTS.certificates,
    ),
    checklists: categoryScore(
      facts.checklists.map((fact) =>
        fact === "submitted" ? "good" : fact === "due" ? "partial" : "bad",
      ),
      CATEGORY_WEIGHTS.checklists,
    ),
    training: categoryScore(
      facts.training.map((fact) =>
        fact === "complete" ? "good" : fact === "incomplete" ? "partial" : "bad",
      ),
      CATEGORY_WEIGHTS.training,
    ),
    medications: categoryScore(
      facts.medications.map((fact) =>
        fact === "ok" ? "good" : fact === "low" ? "partial" : "bad",
      ),
      CATEGORY_WEIGHTS.medications,
    ),
  };
  const active = Object.values(breakdown).filter((row) => row.total > 0);
  const weightSum = active.reduce((sum, row) => sum + row.weight, 0);
  const score =
    weightSum === 0
      ? 0
      : Math.round(
          active.reduce((sum, row) => sum + row.score * row.weight, 0) /
            weightSum,
        );
  const factCount = active.reduce((sum, row) => sum + row.total, 0);
  return { score, band: scoreBand(score), breakdown, factCount };
}

export interface SiteComplianceScore extends ComplianceScore {
  siteId: string;
  siteName: string;
}

/** Per-site scores from per-site fact bundles, sorted worst-first. */
export function computeSiteScores(facts: ScoreFacts[]): SiteComplianceScore[] {
  return facts
    .map((row) => ({
      ...computeComplianceScore(row),
      siteId: row.siteId ?? "unassigned",
      siteName: row.siteName ?? "Unassigned",
    }))
    .sort((a, b) => a.score - b.score || a.siteName.localeCompare(b.siteName));
}

/** Merge per-site fact bundles into one agency bundle. */
export function mergeFacts(facts: ScoreFacts[]): ScoreFacts {
  const merged: ScoreFacts = {
    siteId: null,
    requirements: [],
    certificates: [],
    checklists: [],
    training: [],
    medications: [],
  };
  for (const row of facts) {
    merged.requirements.push(...row.requirements);
    merged.certificates.push(...row.certificates);
    merged.checklists.push(...row.checklists);
    merged.training.push(...row.training);
    merged.medications.push(...row.medications);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Score snapshots (compliance_score_snapshots table)                  */
/* ------------------------------------------------------------------ */

export interface ScoreSnapshot {
  id?: string;
  agencyId: string;
  /** Null = agency-wide snapshot; set = one site. */
  siteId: string | null;
  score: number;
  band: ScoreBand;
  breakdown: Record<string, CategoryBreakdown>;
  factCount: number;
  computedAt: string;
}

/** Row shape for the compliance_score_snapshots insert. */
export function buildScoreSnapshotRow(input: {
  agencyId: string;
  siteId?: string | null;
  result: ComplianceScore;
  computedAt?: string;
}): Record<string, unknown> {
  return {
    agency_id: input.agencyId,
    site_id: input.siteId ?? null,
    score: input.result.score,
    band: input.result.band,
    breakdown: input.result.breakdown,
    fact_count: input.result.factCount,
    computed_at: input.computedAt ?? new Date().toISOString(),
  };
}

/** Oldest-first ordering for the trend chart. */
export function sortSnapshotsOldestFirst<T extends { computedAt: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      new Date(a.computedAt).getTime() - new Date(b.computedAt).getTime(),
  );
}

/** Simple trend direction between the first and last snapshot. */
export function snapshotTrend(
  rows: Array<{ score: number }>,
): "up" | "down" | "flat" {
  if (rows.length < 2) return "flat";
  const delta = rows[rows.length - 1].score - rows[0].score;
  if (delta >= 3) return "up";
  if (delta <= -3) return "down";
  return "flat";
}
