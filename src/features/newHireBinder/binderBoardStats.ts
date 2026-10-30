/**
 * binderBoardStats — presentation math for the Binder Board's visual
 * dashboard (compliance-first restyle, 2026-10-30: "Need to see the
 * donuts and graphs n charts").
 *
 * Everything here aggregates the SAME DerivedBinder objects build 1's
 * deriveBinder produces — pooled, never re-derived — so a number on the
 * board can never disagree with the binder itself. Pooling follows the
 * platform's aggregation convention (domain.metrics, the house-donut
 * score): items are pooled across the set and the percent is
 * satisfied ÷ total over the pool — NOT the mean of per-person
 * percents.
 *
 * Only REQUIRED items are counted anywhere below: optional items are
 * tracked-but-never-counted (build 2) and "records" items are
 * informational, so neither belongs in a completeness visual.
 */
import type {
  DerivedBinder,
  DerivedBinderItem,
} from "../../data/newHireBinder";

/* ------------------------------ donut ------------------------------ */

export interface BinderStatusCounts {
  /** Required items satisfied. */
  satisfied: number;
  /**
   * Required items uploaded and waiting on HR verification (wallet
   * documents "on file" — not satisfied until HR verifies them).
   */
  awaitingVerification: number;
  /** Required items neither satisfied nor awaiting verification. */
  outstanding: number;
  /** All required items (satisfied + awaiting + outstanding). */
  total: number;
}

/** Partition one binder's required items by where they stand. */
export function binderStatusCounts(derived: DerivedBinder): BinderStatusCounts {
  const counts: BinderStatusCounts = {
    satisfied: 0,
    awaitingVerification: 0,
    outstanding: 0,
    total: 0,
  };
  for (const section of derived.sections) {
    for (const row of section.items) {
      if (!row.required) continue;
      counts.total += 1;
      if (row.satisfied) counts.satisfied += 1;
      else if (row.status === "on_file") counts.awaitingVerification += 1;
      else counts.outstanding += 1;
    }
  }
  return counts;
}

/** Pool per-binder counts into one set (the agency donut's basis). */
export function poolBinderStatusCounts(
  list: BinderStatusCounts[],
): BinderStatusCounts {
  return list.reduce<BinderStatusCounts>(
    (acc, c) => ({
      satisfied: acc.satisfied + c.satisfied,
      awaitingVerification: acc.awaitingVerification + c.awaitingVerification,
      outstanding: acc.outstanding + c.outstanding,
      total: acc.total + c.total,
    }),
    { satisfied: 0, awaitingVerification: 0, outstanding: 0, total: 0 },
  );
}

/** satisfied ÷ total as a whole percent; 100 when nothing is tracked —
 *  the same convention deriveBinder and domain.metrics use. */
export function binderPercent(counts: BinderStatusCounts): number {
  return counts.total
    ? Math.round((counts.satisfied / counts.total) * 100)
    : 100;
}

export interface BinderDonutSegmentData {
  key: "satisfied" | "awaiting" | "outstanding";
  label: string;
  count: number;
  color: string;
}

/**
 * Donut segments in the house-donut palette (components/StatusMixDonut):
 * satisfied wears the compliant green, awaiting verification the
 * pending-review sage, outstanding the overdue clay. Every segment is
 * also spelled out in the legend as text — color never carries the
 * meaning alone.
 */
export function binderDonutSegments(
  counts: BinderStatusCounts,
): BinderDonutSegmentData[] {
  return [
    {
      key: "satisfied",
      label: "Satisfied",
      count: counts.satisfied,
      color: "#4d6b42",
    },
    {
      key: "awaiting",
      label: "Awaiting verification",
      count: counts.awaitingVerification,
      color: "#6f815c",
    },
    {
      key: "outstanding",
      label: "Outstanding",
      count: counts.outstanding,
      color: "#b56a4e",
    },
  ];
}

/* --------------------------- board summary -------------------------- */

export interface BinderBoardSummary {
  /** Pooled required-item counts across every in-scope binder. */
  counts: BinderStatusCounts;
  /** Pooled percent satisfied — the agency donut's center number. */
  percent: number;
  staffCount: number;
  /** Staff whose binder is 100% complete (deriveBinder's own percent). */
  fullyComplete: number;
  /**
   * Wallet documents on file awaiting HR verification — build 1's
   * canonical count (derived.awaitingVerification summed), the same
   * number the board has always shown.
   */
  awaitingVerification: number;
  /** Required items with an expired status (certificates, in practice). */
  expiredItems: number;
  /** Required items with a missing status. */
  missingItems: number;
}

