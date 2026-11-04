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
 *
 * Consent currency (founder decision, 2026-11-02) joins the same pool:
 * callers pass a ConsentScoreInput (consentCompliance.ts) and its scored
 * consent items are sliced into each house by the same site-name match,
 * so the donut, the counts, and the score all include consents. When
 * the input is "unknown" the row is flagged `consentUnknown` and its
 * figures are requirements-only — surfaces must not present them as the
 * house's final score.
 */

import { metrics, type Requirement } from "../../domain";
import {
  CONSENT_SCORE_EXCLUDED,
  consentTalliesFromItems,
  type ConsentScoreInput,
} from "./consentCompliance";

export interface HouseComplianceRow {
  siteId: string;
  siteName: string;
  /** This house's scored items (requirements plus scored consents). */
  items: Requirement[];
  score: number;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  review: number;
  /**
   * True when the viewer's consent register has not loaded: the row's
   * figures exclude consents and are NOT the house's final score.
   */
  consentUnknown: boolean;
  /** Scored consent items in this row (empty when consents don't count). */
  consentTotal: number;
  consentCurrent: number;
  consentNotCurrent: number;
}

export function houseComplianceRows(
  sites: { id: string; name: string }[],
  allItems: Requirement[],
  focusSite: string,
  consent: ConsentScoreInput = CONSENT_SCORE_EXCLUDED,
): HouseComplianceRow[] {
  const scoped =
    focusSite && focusSite !== "All sites"
      ? sites.filter((s) => s.name === focusSite)
      : sites;
  return scoped.map((site) => {
    const requirements = allItems.filter((r) => r.site === site.name);
    const consentItems =
      consent.kind === "ready"
        ? consent.items.filter((r) => r.site === site.name)
        : [];
    const items = [...requirements, ...consentItems];
    const tallies = consentTalliesFromItems(items);
    return {
      siteId: site.id,
      siteName: site.name,
      items,
      ...metrics(items),
      consentUnknown: consent.kind === "unknown",
      consentTotal: tallies.total,
      consentCurrent: tallies.current,
      consentNotCurrent: tallies.notCurrent,
    };
  });
}
