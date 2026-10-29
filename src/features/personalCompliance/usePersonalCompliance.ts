/**
 * usePersonalCompliance — loads the signed-in user's readiness roll-up the
 * same way Employee Hub → My Compliance does: the agency's readiness
 * requirements plus the user's compliance evidence, rolled up by
 * `rollupCompliance`. Shared by the Overview card/strip and the mobile
 * home card so every dashboard reads the same numbers from the same store.
 */
import { useEffect, useMemo, useState } from "react";
import {
  rollupCompliance,
  type ReadinessResult,
} from "../../data/hr";
import { createHrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import {
  summarizePersonalCompliance,
  type PersonalComplianceSummary,
} from "./personalCompliance";

export interface PersonalComplianceState {
  loading: boolean;
  error: string;
  items: ReadinessResult[];
  summary: PersonalComplianceSummary;
}

const EMPTY_SUMMARY = summarizePersonalCompliance([]);

export function usePersonalCompliance(
  session: SessionUser | null,
): PersonalComplianceState {
  const store = useMemo(
    () =>
      session
        ? createHrStore({ agencyId: session.agencyId, userId: session.userId })
        : null,
    [session],
  );
  const [items, setItems] = useState<ReadinessResult[]>([]);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session || !store) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      store.listReadinessRequirements(),
      store.getComplianceEvidence(session.userId),
    ])
      .then(([requirements, evidence]) => {
        if (cancelled) return;
        setItems(
          rollupCompliance(
            session.userId,
            session.roleKey,
            requirements,
            evidence,
            new Date().toISOString(),
          ),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Could not load your compliance status.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, session]);

  const summary = useMemo(
    () => (items.length ? summarizePersonalCompliance(items) : EMPTY_SUMMARY),
    [items],
  );
  return { loading, error, items, summary };
}
