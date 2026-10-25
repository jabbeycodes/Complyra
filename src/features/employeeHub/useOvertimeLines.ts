/**
 * The agency's overtime lines (weekly limit, tolerance, approaching notice,
 * week start). Screens fall back to the platform defaults until the rules
 * store answers, and again if it can't (migration not applied yet).
 */

import { useEffect, useMemo, useState } from "react";
import { createRulesStore } from "../../data/rulesStore";
import {
  DEFAULT_OPERATING_RULES,
  DEFAULT_OVERTIME_LINES,
  operatingRulesFrom,
  overtimeLinesFrom,
  type OperatingRules,
  type OvertimeLines,
} from "../../data/rules";
import type { SessionUser } from "../../data/types";

export function useOperatingRules(
  session: Pick<SessionUser, "userId" | "fullName" | "agencyId" | "roleKey" | "platformAdmin"> | null,
): OperatingRules {
  const store = useMemo(() => {
    if (!session) return null;
    return createRulesStore({
      userId: session.userId,
      fullName: session.fullName,
      isOperator: Boolean(session.platformAdmin),
      adminOfAgencyId: session.roleKey === "administrator" ? session.agencyId : null,
      memberOfAgencyIds: [session.agencyId],
    });
  }, [session?.userId, session?.fullName, session?.agencyId, session?.roleKey, session?.platformAdmin]);
  const [rules, setRules] = useState<OperatingRules>(DEFAULT_OPERATING_RULES);

  useEffect(() => {
    if (!session || !store) return;
    let cancelled = false;
    store
      .effectiveRules(session.agencyId)
      .then((rows) => {
        if (!cancelled) setRules(operatingRulesFrom(rows));
      })
      .catch(() => {
        if (!cancelled) setRules(DEFAULT_OPERATING_RULES);
      });
    return () => {
      cancelled = true;
    };
  }, [store, session?.agencyId]);

  return rules;
}

export function useOvertimeLines(
  session: Pick<SessionUser, "userId" | "fullName" | "agencyId" | "roleKey" | "platformAdmin">,
): OvertimeLines {
  const store = useMemo(
    () =>
      createRulesStore({
        userId: session.userId,
        fullName: session.fullName,
        isOperator: Boolean(session.platformAdmin),
        adminOfAgencyId: session.roleKey === "administrator" ? session.agencyId : null,
        memberOfAgencyIds: [session.agencyId],
      }),
    [session.userId, session.fullName, session.agencyId, session.roleKey, session.platformAdmin],
  );
  const [lines, setLines] = useState<OvertimeLines>(DEFAULT_OVERTIME_LINES);

  useEffect(() => {
    let cancelled = false;
    store
      .effectiveRules(session.agencyId)
      .then((rows) => {
        if (!cancelled) setLines(overtimeLinesFrom(rows));
      })
      .catch(() => {
        if (!cancelled) setLines(DEFAULT_OVERTIME_LINES);
      });
    return () => {
      cancelled = true;
    };
  }, [store, session.agencyId]);

  return lines;
}
