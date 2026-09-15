import { categories, type Category, type Requirement, type Status } from "../domain";
import { daysUntil, todayIso } from "./chart";

/** Extra slice dimensions for the Overview dashboard filter bar. */
export type DueWindow = "all" | "overdue" | "7" | "14" | "30";

export interface DashboardFilters {
  program: string;
  category: string;
  status: string;
  due: DueWindow;
}

export const ALL_PROGRAMS = "All programs";
export const ALL_CATEGORIES = "All categories";
export const ALL_STATUSES = "All statuses";

export const DEFAULT_FILTERS: DashboardFilters = {
  program: ALL_PROGRAMS,
  category: ALL_CATEGORIES,
  status: ALL_STATUSES,
  due: "all",
};

export const CATEGORY_OPTIONS: Category[] = [...categories];

export const STATUS_OPTIONS: Status[] = [
  "Compliant",
  "Due soon",
  "Overdue",
  "Expired",
  "Upcoming",
  "Pending review",
];

export const DUE_WINDOW_OPTIONS: { value: DueWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "overdue", label: "Overdue only" },
  { value: "7", label: "Due in 7 days" },
  { value: "14", label: "Due in 14 days" },
  { value: "30", label: "Due in 30 days" },
];

export function filtersActive(filters: DashboardFilters): boolean {
  return (
    filters.program !== ALL_PROGRAMS ||
    filters.category !== ALL_CATEGORIES ||
    filters.status !== ALL_STATUSES ||
    filters.due !== "all"
  );
}

/** Distinct program names across the visible sites, sorted. Never invented. */
export function programOptions(
  sites: { name: string; program?: string | null }[],
): string[] {
  const seen = new Set<string>();
  for (const site of sites) {
    const program = (site.program ?? "").trim();
    if (program) seen.add(program);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function siteProgram(
  siteName: string,
  sites: { name: string; program?: string | null }[],
): string {
  return (sites.find((s) => s.name === siteName)?.program ?? "").trim();
}

/**
 * "Due in 7 days" mirrors the dashboard's existing "Due in the next 7 days"
 * stat card (status "Due soon" is derived as 0..7 days out). "Overdue only"
 * is strictly past-due. Requirements without a parseable due date never
 * match a narrowed window.
 */
export function dueInWindow(
  requirement: Requirement,
  due: DueWindow,
  today: string = todayIso(),
): boolean {
  if (due === "all") return true;
  const days = daysUntil(requirement.due, today);
  if (!Number.isFinite(days)) return false;
  if (due === "overdue") return days < 0;
  return days >= 0 && days <= Number(due);
}

/**
 * Apply the dashboard filters to the visible requirements. Every dimension
 * combines with AND, including the site selector. `requirements` is expected
 * to already be permission-scoped (the `allItems` the dashboard receives).
 */
export function applyDashboardFilters(
  requirements: Requirement[],
  options: {
    site: string;
    sites: { name: string; program?: string | null }[];
    filters: DashboardFilters;
  },
  today: string = todayIso(),
): Requirement[] {
  const { site, sites, filters } = options;
  return requirements.filter((r) => {
    if (site !== "All sites" && r.site !== site) return false;
    if (
      filters.program !== ALL_PROGRAMS &&
      siteProgram(r.site, sites) !== filters.program
    )
      return false;
    if (filters.category !== ALL_CATEGORIES && r.category !== filters.category)
      return false;
    if (filters.status !== ALL_STATUSES && r.status !== filters.status)
      return false;
    if (!dueInWindow(r, filters.due, today)) return false;
    return true;
  });
}
