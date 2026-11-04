/**
 * useConsentRegister.ts — the consent register as a scoring input.
 *
 * The compliance-score surfaces (Overview donuts, program-site cards,
 * the program-site page, the mobile home band, the Individuals cards)
 * all need the same register the Consents register page loads, in the
 * same honest states:
 * - "excluded": the viewer's role cannot see consents at all — consent
 *   currency is out of that viewer's composition entirely.
 * - "loading" / "error": the register is not in hand — the consent
 *   component of any composite score is UNKNOWN, and surfaces must
 *   withhold the composite rather than present a requirements-only
 *   figure as final (the honest-load rule).
 * - "ready": the register is loaded; a loaded register whose
 *   Individuals have no records is a real answer (every required type
 *   reads Missing), never an unknown.
 */

import { useEffect, useMemo, useState } from "react";
import { useData } from "../../data/DataProvider";
import { canSeeConsents, type ConsentRegister } from "../../data/consents";
import {
  consentRequirementItems,
  type ConsentScoreInput,
} from "../overview/consentCompliance";

export type ConsentRegisterState =
  | { kind: "excluded" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; register: ConsentRegister };

export function useConsentRegister(): ConsentRegisterState {
  const { api, session } = useData();
  const role = session?.roleKey ?? "";
  const userId = session?.userId;
  const [state, setState] = useState<ConsentRegisterState>({ kind: "loading" });

  useEffect(() => {
    if (!session || !canSeeConsents(role)) {
      setState({ kind: "excluded" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    api
      .getConsents()
      .then((register) => {
        if (live) setState({ kind: "ready", register });
      })
      .catch((e: unknown) => {
        if (live)
          setState({
            kind: "error",
            message:
              e instanceof Error ? e.message : "Could not load consents.",
          });
      });
    return () => {
      live = false;
    };
  }, [api, session, role, userId]);

  if (!session || !canSeeConsents(role)) return { kind: "excluded" };
  return state;
}

/**
 * The register adapted to the score composition's input shape: scored
 * consent items when ready, "unknown" while loading or failed, and
 * "excluded" for roles that cannot see consents.
 */
export function useConsentScoreInput(
  sites: { id: string; name: string }[],
): ConsentScoreInput {
  const state = useConsentRegister();
  const siteNameForId = useMemo(
    () => new Map(sites.map((s) => [s.id, s.name] as const)),
    [sites],
  );
  return useMemo<ConsentScoreInput>(() => {
    if (state.kind === "excluded") return { kind: "excluded" };
    if (state.kind !== "ready") return { kind: "unknown" };
    return {
      kind: "ready",
      items: consentRequirementItems(state.register, siteNameForId),
    };
  }, [state, siteNameForId]);
}
