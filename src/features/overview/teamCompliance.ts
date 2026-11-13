/**
 * teamCompliance.ts — per-house team compliance for the Overview's house
 * donut cards (founder design, 2026-10-29: the manager lever — a manager
 * should see their team's personal compliance inside the house view).
 *
 * Loads the agency's readiness requirements once, then each visible house
 * staff member's compliance evidence — the same loading pattern Employee
 * Hub → Team Compliance uses (one getComplianceEvidence call per staff
 * member, failures degrade to empty evidence) — and rolls each person up
 * with `rollupCompliance`. Counting (teamComplianceSummary): fully current
 * means no missing/expired item; due-soon-only staff count as current.
 *
 * Hosted-mode note: evidence is one store call per staff member, scoped
 * here to the staff of the houses on screen (post site-filter), matching
 * the Hub's existing pattern rather than inventing a new endpoint.
 */
import { useEffect, useMemo, useState } from "react";
import {
  rollupCompliance,
  type ReadinessResult,
} from "../../data/hr";
import { createHrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import {
  teamComplianceSummary,
  type TeamComplianceSummary,
} from "../personalCompliance/personalCompliance";

export interface TeamStaffEntry {
  userId: string;
  roleKey: string;
  siteId: string | null;
}

export function useTeamComplianceBySite(
  session: SessionUser | null,
  staff: TeamStaffEntry[],
  sites: { id: string; name: string }[],
): Map<string, TeamComplianceSummary> {
  const store = useMemo(
    () =>
      session
        ? createHrStore({ agencyId: session.agencyId, userId: session.userId })
        : null,
    [session],
  );
  const [bySite, setBySite] = useState<Map<string, TeamComplianceSummary>>(
    new Map(),
  );

  // Stable dependency keys: the caller passes fresh array literals.
  const siteIdsKey = sites.map((s) => s.id).join(",");
  const staffKey = staff
    .map((s) => `${s.userId}:${s.siteId ?? ""}`)
    .join(",");

  useEffect(() => {
    if (!store || sites.length === 0) {
      setBySite(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const requirements = await store.listReadinessRequirements();
        const nowIso = new Date().toISOString();
        const next = new Map<string, TeamComplianceSummary>();
        for (const site of sites) {
          const members = staff.filter((s) => s.siteId === site.id);
          if (members.length === 0) continue;
          const rollups: ReadinessResult[][] = await Promise.all(
            members.map(async (member) => {
              const evidence = await store
                .getComplianceEvidence(member.userId);
              return rollupCompliance(
                member.userId,
                member.roleKey,
                requirements,
                evidence,
                nowIso,
              );
            }),
          );
          next.set(site.id, teamComplianceSummary(rollups));
        }
        if (!cancelled) setBySite(next);
      } catch {
        // The line is an enhancement on the house card; a failed load
        // leaves it off rather than failing the Overview.
        if (!cancelled) setBySite(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, siteIdsKey, staffKey]);

  return bySite;
}
