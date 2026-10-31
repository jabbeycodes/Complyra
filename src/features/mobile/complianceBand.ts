/**
 * complianceBand.ts — pure scoping and slicing behind the mobile home
 * compliance band (founder directive, 2026-10-31: "The donuts visual
 * dashboard shouldn't be left out in any homepage — even the mobile view
 * should have that data visualization donut and graph at the top after
 * the greetings").
 *
 * No new compliance math lives here. Personal figures come from
 * personalCompliance.ts (summarizePersonalCompliance /
 * personalComplianceSegments — the readiness roll-up the Employee Hub
 * computes). House figures come from houseComplianceRows over exactly
 * the slicing the desktop Overview applies in App.tsx: sitesVisibleTo
 * for the houses, requirements narrowed to those houses, focus "All
 * sites". The phone and the desktop therefore read the same numbers
 * from the same derivations and cannot disagree.
 */
import { sitesVisibleTo, type StaffSiteRef } from "../../data/dashboard";
import type { SessionUser } from "../../data/types";
import { statusMix, type Requirement } from "../../domain";
import {
  HOUSE_DONUT_ROLES,
  personalComplianceSegments,
  type ComplianceSegment,
  type PersonalComplianceSummary,
} from "../personalCompliance/personalCompliance";
import {
  houseComplianceRows,
  type HouseComplianceRow,
} from "../overview/houseCompliance";

export interface BandSiteRef {
  id: string;
  name: string;
}

/**
 * The viewer's house-compliance rows for the band, or null when the
 * role has no house scope (the desktop house-donut audience:
 * administrator, program_manager, house_manager). An empty array means
 * a house-scope role with no houses visible — the band renders its
 * honest empty state rather than inventing a house.
 */
export function bandHouseRows(
  session: SessionUser,
  sites: BandSiteRef[],
  staff: StaffSiteRef[],
  requirements: Requirement[],
  assignmentSiteIds: string[] = [],
): HouseComplianceRow[] | null {
  if (!HOUSE_DONUT_ROLES.has(session.roleKey)) return null;
  const visibleSites = sitesVisibleTo(session, sites, staff, assignmentSiteIds);
  const visibleNames = new Set(visibleSites.map((site) => site.name));
  const visibleRequirements = requirements.filter((r) =>
    visibleNames.has(r.site),
  );
  return houseComplianceRows(visibleSites, visibleRequirements, "All sites");
}

/* ------------------------- personal status bar ------------------------- */

export interface SegmentBarPart extends ComplianceSegment {
  /** Share of the whole, 0–100 — the segment's width in the bar. */
  percent: number;
}

/**
 * The personal compliance mix as a segmented bar: Current / Due soon /
 * Missing or expired, each segment sized by its share of the total.
 * Zero-count segments keep a 0% part so the legend can still carry
 * their count as text.
 */
export function segmentBarParts(
  summary: PersonalComplianceSummary,
): SegmentBarPart[] {
  return personalComplianceSegments(summary).map((segment) => ({
    ...segment,
    percent: summary.total ? (segment.count / summary.total) * 100 : 0,
  }));
}

/* --------------------------- house mini donut -------------------------- */

export interface HouseSlice {
  key: "compliant" | "dueSoon" | "overdue" | "review" | "upcoming";
  label: string;
  color: string;
  count: number;
}

/**
 * The house donut's slices — the same table StatusMixDonut draws the
 * desktop house donuts from (same statuses, same colors, "Upcoming"
 * only when it has items), counted by domain's statusMix over the
 * house's own requirements.
 */
const HOUSE_SLICE_DEFS: {
  key: HouseSlice["key"];
  label: string;
  color: string;
}[] = [
  { key: "compliant", label: "Compliant", color: "#4d6b42" },
  { key: "dueSoon", label: "Due soon", color: "#c49c60" },
  { key: "overdue", label: "Overdue or expired", color: "#b56a4e" },
  { key: "review", label: "Pending review", color: "#6f815c" },
  { key: "upcoming", label: "Upcoming", color: "#8b5e3c" },
];

export function houseSlices(row: HouseComplianceRow): HouseSlice[] {
  const mix = statusMix(row.items);
  return HOUSE_SLICE_DEFS.map((def) => ({ ...def, count: mix[def.key] })).filter(
    (slice) => slice.key !== "upcoming" || slice.count > 0,
  );
}

/** Total items the house donut's ring is divided across. */
export function houseSliceTotal(slices: HouseSlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.count, 0);
}

/**
 * Whether the house has anything for a donut to draw — the desktop
 * panel's own gate (its scored total plus anything pending review).
 * When false the band shows the desktop's empty wording instead of a
 * ring that would claim a score out of nothing.
 */
export function houseHasDonut(row: HouseComplianceRow): boolean {
  return row.total + row.review > 0;
}
