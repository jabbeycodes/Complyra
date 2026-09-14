/**
 * Recognition scoring — winners-only weekly selection for Complyrer.
 *
 * All functions here are PURE: they take plain numbers and return scores, so
 * they are unit-testable without a database. The documented weights live in
 * docs/recognition-scoring.md; the constants below are the machine-readable
 * copy. Keep the two in sync.
 *
 * Winners only: the public surface is the winner plus positive reasons. Raw
 * scores, full candidate lists, and per-candidate breakdowns never leave the
 * scoring layer except to the managers/admins-only score snapshots table.
 */

/** Plain-language labels for the 1–5 rating scale (Complyrer-original). */
export const RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Needs support",
  2: "Developing",
  3: "Solid",
  4: "Strong",
  5: "Exceptional",
};

export const MIN_RATING = 1;
export const MAX_RATING = 5;

export function ratingLabel(rating: number): string {
  const r = Math.round(rating);
  if (r >= 1 && r <= 5) return RATING_LABELS[r as 1 | 2 | 3 | 4 | 5];
  return "Unrated";
}

export function isValidRating(rating: unknown): rating is 1 | 2 | 3 | 4 | 5 {
  return (
    typeof rating === "number" &&
    Number.isInteger(rating) &&
    rating >= MIN_RATING &&
    rating <= MAX_RATING
  );
}

/** Weights for House Manager of the Week (sum = 100). */
export const HM_WEIGHTS = {
  /** Weekly checklists completed on time at the HM's program sites. */
  weeklyChecklistsOnTime: 35,
  /** Monthly checks (equipment, drills, safety) completed on time. */
  monthlyChecksOnTime: 20,
  /** Site compliance standing: staff training + certificates current. */
  siteComplianceStanding: 25,
  /** Rolling DSP satisfaction average (1–5 mapped to points). */
  dspSatisfaction: 20,
} as const;

/** Weights for DSP of the Week (sum = 100). */
export const DSP_WEIGHTS = {
  /** Training completions and current credentials. */
  trainingAndCredentials: 30,
  /** Documentation timeliness (Complyrer records; see extension note). */
  documentationTimeliness: 25,
  /** Reliability / consistency (checklist + service-log consistency). */
  reliability: 20,
  /** HM's current review of the DSP (1–5 mapped to points). */
  hmReview: 25,
} as const;

export type HmBreakdown = {
  weeklyChecklistsOnTime: number;
  monthlyChecksOnTime: number;
  siteComplianceStanding: number;
  dspSatisfaction: number;
};

export type DspBreakdown = {
  trainingAndCredentials: number;
  documentationTimeliness: number;
  reliability: number;
  hmReview: number;
};

/** Inputs for one HM candidate's weekly score. */
export interface HmScoreInput {
  /** Weekly checklists for the HM's sites this week: on-time completions. */
  weeklyChecklistsDue: number;
  weeklyChecklistsOnTime: number;
  /** Monthly checks due this month at the HM's sites: on-time completions. */
  monthlyChecksDue: number;
  monthlyChecksOnTime: number;
  /** 0–1: share of site staff with current training + certificates. */
  siteComplianceShare: number;
  /** Rolling average of DSP ratings about this HM (1–5), null when none. */
  dspSatisfactionAverage: number | null;
}

export interface HmScoreResult {
  score: number; // 0–100, rounded to 2 decimals
  breakdown: HmBreakdown;
}

/** Inputs for one DSP candidate's weekly score. */
export interface DspScoreInput {
  /** 0–1: share of required training topics complete. */
  trainingShare: number;
  /** 0–1: share of required credentials currently valid. */
  credentialsShare: number;
  /** 0–1: share of documentation records completed on time. */
  documentationTimelinessShare: number;
  /** 0–1: consistency of checklist/service-log completion. */
  reliabilityShare: number;
  /** HM's current review of this DSP (1–5), null when none. */
  hmReviewAverage: number | null;
}

export interface DspScoreResult {
  score: number; // 0–100, rounded to 2 decimals
  breakdown: DspBreakdown;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * On-time completion rate as points. A candidate with nothing due this period
 * scores NEUTRAL (half the weight) rather than zero — absence of assigned
 * work is not a demerit.
 */
export function onTimePoints(due: number, onTime: number, weight: number): number {
  if (due <= 0) return weight / 2;
  return clamp01(onTime / due) * weight;
}

/**
 * A 1–5 rating average mapped to points. A null average (no ratings yet)
 * scores neutral (half the weight) so new pairs are not punished.
 */
export function ratingPoints(average: number | null, weight: number): number {
  if (average === null || !Number.isFinite(average)) return weight / 2;
  const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, average));
  return ((clamped - MIN_RATING) / (MAX_RATING - MIN_RATING)) * weight;
}

/** A 0–1 share mapped to points. */
export function sharePoints(share: number, weight: number): number {
  return clamp01(share) * weight;
}

