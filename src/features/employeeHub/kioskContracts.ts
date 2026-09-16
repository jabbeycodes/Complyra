/**
 * kioskContracts.ts — Worker 4's integration seam for the kiosk time clock.
 *
 * Consumes Worker 3's EXACT store method names off HrStore —
 * `listKioskTokens`, `generateKioskToken`, `revokeKioskToken`,
 * `rotateKioskToken`, `issueClockCredential`, `resetClockPin`,
 * `listClockCredentials`, `unlockCredential`, `listOpenPunches`,
 * `listMissedPunchReports`, `reportMissedPunch`, `decideMissedPunchReport`,
 * `getPunchRules`, `savePunchRules` — and presents them in the
 * migration-correct shapes (Worker 1's hr.ts types, which match the
 * `20260916140000_hr_kiosk_timeclock` migration).
 *
 * KNOWN MISMATCH (flagged for the coordinator / Worker 3, 2026-09-16):
 * Worker 3's hrStore.ts types and mappers do NOT match the migration:
 *  - getPunchRules/savePunchRules read and write columns
 *    (clock_in_grace_minutes, clock_out_grace_minutes, round_to_minutes,
 *    max_shift_hours, require_attestation, require_photo) that do not
 *    exist; the migration's hr_punch_rules has (rounding_minutes,
 *    rounding_applies, grace_minutes, auto_clockout_buffer_minutes,
 *    auto_approval_score_threshold).
 *  - mapCredential selects/reads id, created_at, updated_at, which do not
 *    exist on hr_clock_credentials (its PK is staff_id; it carries
 *    pin_updated_at and updated_by).
 *  - mapMissedReport reads kind, missed_at, reported_by, decided_by/at/note,
 *    which do not exist on hr_missed_punch_reports (it carries work_date,
 *    claimed_in_at/out_at, reviewed_by/at/note); decideMissedPunchReport
 *    and reportMissedPunch write those same nonexistent columns.
 *
 * Until Worker 3 reconciles hrStore.ts with the migration, the mapping
 * functions below are defensive: they accept EITHER shape and normalize to
 * the migration-correct one, so the UI keeps working whichever side lands
 * the fix first. Nothing here edits hrStore.ts (Worker 3 owns it).
 *
 * If a method is missing when called, the adapter throws a plain-English
 * "still being set up" error; components check
 * `isKioskStoreAvailable(store)` first and render a setup note instead.
 */

import type {
  HrClockCredential,
  HrKioskToken,
  HrMissedPunchReport,
  HrPunch,
  HrPunchRules,
  HrShift,
} from "../../data/hr";
import type { HrStore, RemotePunchGrant } from "../../data/hrStore";

/* ------------------------- re-exported UI types -------------------------- */

export type {
  HrClockCredential as ClockCredential,
  HrKioskToken as KioskToken,
  HrMissedPunchReport as MissedPunchReport,
  HrPunchRules as PunchRules,
  HrPunch,
  HrShift,
};

export type MissedPunchReportStatus = "pending" | "approved" | "denied";

/* ------------------------------ store surface ---------------------------- */

/**
 * The kiosk store contract (Worker 3). Method names must match hrStore.ts
 * exactly; the values they return are normalized to the migration-correct
 * shapes before they reach components.
 */
export interface KioskStore {
  listKioskTokens(siteId?: string): Promise<HrKioskToken[]>;
  generateKioskToken(
    siteId: string,
    label: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }>;
  revokeKioskToken(id: string): Promise<void>;
  rotateKioskToken(id: string): Promise<{ token: HrKioskToken; rawToken: string }>;
  issueClockCredential(
    staffId: string,
    employeeIdNumber: string,
    pin: string,
  ): Promise<HrClockCredential>;
  resetClockPin(staffId: string, newPin: string): Promise<HrClockCredential>;
  listClockCredentials(): Promise<HrClockCredential[]>;
  unlockCredential(staffId: string): Promise<HrClockCredential>;
  listOpenPunches(siteId: string): Promise<HrPunch[]>;
  listMissedPunchReports(scope?: {
    staffId?: string;
    siteId?: string;
    status?: MissedPunchReportStatus;
  }): Promise<HrMissedPunchReport[]>;
  decideMissedPunchReport(
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<HrMissedPunchReport>;
  getPunchRules(): Promise<HrPunchRules>;
  savePunchRules(
    patch: Partial<
      Pick<
        HrPunchRules,
        | "roundingMinutes"
        | "roundingApplies"
        | "graceMinutes"
        | "autoClockoutBufferMinutes"
        | "autoApprovalScoreThreshold"
      >
    >,
  ): Promise<HrPunchRules>;
}

const KIOSK_METHODS = [
  "listKioskTokens",
  "generateKioskToken",
  "revokeKioskToken",
  "rotateKioskToken",
  "issueClockCredential",
  "resetClockPin",
  "listClockCredentials",
  "unlockCredential",
  "listOpenPunches",
  "listMissedPunchReports",
  "reportMissedPunch",
  "decideMissedPunchReport",
  "getPunchRules",
  "savePunchRules",
] as const;

/** True when the store already carries the kiosk surface (Worker 3 landed). */
export function isKioskStoreAvailable(store: HrStore): boolean {
  const raw = store as unknown as Record<string, unknown>;
  return KIOSK_METHODS.every((m) => typeof raw[m] === "function");
}

function kioskUnavailable(name: string): Error {
  return new Error(
    `The kiosk time clock is still being set up (store.${name} isn't available yet).`,
  );
}

/* ------------------------- defensive normalization ----------------------- */

type AnyRecord = Record<string, unknown>;

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown, fallback = ""): string =>
  v == null ? fallback : String(v);

