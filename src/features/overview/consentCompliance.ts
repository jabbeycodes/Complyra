/**
 * consentCompliance.ts — consent currency inside the product's existing
 * compliance composition (founder decision, 2026-11-02: "Count expired
 * consents in the compliance scores" — expired or missing required
 * consents make the Individual and their house non-compliant).
 *
 * The house and Individual scores are counts-based: domain's `metrics()`
 * scores a pool of Requirement items (Compliant ÷ active, with Overdue /
 * Expired on the attention side). Consents enter that same pool as
 * synthesized items — one per Individual per REQUIRED consent type — so
 * every surface that already reads the pool (Overview house donuts, the
 * Overview program-site cards, the program-site page, the mobile home
 * band, the Individuals cards) agrees with no new math anywhere.
 *
 * Status mapping, following the decision's exact bands:
 * - "Active" and "Expiring soon" are CURRENT → "Compliant". Expiring
 *   soon deliberately does NOT map to "Due soon": in this composition a
 *   due-soon item sits in the scoring base but outside the compliant
 *   count, which would dent the score. The decision keeps expiring
 *   consents fully current; their warnings live in bells and lists.
 * - "Expired" and "Revoked" → "Expired" (the pool's lapsed bucket).
 * - "Missing", "Draft", "Scheduled", "Superseded" → "Overdue": for a
 *   required type there is no current consent on file.
 *
 * Statuses come from the ONE shared derivation — `consentOnFile` /
 * `consentStatus` in data/consents.ts (which judges expiry against
 * `todayStamp()`). This module never re-derives expiry from dates, so
 * when the shared derivation moves, the score moves with it.
 *
 * Honest-load: consumers pass a ConsentScoreInput. "unknown" (the
 * viewer's role may see consents but the register has not loaded, or
 * failed to load) marks house rows `consentUnknown` so surfaces withhold
 * the composite instead of presenting a requirements-only figure as
 * final. "excluded" (the viewer's role cannot see consents at all)
 * leaves the composition exactly as it was before consents counted.
 * A LOADED register whose Individuals have no consent records is not
 * unknown: every required type reads Missing and scores accordingly.
 */

import {
  consentOnFile,
  type ConsentRegister,
  type ConsentStatus,
} from "../../data/consents";
import type { Requirement, Status } from "../../domain";

export type ConsentScoreInput =
  | { kind: "excluded" }
  | { kind: "unknown" }
  | { kind: "ready"; items: Requirement[] };

export const CONSENT_SCORE_EXCLUDED: ConsentScoreInput = { kind: "excluded" };
export const CONSENT_SCORE_UNKNOWN: ConsentScoreInput = { kind: "unknown" };

/** The Requirement category carried by every synthesized consent item. */
export const CONSENT_ITEM_CATEGORY = "Consents";

/** Map one consent status onto the scoring pool's status vocabulary. */
export function consentScoreStatus(status: ConsentStatus): Status {
  switch (status) {
    case "Active":
    case "Expiring soon":
      return "Compliant";
    case "Expired":
    case "Revoked":
      return "Expired";
    default:
      // Missing, Draft, Scheduled, Superseded — no current consent.
      return "Overdue";
  }
}

/**
 * One scored item per Individual per required consent type. Optional
 * types never score. An Individual whose site is missing from
 * `siteNameForId` keeps an empty site name: house slices (which match on
 * site name) skip the item, while per-Individual slices (which match on
 * the person's name) still count it.
 */
export function consentRequirementItems(
  register: ConsentRegister,
  siteNameForId: ReadonlyMap<string, string>,
  today?: string,
): Requirement[] {
  const items: Requirement[] = [];
  for (const person of register.individuals) {
    for (const type of register.types) {
      if (!type.required) continue;
      const { row, status } = consentOnFile(
        register,
        person.id,
        type.id,
        today,
      );
      items.push({
        id: `consent:${person.id}:${type.id}`,
        title: type.label,
        person: person.fullName,
        site: siteNameForId.get(person.siteId) ?? "",
        category: "Consents",
        owner: "",
        role: "",
        due: row?.reviewOn ?? "",
        status: consentScoreStatus(status),
        source: "Consents register",
        page: 1,
        frequency: "",
        evidence: `Consent status: ${status}`,
      });
    }
  }
  return items;
}