/** Arithmetic mean of a list of 1–5 ratings; null when empty. */
export function rollingAverage(ratings: number[]): number | null {
  const valid = ratings.filter((r) => isValidRating(r));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreHmWeek(input: HmScoreInput): HmScoreResult {
  const breakdown: HmBreakdown = {
    weeklyChecklistsOnTime: round2(
      onTimePoints(
        input.weeklyChecklistsDue,
        input.weeklyChecklistsOnTime,
        HM_WEIGHTS.weeklyChecklistsOnTime,
      ),
    ),
    monthlyChecksOnTime: round2(
      onTimePoints(
        input.monthlyChecksDue,
        input.monthlyChecksOnTime,
        HM_WEIGHTS.monthlyChecksOnTime,
      ),
    ),
    siteComplianceStanding: round2(
      sharePoints(input.siteComplianceShare, HM_WEIGHTS.siteComplianceStanding),
    ),
    dspSatisfaction: round2(
      ratingPoints(input.dspSatisfactionAverage, HM_WEIGHTS.dspSatisfaction),
    ),
  };
  const score = round2(
    breakdown.weeklyChecklistsOnTime +
      breakdown.monthlyChecksOnTime +
      breakdown.siteComplianceStanding +
      breakdown.dspSatisfaction,
  );
  return { score, breakdown };
}

export function scoreDspWeek(input: DspScoreInput): DspScoreResult {
  const trainingAndCredentials = round2(
    sharePoints(input.trainingShare, DSP_WEIGHTS.trainingAndCredentials / 2) +
      sharePoints(input.credentialsShare, DSP_WEIGHTS.trainingAndCredentials / 2),
  );
  const breakdown: DspBreakdown = {
    trainingAndCredentials,
    documentationTimeliness: round2(
      sharePoints(
        input.documentationTimelinessShare,
        DSP_WEIGHTS.documentationTimeliness,
      ),
    ),
    reliability: round2(
      sharePoints(input.reliabilityShare, DSP_WEIGHTS.reliability),
    ),
    hmReview: round2(
      ratingPoints(input.hmReviewAverage, DSP_WEIGHTS.hmReview),
    ),
  };
  const score = round2(
    breakdown.trainingAndCredentials +
      breakdown.documentationTimeliness +
      breakdown.reliability +
      breakdown.hmReview,
  );
  return { score, breakdown };
}

export type WinnerCategory = "hm_of_the_week" | "dsp_of_the_week";

export interface WinnerCandidate {
  id: string;
  fullName: string;
  score: number;
  breakdown: HmBreakdown | DspBreakdown;
}

/**
 * Pick the single winner from scored candidates. Deterministic: highest
 * score wins; exact ties break by candidate id (stable, explainable).
 * Returns null when there are no candidates.
 */
export function pickWinner(
  candidates: WinnerCandidate[],
): WinnerCandidate | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.score > best.score || (c.score === best.score && c.id < best.id)) {
      best = c;
    }
  }
  return best;
}

/**
 * Positive, Complyrer-original highlights for the celebration card. Only
 * strengths above a floor are mentioned; nothing negative ever appears.
 */
export function buildHighlights(
  category: WinnerCategory,
  breakdown: HmBreakdown | DspBreakdown,
): string[] {
  const highlights: string[] = [];
  const b = breakdown as Record<string, number>;
  const entries: Array<[keyof typeof b, string, number]> =
    category === "hm_of_the_week"
      ? [
          ["weeklyChecklistsOnTime", "Weekly checklists completed on time", HM_WEIGHTS.weeklyChecklistsOnTime],
          ["monthlyChecksOnTime", "Monthly checks completed on time", HM_WEIGHTS.monthlyChecksOnTime],
          ["siteComplianceStanding", "Strong site compliance standing", HM_WEIGHTS.siteComplianceStanding],
          ["dspSatisfaction", "High team satisfaction", HM_WEIGHTS.dspSatisfaction],
        ]
      : [
          ["trainingAndCredentials", "Training and credentials current", DSP_WEIGHTS.trainingAndCredentials],
          ["documentationTimeliness", "Documentation completed on time", DSP_WEIGHTS.documentationTimeliness],
          ["reliability", "Consistent and reliable", DSP_WEIGHTS.reliability],
          ["hmReview", "High marks from their house manager", DSP_WEIGHTS.hmReview],
        ];
  for (const [key, label, weight] of entries) {
    const points = b[key as string] ?? 0;
    if (weight > 0 && points / weight >= 0.8) highlights.push(label);
  }
  return highlights;
}

/**
 * Strip a winner row down to its public celebration shape. This is the ONLY
 * shape the public surface may use — no scores of other candidates, no
 * rankings, no breakdowns of non-winners.
 */
export function toPublicWinner(row: {
  id: string;
  weekStart: string;
  category: WinnerCategory;
  winnerId: string;
  winnerName: string;
  score: number;
  breakdown: HmBreakdown | DspBreakdown;
  decidedAt: string;
}): {
  id: string;
  weekStart: string;
  category: WinnerCategory;
  winnerName: string;
  highlights: string[];
  decidedAt: string;
} {
  return {
    id: row.id,
    weekStart: row.weekStart,
    category: row.category,
    winnerName: row.winnerName,
    highlights: buildHighlights(row.category, row.breakdown),
    decidedAt: row.decidedAt,
  };
}

/**
 * Monday (ISO week start) for the given date, as YYYY-MM-DD.
 * Mirrors public.recognition_week_start(date) in the migration.
 */
export function mondayOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}

/** Add (or subtract) whole days to a YYYY-MM-DD ISO date. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Checklist deadline for a recognition week: the Monday after the week at
 * 16:00 local. Agencies run on US Central time, so this is approximated as
 * Monday 22:00 UTC (16:00 CST; an hour generous in daylight time — generous
 * beats punitive for recognition).
 */
export function checklistDeadlineUtc(weekStart: string): string {
  return `${addDaysIso(weekStart, 7)}T22:00:00Z`;
}

/**
 * Default week to score: the most recent Monday-start week whose checklist
 * deadline has passed. The Sunday 06:05 UTC scheduler run therefore scores
 * the week that ended seven days earlier (its Monday-4pm deadline has
 * passed); a manual run later in the week picks up a newer week once its
 * deadline passes. `now` is injectable for tests.
 */
export function defaultRecognitionWeekStart(now: Date = new Date()): string {
  const t = now.getTime();
  let monday = mondayOfWeek(now);
  while (new Date(checklistDeadlineUtc(monday)).getTime() > t) {
    monday = addDaysIso(monday, -7);
  }
  return monday;
}