export function summarizeBinderBoard(
  deriveds: DerivedBinder[],
): BinderBoardSummary {
  const counts = poolBinderStatusCounts(deriveds.map(binderStatusCounts));
  let awaitingVerification = 0;
  let expiredItems = 0;
  let missingItems = 0;
  for (const derived of deriveds) {
    awaitingVerification += derived.awaitingVerification;
    for (const section of derived.sections) {
      for (const row of section.items) {
        if (!row.required || row.satisfied) continue;
        if (row.status === "expired") expiredItems += 1;
        else if (row.status === "missing") missingItems += 1;
      }
    }
  }
  return {
    counts,
    percent: binderPercent(counts),
    staffCount: deriveds.length,
    fullyComplete: deriveds.filter((d) => d.percentComplete === 100).length,
    awaitingVerification,
    expiredItems,
    missingItems,
  };
}

/* --------------------------- section chart -------------------------- */

export interface BinderSectionCompletion {
  key: string;
  title: string;
  satisfied: number;
  /** Required items in this section across the pooled binders. */
  total: number;
  percent: number;
}

/**
 * Completion per template section, pooled across binders by section
 * key (role presets snapshot different templates, so a section pools
 * over the binders that carry it). Weakest first so gaps surface;
 * sections with no required items sit last.
 */
export function binderSectionCompletion(
  deriveds: DerivedBinder[],
): BinderSectionCompletion[] {
  const byKey = new Map<string, BinderSectionCompletion>();
  for (const derived of deriveds) {
    for (const section of derived.sections) {
      const existing = byKey.get(section.section.key);
      if (existing) {
        existing.satisfied += section.satisfied;
        existing.total += section.total;
      } else {
        byKey.set(section.section.key, {
          key: section.section.key,
          title: section.section.title,
          satisfied: section.satisfied,
          total: section.total,
          percent: 100,
        });
      }
    }
  }
  const rows = [...byKey.values()];
  for (const row of rows) {
    row.percent = row.total
      ? Math.round((row.satisfied / row.total) * 100)
      : 100;
  }
  return rows.sort((a, b) => {
    const aEmpty = a.total === 0 ? 1 : 0;
    const bEmpty = b.total === 0 ? 1 : 0;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    return (
      a.percent - b.percent ||
      b.total - a.total ||
      a.title.localeCompare(b.title)
    );
  });
}

/* --------------------------- gap breakdown -------------------------- */

export interface BinderGapSlice {
  key:
    | "expired"
    | "missingDocuments"
    | "returnedDocuments"
    | "training"
    | "awaiting"
    | "otherMissing";
  label: string;
  count: number;
  /** Share of all counted gaps, as a whole percent. */
  percent: number;
}

export interface BinderGapBreakdown {
  slices: BinderGapSlice[];
  /** Sum of the slice counts — the percent denominator. */
  totalGaps: number;
}

const GAP_SLICE_LABELS: Record<BinderGapSlice["key"], string> = {
  expired: "Expired certificates",
  missingDocuments: "Missing documents",
  returnedDocuments: "Returned documents",
  training: "Training not started or in progress",
  awaiting: "Awaiting HR verification",
  otherMissing: "Other missing items",
};

function gapSliceKey(row: DerivedBinderItem): BinderGapSlice["key"] | null {
  if (row.satisfied) return null;
  if (row.status === "expired") return "expired";
  if (row.status === "returned") return "returnedDocuments";
  if (row.status === "on_file") return "awaiting";
  if (
    row.item.kind === "training" &&
    (row.status === "missing" || row.status === "in_progress")
  )
    return "training";
  if (row.status === "missing" && row.item.kind === "document")
    return "missingDocuments";
  if (row.status === "missing" || row.status === "in_progress")
    return "otherMissing";
  return null;
}

/**
 * Where the incompleteness lives, by kind/status — every required item
 * that is not satisfied lands in exactly one slice, so the slices
 * partition the outstanding work and their percents sum to ~100.
 * Non-zero slices only, largest first.
 */
export function binderGapBreakdown(
  deriveds: DerivedBinder[],
): BinderGapBreakdown {
  const counts = new Map<BinderGapSlice["key"], number>();
  for (const derived of deriveds) {
    for (const section of derived.sections) {
      for (const row of section.items) {
        if (!row.required) continue;
        const key = gapSliceKey(row);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const totalGaps = [...counts.values()].reduce((n, c) => n + c, 0);
  const slices = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: GAP_SLICE_LABELS[key],
      count,
      percent: totalGaps ? Math.round((count / totalGaps) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { slices, totalGaps };
}
