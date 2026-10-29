/**
 * personalCompliance.ts — pure summaries behind the personal-compliance
 * surfaces (founder design, 2026-10-29: "A staff's dashboard shows their
 * compliance and what they need to complete or coming up; a manager sees
 * both the compliance of their sites and their own personal compliance").
 *
 * Everything here is presentation math over the readiness roll-up the
 * Employee Hub already computes (`rollupCompliance` in data/hr.ts, fed by
 * HrStore.listReadinessRequirements + getComplianceEvidence). No new data
 * model: this module only counts, sorts, and slices ReadinessResults.
 *
 * Status grammar matches the house compliance donuts: Current / Due soon /
 * Missing or expired, always carried as text, never color alone.
 */

import type { ReadinessResult } from "../../data/hr";

/** Roles that see the house compliance donuts on the Overview. */
export const HOUSE_DONUT_ROLES = new Set([
  "house_manager",
  "program_manager",
  "administrator",
]);

export interface PersonalComplianceSummary {
  total: number;
  /** Items fully current (status "complete"). */
  current: number;
  dueSoon: number;
  missingOrExpired: number;
  /** current / total as a whole percent; 100 when nothing is tracked. */
  percentCurrent: number;
  /** Missing/expired + due-soon count — everything waiting on the person. */
  attentionCount: number;
  /**
   * Attention items in action order: missing/expired first (earliest due
   * first; an item with no due date — nothing on file — sorts first inside
   * its group), then due-soon (earliest due first).
   */
  attention: ReadinessResult[];
}

const STATUS_RANK: Record<ReadinessResult["status"], number> = {
  missing_or_expired: 0,
  due_soon: 1,
  complete: 2,
};

export function summarizePersonalCompliance(
  items: ReadinessResult[],
): PersonalComplianceSummary {
  const current = items.filter((i) => i.status === "complete").length;
  const dueSoon = items.filter((i) => i.status === "due_soon").length;
  const missingOrExpired = items.filter(
    (i) => i.status === "missing_or_expired",
  ).length;
  const total = items.length;
  const attention = items
    .filter((i) => i.status !== "complete")
    .sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      const dueA = a.dueOn ?? "";
      const dueB = b.dueOn ?? "";
      return dueA < dueB ? -1 : dueA > dueB ? 1 : 0;
    });
  return {
    total,
    current,
    dueSoon,
    missingOrExpired,
    percentCurrent: total ? Math.round((current / total) * 100) : 100,
    attentionCount: attention.length,
    attention,
  };
}

export interface ComplianceSegment {
  key: "current" | "dueSoon" | "missingOrExpired";
  label: string;
  count: number;
  color: string;
}

/**
 * Donut segments in the house-donut palette (StatusMixDonut): the personal
 * statuses wear the same colors as their house-level counterparts.
 */
export function personalComplianceSegments(
  summary: PersonalComplianceSummary,
): ComplianceSegment[] {
  return [
    { key: "current", label: "Current", count: summary.current, color: "#4d6b42" },
    { key: "dueSoon", label: "Due soon", count: summary.dueSoon, color: "#c49c60" },
    {
      key: "missingOrExpired",
      label: "Missing or expired",
      count: summary.missingOrExpired,
      color: "#b56a4e",
    },
  ];
}

/** Text label for a readiness status — the non-color carrier of meaning. */
export function readinessStatusLabel(status: ReadinessResult["status"]): string {
  switch (status) {
    case "complete":
      return "Current";
    case "due_soon":
      return "Due soon";
    case "missing_or_expired":
      return "Missing or expired";
  }
}

/* ------------------------------ team roll-up ----------------------------- */

export interface TeamComplianceSummary {
  /** Staff assigned to the house. */
  total: number;
  /**
   * Staff with no missing/expired item. A due-soon-only staff member counts
   * as fully current; so does a staff member with no applicable
   * requirements (nothing outstanding).
   */
  fullyCurrent: number;
  /** Staff with at least one missing/expired item. */
  needAttention: number;
}

export function teamComplianceSummary(
  rollupsByStaff: ReadinessResult[][],
): TeamComplianceSummary {
  let needAttention = 0;
  for (const items of rollupsByStaff) {
    if (items.some((i) => i.status === "missing_or_expired")) needAttention += 1;
  }
  return {
    total: rollupsByStaff.length,
    fullyCurrent: rollupsByStaff.length - needAttention,
    needAttention,
  };
}

/** "Jan 5, 2027" — same rendering the Employee Hub uses for due dates. */
export function formatDueDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