/* ------------------------- per-Individual standing ------------------------ */

export interface ConsentProblem {
  typeId: string;
  label: string;
  status: ConsentStatus;
}

export interface IndividualConsentStanding {
  /** Required consent types configured for the agency. */
  required: number;
  /** Required types with a current consent (Active or Expiring soon). */
  current: number;
  /** Required types with no current consent, worst first. */
  problems: ConsentProblem[];
  expired: number;
  revoked: number;
  missing: number;
  /** Draft, Scheduled, or Superseded — recorded but not in force. */
  notInForce: number;
  /** True when every required type is current. */
  compliant: boolean;
}

const PROBLEM_ORDER: ConsentStatus[] = [
  "Expired",
  "Revoked",
  "Missing",
  "Draft",
  "Scheduled",
  "Superseded",
];

/**
 * One Individual's consent standing, from the same shared derivation
 * the register and the scored items use — the chart verdict and the
 * Individuals card read this, so they cannot disagree with the score.
 */
export function individualConsentStanding(
  register: ConsentRegister,
  individualId: string,
  today?: string,
): IndividualConsentStanding {
  const problems: ConsentProblem[] = [];
  let current = 0;
  let required = 0;
  for (const type of register.types) {
    if (!type.required) continue;
    required += 1;
    const { status } = consentOnFile(register, individualId, type.id, today);
    if (status === "Active" || status === "Expiring soon") current += 1;
    else problems.push({ typeId: type.id, label: type.label, status });
  }
  problems.sort(
    (a, b) => PROBLEM_ORDER.indexOf(a.status) - PROBLEM_ORDER.indexOf(b.status),
  );
  const count = (statuses: ConsentStatus[]) =>
    problems.filter((p) => statuses.includes(p.status)).length;
  return {
    required,
    current,
    problems,
    expired: count(["Expired"]),
    revoked: count(["Revoked"]),
    missing: count(["Missing"]),
    notInForce: count(["Draft", "Scheduled", "Superseded"]),
    compliant: problems.length === 0,
  };
}

/**
 * The problem breakdown as short text, e.g. "2 expired · 1 missing".
 * `maskMissing` follows the register's DSP rule: a DSP never sees the
 * word "Missing" (their register reads "No active consent available"),
 * so their breakdown says "not on file" instead.
 */
export function consentProblemsText(
  standing: IndividualConsentStanding,
  maskMissing = false,
): string {
  const parts: string[] = [];
  if (standing.expired) parts.push(`${standing.expired} expired`);
  if (standing.revoked) parts.push(`${standing.revoked} revoked`);
  if (standing.missing)
    parts.push(
      maskMissing ? `${standing.missing} not on file` : `${standing.missing} missing`,
    );
  if (standing.notInForce)
    parts.push(`${standing.notInForce} not yet in force`);
  return parts.join(" · ");
}

/* ------------------------------ item tallies ----------------------------- */

/**
 * Consent tallies over a slice of the scored pool (one house's items,
 * one person's items): how many scored consent items there are and how
 * many are current. Zero totals mean consents are not in this slice's
 * composition (excluded role, or no Individuals in scope).
 */
export function consentTalliesFromItems(items: Requirement[]): {
  total: number;
  current: number;
  notCurrent: number;
} {
  const consentItems = items.filter((i) => i.category === CONSENT_ITEM_CATEGORY);
  const current = consentItems.filter((i) => i.status === "Compliant").length;
  return {
    total: consentItems.length,
    current,
    notCurrent: consentItems.length - current,
  };
}
