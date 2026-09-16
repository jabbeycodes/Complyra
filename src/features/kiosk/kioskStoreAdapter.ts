/**
 * kioskStoreAdapter.ts — builds a KioskClient from the real HrStore
 * (Worker 3, src/data/hrStore.ts).
 *
 * Typed against the landed store contract (reconciled 2026-09-16 with
 * Worker 1's `20260916140000_hr_kiosk_timeclock` migration): no structural
 * casts. The adapter normalizes Worker 1's flat `verify_kiosk_pin` result
 * into the UI's KioskVerifyResult union, filling site fields from the
 * token resolution step (the PIN RPC deliberately returns no site fields).
 *
 * Bootstrap: the kiosk page is sessionless, so it doesn't know the agency
 * id up front. Token resolution is sessionless-safe: the hosted impl calls
 * the definer RPC `resolve_kiosk_token` (migration
 * `20260916140001_hr_kiosk_token_resolve`), which hashes the raw token
 * server-side and returns only site/agency fields. The adapter then
 * creates a properly agency-scoped store for everything else.
 *
 * Known limitation: the LOCAL (offline/dev) HrStore only resolves tokens
 * seeded via `kioskTestSeed`, so local end-to-end testing of the real
 * bootstrap needs a store constructed with that test seed (see
 * KioskTestSeed in hrStore.ts) or a client registered via setKioskClient.
 */

import {
  createHrStore,
  type HrStore,
} from "../../data/hrStore";
import type {
  HrPunch,
  HrStaffingPattern,
  KioskVerifyResult as StoreVerifyResult,
} from "../../data/hr";
import type {
  KioskClient,
  KioskIndividual,
  KioskPunchInput,
  KioskShiftStatus,
  KioskShiftSuggestion,
  KioskSite,
  KioskVerifyResult,
} from "./kioskClient";

function statusFromPunches(
  punches: HrPunch[],
  staffId: string,
  scheduledShiftLabel: string | null,
): KioskShiftStatus {
  const mine = punches
    .filter((p) => p.staffId === staffId)
    .sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1));
  let openIn: string | null = null;
  let onBreak = false;
  let breakSinceIso: string | null = null;
  for (const punch of mine) {
    if (punch.kind === "in") {
      openIn = punch.punchedAt;
      onBreak = false;
      breakSinceIso = null;
    } else if (punch.kind === "out") {
      openIn = null;
      onBreak = false;
      breakSinceIso = null;
    } else if (punch.kind === "break_in") {
      onBreak = true;
      breakSinceIso = punch.punchedAt;
    } else if (punch.kind === "break_out") {
      onBreak = false;
      breakSinceIso = null;
    }
    // "transfer" keeps the open clock-in as-is: the staffer stays clocked in.
  }
  return {
    clockedIn: openIn !== null,
    sinceIso: openIn,
    scheduledShiftLabel,
    onBreak,
    breakSinceIso,
  };
}

async function fetchKioskStatus(
  store: HrStore,
  staffId: string,
  siteId: string,
): Promise<KioskShiftStatus> {
  const [openPunches, suggestion] = await Promise.all([
    store.listOpenPunches(siteId),
    store.suggestKioskShift(staffId, siteId).catch(() => null),
  ]);
  return statusFromPunches(
    openPunches,
    staffId,
    suggestion?.shiftLabel ?? null,
  );
}

/**
 * Individuals for the EVV picker, sourced from staffing patterns at this
 * site (the sessionless-safe source: patterns carry individualId +
 * individualName display hints). Sorted by name.
 */
async function fetchKioskIndividuals(
  store: HrStore,
  siteId: string,
): Promise<KioskIndividual[]> {
  const patterns: HrStaffingPattern[] = await store
    .listStaffingPatterns({})
    .catch(() => []);
  const seen = new Map<string, string>();
  for (const pattern of patterns) {
    if (pattern.siteId !== siteId) continue;
    if (!pattern.individualId) continue;
    if (!seen.has(pattern.individualId)) {
      seen.set(
        pattern.individualId,
        pattern.individualName ?? pattern.individualId,
      );
    }
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Normalize the store's flat verify_kiosk_pin result into the UI's union
 * shape. Site fields come from the already-resolved token — the RPC
 * never returns them.
 */
function normalizeVerifyResult(
  result: StoreVerifyResult,
  site: KioskSite,
): KioskVerifyResult {
  if (result.ok && result.staffId) {
    return {
      ok: true,
      staffId: result.staffId,
      displayName: result.displayName ?? "",
      siteId: site.siteId,
      siteName: site.siteName,
      agencyId: site.agencyId,
    };
  }
  return {
    ok: false,
    reason: result.reason ?? "bad_pin",
    attemptsLeft: result.attemptsLeft ?? undefined,
    lockedUntil: result.lockedUntil ?? null,
    siteId: site.siteId,
    siteName: site.siteName,
    agencyId: site.agencyId,
  };
}

function adaptStore(store: HrStore, site: KioskSite): KioskClient {
  return {
    resolveKioskToken: (token) => store.resolveKioskToken(token),
    verifyKioskPin: async (rawToken, employeeId, pin) =>
      normalizeVerifyResult(
        await store.verifyKioskPin(rawToken, employeeId, pin),
        site,
      ),
    suggestKioskShift: (staffId, siteId): Promise<KioskShiftSuggestion | null> =>
      store.suggestKioskShift(staffId, siteId),
    // The store's submitKioskPunch(token, input) calls the definer RPC,
    // which resolves the site from the token and stamps
    // verification_method='kiosk_pin' server-side — the input carries no
    // method or photo.
    submitKioskPunch: (token: string, input: KioskPunchInput) =>
      store.submitKioskPunch(token, {
        staffId: input.staffId,
        kind: input.kind,
        punchedAt: input.punchedAt,
        serviceType: input.serviceType ?? null,
        individualId: input.individualId ?? null,
        offline: input.offline,
        attestation: input.attestation ?? null,
        note: input.note ?? null,
      }),
    fetchKioskStatus: (staffId, siteId) =>
      fetchKioskStatus(store, staffId, siteId),
    fetchKioskIndividuals: (siteId) => fetchKioskIndividuals(store, siteId),
  };
}

export interface KioskBootstrappedClient {
  client: KioskClient;
  siteId: string;
  siteName: string;
  agencyId: string;
}

/**
 * Resolve a kiosk token and return a fully-wired client plus the site it
 * belongs to. Throws when the token is invalid.
 */
export async function createKioskClient(
  rawToken: string,
): Promise<KioskBootstrappedClient> {
  const probe = createHrStore({ agencyId: "", userId: "kiosk" });
  const storeSite = await probe.resolveKioskToken(rawToken);
  const site: KioskSite = {
    siteId: storeSite.siteId,
    siteName: storeSite.siteName,
    agencyId: storeSite.agencyId,
  };
  const store = createHrStore({
    agencyId: site.agencyId,
    userId: `kiosk:${site.siteId}`,
  });
  return {
    client: adaptStore(store, site),
    siteId: site.siteId,
    siteName: site.siteName,
    agencyId: site.agencyId,
  };
}
