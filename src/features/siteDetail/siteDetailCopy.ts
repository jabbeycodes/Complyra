import { DRILL_LABELS, type DrillType } from "../../data/monthlyChecks";
import { reviewStatusLabel } from "../../data/status";

/** Human drill name for site-detail lists. Never print raw slugs like severe_weather. */
export function formatDrillTypeLabel(type: string): string {
  if (type in DRILL_LABELS) return DRILL_LABELS[type as DrillType];
  return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function trainingProgressLine(
  profile: { counts: { complete: number; required: number } } | null,
  failed: boolean,
): string {
  if (failed) return "Training record unavailable.";
  if (!profile) return "No training checklist started.";
  if (profile.counts.required === 0) return "No required training items yet.";
  return `${profile.counts.complete} of ${profile.counts.required} training items complete`;
}

export function formatDrillDateStatus(date: string | null | undefined): string {
  const trimmed = date?.trim() ?? "";
  return trimmed ? trimmed : "Not logged";
}

const OPEN_STATUS_RANK: Record<string, number> = {
  Overdue: 0,
  Expired: 1,
  "Due soon": 2,
  "Pending review": 3,
  Upcoming: 4,
};

export function sortOpenRequirements<T extends { status: string; due?: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const rank = (OPEN_STATUS_RANK[a.status] ?? 8) - (OPEN_STATUS_RANK[b.status] ?? 8);
    if (rank !== 0) return rank;
    return (a.due ?? "").localeCompare(b.due ?? "");
  });
}

export function documentStatusLabel(status: string): string {
  if (status === "pending_review" || status === "active" || status === "archived") {
    return reviewStatusLabel(status);
  }
  return status.replace(/_/g, " ");
}

/**
 * Founder-locked (issue #78): the program site Overview "Site facts" keeps
 * only actionable facts. Water (and any similar non-actionable utility
 * entry) must not render. Terms listed here are matched exactly against
 * the fact label.
 */
export const HIDDEN_SITE_FACT_TERMS: ReadonlySet<string> = new Set(["Water"]);

export function siteFactVisible(term: string): boolean {
  return !HIDDEN_SITE_FACT_TERMS.has((term ?? "").trim());
}

export interface SiteFactRow {
  term: string;
  detail: string;
}

export interface SiteFactInput {
  program: string;
  manager: string;
  location: string;
  staffing: string;
  water: string;
  contact: string | null;
}

/**
 * Build the "Site facts" rows in display order, dropping non-actionable
 * utility facts (currently: Water). Callers pass pre-formatted detail
 * strings so this stays a pure, unit-testable filter.
 */
export function siteFactRows(input: SiteFactInput): SiteFactRow[] {
  const rows: Array<SiteFactRow | null> = [
    { term: "Program", detail: input.program },
    { term: "House manager", detail: input.manager },
    { term: "Location", detail: input.location },
    { term: "Staffing", detail: input.staffing },
    { term: "Water", detail: input.water },
    input.contact ? { term: "Site contact", detail: input.contact } : null,
  ];
  return rows.filter(
    (r): r is SiteFactRow => r !== null && siteFactVisible(r.term),
  );
}
