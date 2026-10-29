/**
 * houseCompliance.ts — pure scoping for the Overview's house-compliance
 * donuts (founder directive, 2026-10-28: "Manager overview should have the
 * donut charts first on top to show their house's compliance. The platform
 * is compliance first.").
 *
 * One row per program site the viewer can see, holding exactly that site's
 * requirements plus the score the product already computes for a set of
 * requirements (`metrics` in domain.ts — the same numbers behind the
 * Overview stat cards and the per-site compliance cards). No new metric is
 * invented here; this only slices the existing ones by house.
 *
 * `focusSite` speaks the Overview filter's language: "All sites" or one
 * site name. A specific focus narrows the donuts to that house, matching
 * how the rest of the Overview responds to the filter.
 */

import { metrics, type Requirement } from "../../domain";

export interface HouseComplianceRow {
  siteId: string;
  siteName: string;
  /** This house's requirements only — handed to the status-mix donut. */
  items: Requirement[];
  score: number;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  review: number;
}

export function houseComplianceRows(
  sites: { id: string; name: string }[],
  allItems: Requirement[],
  focusSite: string,
): HouseComplianceRow[] {
  const scoped =
    focusSite && focusSite !== "All sites"
      ? sites.filter((s) => s.name === focusSite)
      : sites;
  return scoped.map((site) => {
    const items = allItems.filter((r) => r.site === site.name);
    return { siteId: site.id, siteName: site.name, items, ...metrics(items) };
  });
}
