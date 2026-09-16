/**
 * kioskClient.ts — contract between the kiosk clock UI (Worker 2) and the
 * kiosk store (Worker 3, src/data/hrStore.ts).
 *
 * The kiosk-facing types are defined HERE (not re-exported from hrStore):
 * the adapter (see ./kioskStoreAdapter.ts) maps them onto Worker 3's
 * landed HrStore kiosk surface (reconciled 2026-09-16 with the
 * hr_kiosk_timeclock migration). Field semantics match the verified backend
 * contract: KioskPunchInput uses camelCase (serviceType, individualId,
 * offline); punch kinds are
 * "in" | "out" | "break_in" | "break_out" | "transfer"; the meal-break
 * attestation travels as a JSON string in `attestation`. The raw kiosk token
 * travels alongside every submitKioskPunch call: the submit_kiosk_punch RPC
 * resolves the site from the token and stamps verification_method='kiosk_pin'
 * server-side, so neither the method nor a photo ever crosses this seam.
 *
 * The client is injectable: tests register a mock with setKioskClient, and
 * the page falls back to building a real client from the HrStore via
 * ./kioskStoreAdapter when none is registered.
 */

/** Punch kinds the kiosk can submit (matches hr.ts HrPunch.kind). */
export type KioskPunchKind =
  | "in"
  | "out"
  | "break_in"
  | "break_out"
  | "transfer";

/**
 * Punch payload handed to submitKioskPunch. Mirrors the store's kiosk
 * punch input: camelCase fields; verification_method is stamped
 * server-side as "kiosk_pin" by the submit_kiosk_punch RPC, so the client
 * sends NO method. Attestation is a JSON string such as
 * {"meal_break_taken": true}. Photo capture was cut entirely: there is
 * no photo field anywhere in the kiosk punch path.
 */
export interface KioskPunchInput {
  staffId: string;
  siteId: string;
  kind: KioskPunchKind;
  /** ISO timestamp of the punch (may be backdated for offline sync). */
  punchedAt: string;
  serviceType?: string | null;
  individualId?: string | null;
  /** True when the punch was captured offline and synced later. */
  offline: boolean;
  attestation?: string | null;
  note?: string | null;
}

export interface KioskSite {
  siteId: string;
  siteName: string;
  agencyId: string;
}

export type KioskPinFailureReason = "bad_token" | "bad_pin" | "locked";

export type KioskVerifyResult =
  | {
      ok: true;
      staffId: string;
      displayName: string;
      siteId: string;
      siteName: string;
      agencyId: string;
    }
  | {
      ok: false;
      reason: KioskPinFailureReason;
      attemptsLeft?: number;
      lockedUntil?: string | null;
      siteId?: string | null;
      siteName?: string | null;
      agencyId?: string | null;
    };

export interface KioskShiftSuggestion {
  shiftLabel: string;
  serviceType: string | null;
  individualId: string | null;
  individualName: string | null;
}

/** Live clock state for one staff member at one site (derived client-side). */
export interface KioskShiftStatus {
  clockedIn: boolean;
  /** ISO timestamp of the open clock-in, null when clocked out. */
  sinceIso: string | null;
  /** Today's published shift label, e.g. "Day 7a–3p". Null when none. */
  scheduledShiftLabel: string | null;
  /** True when a meal break is currently open. */
  onBreak: boolean;
  /** ISO timestamp the current break started, null when not on break. */
  breakSinceIso: string | null;
}

export interface KioskIndividual {
  id: string;
  name: string;
}

export interface KioskClient {
  /** Resolve a kiosk URL token to its site. Throws on an invalid token. */
  resolveKioskToken: (token: string) => Promise<KioskSite>;
  /** Verify employee ID + PIN. */
  verifyKioskPin: (
    rawToken: string,
    employeeId: string,
    pin: string,
  ) => Promise<KioskVerifyResult>;
  /** Suggest today's shift / staffing pattern for the employee at this site. */
  suggestKioskShift: (
    staffId: string,
    siteId: string,
  ) => Promise<KioskShiftSuggestion | null>;
  /**
   * Persist a punch. The sync layer calls this for queued punches too.
   * The raw kiosk token travels alongside the input because the
   * submit_kiosk_punch RPC resolves the site from the token and stamps
   * provenance server-side — the input carries no method or photo.
   */
  submitKioskPunch: (token: string, input: KioskPunchInput) => Promise<unknown>;
  /** Current clock state, derived from today's open punches. */
  fetchKioskStatus: (staffId: string, siteId: string) => Promise<KioskShiftStatus>;
  /** Individuals served at this site, for the EVV "individual served" picker. */
  fetchKioskIndividuals: (siteId: string) => Promise<KioskIndividual[]>;
}

let activeClient: KioskClient | null = null;

/**
 * Register a kiosk client explicitly (tests, or the app wiring a custom
 * store). When set, the page uses it instead of building one from the
 * HrStore.
 */
export function setKioskClient(client: KioskClient): void {
  activeClient = client;
}

/** The explicitly registered client, or null when none was registered. */
export function getRegisteredKioskClient(): KioskClient | null {
  return activeClient;
}

/** Service types offered in the kiosk EVV picker (agency-wide list). */
export const KIOSK_SERVICE_TYPES = [
  "In-Home Respite",
  "Community Networking",
  "ISL Support",
  "Personal Assistance",
  "Supported Employment",
  "Respite Care",
  "Other",
] as const;