const strOrNull = (v: unknown): string | null =>
  v == null ? null : String(v);

/** YYYY-MM-DD of an ISO instant (or a date string passed through). */
function dayOf(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/** Worker 3's KioskToken shape, Worker 1's HrKioskToken shape, or raw rows. */
function mapKioskToken(t: unknown): HrKioskToken {
  const r = t as AnyRecord;
  return {
    id: str(r.id),
    agencyId: str(r.agencyId ?? r.agency_id),
    siteId: str(r.siteId ?? r.site_id),
    label: strOrNull(r.label),
    active:
      typeof r.active === "boolean" ? r.active : (r.revokedAt ?? r.revoked_at) == null,
    createdBy: strOrNull(r.createdBy ?? r.created_by),
    createdAt: str(r.createdAt ?? r.created_at),
    lastUsedAt: strOrNull(r.lastUsedAt ?? r.last_used_at),
    revokedAt: strOrNull(r.revokedAt ?? r.revoked_at),
  };
}

function mapTokenResult(t: unknown): { token: HrKioskToken; rawToken: string } {
  const r = t as AnyRecord;
  return {
    token: mapKioskToken(r.token ?? t),
    rawToken: str(r.rawToken ?? r.raw_token),
  };
}

/** Worker 3's ClockCredential shape, Worker 1's HrClockCredential, raw rows. */
function mapCredential(c: unknown): HrClockCredential {
  const r = c as AnyRecord;
  return {
    staffId: str(r.staffId ?? r.staff_id),
    agencyId: str(r.agencyId ?? r.agency_id),
    employeeIdNumber: str(r.employeeIdNumber ?? r.employee_id_number),
    failedAttempts: num(r.failedAttempts ?? r.failed_attempts, 0),
    lockedUntil: strOrNull(r.lockedUntil ?? r.locked_until),
    pinUpdatedAt: strOrNull(r.pinUpdatedAt ?? r.pin_updated_at ?? r.pinSetAt),
    updatedBy: strOrNull(r.updatedBy ?? r.updated_by),
  };
}

/** Worker 3's MissedPunchReport shape, Worker 1's HrMissedPunchReport, rows. */
function mapMissedReport(r0: unknown): HrMissedPunchReport {
  const r = r0 as AnyRecord;
  const kind = str(r.kind);
  const missedAt = strOrNull(r.missedAt ?? r.missed_at);
  return {
    id: str(r.id),
    agencyId: str(r.agencyId ?? r.agency_id),
    staffId: str(r.staffId ?? r.staff_id),
    siteId: strOrNull(r.siteId ?? r.site_id),
    workDate: str(r.workDate ?? r.work_date ?? (missedAt ? dayOf(missedAt) : "")),
    claimedInAt:
      strOrNull(r.claimedInAt ?? r.claimed_in_at) ??
      (kind === "in" ? missedAt : null),
    claimedOutAt:
      strOrNull(r.claimedOutAt ?? r.claimed_out_at) ??
      (kind === "out" ? missedAt : null),
    reason: str(r.reason),
    status: ((): MissedPunchReportStatus => {
      const s = str(r.status);
      return s === "approved" || s === "denied" ? s : "pending";
    })(),
    reviewedBy: strOrNull(r.reviewedBy ?? r.reviewed_by ?? r.decidedBy ?? r.decided_by),
    reviewedAt: strOrNull(r.reviewedAt ?? r.reviewed_at ?? r.decidedAt ?? r.decided_at),
    reviewNote: strOrNull(r.reviewNote ?? r.review_note ?? r.decisionNote ?? r.decision_note),
    createdAt: str(r.createdAt ?? r.created_at),
  };
}

/**
 * Worker 3's HrPunchRules shape vs the migration's shape. The migration
 * (and Worker 1's analytics) is authoritative; Worker 3's fields are read
 * as fallbacks where they overlap (roundToMinutes → roundingMinutes,
 * clockInGraceMinutes → graceMinutes).
 */
function mapPunchRules(r0: unknown): HrPunchRules {
  const r = r0 as AnyRecord;
  const rounding = num(r.roundingMinutes ?? r.rounding_minutes ?? r.roundToMinutes ?? r.round_to_minutes, 0);
  return {
    agencyId: str(r.agencyId ?? r.agency_id),
    roundingMinutes: rounding === 5 || rounding === 10 || rounding === 15 ? rounding : 0,
    roundingApplies:
      (r.roundingApplies ?? r.rounding_applies) === "display_and_payroll"
        ? "display_and_payroll"
        : "payroll",
    graceMinutes: num(r.graceMinutes ?? r.grace_minutes ?? r.clockInGraceMinutes ?? r.clock_in_grace_minutes, 5),
    autoClockoutBufferMinutes: num(
      r.autoClockoutBufferMinutes ?? r.auto_clockout_buffer_minutes,
      30,
    ),
    autoApprovalScoreThreshold: num(
      r.autoApprovalScoreThreshold ?? r.auto_approval_score_threshold,
      90,
    ),
    updatedBy: strOrNull(r.updatedBy ?? r.updated_by),
    updatedAt: str(r.updatedAt ?? r.updated_at),
  };
}

/* -------------------------------- adapter -------------------------------- */

/**
 * Bind the contracted kiosk methods off an HrStore and normalize results
 * to the migration-correct shapes. Missing methods throw the setup error
 * when CALLED (not when adapted), so components can adapt unconditionally
 * and gate rendering with isKioskStoreAvailable().
 */
export function adaptKioskStore(store: HrStore): KioskStore {
  const raw = store as unknown as Record<string, unknown>;
  const call = (name: string) => {
    const fn = raw[name];
    if (typeof fn !== "function") {
      return (..._args: unknown[]): Promise<never> =>
        Promise.reject(kioskUnavailable(name));
    }
    return fn as (...args: unknown[]) => Promise<unknown>;
  };
  const asArray = async (p: Promise<unknown>): Promise<unknown[]> => {
    const v = await p;
    return Array.isArray(v) ? v : [];
  };
  return {
    listKioskTokens: async (siteId?: string) =>
      (await asArray(call("listKioskTokens")(siteId))).map(mapKioskToken),
    generateKioskToken: async (siteId: string, label: string) =>
      mapTokenResult(await call("generateKioskToken")(siteId, label)),
    revokeKioskToken: (id: string) =>
      call("revokeKioskToken")(id).then(() => undefined),
    rotateKioskToken: async (id: string) =>
      mapTokenResult(await call("rotateKioskToken")(id)),
    issueClockCredential: async (staffId: string, employeeIdNumber: string, pin: string) =>
      mapCredential(await call("issueClockCredential")(staffId, employeeIdNumber, pin)),
    resetClockPin: async (staffId: string, newPin: string) =>
      mapCredential(await call("resetClockPin")(staffId, newPin)),
    listClockCredentials: async () =>
      (await asArray(call("listClockCredentials")())).map(mapCredential),
    unlockCredential: async (staffId: string) =>
      mapCredential(await call("unlockCredential")(staffId)),
    listOpenPunches: async (siteId: string) =>
      (await asArray(call("listOpenPunches")(siteId))) as HrPunch[],
    listMissedPunchReports: async (scope?: {
      staffId?: string;
      siteId?: string;
      status?: MissedPunchReportStatus;
    }) => (await asArray(call("listMissedPunchReports")(scope))).map(mapMissedReport),
    decideMissedPunchReport: async (id: string, approve: boolean, note?: string) =>
      mapMissedReport(await call("decideMissedPunchReport")(id, approve, note)),
    getPunchRules: async () => mapPunchRules(await call("getPunchRules")()),
    savePunchRules: async (patch) => {
      // Worker 3's savePunchRules only knows its own field names; translate
      // the migration-correct patch into them. NOTE: roundingApplies,
      // autoClockoutBufferMinutes, and autoApprovalScoreThreshold have no
      // Worker-3 counterpart and are dropped here — the DB row (migration)
      // does carry them, so this loss disappears once Worker 3 reconciles
      // its savePunchRules with the migration.
      const w3patch: Record<string, unknown> = {};
      if (patch.roundingMinutes !== undefined) {
        w3patch.roundToMinutes = patch.roundingMinutes;
        w3patch.roundingMinutes = patch.roundingMinutes;
        w3patch.rounding_minutes = patch.roundingMinutes;
      }
      if (patch.roundingApplies !== undefined) {
        w3patch.roundingApplies = patch.roundingApplies;
        w3patch.rounding_applies = patch.roundingApplies;
      }
      if (patch.graceMinutes !== undefined) {
        w3patch.graceMinutes = patch.graceMinutes;
        w3patch.grace_minutes = patch.graceMinutes;
        w3patch.clockInGraceMinutes = patch.graceMinutes;
        w3patch.clock_in_grace_minutes = patch.graceMinutes;
        w3patch.clockOutGraceMinutes = patch.graceMinutes;
        w3patch.clock_out_grace_minutes = patch.graceMinutes;
      }
      if (patch.autoClockoutBufferMinutes !== undefined) {
        w3patch.autoClockoutBufferMinutes = patch.autoClockoutBufferMinutes;
        w3patch.auto_clockout_buffer_minutes = patch.autoClockoutBufferMinutes;
      }
      if (patch.autoApprovalScoreThreshold !== undefined) {
        w3patch.autoApprovalScoreThreshold = patch.autoApprovalScoreThreshold;
        w3patch.auto_approval_score_threshold = patch.autoApprovalScoreThreshold;
      }
      return mapPunchRules(await call("savePunchRules")(w3patch));
    },
  };
}

/* ------------------------- remote punch grants --------------------------- */

/**
 * Remote-punch grant surface (Worker 3 is building these; they are NOT in
 * hrStore.ts yet). Punches made from a personal device carry
 * `HrPunch.remote === true` and require a hub.remote_punch grant.
 */
const REMOTE_METHODS = [
  "hasRemotePunch",
  "grantRemotePunch",
  "revokeRemotePunch",
  "listRemotePunchGrants",
] as const;

/** True when the store already carries the remote-punch surface. */
export function isRemotePunchAvailable(store: HrStore): boolean {
  const raw = store as unknown as Record<string, unknown>;
  return REMOTE_METHODS.every((m) => typeof raw[m] === "function");
}

/** A hub.remote_punch grant for one staff member — Worker 3's exact shape. */
export type { RemotePunchGrant } from "../../data/hrStore";

function strOrNull2(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapGrant(r: Record<string, unknown>): RemotePunchGrant {
  return {
    staffId: String(r.staffId ?? r.staff_id ?? ""),
    grantedBy: strOrNull2(r.grantedBy ?? r.granted_by),
    grantedAt: String(r.grantedAt ?? r.granted_at ?? ""),
    employeeIdNumber: strOrNull2(r.employeeIdNumber ?? r.employee_id_number),
  };
}

export interface RemotePunchStore {
  /** True when the staff member holds a hub.remote_punch grant. */
  hasRemotePunch(staffId: string): Promise<boolean>;
  grantRemotePunch(staffId: string): Promise<RemotePunchGrant>;
  revokeRemotePunch(staffId: string): Promise<void>;
  listRemotePunchGrants(): Promise<RemotePunchGrant[]>;
}

/**
 * Dynamic adapter for the remote-punch surface. Like adaptKioskStore: the
 * exact method names are called on the store at runtime and missing
 * methods fail with a plain-language setup error.
 */
export function adaptRemotePunchStore(store: HrStore): RemotePunchStore {
  const raw = store as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const call = (name: (typeof REMOTE_METHODS)[number]) => {
    const fn = raw[name];
    if (typeof fn !== "function") {
      throw new Error(
        `Remote punch access is still being set up (store.${name} is not available yet).`,
      );
    }
    return (...args: unknown[]) => fn.apply(store, args);
  };
  const asArray = async (p: Promise<unknown>): Promise<Record<string, unknown>[]> => {
    const v = await p;
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  return {
    hasRemotePunch: async (staffId: string) =>
      Boolean(await call("hasRemotePunch")(staffId)),
    grantRemotePunch: async (staffId: string) =>
      mapGrant((await call("grantRemotePunch")(staffId)) as Record<string, unknown>),
    revokeRemotePunch: (staffId: string) =>
      call("revokeRemotePunch")(staffId).then(() => undefined),
    listRemotePunchGrants: async () =>
      (await asArray(call("listRemotePunchGrants")())).map(mapGrant),
  };
}
