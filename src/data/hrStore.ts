/**
 * HR / Employee Hub data store.
 *
 * `createHrStore({ agencyId, userId })` returns an HrStore backed by Supabase
 * when a browser client is configured (hosted), and by localStorage otherwise
 * (key "complyrer.hr.v1", JSON, namespaced per agency+user). RLS on the server
 * enforces real security; the Supabase implementation passes session scoping
 * (agency_id = opts.agencyId) in queries for the tables whose rows carry an
 * agency_id, and relies on RLS for the join tables (corrections, acks,
 * approvals) that don't.
 *
 * Table names follow the hr_* convention (snake_case columns). The hr_*
 * migrations are owned by the domain workstream; if a table is missing the
 * Supabase calls will fail and the error surfaces to the caller.
 *
 * Entity types and pure logic (validateClockIn/validateClockOut, the punch
 * guards) come from ./hr, owned by the domain workstream.
 */
import { createSupabaseBrowserClient } from "./index";
import type { SupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import {
  buildPayrollCsvExport,
  computePatternWeeklyHours,
  currentLeaveBalance,
  timeOffRequestHours,
  validateAccrualPolicy,
  validateClockIn,
  validateClockOut,
  validateShiftSwap,
  validateTimeOffBalance,
  DEFAULT_OVERTIME_RULES,
} from "./hr";
import type {
  AccrualPolicyInput,
  ComplianceEvidence,
  HrAccrualLedgerEntry,
  HrAccrualPolicy,
  HrClockCredential,
  HrDocument,
  HrDocumentAck,
  HrKioskToken,
  HrMissedPunchReport,
  HrOvertimeRules,
  HrPayPeriod,
  HrPunch,
  HrPunchCorrection,
  HrPunchRules,
  HrReadinessRequirement,
  HrShift,
  HrShiftSwap,
  HrStaffingPattern,
  HrTimecardApproval,
  HrTimeOffRequest,
  KioskVerifyResult,
  LedgerEntryInput,
  LeaveType,
  OvertimeRulesInput,
  ShiftSwapInput,
  ShiftSwapStatus,
} from "./hr";
import { DEFAULT_PUNCH_RULES } from "./hr";
import { AGENCY_ID as EVERGREEN_DEMO_AGENCY_ID } from "./seed";

/* ------------------------------ input types ------------------------------ */
/* (the domain module exports entities only; inputs are a store concern) */

export type HrShiftInput = Omit<HrShift, "id" | "agencyId" | "createdBy"> & {
  createdBy?: string;
};
export type HrDocumentInput = Omit<HrDocument, "id" | "agencyId">;
export type HrTimeOffRequestInput = Pick<
  HrTimeOffRequest,
  "kind" | "startsOn" | "endsOn" | "reason"
>;
export type HrReadinessRequirementInput = Omit<
  HrReadinessRequirement,
  "id" | "agencyId"
> & { id?: string };

/** Input for creating a staffing pattern (id/agencyId + display hints are store-owned). */
export type HrStaffingPatternInput = Omit<
  HrStaffingPattern,
  "id" | "agencyId" | "staffName" | "individualName" | "siteName"
>;

/* ------------------------- kiosk time clock (Worker 3) ---------------------- */
/*
 * RECONCILED 2026-09-16 with Worker 1's `20260916140000_hr_kiosk_timeclock`
 * migration and hr.ts kiosk types (HrKioskToken, HrClockCredential,
 * HrMissedPunchReport, HrPunchRules, KioskVerifyResult, DEFAULT_PUNCH_RULES).
 * Entity types come from hr.ts; only store-owned inputs and helpers live here.
 *
 * Backend facts (from the migration — do not drift from these):
 * - hr_kiosk_tokens(id, agency_id, site_id NOT NULL, token_hash UNIQUE sha256
 *   hex, label NULLABLE, active bool, created_by, created_at, last_used_at,
 *   revoked_at NULL). Raw tokens are generated client-side (32 random bytes
 *   hex); ONLY the sha256 hex is stored — the raw token is shown once.
 *   One active token per site (partial unique index).
 * - hr_clock_credentials(staff_id PK, agency_id, employee_id_number,
 *   pin_hash bcrypt, failed_attempts, locked_until NULL, pin_updated_at,
 *   updated_by). PINs are hashed with bcryptjs client-side (cost 10);
 *   plaintext never leaves the browser. RLS: hub.manage_pay_settings only.
 * - hr_missed_punch_reports(id, agency_id, staff_id, site_id NULLABLE,
 *   work_date date, claimed_in_at NULLABLE, claimed_out_at NULLABLE, reason,
 *   status, reviewed_by, reviewed_at, review_note, created_at). DB check: at
 *   least one of claimed_in_at / claimed_out_at is not null. On approval the
 *   APP inserts the punch rows and writes correction-ledger entries into
 *   hr_punch_corrections (see decideMissedPunchReport).
 * - hr_punch_rules(agency_id PK, rounding_minutes ∈ {0,5,10,15},
 *   rounding_applies ∈ {'payroll','display_and_payroll'}, grace_minutes,
 *   auto_clockout_buffer_minutes, auto_approval_score_threshold,
 *   updated_by, updated_at). RLS: read hub.access, write hub.manage_pay_settings.
 * - hr_punches gains: service_type, individual_id, verification_method NOT
 *   NULL DEFAULT 'web' CHECK (web|mobile|kiosk_pin|qr|nfc) — NO photo
 *   method —, offline, remote, rounded_punched_at, attestation jsonb,
 *   transfer_group, auto_clockout, exception_flags; kind widened to
 *   in/out/break_in/break_out/transfer. There is no photo_data_url column:
 *   photo capture was cut from the kiosk path entirely.
 *
 * RPC verify_kiosk_pin(p_token text, p_employee_id text, p_pin text) RETURNS
 * jsonb {ok, reason?, staff_id?, display_name?, attempts_left?, locked_until?}
 * — deliberately NO site fields (Worker 1's kiosk trust model: the kiosk
 * device authenticates through the RPC only, never table reads; hashes never
 * leave the DB). Lockout: 5 failed attempts lock the credential 15 minutes;
 * success clears. Unknown employee id → {ok:false, reason:'bad_pin',
 * attempts_left:null} (audited, no row to lock).
 *
 * resolveKioskToken calls the companion definer RPC
 * public.resolve_kiosk_token(p_token text) (migration
 * 20260916140001_hr_kiosk_token_resolve, granted to anon + authenticated
 * like verify_kiosk_pin). The raw token is hashed INSIDE the function; the
 * response carries only {ok, site_id, site_name, agency_id} — never hashes,
 * never staff data. Only active, non-revoked tokens resolve; anything else
 * returns {ok:false} and the store throws "Invalid kiosk token.". Because the
 * RPC is granted to anon, a kiosk device can resolve/brand itself before any
 * staff member clocks in, without any table reads.
 *
 * RLS / permission gates (Worker 1; the store does not gate, Worker 4's HR UI
 * does): kiosk token admin writes need hub.manage_schedule (NOT
 * hub.manage_staffing); PIN/credential admin needs hub.manage_pay_settings;
 * missed-punch decisions need hub.review_timecards.
 *
 * Punch submission: kiosk devices are unauthenticated, so punches go through
 * the SECURITY DEFINER RPC public.submit_kiosk_punch (migration
 * 20260916140001_hr_kiosk_token_resolve) — NEVER a direct insert. The RPC
 * hashes the token server-side, requires an active token, stamps
 * verification_method='kiosk_pin' (no client method is accepted), and the
 * stamp_punch_remote trigger derives remote=false. The store's
 * submitKioskPunch(token, input) takes the raw token + punch fields and
 * returns the punch row.
 *
 * Remote punching (personal device): staff clocking in/out from the hub
 * Time Clock need an individual hub.remote_punch grant
 * (hr_staff_permission_grants, Worker 1's migration). The store surfaces
 * hasRemotePunch / grantRemotePunch / revokeRemotePunch /
 * listRemotePunchGrants on both impls; local clockIn/clockOut REQUIRE the
 * grant, and the Supabase impl pre-checks it for a friendly message (the
 * hr_punches_insert_remote RLS policy is the real server-side gate).
 */

/**
 * Punch fields for submitKioskPunch(token, input). The raw kiosk token (not
 * the input) determines the site; verification_method is stamped
 * server-side as 'kiosk_pin' — the input carries NO method and NO photo
 * (photo capture was cut from the kiosk path entirely).
 */
export interface KioskPunchInput {
  staffId: string;
  kind: HrPunch["kind"];
  /** ISO timestamp of the punch (may be backdated for offline sync). */
  punchedAt: string;
  serviceType?: string | null;
  individualId?: string | null;
  /** True when the punch was captured offline and synced later. */
  offline: boolean;
  /**
   * Written to hr_punches.attestation (jsonb); surfaced on HrPunch.attestation.
   */
  attestation?: string | Record<string, unknown> | null;
  note?: string | null;
  shiftId?: string | null;
}

/**
 * One active hub.remote_punch grant (Worker 1's hr_staff_permission_grants).
 * employeeIdNumber comes from the staffer's clock credential when one exists
 * (null otherwise) so HR lists can show the familiar ID number.
 */
export interface RemotePunchGrant {
  staffId: string;
  grantedBy: string | null;
  grantedAt: string;
  employeeIdNumber: string | null;
}

/**
 * The exact argument object sent to the public.submit_kiosk_punch RPC.
 * Exported for unit tests: the RPC contract (argument names, server-stamped
 * verification_method='kiosk_pin') is pinned here, not in the impl.
 */
export function buildSubmitKioskPunchParams(
  token: string,
  input: KioskPunchInput,
): Record<string, unknown> {
  return {
    p_token: token,
    p_staff_id: input.staffId,
    p_kind: input.kind,
    p_punched_at: input.punchedAt,
    p_service_type:
      input.serviceType?.trim() ? input.serviceType.trim() : null,
    p_individual_id: input.individualId ?? null,
    p_attestation: input.attestation ?? null,
    p_note: input.note?.trim() ? input.note.trim() : null,
    p_shift_id: input.shiftId ?? null,
    p_offline: input.offline,
  };
}

export interface KioskSite {
  siteId: string;
  siteName: string;
  agencyId: string;
}

export interface MissedPunchReportInput {
  staffId: string;
  siteId?: string | null;
  /** YYYY-MM-DD work date. */
  workDate: string;
  claimedInAt?: string | null;
  claimedOutAt?: string | null;
  reason: string;
}

export interface KioskShiftSuggestion {
  shiftLabel: string;
  serviceType: string | null;
  individualId: string | null;
  individualName: string | null;
}

/**
 * Test-only seed for the local impl: a known-good token + PIN credential.
 * Never pass this in production — createHrStore's kioskTestSeed exists so
 * tests get a working local PIN flow without touching the network.
 */
export interface KioskTestSeed {
  rawToken: string;
  siteId: string;
  siteName: string;
  staffId: string;
  displayName: string;
  employeeIdNumber: string;
  pin: string;
}

export interface HrStore {
  /* Shifts */
  listShifts(fromIso: string, toIso: string, siteId?: string): Promise<HrShift[]>;
  createShift(input: HrShiftInput): Promise<HrShift>;
  updateShift(id: string, patch: Partial<HrShiftInput>): Promise<HrShift>;
  deleteShift(id: string): Promise<void>;
  /* Time clock */
  listPunches(staffId: string, fromIso: string, toIso: string): Promise<HrPunch[]>;
  clockIn(note?: string): Promise<HrPunch>;
  clockOut(note?: string): Promise<HrPunch>;
  /* Punch corrections */
  listPunchCorrections(scope: { staffId?: string }): Promise<HrPunchCorrection[]>;
  requestPunchCorrection(
    punchId: string,
    req: { requestedKind: HrPunchCorrection["requestedKind"]; requestedAt: string; reason: string },
  ): Promise<HrPunchCorrection>;
  decidePunchCorrection(
    id: string,
    approve: boolean,
    reviewNote?: string,
  ): Promise<HrPunchCorrection>;
  /* Pay periods + timecard approvals */
  listPayPeriods(): Promise<HrPayPeriod[]>;
  createPayPeriod(startsOn: string, endsOn: string): Promise<HrPayPeriod>;
  lockPayPeriod(id: string): Promise<HrPayPeriod>;
  markPayPeriodExported(id: string): Promise<HrPayPeriod>;
  getTimecardApproval(periodId: string, staffId: string): Promise<HrTimecardApproval | null>;
  submitTimecard(periodId: string): Promise<HrTimecardApproval>;
  decideTimecard(
    periodId: string,
    staffId: string,
    status: "approved" | "changes_requested",
    note?: string,
  ): Promise<HrTimecardApproval>;
  /* HR documents */
  listDocuments(): Promise<HrDocument[]>;
  createDocument(input: HrDocumentInput): Promise<HrDocument>;
  updateDocument(id: string, patch: Partial<HrDocumentInput>): Promise<HrDocument>;
  acknowledgeDocument(docId: string, signatureName: string): Promise<HrDocumentAck>;
  listDocumentAcks(docId?: string): Promise<HrDocumentAck[]>;
  /* Time off */
  listTimeOffRequests(scope: { staffId?: string }): Promise<HrTimeOffRequest[]>;
  createTimeOffRequest(input: HrTimeOffRequestInput): Promise<HrTimeOffRequest>;
  decideTimeOffRequest(id: string, approve: boolean, note?: string): Promise<HrTimeOffRequest>;
  /* Readiness requirements */
  listReadinessRequirements(): Promise<HrReadinessRequirement[]>;
  saveReadinessRequirement(input: HrReadinessRequirementInput): Promise<HrReadinessRequirement>;
  /* Compliance evidence for the "My Compliance" tab */
  getComplianceEvidence(staffId: string): Promise<ComplianceEvidence>;
  /* Staffing patterns (recurring weekly assignments) */
  listStaffingPatterns(scope: { staffId?: string }): Promise<HrStaffingPattern[]>;
  createStaffingPattern(input: HrStaffingPatternInput): Promise<HrStaffingPattern>;
  updateStaffingPattern(
    id: string,
    patch: Partial<HrStaffingPatternInput>,
  ): Promise<HrStaffingPattern>;
  setStaffingPatternActive(id: string, active: boolean): Promise<void>;
  /* PTO accrual policies (HR-PHASE2) */
  listAccrualPolicies(): Promise<HrAccrualPolicy[]>;
  createAccrualPolicy(input: AccrualPolicyInput): Promise<HrAccrualPolicy>;
  updateAccrualPolicy(
    id: string,
    patch: Partial<AccrualPolicyInput>,
  ): Promise<HrAccrualPolicy>;
  setAccrualPolicyActive(id: string, active: boolean): Promise<HrAccrualPolicy>;
  /* Leave ledger (HR-PHASE2) */
  listLedgerEntries(
    staffId: string,
    opts?: { leaveType?: LeaveType },
  ): Promise<HrAccrualLedgerEntry[]>;
  postLedgerEntry(input: LedgerEntryInput): Promise<HrAccrualLedgerEntry>;
  /* Overtime rules (HR-PHASE2) */
  getOvertimeRules(): Promise<HrOvertimeRules>;
  saveOvertimeRules(input: OvertimeRulesInput): Promise<HrOvertimeRules>;
  /* Shift swaps (HR-PHASE2) */
  listShiftSwaps(scope?: {
    staffId?: string;
    status?: ShiftSwapStatus;
  }): Promise<HrShiftSwap[]>;
  createShiftSwap(input: ShiftSwapInput): Promise<HrShiftSwap>;
  claimShiftSwap(
    id: string,
    claimerId: string,
    counterOfferShiftId?: string,
  ): Promise<HrShiftSwap>;
  decideShiftSwap(
    id: string,
    approve: boolean,
    decidedBy: string,
    note?: string,
  ): Promise<HrShiftSwap>;
  cancelShiftSwap(id: string): Promise<HrShiftSwap>;
  /* Kiosk time clock (Worker 3) — entity types are Worker 1's hr.ts types */
  verifyKioskPin(
    rawToken: string,
    employeeId: string,
    pin: string,
  ): Promise<KioskVerifyResult>;
  resolveKioskToken(rawToken: string): Promise<KioskSite>;
  /**
   * Submit a punch from a kiosk device via the submit_kiosk_punch definer
   * RPC — never a direct insert. The token is hashed server-side and must
   * belong to an active token; verification_method is stamped 'kiosk_pin'
   * and remote derives false. Throws "Invalid kiosk token." otherwise.
   */
  submitKioskPunch(token: string, input: KioskPunchInput): Promise<HrPunch>;
  suggestKioskShift(
    staffId: string,
    siteId: string,
  ): Promise<KioskShiftSuggestion | null>;
  /* hub.remote_punch per-staff grants (personal-device punching) */
  /** True when the staffer holds an active hub.remote_punch grant. */
  hasRemotePunch(staffId: string): Promise<boolean>;
  /**
   * Grant hub.remote_punch to a staffer. grantedBy defaults to the current
   * user. Idempotent: an existing active grant is returned as-is.
   */
  grantRemotePunch(
    staffId: string,
    grantedBy?: string,
  ): Promise<RemotePunchGrant>;
  /** Soft-revoke: sets revoked_at, never deletes the row. */
  revokeRemotePunch(staffId: string): Promise<void>;
  /** Active grants for this agency, newest first. */
  listRemotePunchGrants(): Promise<RemotePunchGrant[]>;
  /* Kiosk token admin (HR UI, writes gated on hub.manage_schedule) */
  listKioskTokens(siteId?: string): Promise<HrKioskToken[]>;
  generateKioskToken(
    siteId: string,
    label: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }>;
  revokeKioskToken(id: string): Promise<void>;
  rotateKioskToken(
    id: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }>;
  /* PIN/credential admin (HR UI, gated on hub.manage_pay_settings) */
  issueClockCredential(
    staffId: string,
    employeeIdNumber: string,
    pin: string,
  ): Promise<HrClockCredential>;
  resetClockPin(staffId: string, newPin: string): Promise<HrClockCredential>;
  listClockCredentials(): Promise<HrClockCredential[]>;
  unlockCredential(staffId: string): Promise<HrClockCredential>;
  /* Open sessions, missed punches, punch rules */
  listOpenPunches(siteId: string): Promise<HrPunch[]>;
  listMissedPunchReports(scope?: {
    staffId?: string;
    siteId?: string;
    status?: HrMissedPunchReport["status"];
  }): Promise<HrMissedPunchReport[]>;
  reportMissedPunch(
    input: MissedPunchReportInput,
  ): Promise<HrMissedPunchReport>;
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

/* ------------------------------ helpers -------------------------------- */

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `hr-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------- Supabase implementation ---------------------- */

function mapShift(r: Record<string, unknown>): HrShift {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    siteId: r.site_id == null ? null : String(r.site_id),
    staffId: r.staff_id == null ? null : String(r.staff_id),
    title: String(r.title ?? ""),
    startsAt: String(r.starts_at),
    endsAt: String(r.ends_at),
    status: (r.status as HrShift["status"]) ?? "scheduled",
    notes: r.notes == null ? null : String(r.notes),
    createdBy: String(r.created_by ?? ""),
  };
}

function mapPunch(r: Record<string, unknown>): HrPunch {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    siteId: r.site_id == null ? null : String(r.site_id),
    staffId: String(r.staff_id),
    kind: r.kind as HrPunch["kind"],
    punchedAt: String(r.punched_at),
    source: String(r.source ?? "hub"),
    note: r.note == null ? null : String(r.note),
    shiftId: r.shift_id == null ? null : String(r.shift_id),
    /* Kiosk-era optional columns (Worker 1's hr.ts HrPunch). */
    serviceType: r.service_type == null ? undefined : String(r.service_type),
    individualId:
      r.individual_id == null ? undefined : String(r.individual_id),
    verificationMethod:
      r.verification_method == null
        ? undefined
        : String(r.verification_method),
    offline: r.offline == null ? undefined : Boolean(r.offline),
    /* True when punched from a personal device under a hub.remote_punch
     * grant (server-stamped: the trigger forces false for kiosk_pin). */
    remote: r.remote == null ? undefined : Boolean(r.remote),
    roundedPunchedAt:
      r.rounded_punched_at == null ? undefined : String(r.rounded_punched_at),
  };
}

function mapCorrection(r: Record<string, unknown>): HrPunchCorrection {
  return {
    id: String(r.id),
    punchId: String(r.punch_id),
    staffId: String(r.staff_id),
    requestedKind: (r.requested_kind as HrPunchCorrection["requestedKind"]) ?? null,
    requestedAt: r.requested_at == null ? null : String(r.requested_at),
    reason: String(r.reason ?? ""),
    status: r.status as HrPunchCorrection["status"],
    reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
    reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
    reviewNote: r.review_note == null ? null : String(r.review_note),
  };
}

function mapPeriod(r: Record<string, unknown>): HrPayPeriod {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    status: r.status as HrPayPeriod["status"],
    lockedBy: r.locked_by == null ? null : String(r.locked_by),
    lockedAt: r.locked_at == null ? null : String(r.locked_at),
  };
}

function mapApproval(r: Record<string, unknown>): HrTimecardApproval {
  return {
    id: String(r.id),
    payPeriodId: String(r.pay_period_id),
    staffId: String(r.staff_id),
    status: r.status as HrTimecardApproval["status"],
    submittedAt: r.submitted_at == null ? null : String(r.submitted_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
    note: r.note == null ? null : String(r.note),
  };
}

function mapDocument(r: Record<string, unknown>): HrDocument {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    title: String(r.title ?? ""),
    category: (r.category as HrDocument["category"]) ?? "notice",
    body: r.body == null ? null : String(r.body),
    fileUrl: r.file_url == null ? null : String(r.file_url),
    requiresAck: Boolean(r.requires_ack),
    active: r.active == null ? true : Boolean(r.active),
  };
}

function mapAck(r: Record<string, unknown>): HrDocumentAck {
  return {
    id: String(r.id),
    docId: String(r.doc_id),
    staffId: String(r.staff_id),
    ackedAt: String(r.acked_at),
    signatureName: String(r.signature_name ?? ""),
  };
}

/* Column names follow the hr_* snake_case convention; if the phase-2
 * migration names a column differently, the Supabase calls below fail loudly
 * and this mapping is the single place to reconcile. */

function mapAccrualPolicy(r: Record<string, unknown>): HrAccrualPolicy {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    leaveType: r.leave_type as LeaveType,
    tenureBands: (r.tenure_bands as HrAccrualPolicy["tenureBands"]) ?? [],
    carryoverCapHours: Number(r.carryover_cap_hours ?? 0),
    carryoverBasis: (r.carryover_basis as HrAccrualPolicy["carryoverBasis"]) ?? "calendar_year",
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to == null ? null : String(r.effective_to),
    active: Boolean(r.active),
    createdBy: String(r.created_by ?? ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapLedgerEntry(r: Record<string, unknown>): HrAccrualLedgerEntry {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    staffId: String(r.staff_id),
    payPeriodId: r.pay_period_id == null ? null : String(r.pay_period_id),
    periodStart: String(r.period_start),
    leaveType: r.leave_type as LeaveType,
    accrued: Number(r.accrued ?? 0),
    used: Number(r.used ?? 0),
    adjustment: Number(r.adjustment ?? 0),
    balance: Number(r.balance ?? 0),
    note: r.note == null ? null : String(r.note),
    createdAt: String(r.created_at),
  };
}

function mapOvertimeRules(
  r: Record<string, unknown>,
  agencyId: string,
): HrOvertimeRules {
  return {
    agencyId,
    weeklyThresholdHours: Number(r.weekly_threshold_hours),
    dailyThresholdHours:
      r.daily_threshold_hours == null ? null : Number(r.daily_threshold_hours),
    seventhConsecutiveDay: Boolean(r.seventh_consecutive_day),
    seventhDayThresholdHours: Number(r.seventh_day_threshold_hours ?? 8),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
    updatedAt: String(r.updated_at),
  };
}

function mapShiftSwap(r: Record<string, unknown>): HrShiftSwap {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    requesterId: String(r.requester_id),
    offeredShiftId: String(r.offered_shift_id),
    requestedShiftId:
      r.requested_shift_id == null ? null : String(r.requested_shift_id),
    targetStaffId:
      r.target_staff_id == null ? null : String(r.target_staff_id),
    status: r.status as ShiftSwapStatus,
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
    decisionNote: r.decision_note == null ? null : String(r.decision_note),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapTimeOff(r: Record<string, unknown>): HrTimeOffRequest {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    siteId: r.site_id == null ? null : String(r.site_id),
    staffId: String(r.staff_id),
    kind: r.kind as HrTimeOffRequest["kind"],
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    status: r.status as HrTimeOffRequest["status"],
    reason: String(r.reason ?? ""),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
    decisionNote: r.decision_note == null ? null : String(r.decision_note),
  };
}

function mapRequirement(r: Record<string, unknown>): HrReadinessRequirement {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    key: String(r.key ?? ""),
    label: String(r.label ?? ""),
    kind: r.kind as HrReadinessRequirement["kind"],
    dueEveryDays: r.due_every_days == null ? null : Number(r.due_every_days),
    requiredRoleKeys: Array.isArray(r.required_role_keys)
      ? (r.required_role_keys as string[])
      : [],
    active: r.active == null ? true : Boolean(r.active),
  };
}

function mapStaffingPattern(r: Record<string, unknown>): HrStaffingPattern {
  const numArray = (v: unknown): number[] =>
    Array.isArray(v) ? (v as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [];
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map(String) : [];
  const windows = Array.isArray(r.windows)
    ? (r.windows as Record<string, unknown>[]).map((w) => ({
        start: String(w.start ?? ""),
        end: String(w.end ?? ""),
      }))
    : [];
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    siteId: r.site_id == null ? null : String(r.site_id),
    staffId: String(r.staff_id),
    individualId: r.individual_id == null ? null : String(r.individual_id),
    shiftLabel: r.shift_label == null ? null : String(r.shift_label),
    days: numArray(r.days),
    windows,
    weeklyHours: Number(r.weekly_hours ?? 0),
    serviceTags: strArray(r.service_tags),
    requiresIsdTraining: Boolean(r.requires_isd_training),
    onCall: Boolean(r.on_call),
    notes: r.notes == null ? null : String(r.notes),
    effectiveFrom: String(r.effective_from ?? ""),
    effectiveTo: r.effective_to == null ? null : String(r.effective_to),
    active: r.active == null ? true : Boolean(r.active),
  };
}

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/* ------------------------- kiosk helpers (Worker 3) ----------------------- */
/* Entity mappers target Worker 1's hr.ts types, which mirror the
 * 20260916140000_hr_kiosk_timeclock migration 1:1. */

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;
/** Kiosk PINs are numeric, 4–8 digits. */
const PIN_RE = /^\d{4,8}$/;

function assertPinFormat(pin: string): void {
  if (!PIN_RE.test(pin)) {
    throw new Error("PIN must be 4–8 digits.");
  }
}

/** sha256 hex digest of a raw kiosk token (what the server stores). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 random bytes as hex — the raw kiosk token, shown to the admin once. */
function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mapKioskToken(r: Record<string, unknown>): HrKioskToken {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    siteId: String(r.site_id),
    label: r.label == null ? null : String(r.label),
    active: Boolean(r.active),
    createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
  };
}

/** Safe credential mapper: callers must select WITHOUT pin_hash. */
function mapCredential(r: Record<string, unknown>): HrClockCredential {
  return {
    staffId: String(r.staff_id),
    agencyId: String(r.agency_id),
    employeeIdNumber: String(r.employee_id_number ?? ""),
    failedAttempts: Number(r.failed_attempts ?? 0),
    lockedUntil: r.locked_until == null ? null : String(r.locked_until),
    pinUpdatedAt:
      r.pin_updated_at == null ? null : String(r.pin_updated_at),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
  };
}

const CREDENTIAL_SAFE_COLUMNS =
  "staff_id, agency_id, employee_id_number, failed_attempts, locked_until, pin_updated_at, updated_by";

function mapMissedReport(r: Record<string, unknown>): HrMissedPunchReport {
  return {
    id: String(r.id),
    agencyId: String(r.agency_id),
    staffId: String(r.staff_id),
    siteId: r.site_id == null ? null : String(r.site_id),
    workDate: String(r.work_date ?? ""),
    claimedInAt: r.claimed_in_at == null ? null : String(r.claimed_in_at),
    claimedOutAt:
      r.claimed_out_at == null ? null : String(r.claimed_out_at),
    reason: String(r.reason ?? ""),
    status: r.status as HrMissedPunchReport["status"],
    reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
    reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
    reviewNote: r.review_note == null ? null : String(r.review_note),
    createdAt: String(r.created_at),
  };
}

function mapPunchRules(
  r: Record<string, unknown>,
  agencyId: string,
): HrPunchRules {
  return {
    agencyId,
    roundingMinutes: Number(r.rounding_minutes ?? 0),
    roundingApplies:
      r.rounding_applies === "display_and_payroll"
        ? "display_and_payroll"
        : "payroll",
    graceMinutes: Number(r.grace_minutes ?? 5),
    autoClockoutBufferMinutes: Number(r.auto_clockout_buffer_minutes ?? 30),
    autoApprovalScoreThreshold: Number(r.auto_approval_score_threshold ?? 90),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
    updatedAt: String(r.updated_at ?? nowIso()),
  };
}

function defaultPunchRules(agencyId: string): HrPunchRules {
  return {
    agencyId,
    ...DEFAULT_PUNCH_RULES,
    updatedBy: null,
    updatedAt: nowIso(),
  };
}

const ROUNDING_MINUTES_ALLOWED = [0, 5, 10, 15] as const;

function assertPunchRulesPatch(
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
): void {
  if (
    patch.roundingMinutes !== undefined &&
    !(ROUNDING_MINUTES_ALLOWED as readonly number[]).includes(
      patch.roundingMinutes,
    )
  ) {
    throw new Error("roundingMinutes must be one of 0, 5, 10, 15.");
  }
  if (
    patch.roundingApplies !== undefined &&
    patch.roundingApplies !== "payroll" &&
    patch.roundingApplies !== "display_and_payroll"
  ) {
    throw new Error(
      "roundingApplies must be 'payroll' or 'display_and_payroll'.",
    );
  }
  if (
    patch.graceMinutes !== undefined &&
    (!Number.isFinite(patch.graceMinutes) || patch.graceMinutes < 0)
  ) {
    throw new Error("graceMinutes must be a non-negative number.");
  }
  if (
    patch.autoClockoutBufferMinutes !== undefined &&
    (!Number.isFinite(patch.autoClockoutBufferMinutes) ||
      patch.autoClockoutBufferMinutes < 0)
  ) {
    throw new Error("autoClockoutBufferMinutes must be a non-negative number.");
  }
  if (
    patch.autoApprovalScoreThreshold !== undefined &&
    (!Number.isFinite(patch.autoApprovalScoreThreshold) ||
      patch.autoApprovalScoreThreshold < 0 ||
      patch.autoApprovalScoreThreshold > 100)
  ) {
    throw new Error("autoApprovalScoreThreshold must be between 0 and 100.");
  }
}

type GuardPunch = Pick<HrPunch, "kind" | "punchedAt">;

/**
 * Kiosk-aware open session: "in" opens, "out" closes, break/transfer punches
 * are neutral. (hr.ts's analyzePunches skips break/transfer entirely; the
 * domain validators below are called with in/out punches only.)
 */
function kioskSessionOpen(punches: GuardPunch[]): boolean {
  const sorted = [...punches].sort((a, b) =>
    a.punchedAt < b.punchedAt ? -1 : a.punchedAt > b.punchedAt ? 1 : 0,
  );
  let open = false;
  for (const p of sorted) {
    if (p.kind === "in") open = true;
    else if (p.kind === "out") open = false;
  }
  return open;
}

/** Latest break_in with no later break_out, or null. */
function openBreakPunch(punches: GuardPunch[]): GuardPunch | null {
  const sorted = [...punches].sort((a, b) =>
    a.punchedAt < b.punchedAt ? -1 : a.punchedAt > b.punchedAt ? 1 : 0,
  );
  let open: GuardPunch | null = null;
  for (const p of sorted) {
    if (p.kind === "break_in") open = p;
    else if (p.kind === "break_out") open = null;
  }
  return open;
}

/**
 * Domain punch guards for kiosk submissions. Reuses hr.ts's validateClockIn /
 * validateClockOut (narrowed to in/out punches) so the kiosk surfaces the same
 * user-facing messages as the hub clock.
 */
function guardKioskPunch(
  todays: GuardPunch[],
  kind: HrPunch["kind"],
  punchedAt: string,
): void {
  const session = todays.filter((p) => p.kind === "in" || p.kind === "out");
  if (kind === "in") {
    validateClockIn(session as HrPunch[], punchedAt);
  } else if (kind === "out" || kind === "transfer" || kind === "break_in") {
    validateClockOut(session as HrPunch[]);
  } else {
    if (!openBreakPunch(todays)) {
      throw new Error("No open break to end.");
    }
  }
}

/** Raw verify_kiosk_pin RPC response (mirrors Worker 1's KioskVerifyResult). */
interface VerifyKioskPinRow {
  ok: boolean;
  reason?: "bad_token" | "bad_pin" | "locked" | null;
  staff_id?: string | null;
  display_name?: string | null;
  attempts_left?: number | null;
  locked_until?: string | null;
}

function mapVerifyResult(row: VerifyKioskPinRow): KioskVerifyResult {
  if (row.ok && row.staff_id != null) {
    return {
      ok: true,
      staffId: String(row.staff_id),
      displayName: row.display_name ?? null,
    };
  }
  return {
    ok: false,
    reason: row.reason ?? "bad_pin",
    attemptsLeft: row.attempts_left ?? null,
    lockedUntil: row.locked_until ?? null,
  };
}

function validateMissedPunchInput(input: MissedPunchReportInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    throw new Error("workDate must be YYYY-MM-DD.");
  }
  if (input.claimedInAt == null && input.claimedOutAt == null) {
    throw new Error(
      "At least one of claimedInAt / claimedOutAt is required.",
    );
  }
  for (const v of [input.claimedInAt, input.claimedOutAt]) {
    if (v != null && Number.isNaN(new Date(v).getTime())) {
      throw new Error("Invalid claimed punch time.");
    }
  }
  if (!input.reason.trim()) throw new Error("A reason is required.");
}

class SupabaseHrStore implements HrStore {
  constructor(
    private client: SupabaseClient,
    private agencyId: string,
    private userId: string,
  ) {}

  async listShifts(fromIso: string, toIso: string, siteId?: string): Promise<HrShift[]> {
    let q = this.client
      .from("hr_shifts")
      .select("*")
      .eq("agency_id", this.agencyId)
      .gte("starts_at", fromIso)
      .lte("ends_at", toIso)
      .order("starts_at", { ascending: true });
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    throwIf(error, "Could not load shifts");
    return (data ?? []).map(mapShift);
  }

  async createShift(input: HrShiftInput): Promise<HrShift> {
    const { data, error } = await this.client
      .from("hr_shifts")
      .insert({
        agency_id: this.agencyId,
        site_id: input.siteId,
        staff_id: input.staffId,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        status: input.status,
        notes: input.notes,
        created_by: input.createdBy ?? this.userId,
      })
      .select()
      .single();
    throwIf(error, "Could not create shift");
    return mapShift(data as Record<string, unknown>);
  }

  async updateShift(id: string, patch: Partial<HrShiftInput>): Promise<HrShift> {
    const row: Record<string, unknown> = {};
    if (patch.siteId !== undefined) row.site_id = patch.siteId;
    if (patch.staffId !== undefined) row.staff_id = patch.staffId;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.notes !== undefined) row.notes = patch.notes;
    const { data, error } = await this.client
      .from("hr_shifts")
      .update(row)
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update shift");
    return mapShift(data as Record<string, unknown>);
  }

  async deleteShift(id: string): Promise<void> {
    const { error } = await this.client
      .from("hr_shifts")
      .delete()
      .eq("id", id)
      .eq("agency_id", this.agencyId);
    throwIf(error, "Could not delete shift");
  }

  async listPunches(staffId: string, fromIso: string, toIso: string): Promise<HrPunch[]> {
    const { data, error } = await this.client
      .from("hr_punches")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("staff_id", staffId)
      .gte("punched_at", fromIso)
      .lte("punched_at", toIso)
      .order("punched_at", { ascending: true });
    throwIf(error, "Could not load punches");
    return (data ?? []).map(mapPunch);
  }

  private dayRange(d = new Date()): { from: string; to: string } {
    const stamp = todayStamp(d);
    return { from: `${stamp}T00:00:00`, to: `${stamp}T23:59:59.999` };
  }

  /**
   * Friendly pre-check for hub.remote_punch before a hub clock in/out. The
   * hr_punches_insert_remote RLS policy is the real server-side gate; this
   * surfaces the plain-language reason before the insert fails.
   */
  private async requireRemotePunchGrant(action: "in" | "out"): Promise<void> {
    if (await this.hasRemotePunch(this.userId)) return;
    throw new Error(
      action === "in"
        ? "Clock in on the house kiosk laptop — remote clock-in isn't enabled for your account."
        : "Clock out on the house kiosk laptop — remote clock-out isn't enabled for your account.",
    );
  }

  async clockIn(note?: string): Promise<HrPunch> {
    await this.requireRemotePunchGrant("in");
    const { from, to } = this.dayRange();
    const todays = await this.listPunches(this.userId, from, to);
    // Domain punch guard throws a user-facing message when already clocked in.
    validateClockIn(todays, nowIso());
    const { data, error } = await this.client
      .from("hr_punches")
      .insert({
        agency_id: this.agencyId,
        site_id: null,
        staff_id: this.userId,
        kind: "in",
        punched_at: nowIso(),
        source: "hub",
        note: note?.trim() ? note.trim() : null,
        shift_id: null,
      })
      .select()
      .single();
    throwIf(error, "Could not clock in");
    return mapPunch(data as Record<string, unknown>);
  }

  async clockOut(note?: string): Promise<HrPunch> {
    await this.requireRemotePunchGrant("out");
    const { from, to } = this.dayRange();
    const todays = await this.listPunches(this.userId, from, to);
    // Domain punch guard throws a user-facing message when nothing is open.
    validateClockOut(todays);
    const { data, error } = await this.client
      .from("hr_punches")
      .insert({
        agency_id: this.agencyId,
        site_id: null,
        staff_id: this.userId,
        kind: "out",
        punched_at: nowIso(),
        source: "hub",
        note: note?.trim() ? note.trim() : null,
        shift_id: null,
      })
      .select()
      .single();
    throwIf(error, "Could not clock out");
    return mapPunch(data as Record<string, unknown>);
  }

  async listPunchCorrections(scope: { staffId?: string }): Promise<HrPunchCorrection[]> {
    // hr_punch_corrections carries no agency_id in the domain contract; RLS
    // scopes rows to the caller's agency.
    let q = this.client
      .from("hr_punch_corrections")
      .select("*")
      .order("requested_at", { ascending: false });
    if (scope.staffId) q = q.eq("staff_id", scope.staffId);
    const { data, error } = await q;
    throwIf(error, "Could not load punch corrections");
    return (data ?? []).map(mapCorrection);
  }

  async requestPunchCorrection(
    punchId: string,
    req: { requestedKind: HrPunchCorrection["requestedKind"]; requestedAt: string; reason: string },
  ): Promise<HrPunchCorrection> {
    const { data, error } = await this.client
      .from("hr_punch_corrections")
      .insert({
        punch_id: punchId,
        staff_id: this.userId,
        requested_kind: req.requestedKind,
        requested_at: req.requestedAt,
        reason: req.reason,
        status: "pending",
      })
      .select()
      .single();
    throwIf(error, "Could not request a punch correction");
    return mapCorrection(data as Record<string, unknown>);
  }

  async decidePunchCorrection(
    id: string,
    approve: boolean,
    reviewNote?: string,
  ): Promise<HrPunchCorrection> {
    const { data, error } = await this.client
      .from("hr_punch_corrections")
      .update({
        status: approve ? "approved" : "denied",
        reviewed_by: this.userId,
        reviewed_at: nowIso(),
        review_note: reviewNote?.trim() ? reviewNote.trim() : null,
      })
      .eq("id", id)
      .select()
      .single();
    throwIf(error, "Could not decide the punch correction");
    return mapCorrection(data as Record<string, unknown>);
  }

  async listPayPeriods(): Promise<HrPayPeriod[]> {
    const { data, error } = await this.client
      .from("hr_pay_periods")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("starts_on", { ascending: false });
    throwIf(error, "Could not load pay periods");
    return (data ?? []).map(mapPeriod);
  }

  async createPayPeriod(startsOn: string, endsOn: string): Promise<HrPayPeriod> {
    const { data, error } = await this.client
      .from("hr_pay_periods")
      .insert({
        agency_id: this.agencyId,
        starts_on: startsOn,
        ends_on: endsOn,
        status: "open",
      })
      .select()
      .single();
    throwIf(error, "Could not create pay period");
    return mapPeriod(data as Record<string, unknown>);
  }

  private async setPeriodStatus(id: string, status: HrPayPeriod["status"]): Promise<HrPayPeriod> {
    const { data, error } = await this.client
      .from("hr_pay_periods")
      .update({
        status,
        locked_by: this.userId,
        locked_at: nowIso(),
      })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update pay period");
    return mapPeriod(data as Record<string, unknown>);
  }

  async lockPayPeriod(id: string): Promise<HrPayPeriod> {
    return this.setPeriodStatus(id, "locked");
  }

  async markPayPeriodExported(id: string): Promise<HrPayPeriod> {
    return this.setPeriodStatus(id, "exported");
  }

  async getTimecardApproval(
    periodId: string,
    staffId: string,
  ): Promise<HrTimecardApproval | null> {
    // hr_timecard_approvals carries no agency_id in the domain contract; RLS
    // scopes rows to the caller's agency.
    const { data, error } = await this.client
      .from("hr_timecard_approvals")
      .select("*")
      .eq("pay_period_id", periodId)
      .eq("staff_id", staffId)
      .maybeSingle();
    throwIf(error, "Could not load timecard approval");
    return data ? mapApproval(data as Record<string, unknown>) : null;
  }

  async submitTimecard(periodId: string): Promise<HrTimecardApproval> {
    const existing = await this.getTimecardApproval(periodId, this.userId);
    if (existing) {
      const { data, error } = await this.client
        .from("hr_timecard_approvals")
        .update({ status: "submitted", submitted_at: nowIso() })
        .eq("id", existing.id)
        .select()
        .single();
      throwIf(error, "Could not submit timecard");
      return mapApproval(data as Record<string, unknown>);
    }
    const { data, error } = await this.client
      .from("hr_timecard_approvals")
      .insert({
        pay_period_id: periodId,
        staff_id: this.userId,
        status: "submitted",
        submitted_at: nowIso(),
      })
      .select()
      .single();
    throwIf(error, "Could not submit timecard");
    return mapApproval(data as Record<string, unknown>);
  }

  async decideTimecard(
    periodId: string,
    staffId: string,
    status: "approved" | "changes_requested",
    note?: string,
  ): Promise<HrTimecardApproval> {
    const existing = await this.getTimecardApproval(periodId, staffId);
    const base = {
      status,
      decided_by: this.userId,
      decided_at: nowIso(),
      note: note?.trim() ? note.trim() : null,
    };
    if (existing) {
      const { data, error } = await this.client
        .from("hr_timecard_approvals")
        .update(base)
        .eq("id", existing.id)
        .select()
        .single();
      throwIf(error, "Could not decide the timecard");
      return mapApproval(data as Record<string, unknown>);
    }
    const { data, error } = await this.client
      .from("hr_timecard_approvals")
      .insert({ pay_period_id: periodId, staff_id: staffId, ...base })
      .select()
      .single();
    throwIf(error, "Could not decide the timecard");
    return mapApproval(data as Record<string, unknown>);
  }

  async listDocuments(): Promise<HrDocument[]> {
    const { data, error } = await this.client
      .from("hr_documents")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("active", true)
      .order("title", { ascending: true });
    throwIf(error, "Could not load HR documents");
    return (data ?? []).map(mapDocument);
  }

  async createDocument(input: HrDocumentInput): Promise<HrDocument> {
    const { data, error } = await this.client
      .from("hr_documents")
      .insert({
        agency_id: this.agencyId,
        title: input.title,
        category: input.category,
        body: input.body,
        file_url: input.fileUrl,
        requires_ack: input.requiresAck,
        active: input.active,
      })
      .select()
      .single();
    throwIf(error, "Could not create document");
    return mapDocument(data as Record<string, unknown>);
  }

  async updateDocument(id: string, patch: Partial<HrDocumentInput>): Promise<HrDocument> {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.body !== undefined) row.body = patch.body;
    if (patch.fileUrl !== undefined) row.file_url = patch.fileUrl;
    if (patch.requiresAck !== undefined) row.requires_ack = patch.requiresAck;
    if (patch.active !== undefined) row.active = patch.active;
    const { data, error } = await this.client
      .from("hr_documents")
      .update(row)
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update document");
    return mapDocument(data as Record<string, unknown>);
  }

  async acknowledgeDocument(docId: string, signatureName: string): Promise<HrDocumentAck> {
    if (!signatureName.trim()) throw new Error("Type your full name to acknowledge.");
    const { data, error } = await this.client
      .from("hr_document_acks")
      .insert({
        doc_id: docId,
        staff_id: this.userId,
        signature_name: signatureName.trim(),
        acked_at: nowIso(),
      })
      .select()
      .single();
    throwIf(error, "Could not record the acknowledgment");
    return mapAck(data as Record<string, unknown>);
  }

  async listDocumentAcks(docId?: string): Promise<HrDocumentAck[]> {
    // hr_document_acks carries no agency_id in the domain contract; RLS
    // scopes rows to the caller's agency.
    let q = this.client
      .from("hr_document_acks")
      .select("*")
      .order("acked_at", { ascending: false });
    if (docId) q = q.eq("doc_id", docId);
    const { data, error } = await q;
    throwIf(error, "Could not load document acknowledgments");
    return (data ?? []).map(mapAck);
  }

  async listTimeOffRequests(scope: { staffId?: string }): Promise<HrTimeOffRequest[]> {
    let q = this.client
      .from("hr_time_off_requests")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("starts_on", { ascending: false });
    if (scope.staffId) q = q.eq("staff_id", scope.staffId);
    const { data, error } = await q;
    throwIf(error, "Could not load time-off requests");
    return (data ?? []).map(mapTimeOff);
  }

  /**
   * Throws a user-facing error when a pto/sick request would exceed the
   * staff member's current leave balance. Unpaid/other kinds skip the check;
   * so does a leave type with no active accrual policy (nothing to check
   * against).
   */
  private async assertTimeOffBalance(
    kind: HrTimeOffRequest["kind"],
    startsOn: string,
    endsOn: string,
    staffId: string,
  ): Promise<void> {
    if (kind !== "pto" && kind !== "sick") return;
    const policies = await this.listAccrualPolicies();
    const policy = policies.find((p) => p.leaveType === kind && p.active);
    if (!policy) return;
    const hours = timeOffRequestHours(startsOn, endsOn);
    const ledger = await this.listLedgerEntries(staffId, { leaveType: kind });
    const balance = currentLeaveBalance(ledger, kind);
    const check = validateTimeOffBalance(hours, balance, kind);
    if (!check.ok) throw new Error(check.errors.join(" "));
  }

  async createTimeOffRequest(input: HrTimeOffRequestInput): Promise<HrTimeOffRequest> {
    await this.assertTimeOffBalance(input.kind, input.startsOn, input.endsOn, this.userId);
    const { data, error } = await this.client
      .from("hr_time_off_requests")
      .insert({
        agency_id: this.agencyId,
        site_id: null,
        staff_id: this.userId,
        kind: input.kind,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        status: "pending",
        reason: input.reason,
      })
      .select()
      .single();
    throwIf(error, "Could not create the time-off request");
    return mapTimeOff(data as Record<string, unknown>);
  }

  async decideTimeOffRequest(
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<HrTimeOffRequest> {
    const { data: existing, error: fetchError } = await this.client
      .from("hr_time_off_requests")
      .select("*")
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(fetchError, "Time-off request not found");
    const prev = mapTimeOff(existing as Record<string, unknown>);
    const { data, error } = await this.client
      .from("hr_time_off_requests")
      .update({
        status: approve ? "approved" : "denied",
        decided_by: this.userId,
        decided_at: nowIso(),
        decision_note: note?.trim() ? note.trim() : null,
      })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not decide the time-off request");
    const decided = mapTimeOff(data as Record<string, unknown>);
    // Ledger integration: approving a pto/sick request debits the balance;
    // reversing an approval posts a restoring adjustment. Guards on the
    // previous status keep repeated decides from double-posting.
    if (prev.kind === "pto" || prev.kind === "sick") {
      const hours = timeOffRequestHours(prev.startsOn, prev.endsOn);
      if (approve && prev.status !== "approved") {
        await this.postLedgerEntry({
          staffId: prev.staffId,
          leaveType: prev.kind,
          used: hours,
          note: `time-off ${prev.id}`,
        });
      } else if (!approve && prev.status === "approved") {
        await this.postLedgerEntry({
          staffId: prev.staffId,
          leaveType: prev.kind,
          adjustment: hours,
          note: `time-off restored ${prev.id}`,
        });
      }
    }
    return decided;
  }

  async listReadinessRequirements(): Promise<HrReadinessRequirement[]> {
    const { data, error } = await this.client
      .from("hr_readiness_requirements")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("active", true)
      .order("label", { ascending: true });
    throwIf(error, "Could not load readiness requirements");
    return (data ?? []).map(mapRequirement);
  }

  async saveReadinessRequirement(input: HrReadinessRequirementInput): Promise<HrReadinessRequirement> {
    const row = {
      agency_id: this.agencyId,
      key: input.key,
      label: input.label,
      kind: input.kind,
      due_every_days: input.dueEveryDays,
      required_role_keys: input.requiredRoleKeys,
      active: input.active,
    };
    if (input.id) {
      const { data, error } = await this.client
        .from("hr_readiness_requirements")
        .update(row)
        .eq("id", input.id)
        .eq("agency_id", this.agencyId)
        .select()
        .single();
      throwIf(error, "Could not save the readiness requirement");
      return mapRequirement(data as Record<string, unknown>);
    }
    const { data, error } = await this.client
      .from("hr_readiness_requirements")
      .insert(row)
      .select()
      .single();
    throwIf(error, "Could not save the readiness requirement");
    return mapRequirement(data as Record<string, unknown>);
  }

  async getComplianceEvidence(staffId: string): Promise<ComplianceEvidence> {
    const evidence: ComplianceEvidence = {
      certs: [],
      trainings: [],
      delegations: [],
      docAcks: [],
    };
    // Certificates: live schema (staff_certificates.user_id, cert_name, expires_on).
    try {
      const { data, error } = await this.client
        .from("staff_certificates")
        .select("cert_name, expires_on")
        .eq("agency_id", this.agencyId)
        .eq("user_id", staffId);
      throwIf(error, "certificates");
      evidence.certs = (data ?? []).map((r: Record<string, unknown>) => ({
        key: String(r.cert_name ?? ""),
        name: String(r.cert_name ?? ""),
        expiresOn: String(r.expires_on ?? ""),
      }));
    } catch {
      // Best effort: evidence stays empty where the schema is unavailable.
    }
    // Trainings: best effort over training_requirements + training_signoffs.
    // Label resolution is unclear in the current schema, so topic_id doubles
    // as the evidence key and label; empty arrays are acceptable here.
    try {
      const { data, error } = await this.client
        .from("training_requirements")
        .select("id, topic_id, status, due_on")
        .eq("agency_id", this.agencyId)
        .eq("user_id", staffId)
        .eq("status", "complete");
      throwIf(error, "trainings");
      const reqs = (data ?? []) as Record<string, unknown>[];
      let signoffs: Record<string, unknown>[] = [];
      if (reqs.length) {
        const ids = reqs.map((r) => String(r.id));
        const so = await this.client
          .from("training_signoffs")
          .select("requirement_id, signed_on, next_due_on")
          .in("requirement_id", ids);
        if (!so.error) signoffs = (so.data ?? []) as Record<string, unknown>[];
      }
      const byReq = new Map(signoffs.map((s) => [String(s.requirement_id), s]));
      evidence.trainings = reqs.map((r) => {
        const so = byReq.get(String(r.id));
        return {
          key: String(r.topic_id ?? ""),
          label: String(r.topic_id ?? ""),
          completedOn: so ? String(so.signed_on ?? "") : "",
          nextDueOn: so
            ? so.next_due_on == null
              ? null
              : String(so.next_due_on)
            : r.due_on == null
              ? null
              : String(r.due_on),
        };
      });
    } catch {
      // Best effort only.
    }
    // Delegations: no delegation-completion table is visible in the schema, so
    // this stays empty until the domain workstream wires it up.
    // Document acknowledgments: join acks to hr_documents for the title key.
    try {
      const { data, error } = await this.client
        .from("hr_document_acks")
        .select("doc_id, acked_at")
        .eq("staff_id", staffId);
      throwIf(error, "acks");
      const acks = (data ?? []) as Record<string, unknown>[];
      const docIds = [...new Set(acks.map((a) => String(a.doc_id)))];
      const titles = new Map<string, string>();
      if (docIds.length) {
        const docs = await this.client
          .from("hr_documents")
          .select("id, title")
          .eq("agency_id", this.agencyId)
          .in("id", docIds);
        if (!docs.error) {
          for (const d of (docs.data ?? []) as Record<string, unknown>[]) {
            titles.set(String(d.id), String(d.title ?? ""));
          }
        }
      }
      evidence.docAcks = acks.map((a) => ({
        docKey: titles.get(String(a.doc_id)) ?? String(a.doc_id),
        ackedAt: String(a.acked_at ?? ""),
      }));
    } catch {
      // Best effort only.
    }
    return evidence;
  }

  /** Best-effort id -> display-name lookup for staffing pattern enrichment. */
  private async lookupDisplayNames(
    table: string,
    nameColumn: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    try {
      const { data, error } = await this.client
        .from(table)
        .select(`id, ${nameColumn}`)
        .in("id", ids);
      if (error || !data) return map;
      const rows = data as unknown as Array<Record<string, unknown>>;
      for (const row of rows) {
        const name = String(row[nameColumn] ?? "").trim();
        if (name) map.set(String(row.id), name);
      }
    } catch {
      // Best effort: rows render without names rather than failing the list.
    }
    return map;
  }

  async listStaffingPatterns(scope: { staffId?: string }): Promise<HrStaffingPattern[]> {
    let q = this.client
      .from("hr_staffing_patterns")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("staff_id", { ascending: true })
      .order("shift_label", { ascending: true });
    if (scope.staffId) q = q.eq("staff_id", scope.staffId);
    const { data, error } = await q;
    throwIf(error, "Could not load staffing patterns");
    const rows = (data ?? []).map(mapStaffingPattern);
    const staffIds = [...new Set(rows.map((p) => p.staffId))];
    const siteIds = [
      ...new Set(rows.map((p) => p.siteId).filter((s): s is string => s !== null)),
    ];
    const individualIds = [
      ...new Set(
        rows.map((p) => p.individualId).filter((s): s is string => s !== null),
      ),
    ];
    const [staffNames, siteNames, individualNames] = await Promise.all([
      this.lookupDisplayNames("profiles", "full_name", staffIds),
      this.lookupDisplayNames("sites", "name", siteIds),
      this.lookupDisplayNames("individuals", "full_name", individualIds),
    ]);
    for (const p of rows) {
      p.staffName = staffNames.get(p.staffId) ?? null;
      p.siteName = p.siteId ? (siteNames.get(p.siteId) ?? null) : null;
      p.individualName = p.individualId ? (individualNames.get(p.individualId) ?? null) : null;
    }
    return rows;
  }

  private staffingRow(input: HrStaffingPatternInput): Record<string, unknown> {
    return {
      agency_id: this.agencyId,
      site_id: input.siteId,
      staff_id: input.staffId,
      individual_id: input.individualId,
      shift_label: input.shiftLabel,
      days: input.days,
      windows: input.windows,
      weekly_hours: input.weeklyHours,
      service_tags: input.serviceTags,
      requires_isd_training: input.requiresIsdTraining,
      on_call: input.onCall,
      notes: input.notes,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo,
      active: input.active,
      created_by: this.userId,
    };
  }

  async createStaffingPattern(input: HrStaffingPatternInput): Promise<HrStaffingPattern> {
    const { data, error } = await this.client
      .from("hr_staffing_patterns")
      .insert(this.staffingRow(input))
      .select()
      .single();
    throwIf(error, "Could not create the staffing pattern");
    return mapStaffingPattern(data as Record<string, unknown>);
  }

  async updateStaffingPattern(
    id: string,
    patch: Partial<HrStaffingPatternInput>,
  ): Promise<HrStaffingPattern> {
    const row: Record<string, unknown> = {};
    if (patch.siteId !== undefined) row.site_id = patch.siteId;
    if (patch.staffId !== undefined) row.staff_id = patch.staffId;
    if (patch.individualId !== undefined) row.individual_id = patch.individualId;
    if (patch.shiftLabel !== undefined) row.shift_label = patch.shiftLabel;
    if (patch.days !== undefined) row.days = patch.days;
    if (patch.windows !== undefined) row.windows = patch.windows;
    if (patch.weeklyHours !== undefined) row.weekly_hours = patch.weeklyHours;
    if (patch.serviceTags !== undefined) row.service_tags = patch.serviceTags;
    if (patch.requiresIsdTraining !== undefined) row.requires_isd_training = patch.requiresIsdTraining;
    if (patch.onCall !== undefined) row.on_call = patch.onCall;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.effectiveFrom !== undefined) row.effective_from = patch.effectiveFrom;
    if (patch.effectiveTo !== undefined) row.effective_to = patch.effectiveTo;
    if (patch.active !== undefined) row.active = patch.active;
    const { data, error } = await this.client
      .from("hr_staffing_patterns")
      .update(row)
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update the staffing pattern");
    return mapStaffingPattern(data as Record<string, unknown>);
  }

  async setStaffingPatternActive(id: string, active: boolean): Promise<void> {
    const { error } = await this.client
      .from("hr_staffing_patterns")
      .update({ active })
      .eq("id", id)
      .eq("agency_id", this.agencyId);
    throwIf(error, "Could not update the staffing pattern");
  }

  /* ------------------------- PTO accrual policies ------------------------- */

  async listAccrualPolicies(): Promise<HrAccrualPolicy[]> {
    const { data, error } = await this.client
      .from("hr_accrual_policies")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("leave_type", { ascending: true })
      .order("effective_from", { ascending: false });
    throwIf(error, "Could not load accrual policies");
    return (data ?? []).map(mapAccrualPolicy);
  }

  private accrualPolicyRow(input: AccrualPolicyInput): Record<string, unknown> {
    return {
      agency_id: this.agencyId,
      leave_type: input.leaveType,
      tenure_bands: input.tenureBands,
      carryover_cap_hours: input.carryoverCapHours,
      carryover_basis: input.carryoverBasis,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo,
      active: true,
      created_by: this.userId,
    };
  }

  async createAccrualPolicy(input: AccrualPolicyInput): Promise<HrAccrualPolicy> {
    const problems = validateAccrualPolicy(input);
    if (problems.length > 0) throw new Error(problems.join(" "));
    const { data, error } = await this.client
      .from("hr_accrual_policies")
      .insert(this.accrualPolicyRow(input))
      .select()
      .single();
    throwIf(error, "Could not create the accrual policy");
    return mapAccrualPolicy(data as Record<string, unknown>);
  }

  async updateAccrualPolicy(
    id: string,
    patch: Partial<AccrualPolicyInput>,
  ): Promise<HrAccrualPolicy> {
    // Validate the merged policy, not just the patch.
    const { data: existing, error: fetchError } = await this.client
      .from("hr_accrual_policies")
      .select("*")
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(fetchError, "Accrual policy not found");
    const merged = { ...mapAccrualPolicy(existing as Record<string, unknown>), ...patch };
    const problems = validateAccrualPolicy(merged);
    if (problems.length > 0) throw new Error(problems.join(" "));
    const row: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.leaveType !== undefined) row.leave_type = patch.leaveType;
    if (patch.tenureBands !== undefined) row.tenure_bands = patch.tenureBands;
    if (patch.carryoverCapHours !== undefined) row.carryover_cap_hours = patch.carryoverCapHours;
    if (patch.carryoverBasis !== undefined) row.carryover_basis = patch.carryoverBasis;
    if (patch.effectiveFrom !== undefined) row.effective_from = patch.effectiveFrom;
    if (patch.effectiveTo !== undefined) row.effective_to = patch.effectiveTo;
    const { data, error } = await this.client
      .from("hr_accrual_policies")
      .update(row)
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update the accrual policy");
    return mapAccrualPolicy(data as Record<string, unknown>);
  }

  async setAccrualPolicyActive(id: string, active: boolean): Promise<HrAccrualPolicy> {
    const { data, error } = await this.client
      .from("hr_accrual_policies")
      .update({ active, updated_at: nowIso() })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not update the accrual policy");
    return mapAccrualPolicy(data as Record<string, unknown>);
  }

  /* ------------------------------ Leave ledger --------------------------- */

  async listLedgerEntries(
    staffId: string,
    opts: { leaveType?: LeaveType } = {},
  ): Promise<HrAccrualLedgerEntry[]> {
    let q = this.client
      .from("hr_accrual_ledger")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("staff_id", staffId)
      .order("period_start", { ascending: true })
      .order("created_at", { ascending: true });
    if (opts.leaveType) q = q.eq("leave_type", opts.leaveType);
    const { data, error } = await q;
    throwIf(error, "Could not load the leave ledger");
    return (data ?? []).map(mapLedgerEntry);
  }

  async postLedgerEntry(input: LedgerEntryInput): Promise<HrAccrualLedgerEntry> {
    const existing = await this.listLedgerEntries(input.staffId, {
      leaveType: input.leaveType,
    });
    const balance =
      currentLeaveBalance(existing, input.leaveType) +
      (input.accrued ?? 0) -
      (input.used ?? 0) +
      (input.adjustment ?? 0);
    const { data, error } = await this.client
      .from("hr_accrual_ledger")
      .insert({
        agency_id: this.agencyId,
        staff_id: input.staffId,
        pay_period_id: input.payPeriodId ?? null,
        period_start: input.periodStart ?? todayStamp(),
        leave_type: input.leaveType,
        accrued: input.accrued ?? 0,
        used: input.used ?? 0,
        adjustment: input.adjustment ?? 0,
        balance,
        note: input.note ?? null,
      })
      .select()
      .single();
    throwIf(error, "Could not post the ledger entry");
    return mapLedgerEntry(data as Record<string, unknown>);
  }

  /* ----------------------------- Overtime rules --------------------------- */

  async getOvertimeRules(): Promise<HrOvertimeRules> {
    const { data, error } = await this.client
      .from("hr_overtime_rules")
      .select("*")
      .eq("agency_id", this.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load overtime rules");
    if (!data) {
      return {
        ...DEFAULT_OVERTIME_RULES,
        agencyId: this.agencyId,
        updatedBy: null,
        updatedAt: nowIso(),
      };
    }
    return mapOvertimeRules(data as Record<string, unknown>, this.agencyId);
  }

  async saveOvertimeRules(input: OvertimeRulesInput): Promise<HrOvertimeRules> {
    if (!(input.weeklyThresholdHours > 0)) {
      throw new Error("Weekly overtime threshold must be above 0 hours.");
    }
    if (input.dailyThresholdHours !== null && !(input.dailyThresholdHours > 0)) {
      throw new Error("Daily overtime threshold must be above 0 hours.");
    }
    if (!(input.seventhDayThresholdHours >= 0)) {
      throw new Error("Seventh-day overtime threshold cannot be negative.");
    }
    const { data, error } = await this.client
      .from("hr_overtime_rules")
      .upsert(
        {
          agency_id: this.agencyId,
          weekly_threshold_hours: input.weeklyThresholdHours,
          daily_threshold_hours: input.dailyThresholdHours,
          seventh_consecutive_day: input.seventhConsecutiveDay,
          seventh_day_threshold_hours: input.seventhDayThresholdHours,
          updated_by: this.userId,
          updated_at: nowIso(),
        },
        { onConflict: "agency_id" },
      )
      .select()
      .single();
    throwIf(error, "Could not save overtime rules");
    return mapOvertimeRules(data as Record<string, unknown>, this.agencyId);
  }

  /* ------------------------------- Shift swaps --------------------------- */

  private async getSwap(id: string): Promise<HrShiftSwap> {
    const { data, error } = await this.client
      .from("hr_shift_swaps")
      .select("*")
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(error, "Shift swap not found");
    return mapShiftSwap(data as Record<string, unknown>);
  }

  private async getShiftById(id: string): Promise<HrShift> {
    const { data, error } = await this.client
      .from("hr_shifts")
      .select("*")
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(error, "Shift not found");
    return mapShift(data as Record<string, unknown>);
  }

  /** One staffer's shifts that could overlap [startsAt, endsAt). */
  private async shiftsOverlappingWindow(
    staffId: string,
    startsAt: string,
    endsAt: string,
  ): Promise<HrShift[]> {
    const { data, error } = await this.client
      .from("hr_shifts")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("staff_id", staffId)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt);
    throwIf(error, "Could not load shifts for swap validation");
    return (data ?? []).map(mapShift);
  }

  async listShiftSwaps(
    scope: { staffId?: string; status?: ShiftSwapStatus } = {},
  ): Promise<HrShiftSwap[]> {
    let q = this.client
      .from("hr_shift_swaps")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("created_at", { ascending: false });
    if (scope.staffId) {
      q = q.or(`requester_id.eq.${scope.staffId},target_staff_id.eq.${scope.staffId}`);
    }
    if (scope.status) q = q.eq("status", scope.status);
    const { data, error } = await q;
    throwIf(error, "Could not load shift swaps");
    return (data ?? []).map(mapShiftSwap);
  }

  async createShiftSwap(input: ShiftSwapInput): Promise<HrShiftSwap> {
    const offered = await this.getShiftById(input.offeredShiftId);
    const targetId = input.targetStaffId ?? null;
    if (targetId !== null && targetId === this.userId) {
      throw new Error("You can't offer a shift swap to yourself.");
    }
    const claimerShifts = targetId
      ? await this.shiftsOverlappingWindow(targetId, offered.startsAt, offered.endsAt)
      : [];
    let claimedShift: HrShift | null = null;
    if (input.requestedShiftId) {
      claimedShift = await this.getShiftById(input.requestedShiftId);
    }
    const requesterShifts = claimedShift
      ? await this.shiftsOverlappingWindow(
          this.userId,
          claimedShift.startsAt,
          claimedShift.endsAt,
        )
      : [];
    const problems = validateShiftSwap({
      offeredShift: offered,
      requesterId: this.userId,
      requesterShifts,
      claimerId: targetId ?? "unclaimed",
      claimerShifts,
      claimedShift,
      nowIso: nowIso(),
    });
    if (problems.length > 0) throw new Error(problems.join(" "));
    const { data, error } = await this.client
      .from("hr_shift_swaps")
      .insert({
        agency_id: this.agencyId,
        requester_id: this.userId,
        offered_shift_id: input.offeredShiftId,
        requested_shift_id: input.requestedShiftId ?? null,
        target_staff_id: targetId,
        status: "pending",
      })
      .select()
      .single();
    throwIf(error, "Could not create the shift swap");
    return mapShiftSwap(data as Record<string, unknown>);
  }

  async claimShiftSwap(
    id: string,
    claimerId: string,
    counterOfferShiftId?: string,
  ): Promise<HrShiftSwap> {
    const swap = await this.getSwap(id);
    if (swap.status !== "pending") {
      throw new Error("This shift swap is no longer open.");
    }
    if (claimerId === swap.requesterId) {
      throw new Error("You can't claim your own shift-swap posting.");
    }
    if (swap.targetStaffId !== null && swap.targetStaffId !== claimerId) {
      throw new Error("This shift was offered to someone else.");
    }
    const offered = await this.getShiftById(swap.offeredShiftId);
    const claimerShifts = await this.shiftsOverlappingWindow(
      claimerId,
      offered.startsAt,
      offered.endsAt,
    );
    let claimedShift: HrShift | null = null;
    if (counterOfferShiftId) {
      claimedShift = await this.getShiftById(counterOfferShiftId);
      if (claimedShift.staffId !== claimerId) {
        throw new Error("The counter-offered shift isn't assigned to you.");
      }
    } else if (swap.requestedShiftId) {
      claimedShift = await this.getShiftById(swap.requestedShiftId);
    }
    const requesterShifts = claimedShift
      ? await this.shiftsOverlappingWindow(
          swap.requesterId,
          claimedShift.startsAt,
          claimedShift.endsAt,
        )
      : [];
    const problems = validateShiftSwap({
      offeredShift: offered,
      requesterId: swap.requesterId,
      requesterShifts,
      claimerId,
      claimerShifts,
      claimedShift,
      nowIso: nowIso(),
    });
    if (problems.length > 0) throw new Error(problems.join(" "));
    const row: Record<string, unknown> = {
      target_staff_id: claimerId,
      updated_at: nowIso(),
    };
    if (counterOfferShiftId) row.requested_shift_id = counterOfferShiftId;
    const { data, error } = await this.client
      .from("hr_shift_swaps")
      .update(row)
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not claim the shift swap");
    return mapShiftSwap(data as Record<string, unknown>);
  }

  async decideShiftSwap(
    id: string,
    approve: boolean,
    decidedBy: string,
    note?: string,
  ): Promise<HrShiftSwap> {
    const swap = await this.getSwap(id);
    if (swap.status !== "pending") {
      throw new Error("This shift swap has already been decided.");
    }
    if (approve) {
      // Reassign through the existing shift-update path.
      if (swap.requestedShiftId) {
        if (!swap.targetStaffId) {
          throw new Error("This swap has no one to assign the shift to.");
        }
        await this.updateShift(swap.offeredShiftId, { staffId: swap.targetStaffId });
        await this.updateShift(swap.requestedShiftId, { staffId: swap.requesterId });
      } else {
        if (!swap.targetStaffId) {
          throw new Error("This swap has no one to assign the shift to.");
        }
        await this.updateShift(swap.offeredShiftId, { staffId: swap.targetStaffId });
      }
    }
    const now = nowIso();
    const { data, error } = await this.client
      .from("hr_shift_swaps")
      .update({
        status: approve ? "approved" : "denied",
        decided_by: decidedBy,
        decided_at: now,
        decision_note: note?.trim() ? note.trim() : null,
        updated_at: now,
      })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not decide the shift swap");
    return mapShiftSwap(data as Record<string, unknown>);
  }

  async cancelShiftSwap(id: string): Promise<HrShiftSwap> {
    const swap = await this.getSwap(id);
    if (swap.status !== "pending") {
      throw new Error("Only a pending swap can be cancelled.");
    }
    const { data, error } = await this.client
      .from("hr_shift_swaps")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not cancel the shift swap");
    return mapShiftSwap(data as Record<string, unknown>);
  }

  /* ------------------------- kiosk time clock (Worker 3) ------------------ */
  /*
   * RLS NOTES (Worker 1's migration 20260916140000_hr_kiosk_timeclock):
   * - verify_kiosk_pin and resolve_kiosk_token are SECURITY DEFINER and
   *   granted to anon + authenticated; they are the ONLY data paths an
   *   unauthenticated kiosk device has (anon has no table policies).
   * - Token-hash/site lookups run inside resolve_kiosk_token; the store never
   *   sends or receives token hashes or raw tokens except the one-time raw
   *   token returned by generateKioskToken/rotateKioskToken.
   * - submitKioskPunch calls the SECURITY DEFINER RPC submit_kiosk_punch
   *   (migration 20260916140001_hr_kiosk_token_resolve) — never a direct
   *   insert. The RPC hashes the token server-side, requires an active
   *   token, stamps verification_method='kiosk_pin' (any client method is
   *   ignored), and the stamp_punch_remote trigger derives remote=false.
   *   The punch id returned by the RPC is read back for the caller.
   * - Known integration gaps (Worker 1/coordinator to resolve; the store
   *   attempts the documented writes and lets RLS enforce):
   *   1. decideMissedPunchReport (approve): the migration says the app
   *      inserts the punch rows AND writes hr_punch_corrections ledger
   *      entries, but hr_punches_insert AND hr_punch_corrections_insert both
   *      require staff_id = auth.uid() — a manager approving someone else's
   *      report is blocked by RLS. Needs a definer RPC or policy exception.
   *   2. reportMissedPunch: hr_missed_punch_reports_insert requires
   *      staff_id = auth.uid(); a manager cannot file for another staffer.
   */

  async verifyKioskPin(
    rawToken: string,
    employeeId: string,
    pin: string,
  ): Promise<KioskVerifyResult> {
    // The raw token is hashed INSIDE the definer RPC; token hashes never
    // leave the database. The RPC deliberately returns no site fields.
    const { data, error } = await this.client.rpc("verify_kiosk_pin", {
      p_token: rawToken,
      p_employee_id: employeeId.trim(),
      p_pin: pin,
    });
    throwIf(error, "Could not verify kiosk PIN");
    return mapVerifyResult((data ?? {}) as VerifyKioskPinRow);
  }

  async resolveKioskToken(rawToken: string): Promise<KioskSite> {
    // Companion definer RPC (20260916140001_hr_kiosk_token_resolve): the raw
    // token is hashed inside the function and the response carries only
    // site/agency fields — never hashes, never staff data.
    const { data, error } = await this.client.rpc("resolve_kiosk_token", {
      p_token: rawToken,
    });
    throwIf(error, "Could not resolve kiosk token");
    const row = (data ?? {}) as {
      ok?: boolean;
      site_id?: string | null;
      site_name?: string | null;
      agency_id?: string | null;
    };
    if (!row.ok || row.site_id == null) {
      throw new Error("Invalid kiosk token.");
    }
    return {
      siteId: String(row.site_id),
      siteName: String(row.site_name ?? ""),
      agencyId: String(row.agency_id ?? this.agencyId),
    };
  }

  private kioskDayRange(punchedAt: string): { from: string; to: string } {
    const d = new Date(punchedAt);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid punch time.");
    const stamp = todayStamp(d);
    return { from: `${stamp}T00:00:00`, to: `${stamp}T23:59:59.999` };
  }

  async submitKioskPunch(
    token: string,
    input: KioskPunchInput,
  ): Promise<HrPunch> {
    // The RPC is the ONLY punch-writing path for kiosk devices (anon has no
    // table policies). verification_method is stamped 'kiosk_pin'
    // server-side; no client method is accepted or sent.
    const { from, to } = this.kioskDayRange(input.punchedAt);
    const todays = await this.listPunches(input.staffId, from, to);
    guardKioskPunch(todays, input.kind, input.punchedAt);
    const { data, error } = await this.client.rpc(
      "submit_kiosk_punch",
      buildSubmitKioskPunchParams(token, input),
    );
    throwIf(error, "Could not submit kiosk punch");
    const punchId = String(data);
    // The definer RPC returns only the new punch id; read the row back so
    // the caller gets the full HrPunch (verificationMethod, remote, ...).
    // A sessionless kiosk device may be RLS-blocked from the read — then
    // synthesize the row from what the RPC guarantees.
    const { data: row, error: fetchError } = await this.client
      .from("hr_punches")
      .select("*")
      .eq("id", punchId)
      .maybeSingle();
    if (fetchError) {
      throw new Error(`Could not read the submitted punch: ${fetchError.message}`);
    }
    if (row) return mapPunch(row as Record<string, unknown>);
    return {
      id: punchId,
      agencyId: this.agencyId,
      siteId: null,
      staffId: input.staffId,
      kind: input.kind,
      punchedAt: input.punchedAt,
      source: "kiosk",
      note: input.note?.trim() ? input.note.trim() : null,
      shiftId: input.shiftId ?? null,
      serviceType:
        input.serviceType?.trim() ? input.serviceType.trim() : null,
      individualId: input.individualId ?? null,
      verificationMethod: "kiosk_pin",
      offline: input.offline,
      remote: false,
    };
  }

  /* ----------------- hub.remote_punch grants (Worker 1) ------------------ */
  /*
   * Per-staff permission grants (hr_staff_permission_grants): the grant is
   * what lets a staffer punch from a personal device instead of the house
   * kiosk. Writes need hub.manage_pay_settings (RLS); the staffer can read
   * their own row. Revocation is a soft delete (revoked_at), never a delete.
   */

  private mapRemoteGrant(
    r: Record<string, unknown>,
    employeeIdNumber: string | null,
  ): RemotePunchGrant {
    return {
      staffId: String(r.staff_id),
      grantedBy: r.granted_by == null ? null : String(r.granted_by),
      grantedAt: String(r.granted_at),
      employeeIdNumber,
    };
  }

  /** staffer -> employee ID number, from clock credentials (best effort). */
  private async remoteGrantIdNumbers(
    staffIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!staffIds.length) return map;
    const { data, error } = await this.client
      .from("hr_clock_credentials")
      .select("staff_id, employee_id_number")
      .eq("agency_id", this.agencyId)
      .in("staff_id", staffIds);
    if (error || !data) return map;
    for (const r of data as Record<string, unknown>[]) {
      map.set(String(r.staff_id), String(r.employee_id_number ?? ""));
    }
    return map;
  }

  async hasRemotePunch(staffId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("hr_staff_permission_grants")
      .select("id")
      .eq("agency_id", this.agencyId)
      .eq("staff_id", staffId)
      .eq("permission_key", "hub.remote_punch")
      .is("revoked_at", null)
      .maybeSingle();
    throwIf(error, "Could not check remote-punch access");
    return data != null;
  }

  async grantRemotePunch(
    staffId: string,
    grantedBy?: string,
  ): Promise<RemotePunchGrant> {
    const existing = await this.listRemotePunchGrants();
    const hit = existing.find((g) => g.staffId === staffId);
    if (hit) return hit;
    const { data, error } = await this.client
      .from("hr_staff_permission_grants")
      .insert({
        agency_id: this.agencyId,
        staff_id: staffId,
        permission_key: "hub.remote_punch",
        granted_by: grantedBy ?? this.userId,
      })
      .select()
      .single();
    throwIf(error, "Could not grant remote punching");
    const row = data as Record<string, unknown>;
    const ids = await this.remoteGrantIdNumbers([staffId]);
    return this.mapRemoteGrant(row, ids.get(staffId) ?? null);
  }

  async revokeRemotePunch(staffId: string): Promise<void> {
    const { error } = await this.client
      .from("hr_staff_permission_grants")
      .update({ revoked_at: nowIso(), revoked_by: this.userId })
      .eq("agency_id", this.agencyId)
      .eq("staff_id", staffId)
      .eq("permission_key", "hub.remote_punch")
      .is("revoked_at", null);
    throwIf(error, "Could not revoke remote punching");
  }

  async listRemotePunchGrants(): Promise<RemotePunchGrant[]> {
    const { data, error } = await this.client
      .from("hr_staff_permission_grants")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("permission_key", "hub.remote_punch")
      .is("revoked_at", null)
      .order("granted_at", { ascending: false });
    throwIf(error, "Could not load remote-punch grants");
    const rows = (data ?? []) as Record<string, unknown>[];
    const ids = await this.remoteGrantIdNumbers(
      rows.map((r) => String(r.staff_id)),
    );
    return rows.map((r) =>
      this.mapRemoteGrant(r, ids.get(String(r.staff_id)) ?? null),
    );
  }

  async suggestKioskShift(
    staffId: string,
    siteId: string,
  ): Promise<KioskShiftSuggestion | null> {
    const now = new Date();
    const stamp = todayStamp(now);
    const shifts = await this.listShifts(
      `${stamp}T00:00:00`,
      `${stamp}T23:59:59.999`,
      siteId,
    );
    const mine = shifts
      .filter((s) => s.staffId === staffId)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0];
    if (mine) {
      return {
        shiftLabel: mine.title,
        serviceType: null,
        individualId: null,
        individualName: null,
      };
    }
    const patterns = await this.listStaffingPatterns({ staffId });
    const weekday = now.getDay();
    const pattern = patterns.find(
      (p) =>
        p.active &&
        p.siteId === siteId &&
        p.days.includes(weekday) &&
        p.effectiveFrom <= stamp &&
        (p.effectiveTo == null || p.effectiveTo >= stamp),
    );
    if (!pattern) return null;
    return {
      shiftLabel: pattern.shiftLabel ?? "Scheduled shift",
      serviceType: pattern.serviceTags[0] ?? null,
      individualId: pattern.individualId,
      individualName: pattern.individualName ?? null,
    };
  }

  async listKioskTokens(siteId?: string): Promise<HrKioskToken[]> {
    let q = this.client
      .from("hr_kiosk_tokens")
      .select(
        "id, agency_id, site_id, label, active, created_by, created_at, last_used_at, revoked_at",
      )
      .eq("agency_id", this.agencyId)
      .eq("active", true)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    throwIf(error, "Could not load kiosk tokens");
    return (data ?? []).map((r) => mapKioskToken(r as Record<string, unknown>));
  }

  async generateKioskToken(
    siteId: string,
    label: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }> {
    // Raw token is generated client-side (32 random bytes hex); only its
    // sha256 hex is stored. The raw token is returned once for the admin to
    // enter on the kiosk device.
    const rawToken = randomTokenHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const { data, error } = await this.client
      .from("hr_kiosk_tokens")
      .insert({
        agency_id: this.agencyId,
        site_id: siteId,
        label: label.trim() ? label.trim() : null,
        token_hash: tokenHash,
        active: true,
        created_by: this.userId,
      })
      .select(
        "id, agency_id, site_id, label, active, created_by, created_at, last_used_at, revoked_at",
      )
      .single();
    throwIf(error, "Could not generate kiosk token");
    return {
      token: mapKioskToken(data as Record<string, unknown>),
      rawToken,
    };
  }

  async revokeKioskToken(id: string): Promise<void> {
    const { error } = await this.client
      .from("hr_kiosk_tokens")
      .update({ revoked_at: nowIso(), active: false })
      .eq("id", id)
      .eq("agency_id", this.agencyId);
    throwIf(error, "Could not revoke kiosk token");
  }

  async rotateKioskToken(
    id: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }> {
    const { data, error } = await this.client
      .from("hr_kiosk_tokens")
      .select(
        "id, agency_id, site_id, label, active, created_by, created_at, last_used_at, revoked_at",
      )
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(error, "Could not load kiosk token");
    const current = mapKioskToken(data as Record<string, unknown>);
    if (!current.active || current.revokedAt) {
      throw new Error("This token is already revoked.");
    }
    await this.revokeKioskToken(id);
    return this.generateKioskToken(
      current.siteId,
      current.label ? `${current.label} (rotated ${todayStamp()})` : "",
    );
  }

  async issueClockCredential(
    staffId: string,
    employeeIdNumber: string,
    pin: string,
  ): Promise<HrClockCredential> {
    assertPinFormat(pin);
    if (!employeeIdNumber.trim()) {
      throw new Error("An employee ID number is required.");
    }
    // bcrypt client-side (cost 10): the plaintext PIN never leaves the
    // browser; the DB stores only pin_hash.
    const pinHash = await bcrypt.hash(pin, 10);
    const { data, error } = await this.client
      .from("hr_clock_credentials")
      .insert({
        agency_id: this.agencyId,
        staff_id: staffId,
        employee_id_number: employeeIdNumber.trim(),
        pin_hash: pinHash,
        pin_updated_at: nowIso(),
        updated_by: this.userId,
      })
      .select(CREDENTIAL_SAFE_COLUMNS)
      .single();
    throwIf(error, "Could not issue clock credential");
    return mapCredential(data as Record<string, unknown>);
  }

  async resetClockPin(
    staffId: string,
    newPin: string,
  ): Promise<HrClockCredential> {
    assertPinFormat(newPin);
    const pinHash = await bcrypt.hash(newPin, 10);
    const { data, error } = await this.client
      .from("hr_clock_credentials")
      .update({
        pin_hash: pinHash,
        pin_updated_at: nowIso(),
        failed_attempts: 0,
        locked_until: null,
        updated_by: this.userId,
      })
      .eq("staff_id", staffId)
      .eq("agency_id", this.agencyId)
      .select(CREDENTIAL_SAFE_COLUMNS)
      .single();
    throwIf(error, "Could not reset the PIN");
    return mapCredential(data as Record<string, unknown>);
  }

  async listClockCredentials(): Promise<HrClockCredential[]> {
    const { data, error } = await this.client
      .from("hr_clock_credentials")
      .select(CREDENTIAL_SAFE_COLUMNS)
      .eq("agency_id", this.agencyId)
      .order("staff_id", { ascending: true });
    throwIf(error, "Could not load clock credentials");
    return (data ?? []).map((r) =>
      mapCredential(r as Record<string, unknown>),
    );
  }

  async unlockCredential(staffId: string): Promise<HrClockCredential> {
    const { data, error } = await this.client
      .from("hr_clock_credentials")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("staff_id", staffId)
      .eq("agency_id", this.agencyId)
      .select(CREDENTIAL_SAFE_COLUMNS)
      .single();
    throwIf(error, "Could not unlock the credential");
    return mapCredential(data as Record<string, unknown>);
  }

  private async listSitePunchesToday(
    siteId: string,
  ): Promise<Record<string, unknown>[]> {
    const stamp = todayStamp();
    const { data, error } = await this.client
      .from("hr_punches")
      .select("*")
      .eq("agency_id", this.agencyId)
      .eq("site_id", siteId)
      .gte("punched_at", `${stamp}T00:00:00`)
      .order("punched_at", { ascending: true });
    throwIf(error, "Could not load site punches");
    return (data ?? []) as Record<string, unknown>[];
  }

  async listOpenPunches(siteId: string): Promise<HrPunch[]> {
    const rows = await this.listSitePunchesToday(siteId);
    const byStaff = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const sid = String(r.staff_id);
      const list = byStaff.get(sid) ?? [];
      list.push(r);
      byStaff.set(sid, list);
    }
    const open: HrPunch[] = [];
    for (const staffRows of byStaff.values()) {
      const guards: GuardPunch[] = staffRows.map((r) => ({
        kind: r.kind as HrPunch["kind"],
        punchedAt: String(r.punched_at),
      }));
      if (!kioskSessionOpen(guards)) continue;
      const lastIn = [...staffRows]
        .filter((r) => r.kind === "in")
        .sort((a, b) => (String(a.punched_at) < String(b.punched_at) ? -1 : 1))
        .pop();
      if (lastIn) open.push(mapPunch(lastIn));
    }
    return open.sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1));
  }

  async listMissedPunchReports(scope?: {
    staffId?: string;
    siteId?: string;
    status?: HrMissedPunchReport["status"];
  }): Promise<HrMissedPunchReport[]> {
    let q = this.client
      .from("hr_missed_punch_reports")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (scope?.staffId) q = q.eq("staff_id", scope.staffId);
    if (scope?.siteId) q = q.eq("site_id", scope.siteId);
    if (scope?.status) q = q.eq("status", scope.status);
    const { data, error } = await q;
    throwIf(error, "Could not load missed-punch reports");
    return (data ?? []).map((r) =>
      mapMissedReport(r as Record<string, unknown>),
    );
  }

  async reportMissedPunch(
    input: MissedPunchReportInput,
  ): Promise<HrMissedPunchReport> {
    validateMissedPunchInput(input);
    // RLS note: staff file their own reports (staff_id = auth.uid()).
    const { data, error } = await this.client
      .from("hr_missed_punch_reports")
      .insert({
        agency_id: this.agencyId,
        staff_id: input.staffId,
        site_id: input.siteId ?? null,
        work_date: input.workDate,
        claimed_in_at: input.claimedInAt ?? null,
        claimed_out_at: input.claimedOutAt ?? null,
        reason: input.reason.trim(),
        status: "pending",
      })
      .select()
      .single();
    throwIf(error, "Could not file the missed-punch report");
    return mapMissedReport(data as Record<string, unknown>);
  }

  async decideMissedPunchReport(
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<HrMissedPunchReport> {
    const { data: existing, error: fetchError } = await this.client
      .from("hr_missed_punch_reports")
      .select("*")
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .single();
    throwIf(fetchError, "Could not load the missed-punch report");
    const report = mapMissedReport(existing as Record<string, unknown>);
    if (report.status !== "pending") {
      throw new Error("This report has already been decided.");
    }
    const decidedAt = nowIso();
    const reviewNote = note?.trim() ? note.trim() : null;
    if (approve) {
      // Correction ledger: the actual punch rows (source = 'correction'),
      // one per claimed time. NOTE: RLS on hr_punches/hr_punch_corrections
      // requires staff_id = auth.uid(); see the integration-gap note above.
      const claimed: Array<{ kind: "in" | "out"; at: string }> = [];
      if (report.claimedInAt) claimed.push({ kind: "in", at: report.claimedInAt });
      if (report.claimedOutAt)
        claimed.push({ kind: "out", at: report.claimedOutAt });
      for (const c of claimed) {
        const { data: punchRow, error: punchError } = await this.client
          .from("hr_punches")
          .insert({
            agency_id: this.agencyId,
            site_id: report.siteId,
            staff_id: report.staffId,
            kind: c.kind,
            punched_at: c.at,
            source: "correction",
            verification_method: "web",
            note: `Missed-punch report approved${
              reviewNote ? `: ${reviewNote}` : ""
            }`,
            shift_id: null,
            created_by: this.userId,
          })
          .select("id")
          .single();
        throwIf(punchError, "Could not write the correction punch");
        const { error: correctionError } = await this.client
          .from("hr_punch_corrections")
          .insert({
            punch_id: String((punchRow as { id: unknown }).id),
            staff_id: report.staffId,
            requested_kind: c.kind,
            requested_at: c.at,
            reason: report.reason,
            status: "approved",
            reviewed_by: this.userId,
            reviewed_at: decidedAt,
            review_note: reviewNote,
          });
        throwIf(correctionError, "Could not write the correction ledger");
      }
    }
    const { data, error } = await this.client
      .from("hr_missed_punch_reports")
      .update({
        status: approve ? "approved" : "denied",
        reviewed_by: this.userId,
        reviewed_at: decidedAt,
        review_note: reviewNote,
      })
      .eq("id", id)
      .eq("agency_id", this.agencyId)
      .select()
      .single();
    throwIf(error, "Could not decide the missed-punch report");
    return mapMissedReport(data as Record<string, unknown>);
  }

  async getPunchRules(): Promise<HrPunchRules> {
    const { data, error } = await this.client
      .from("hr_punch_rules")
      .select("*")
      .eq("agency_id", this.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load punch rules");
    return data
      ? mapPunchRules(data as Record<string, unknown>, this.agencyId)
      : defaultPunchRules(this.agencyId);
  }

  async savePunchRules(
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
  ): Promise<HrPunchRules> {
    assertPunchRulesPatch(patch);
    const current = await this.getPunchRules();
    const merged: HrPunchRules = {
      ...current,
      ...patch,
      agencyId: this.agencyId,
      updatedBy: this.userId,
      updatedAt: nowIso(),
    };
    const { data, error } = await this.client
      .from("hr_punch_rules")
      .upsert(
        {
          agency_id: this.agencyId,
          rounding_minutes: merged.roundingMinutes,
          rounding_applies: merged.roundingApplies,
          grace_minutes: merged.graceMinutes,
          auto_clockout_buffer_minutes: merged.autoClockoutBufferMinutes,
          auto_approval_score_threshold: merged.autoApprovalScoreThreshold,
          updated_by: merged.updatedBy,
          updated_at: merged.updatedAt,
        },
        { onConflict: "agency_id" },
      )
      .select()
      .single();
    throwIf(error, "Could not save punch rules");
    return mapPunchRules(data as Record<string, unknown>, this.agencyId);
  }
}

/* ------------------------ localStorage implementation -------------------- */

const LOCAL_KEY = "complyrer.hr.v1";

interface LocalBucket {
  shifts: HrShift[];
  punches: HrPunch[];
  corrections: HrPunchCorrection[];
  periods: HrPayPeriod[];
  approvals: HrTimecardApproval[];
  documents: HrDocument[];
  acks: HrDocumentAck[];
  timeOff: HrTimeOffRequest[];
  requirements: HrReadinessRequirement[];
  patterns: HrStaffingPattern[];
  /** True once the Evergreen demo seed has been written (so a user who clears all patterns doesn't get them back). */
  staffingSeeded?: boolean;
  /* HR-PHASE2 */
  policies: HrAccrualPolicy[];
  ledger: HrAccrualLedgerEntry[];
  overtimeRules: HrOvertimeRules | null;
  swaps: HrShiftSwap[];
  /* Kiosk time clock (Worker 3) */
  kioskTokens: LocalKioskTokenRow[];
  credentials: LocalCredentialRow[];
  missedReports: HrMissedPunchReport[];
  punchRules: HrPunchRules | null;
  /** True once the kiosk test seed has been written (tests only). */
  kioskTestSeeded?: boolean;
  /* hub.remote_punch grants: active + revoked rows (revocation is soft). */
  remoteGrants: LocalGrantRow[];
}

/** Local hub.remote_punch grant row (mirrors hr_staff_permission_grants). */
interface LocalGrantRow {
  staffId: string;
  permissionKey: string;
  grantedBy: string | null;
  grantedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** Local kiosk token row: metadata + the sha256 hex of the raw token. */
interface LocalKioskTokenRow extends HrKioskToken {
  tokenHash: string;
  /** Display hint for the seeded site; not a DB column. */
  siteName?: string;
}

/** Local credential row: safe fields + the bcrypt PIN hash (never exposed). */
interface LocalCredentialRow extends HrClockCredential {
  /** Display hint; not a DB column. */
  displayName?: string;
  /** bcrypt hash — never exposed through any method. */
  pinHash: string;
}

function emptyBucket(): LocalBucket {
  return {
    shifts: [],
    punches: [],
    corrections: [],
    periods: [],
    approvals: [],
    documents: [],
    acks: [],
    timeOff: [],
    requirements: [],
    patterns: [],
    policies: [],
    ledger: [],
    overtimeRules: null,
    swaps: [],
    kioskTokens: [],
    credentials: [],
    missedReports: [],
    punchRules: null,
    remoteGrants: [],
  };
}

/* ------------------------- demo staffing seed (local) ---------------------- */
/* Fictional staffing patterns for the Evergreen demo agency, localStorage
 * only. Every row is clearly fictional (Demo Staff N, Demo Client A.., Demo
 * House North/South, notes prefixed "DEMO — ") and never uses real names or
 * phone numbers. */

function seedDemoStaffingPatterns(): HrStaffingPattern[] {
  const demoId = (n: number) => `demo-pattern-${String(n).padStart(2, "0")}`;
  const rows: Array<
    Omit<HrStaffingPattern, "id" | "agencyId" | "weeklyHours">
  > = [];
  const split = [
    { start: "07:30", end: "08:30" },
    { start: "16:30", end: "17:30" },
  ];

  // ~8 CSS-style rows: split-shift In-Home Respite / Community Networking.
  const cssRows: Array<{
    staff: string;
    client: string;
    days: number[];
    tags: string[];
    isd: boolean;
    onCall: boolean;
  }> = [
    { staff: "Demo Staff 1", client: "Demo Client A", days: [1, 2, 3, 4, 5], tags: ["In-Home Respite"], isd: true, onCall: false },
    { staff: "Demo Staff 2", client: "Demo Client B", days: [1, 2, 3, 4, 5], tags: ["In-Home Respite"], isd: false, onCall: true },
    { staff: "Demo Staff 3", client: "Demo Client C", days: [1, 3, 5], tags: ["Community Networking"], isd: true, onCall: false },
    { staff: "Demo Staff 4", client: "Demo Client D", days: [2, 4], tags: ["Community Networking", "In-Home Respite"], isd: false, onCall: false },
    { staff: "Demo Staff 5", client: "Demo Client E", days: [1, 2, 3, 4, 5], tags: ["In-Home Respite"], isd: false, onCall: false },
    { staff: "Demo Staff 6", client: "Demo Client F", days: [6, 0], tags: ["Community Networking"], isd: false, onCall: true },
    { staff: "Demo Staff 7", client: "Demo Client G", days: [1, 3, 5], tags: ["In-Home Respite"], isd: false, onCall: false },
    { staff: "Demo Staff 8", client: "Demo Client H", days: [2, 4], tags: ["In-Home Respite"], isd: true, onCall: false },
  ];
  cssRows.forEach((r) => {
    rows.push({
      siteId: null,
      staffId: `demo-staff-${r.staff.split(" ").pop()}`,
      staffName: r.staff,
      individualId: null,
      individualName: r.client,
      siteName: null,
      shiftLabel: "CSS split shift",
      days: r.days,
      windows: split,
      serviceTags: r.tags,
      requiresIsdTraining: r.isd,
      onCall: r.onCall,
      notes: "DEMO — example community-support-services pattern",
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      active: true,
    });
  });

  // ~6 LPMM-style rows: residential house coverage, three shifts, two houses.
  const houses = [
    { siteName: "Demo House North", staff: ["Demo Staff 9", "Demo Staff 10", "Demo Staff 11"] },
    { siteName: "Demo House South", staff: ["Demo Staff 12", "Demo Staff 13", "Demo Staff 14"] },
  ];
  const houseShifts = [
    { label: "1st shift", windows: [{ start: "07:00", end: "15:00" }] },
    { label: "2nd shift", windows: [{ start: "15:00", end: "23:00" }] },
    { label: "Overnight", windows: [{ start: "23:00", end: "07:00" }] },
  ];
  houses.forEach((house, h) => {
    houseShifts.forEach((shift, s) => {
      rows.push({
        siteId: null,
        staffId: `demo-staff-${9 + h * 3 + s}`,
        staffName: house.staff[s],
        individualId: null,
        individualName: null,
        siteName: house.siteName,
        shiftLabel: shift.label,
        days: [1, 2, 3, 4, 5],
        windows: shift.windows,
        serviceTags: ["Residential"],
        requiresIsdTraining: shift.label === "Overnight",
        onCall: false,
        notes: "DEMO — example residential house coverage",
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        active: true,
      });
    });
  });

  return rows.map((r, i) => ({
    ...r,
    id: demoId(i + 1),
    agencyId: EVERGREEN_DEMO_AGENCY_ID,
    weeklyHours: computePatternWeeklyHours(r.days, r.windows),
  }));
}

type LocalRoot = Record<string, Record<string, LocalBucket>>;

class LocalHrStore implements HrStore {
  private memory: LocalBucket | null = null;

  constructor(
    private agencyId: string,
    private userId: string,
    private kioskTestSeed?: KioskTestSeed,
  ) {}

  private storageAvailable(): boolean {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  }

  private load(): LocalBucket {
    if (this.memory) return this.memory;
    if (!this.storageAvailable()) {
      this.memory = emptyBucket();
    } else {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        const root = (raw ? JSON.parse(raw) : {}) as LocalRoot;
        const bucket = root[this.agencyId]?.[this.userId] ?? emptyBucket();
        // Buckets written before staffing patterns existed have no patterns array.
        if (!Array.isArray(bucket.patterns)) bucket.patterns = [];
        // Buckets written before HR-PHASE2 existed have no phase-2 arrays.
        if (!Array.isArray(bucket.policies)) bucket.policies = [];
        if (!Array.isArray(bucket.ledger)) bucket.ledger = [];
        if (!Array.isArray(bucket.swaps)) bucket.swaps = [];
        if (bucket.overtimeRules === undefined) bucket.overtimeRules = null;
        // Buckets written before the kiosk build existed have no kiosk arrays.
        if (!Array.isArray(bucket.kioskTokens)) bucket.kioskTokens = [];
        if (!Array.isArray(bucket.credentials)) bucket.credentials = [];
        if (!Array.isArray(bucket.missedReports)) bucket.missedReports = [];
        if (bucket.punchRules === undefined) bucket.punchRules = null;
        // Buckets written before remote-punch grants existed have no grants array.
        if (!Array.isArray(bucket.remoteGrants)) bucket.remoteGrants = [];
        this.memory = bucket;
      } catch {
        this.memory = emptyBucket();
      }
    }
    // One-time fictional demo seed for the Evergreen demo agency.
    if (
      this.agencyId === EVERGREEN_DEMO_AGENCY_ID &&
      !this.memory.staffingSeeded &&
      this.memory.patterns.length === 0
    ) {
      this.memory.patterns = seedDemoStaffingPatterns();
      this.memory.staffingSeeded = true;
      this.save(this.memory);
    }
    return this.memory;
  }

  private save(bucket: LocalBucket): void {
    this.memory = bucket;
    if (!this.storageAvailable()) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const root = (raw ? JSON.parse(raw) : {}) as LocalRoot;
      if (!root[this.agencyId]) root[this.agencyId] = {};
      root[this.agencyId][this.userId] = bucket;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(root));
    } catch {
      // Storage full or unavailable: keep the in-memory copy.
    }
  }

  private mutate<T>(fn: (b: LocalBucket) => T): T {
    const bucket = this.load();
    const result = fn(bucket);
    this.save(bucket);
    return result;
  }

  async listShifts(fromIso: string, toIso: string, siteId?: string): Promise<HrShift[]> {
    return this.load()
      .shifts.filter(
        (s) =>
          s.startsAt >= fromIso &&
          s.endsAt <= toIso &&
          (!siteId || s.siteId === siteId),
      )
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  }

  async createShift(input: HrShiftInput): Promise<HrShift> {
    return this.mutate((b) => {
      const shift: HrShift = {
        ...input,
        id: newId(),
        agencyId: this.agencyId,
        createdBy: input.createdBy ?? this.userId,
      };
      b.shifts.push(shift);
      return shift;
    });
  }

  async updateShift(id: string, patch: Partial<HrShiftInput>): Promise<HrShift> {
    return this.mutate((b) => {
      const shift = b.shifts.find((s) => s.id === id);
      if (!shift) throw new Error("Shift not found.");
      Object.assign(shift, patch);
      return shift;
    });
  }

  async deleteShift(id: string): Promise<void> {
    this.mutate((b) => {
      b.shifts = b.shifts.filter((s) => s.id !== id);
    });
  }

  async listPunches(staffId: string, fromIso: string, toIso: string): Promise<HrPunch[]> {
    return this.load()
      .punches.filter(
        (p) => p.staffId === staffId && p.punchedAt >= fromIso && p.punchedAt <= toIso,
      )
      .sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1));
  }

  private dayRange(d = new Date()): { from: string; to: string } {
    const stamp = todayStamp(d);
    return { from: `${stamp}T00:00:00`, to: `${stamp}T23:59:59.999` };
  }

  /**
   * Local mirror of the hr_punches_insert_remote RLS gate: hub clock in/out
   * from a personal device REQUIRE an individual hub.remote_punch grant —
   * otherwise the staffer clocks in on the house kiosk laptop.
   */
  private async requireRemotePunchGrantLocal(
    action: "in" | "out",
  ): Promise<void> {
    if (await this.hasRemotePunch(this.userId)) return;
    throw new Error(
      action === "in"
        ? "Clock in on the house kiosk laptop — remote clock-in isn't enabled for your account."
        : "Clock out on the house kiosk laptop — remote clock-out isn't enabled for your account.",
    );
  }

  async clockIn(note?: string): Promise<HrPunch> {
    await this.requireRemotePunchGrantLocal("in");
    const { from, to } = this.dayRange();
    const todays = await this.listPunches(this.userId, from, to);
    validateClockIn(todays, nowIso());
    return this.mutate((b) => {
      const punch: HrPunch = {
        id: newId(),
        agencyId: this.agencyId,
        siteId: null,
        staffId: this.userId,
        kind: "in",
        punchedAt: nowIso(),
        source: "hub",
        note: note?.trim() ? note.trim() : null,
        shiftId: null,
        // Mirrors the stamp_punch_remote trigger: a non-kiosk_pin punch is a
        // remote punch (the grant above is what allows it).
        verificationMethod: "web",
        remote: true,
      };
      b.punches.push(punch);
      return punch;
    });
  }

  async clockOut(note?: string): Promise<HrPunch> {
    await this.requireRemotePunchGrantLocal("out");
    const { from, to } = this.dayRange();
    const todays = await this.listPunches(this.userId, from, to);
    validateClockOut(todays);
    return this.mutate((b) => {
      const punch: HrPunch = {
        id: newId(),
        agencyId: this.agencyId,
        siteId: null,
        staffId: this.userId,
        kind: "out",
        punchedAt: nowIso(),
        source: "hub",
        note: note?.trim() ? note.trim() : null,
        shiftId: null,
        verificationMethod: "web",
        remote: true,
      };
      b.punches.push(punch);
      return punch;
    });
  }

  async listPunchCorrections(scope: { staffId?: string }): Promise<HrPunchCorrection[]> {
    return this.load().corrections.filter(
      (c) => !scope.staffId || c.staffId === scope.staffId,
    );
  }

  async requestPunchCorrection(
    punchId: string,
    req: { requestedKind: HrPunchCorrection["requestedKind"]; requestedAt: string; reason: string },
  ): Promise<HrPunchCorrection> {
    return this.mutate((b) => {
      const correction: HrPunchCorrection = {
        id: newId(),
        punchId,
        staffId: this.userId,
        requestedKind: req.requestedKind,
        requestedAt: req.requestedAt,
        reason: req.reason,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      };
      b.corrections.push(correction);
      return correction;
    });
  }

  async decidePunchCorrection(
    id: string,
    approve: boolean,
    reviewNote?: string,
  ): Promise<HrPunchCorrection> {
    return this.mutate((b) => {
      const c = b.corrections.find((x) => x.id === id);
      if (!c) throw new Error("Correction not found.");
      c.status = approve ? "approved" : "denied";
      c.reviewedBy = this.userId;
      c.reviewedAt = nowIso();
      c.reviewNote = reviewNote?.trim() ? reviewNote.trim() : null;
      return c;
    });
  }

  async listPayPeriods(): Promise<HrPayPeriod[]> {
    return this.load().periods.sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
  }

  async createPayPeriod(startsOn: string, endsOn: string): Promise<HrPayPeriod> {
    return this.mutate((b) => {
      const period: HrPayPeriod = {
        id: newId(),
        agencyId: this.agencyId,
        startsOn,
        endsOn,
        status: "open",
        lockedBy: null,
        lockedAt: null,
      };
      b.periods.push(period);
      return period;
    });
  }

  private setPeriodStatus(id: string, status: HrPayPeriod["status"]): HrPayPeriod {
    return this.mutate((b) => {
      const p = b.periods.find((x) => x.id === id);
      if (!p) throw new Error("Pay period not found.");
      p.status = status;
      p.lockedBy = this.userId;
      p.lockedAt = nowIso();
      return p;
    });
  }

  async lockPayPeriod(id: string): Promise<HrPayPeriod> {
    return this.setPeriodStatus(id, "locked");
  }

  async markPayPeriodExported(id: string): Promise<HrPayPeriod> {
    return this.setPeriodStatus(id, "exported");
  }

  async getTimecardApproval(
    periodId: string,
    staffId: string,
  ): Promise<HrTimecardApproval | null> {
    return (
      this.load().approvals.find(
        (a) => a.payPeriodId === periodId && a.staffId === staffId,
      ) ?? null
    );
  }

  async submitTimecard(periodId: string): Promise<HrTimecardApproval> {
    return this.mutate((b) => {
      let approval = b.approvals.find(
        (a) => a.payPeriodId === periodId && a.staffId === this.userId,
      );
      if (approval) {
        approval.status = "submitted";
        approval.submittedAt = nowIso();
        return approval;
      }
      approval = {
        id: newId(),
        payPeriodId: periodId,
        staffId: this.userId,
        status: "submitted",
        submittedAt: nowIso(),
        decidedBy: null,
        decidedAt: null,
        note: null,
      };
      b.approvals.push(approval);
      return approval;
    });
  }

  async decideTimecard(
    periodId: string,
    staffId: string,
    status: "approved" | "changes_requested",
    note?: string,
  ): Promise<HrTimecardApproval> {
    return this.mutate((b) => {
      let approval = b.approvals.find(
        (a) => a.payPeriodId === periodId && a.staffId === staffId,
      );
      if (!approval) {
        approval = {
          id: newId(),
          payPeriodId: periodId,
          staffId,
          status,
          submittedAt: null,
          decidedBy: this.userId,
          decidedAt: nowIso(),
          note: note?.trim() ? note.trim() : null,
        };
        b.approvals.push(approval);
        return approval;
      }
      approval.status = status;
      approval.decidedBy = this.userId;
      approval.decidedAt = nowIso();
      approval.note = note?.trim() ? note.trim() : null;
      return approval;
    });
  }

  async listDocuments(): Promise<HrDocument[]> {
    return this.load()
      .documents.filter((d) => d.active)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async createDocument(input: HrDocumentInput): Promise<HrDocument> {
    return this.mutate((b) => {
      const doc: HrDocument = {
        ...input,
        id: newId(),
        agencyId: this.agencyId,
      };
      b.documents.push(doc);
      return doc;
    });
  }

  async updateDocument(id: string, patch: Partial<HrDocumentInput>): Promise<HrDocument> {
    return this.mutate((b) => {
      const doc = b.documents.find((d) => d.id === id);
      if (!doc) throw new Error("Document not found.");
      Object.assign(doc, patch);
      return doc;
    });
  }

  async acknowledgeDocument(docId: string, signatureName: string): Promise<HrDocumentAck> {
    if (!signatureName.trim()) throw new Error("Type your full name to acknowledge.");
    return this.mutate((b) => {
      const ack: HrDocumentAck = {
        id: newId(),
        docId,
        staffId: this.userId,
        signatureName: signatureName.trim(),
        ackedAt: nowIso(),
      };
      b.acks.push(ack);
      return ack;
    });
  }

  async listDocumentAcks(docId?: string): Promise<HrDocumentAck[]> {
    return this.load()
      .acks.filter((a) => !docId || a.docId === docId)
      .sort((a, b) => (a.ackedAt < b.ackedAt ? 1 : -1));
  }

  async listTimeOffRequests(scope: { staffId?: string }): Promise<HrTimeOffRequest[]> {
    return this.load()
      .timeOff.filter((t) => !scope.staffId || t.staffId === scope.staffId)
      .sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
  }

  private assertTimeOffBalanceLocal(
    b: LocalBucket,
    kind: HrTimeOffRequest["kind"],
    startsOn: string,
    endsOn: string,
    staffId: string,
  ): void {
    if (kind !== "pto" && kind !== "sick") return;
    const policy = b.policies.find((p) => p.leaveType === kind && p.active);
    if (!policy) return;
    const hours = timeOffRequestHours(startsOn, endsOn);
    const balance = currentLeaveBalance(b.ledger.filter((e) => e.staffId === staffId), kind);
    const check = validateTimeOffBalance(hours, balance, kind);
    if (!check.ok) throw new Error(check.errors.join(" "));
  }

  private postLedgerEntryLocal(
    b: LocalBucket,
    input: LedgerEntryInput,
  ): HrAccrualLedgerEntry {
    const balance =
      currentLeaveBalance(
        b.ledger.filter((e) => e.staffId === input.staffId),
        input.leaveType,
      ) +
      (input.accrued ?? 0) -
      (input.used ?? 0) +
      (input.adjustment ?? 0);
    const entry: HrAccrualLedgerEntry = {
      id: newId(),
      agencyId: this.agencyId,
      staffId: input.staffId,
      payPeriodId: input.payPeriodId ?? null,
      periodStart: input.periodStart ?? todayStamp(),
      leaveType: input.leaveType,
      accrued: input.accrued ?? 0,
      used: input.used ?? 0,
      adjustment: input.adjustment ?? 0,
      balance,
      note: input.note ?? null,
      createdAt: nowIso(),
    };
    b.ledger.push(entry);
    return entry;
  }

  async createTimeOffRequest(input: HrTimeOffRequestInput): Promise<HrTimeOffRequest> {
    return this.mutate((b) => {
      this.assertTimeOffBalanceLocal(b, input.kind, input.startsOn, input.endsOn, this.userId);
      const req: HrTimeOffRequest = {
        ...input,
        id: newId(),
        agencyId: this.agencyId,
        siteId: null,
        staffId: this.userId,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      };
      b.timeOff.push(req);
      return req;
    });
  }

  async decideTimeOffRequest(
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<HrTimeOffRequest> {
    return this.mutate((b) => {
      const req = b.timeOff.find((t) => t.id === id);
      if (!req) throw new Error("Time-off request not found.");
      const prevStatus = req.status;
      req.status = approve ? "approved" : "denied";
      req.decidedBy = this.userId;
      req.decidedAt = nowIso();
      req.decisionNote = note?.trim() ? note.trim() : null;
      // Ledger integration mirrors the Supabase implementation: approving a
      // pto/sick request debits the balance; reversing an approval posts a
      // restoring adjustment. Guards keep repeated decides idempotent.
      if (req.kind === "pto" || req.kind === "sick") {
        const hours = timeOffRequestHours(req.startsOn, req.endsOn);
        if (approve && prevStatus !== "approved") {
          this.postLedgerEntryLocal(b, {
            staffId: req.staffId,
            leaveType: req.kind,
            used: hours,
            note: `time-off ${req.id}`,
          });
        } else if (!approve && prevStatus === "approved") {
          this.postLedgerEntryLocal(b, {
            staffId: req.staffId,
            leaveType: req.kind,
            adjustment: hours,
            note: `time-off restored ${req.id}`,
          });
        }
      }
      return req;
    });
  }

  async listReadinessRequirements(): Promise<HrReadinessRequirement[]> {
    return this.load()
      .requirements.filter((r) => r.active)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async saveReadinessRequirement(
    input: HrReadinessRequirementInput,
  ): Promise<HrReadinessRequirement> {
    return this.mutate((b) => {
      if (input.id) {
        const existing = b.requirements.find((r) => r.id === input.id);
        if (!existing) throw new Error("Requirement not found.");
        Object.assign(existing, {
          key: input.key,
          label: input.label,
          kind: input.kind,
          dueEveryDays: input.dueEveryDays,
          requiredRoleKeys: input.requiredRoleKeys,
          active: input.active,
        });
        return existing;
      }
      const created: HrReadinessRequirement = {
        id: newId(),
        agencyId: this.agencyId,
        key: input.key,
        label: input.label,
        kind: input.kind,
        dueEveryDays: input.dueEveryDays,
        requiredRoleKeys: input.requiredRoleKeys,
        active: input.active,
      };
      b.requirements.push(created);
      return created;
    });
  }

  async getComplianceEvidence(_staffId: string): Promise<ComplianceEvidence> {
    // Local mode has no certificate/training/delegation/document tables, so
    // there is no local evidence to roll up.
    return { certs: [], trainings: [], delegations: [], docAcks: [] };
  }

  async listStaffingPatterns(scope: { staffId?: string }): Promise<HrStaffingPattern[]> {
    return this.load()
      .patterns.filter((p) => !scope.staffId || p.staffId === scope.staffId)
      .sort((a, b) => {
        const nameA = a.staffName ?? a.staffId;
        const nameB = b.staffName ?? b.staffId;
        return nameA.localeCompare(nameB);
      });
  }

  async createStaffingPattern(input: HrStaffingPatternInput): Promise<HrStaffingPattern> {
    return this.mutate((b) => {
      const pattern: HrStaffingPattern = {
        ...input,
        id: newId(),
        agencyId: this.agencyId,
      };
      b.patterns.push(pattern);
      return pattern;
    });
  }

  async updateStaffingPattern(
    id: string,
    patch: Partial<HrStaffingPatternInput>,
  ): Promise<HrStaffingPattern> {
    return this.mutate((b) => {
      const pattern = b.patterns.find((p) => p.id === id);
      if (!pattern) throw new Error("Staffing pattern not found.");
      Object.assign(pattern, patch);
      return pattern;
    });
  }

  async setStaffingPatternActive(id: string, active: boolean): Promise<void> {
    this.mutate((b) => {
      const pattern = b.patterns.find((p) => p.id === id);
      if (!pattern) throw new Error("Staffing pattern not found.");
      pattern.active = active;
    });
  }

  /* ------------------------- PTO accrual policies ------------------------- */

  async listAccrualPolicies(): Promise<HrAccrualPolicy[]> {
    return this.load()
      .policies.slice()
      .sort(
        (a, b) =>
          a.leaveType.localeCompare(b.leaveType) ||
          (b.effectiveFrom < a.effectiveFrom ? -1 : 1),
      );
  }

  async createAccrualPolicy(input: AccrualPolicyInput): Promise<HrAccrualPolicy> {
    const problems = validateAccrualPolicy(input);
    if (problems.length > 0) throw new Error(problems.join(" "));
    return this.mutate((b) => {
      const now = nowIso();
      const policy: HrAccrualPolicy = {
        ...input,
        id: newId(),
        agencyId: this.agencyId,
        active: true,
        createdBy: this.userId,
        createdAt: now,
        updatedAt: now,
      };
      b.policies.push(policy);
      return policy;
    });
  }

  async updateAccrualPolicy(
    id: string,
    patch: Partial<AccrualPolicyInput>,
  ): Promise<HrAccrualPolicy> {
    return this.mutate((b) => {
      const policy = b.policies.find((p) => p.id === id);
      if (!policy) throw new Error("Accrual policy not found.");
      const problems = validateAccrualPolicy({ ...policy, ...patch });
      if (problems.length > 0) throw new Error(problems.join(" "));
      Object.assign(policy, patch, { updatedAt: nowIso() });
      return policy;
    });
  }

  async setAccrualPolicyActive(id: string, active: boolean): Promise<HrAccrualPolicy> {
    return this.mutate((b) => {
      const policy = b.policies.find((p) => p.id === id);
      if (!policy) throw new Error("Accrual policy not found.");
      policy.active = active;
      policy.updatedAt = nowIso();
      return policy;
    });
  }

  /* ------------------------------ Leave ledger --------------------------- */

  async listLedgerEntries(
    staffId: string,
    opts: { leaveType?: LeaveType } = {},
  ): Promise<HrAccrualLedgerEntry[]> {
    return this.load()
      .ledger.filter(
        (e) =>
          e.staffId === staffId &&
          (!opts.leaveType || e.leaveType === opts.leaveType),
      )
      .sort(
        (a, b) =>
          a.periodStart < b.periodStart
            ? -1
            : a.periodStart > b.periodStart
              ? 1
              : a.createdAt < b.createdAt
                ? -1
                : 1,
      );
  }

  async postLedgerEntry(input: LedgerEntryInput): Promise<HrAccrualLedgerEntry> {
    return this.mutate((b) => this.postLedgerEntryLocal(b, input));
  }

  /* ----------------------------- Overtime rules --------------------------- */

  async getOvertimeRules(): Promise<HrOvertimeRules> {
    const stored = this.load().overtimeRules;
    if (stored) return { ...stored };
    return {
      ...DEFAULT_OVERTIME_RULES,
      agencyId: this.agencyId,
      updatedBy: null,
      updatedAt: nowIso(),
    };
  }

  async saveOvertimeRules(input: OvertimeRulesInput): Promise<HrOvertimeRules> {
    if (!(input.weeklyThresholdHours > 0)) {
      throw new Error("Weekly overtime threshold must be above 0 hours.");
    }
    if (input.dailyThresholdHours !== null && !(input.dailyThresholdHours > 0)) {
      throw new Error("Daily overtime threshold must be above 0 hours.");
    }
    if (!(input.seventhDayThresholdHours >= 0)) {
      throw new Error("Seventh-day overtime threshold cannot be negative.");
    }
    return this.mutate((b) => {
      const rules: HrOvertimeRules = {
        ...input,
        agencyId: this.agencyId,
        updatedBy: this.userId,
        updatedAt: nowIso(),
      };
      b.overtimeRules = rules;
      return { ...rules };
    });
  }

  /* ------------------------------- Shift swaps --------------------------- */

  private getShiftLocal(b: LocalBucket, id: string): HrShift {
    const shift = b.shifts.find((s) => s.id === id);
    if (!shift) throw new Error("Shift not found.");
    return shift;
  }

  private getSwapLocal(b: LocalBucket, id: string): HrShiftSwap {
    const swap = b.swaps.find((s) => s.id === id);
    if (!swap) throw new Error("Shift swap not found.");
    return swap;
  }

  async listShiftSwaps(
    scope: { staffId?: string; status?: ShiftSwapStatus } = {},
  ): Promise<HrShiftSwap[]> {
    return this.load()
      .swaps.filter(
        (s) =>
          (!scope.staffId ||
            s.requesterId === scope.staffId ||
            s.targetStaffId === scope.staffId) &&
          (!scope.status || s.status === scope.status),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createShiftSwap(input: ShiftSwapInput): Promise<HrShiftSwap> {
    return this.mutate((b) => {
      const offered = this.getShiftLocal(b, input.offeredShiftId);
      const targetId = input.targetStaffId ?? null;
      if (targetId !== null && targetId === this.userId) {
        throw new Error("You can't offer a shift swap to yourself.");
      }
      let claimedShift: HrShift | null = null;
      if (input.requestedShiftId) {
        claimedShift = this.getShiftLocal(b, input.requestedShiftId);
      }
      const problems = validateShiftSwap({
        offeredShift: offered,
        requesterId: this.userId,
        requesterShifts: b.shifts.filter((s) => s.staffId === this.userId),
        claimerId: targetId ?? "unclaimed",
        claimerShifts: targetId
          ? b.shifts.filter((s) => s.staffId === targetId)
          : [],
        claimedShift,
        nowIso: nowIso(),
      });
      if (problems.length > 0) throw new Error(problems.join(" "));
      const now = nowIso();
      const swap: HrShiftSwap = {
        id: newId(),
        agencyId: this.agencyId,
        requesterId: this.userId,
        offeredShiftId: input.offeredShiftId,
        requestedShiftId: input.requestedShiftId ?? null,
        targetStaffId: targetId,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        createdAt: now,
        updatedAt: now,
      };
      b.swaps.push(swap);
      return swap;
    });
  }

  async claimShiftSwap(
    id: string,
    claimerId: string,
    counterOfferShiftId?: string,
  ): Promise<HrShiftSwap> {
    return this.mutate((b) => {
      const swap = this.getSwapLocal(b, id);
      if (swap.status !== "pending") {
        throw new Error("This shift swap is no longer open.");
      }
      if (claimerId === swap.requesterId) {
        throw new Error("You can't claim your own shift-swap posting.");
      }
      if (swap.targetStaffId !== null && swap.targetStaffId !== claimerId) {
        throw new Error("This shift was offered to someone else.");
      }
      const offered = this.getShiftLocal(b, swap.offeredShiftId);
      let claimedShift: HrShift | null = null;
      if (counterOfferShiftId) {
        claimedShift = this.getShiftLocal(b, counterOfferShiftId);
        if (claimedShift.staffId !== claimerId) {
          throw new Error("The counter-offered shift isn't assigned to you.");
        }
      } else if (swap.requestedShiftId) {
        claimedShift = this.getShiftLocal(b, swap.requestedShiftId);
      }
      const problems = validateShiftSwap({
        offeredShift: offered,
        requesterId: swap.requesterId,
        requesterShifts: b.shifts.filter((s) => s.staffId === swap.requesterId),
        claimerId,
        claimerShifts: b.shifts.filter((s) => s.staffId === claimerId),
        claimedShift,
        nowIso: nowIso(),
      });
      if (problems.length > 0) throw new Error(problems.join(" "));
      swap.targetStaffId = claimerId;
      if (counterOfferShiftId) swap.requestedShiftId = counterOfferShiftId;
      swap.updatedAt = nowIso();
      return swap;
    });
  }

  async decideShiftSwap(
    id: string,
    approve: boolean,
    decidedBy: string,
    note?: string,
  ): Promise<HrShiftSwap> {
    return this.mutate((b) => {
      const swap = this.getSwapLocal(b, id);
      if (swap.status !== "pending") {
        throw new Error("This shift swap has already been decided.");
      }
      if (approve) {
        // Reassign through the existing shift-update path (in-place here to
        // keep the whole decide atomic within one bucket mutation).
        if (swap.requestedShiftId) {
          if (!swap.targetStaffId) {
            throw new Error("This swap has no one to assign the shift to.");
          }
          this.getShiftLocal(b, swap.offeredShiftId).staffId = swap.targetStaffId;
          this.getShiftLocal(b, swap.requestedShiftId).staffId = swap.requesterId;
        } else {
          if (!swap.targetStaffId) {
            throw new Error("This swap has no one to assign the shift to.");
          }
          this.getShiftLocal(b, swap.offeredShiftId).staffId = swap.targetStaffId;
        }
      }
      swap.status = approve ? "approved" : "denied";
      swap.decidedBy = decidedBy;
      swap.decidedAt = nowIso();
      swap.decisionNote = note?.trim() ? note.trim() : null;
      swap.updatedAt = nowIso();
      return swap;
    });
  }

  async cancelShiftSwap(id: string): Promise<HrShiftSwap> {
    return this.mutate((b) => {
      const swap = this.getSwapLocal(b, id);
      if (swap.status !== "pending") {
        throw new Error("Only a pending swap can be cancelled.");
      }
      swap.status = "cancelled";
      swap.updatedAt = nowIso();
      return swap;
    });
  }

  /* ------------------------- kiosk time clock (Worker 3) ------------------ */
  /*
   * Local (localStorage) mirror of the Supabase impl. Entity shapes match
   * Worker 1's hr.ts types; verifyKioskPin mirrors the verify_kiosk_pin RPC
   * semantics (5 strikes → 15-minute lockout, lockout clears on success,
   * unknown employee id → bad_pin without lockout) and returns its flat
   * shape (no site fields); token resolution is a hash lookup.
   */

  /**
   * Writes the test seed (known token + PIN credential) once. Test-only:
   * only runs when createHrStore was given a kioskTestSeed.
   */
  private async ensureKioskSeed(): Promise<void> {
    const seed = this.kioskTestSeed;
    if (!seed) return;
    const bucket = this.load();
    if (bucket.kioskTestSeeded) return;
    const tokenHash = await sha256Hex(seed.rawToken);
    const now = nowIso();
    bucket.kioskTokens.push({
      id: newId(),
      agencyId: this.agencyId,
      siteId: seed.siteId,
      label: "Test kiosk token",
      active: true,
      createdBy: this.userId,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      siteName: seed.siteName,
      tokenHash,
    });
    bucket.credentials.push({
      staffId: seed.staffId,
      agencyId: this.agencyId,
      employeeIdNumber: seed.employeeIdNumber,
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: now,
      updatedBy: this.userId,
      displayName: seed.displayName,
      pinHash: bcrypt.hashSync(seed.pin, 10),
    });
    bucket.kioskTestSeeded = true;
    this.save(bucket);
  }

  /** Safe credential: drops pinHash and displayName (never exposed). */
  private credentialSafe(c: LocalCredentialRow): HrClockCredential {
    return {
      staffId: c.staffId,
      agencyId: c.agencyId,
      employeeIdNumber: c.employeeIdNumber,
      failedAttempts: c.failedAttempts,
      lockedUntil: c.lockedUntil,
      pinUpdatedAt: c.pinUpdatedAt,
      updatedBy: c.updatedBy,
    };
  }

  /** Safe token: drops tokenHash and the siteName display hint. */
  private tokenSafe(t: LocalKioskTokenRow): HrKioskToken {
    return {
      id: t.id,
      agencyId: t.agencyId,
      siteId: t.siteId,
      label: t.label,
      active: t.active,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
    };
  }

  private findTokenLocal(
    bucket: LocalBucket,
    tokenHash: string,
  ): LocalKioskTokenRow | undefined {
    return bucket.kioskTokens.find(
      (t) => t.tokenHash === tokenHash && t.active && t.revokedAt == null,
    );
  }

  async verifyKioskPin(
    rawToken: string,
    employeeId: string,
    pin: string,
  ): Promise<KioskVerifyResult> {
    await this.ensureKioskSeed();
    const bucket = this.load();
    const token = this.findTokenLocal(bucket, await sha256Hex(rawToken));
    if (!token) {
      return { ok: false, reason: "bad_token" };
    }
    const credential = bucket.credentials.find(
      (c) => c.employeeIdNumber === employeeId.trim(),
    );
    if (!credential) {
      // Unknown employee id: same shape as a wrong PIN, no lockout (no row
      // to lock), mirroring the RPC.
      return { ok: false, reason: "bad_pin", attemptsLeft: null };
    }
    if (
      credential.lockedUntil &&
      Date.parse(credential.lockedUntil) > Date.now()
    ) {
      return {
        ok: false,
        reason: "locked",
        attemptsLeft: 0,
        lockedUntil: credential.lockedUntil,
      };
    }
    const ok = await bcrypt.compare(pin, credential.pinHash);
    if (ok) {
      credential.failedAttempts = 0;
      credential.lockedUntil = null;
      token.lastUsedAt = nowIso();
      this.save(bucket);
      return {
        ok: true,
        staffId: credential.staffId,
        displayName: credential.displayName ?? null,
      };
    }
    credential.failedAttempts += 1;
    const attemptsLeft = Math.max(
      0,
      MAX_PIN_ATTEMPTS - credential.failedAttempts,
    );
    let lockedUntil: string | null = null;
    let reason: "bad_pin" | "locked" = "bad_pin";
    if (credential.failedAttempts >= MAX_PIN_ATTEMPTS) {
      lockedUntil = new Date(
        Date.now() + PIN_LOCKOUT_MINUTES * 60_000,
      ).toISOString();
      credential.lockedUntil = lockedUntil;
      reason = "locked";
    }
    this.save(bucket);
    return { ok: false, reason, attemptsLeft, lockedUntil };
  }

  async resolveKioskToken(rawToken: string): Promise<KioskSite> {
    await this.ensureKioskSeed();
    const bucket = this.load();
    const token = this.findTokenLocal(bucket, await sha256Hex(rawToken));
    if (!token) {
      throw new Error("Invalid kiosk token.");
    }
    return {
      siteId: token.siteId,
      siteName: token.siteName ?? "",
      agencyId: token.agencyId,
    };
  }

  /**
   * Local mirror of the submit_kiosk_punch definer RPC: the raw token is
   * required and must belong to an active token (otherwise it throws
   * "Invalid kiosk token.", like the RPC's raise); verification_method is
   * stamped 'kiosk_pin' and remote derives false, exactly as the server
   * does. Never a direct insert in the Supabase impl.
   */
  async submitKioskPunch(
    token: string,
    input: KioskPunchInput,
  ): Promise<HrPunch> {
    await this.ensureKioskSeed();
    const d = new Date(input.punchedAt);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid punch time.");
    const bucket = this.load();
    const tokenRow = this.findTokenLocal(bucket, await sha256Hex(token));
    if (!tokenRow) {
      throw new Error("Invalid kiosk token.");
    }
    const stamp = todayStamp(d);
    const todays = await this.listPunches(
      input.staffId,
      `${stamp}T00:00:00`,
      `${stamp}T23:59:59.999`,
    );
    guardKioskPunch(todays, input.kind, input.punchedAt);
    const punch: HrPunch = {
      id: newId(),
      agencyId: this.agencyId,
      siteId: tokenRow.siteId,
      staffId: input.staffId,
      kind: input.kind,
      punchedAt: input.punchedAt,
      source: "kiosk",
      note: input.note?.trim() ? input.note.trim() : null,
      shiftId: input.shiftId ?? null,
      serviceType: input.serviceType?.trim()
        ? input.serviceType.trim()
        : undefined,
      individualId: input.individualId ?? undefined,
      verificationMethod: "kiosk_pin",
      offline: input.offline,
      remote: false,
      attestation: input.attestation ?? undefined,
    };
    return this.mutate((b) => {
      b.punches.push(punch);
      return punch;
    });
  }

  /* ----------------- hub.remote_punch grants (local mirror) ---------------- */
  /*
   * In-memory (+localStorage-persisted) mirror of hr_staff_permission_grants.
   * Revocation is a soft delete (revoked_at), never a row delete.
   */

  private activeGrantLocal(
    b: LocalBucket,
    staffId: string,
  ): LocalGrantRow | undefined {
    return b.remoteGrants.find(
      (g) =>
        g.staffId === staffId &&
        g.permissionKey === "hub.remote_punch" &&
        g.revokedAt == null,
    );
  }

  private mapGrantLocal(
    b: LocalBucket,
    g: LocalGrantRow,
  ): RemotePunchGrant {
    const cred = b.credentials.find((c) => c.staffId === g.staffId);
    return {
      staffId: g.staffId,
      grantedBy: g.grantedBy,
      grantedAt: g.grantedAt,
      employeeIdNumber: cred ? cred.employeeIdNumber : null,
    };
  }

  async hasRemotePunch(staffId: string): Promise<boolean> {
    return this.activeGrantLocal(this.load(), staffId) != null;
  }

  async grantRemotePunch(
    staffId: string,
    grantedBy?: string,
  ): Promise<RemotePunchGrant> {
    return this.mutate((b) => {
      const existing = this.activeGrantLocal(b, staffId);
      if (existing) return this.mapGrantLocal(b, existing);
      const row: LocalGrantRow = {
        staffId,
        permissionKey: "hub.remote_punch",
        grantedBy: grantedBy ?? this.userId,
        grantedAt: nowIso(),
        revokedAt: null,
        revokedBy: null,
      };
      b.remoteGrants.push(row);
      return this.mapGrantLocal(b, row);
    });
  }

  async revokeRemotePunch(staffId: string): Promise<void> {
    this.mutate((b) => {
      const now = nowIso();
      for (const g of b.remoteGrants) {
        if (
          g.staffId === staffId &&
          g.permissionKey === "hub.remote_punch" &&
          g.revokedAt == null
        ) {
          g.revokedAt = now;
          g.revokedBy = this.userId;
        }
      }
    });
  }

  async listRemotePunchGrants(): Promise<RemotePunchGrant[]> {
    const b = this.load();
    return b.remoteGrants
      .filter(
        (g) => g.permissionKey === "hub.remote_punch" && g.revokedAt == null,
      )
      .sort((a, c) => (a.grantedAt < c.grantedAt ? 1 : -1))
      .map((g) => this.mapGrantLocal(b, g));
  }

  async suggestKioskShift(
    staffId: string,
    siteId: string,
  ): Promise<KioskShiftSuggestion | null> {
    const now = new Date();
    const stamp = todayStamp(now);
    const shifts = await this.listShifts(
      `${stamp}T00:00:00`,
      `${stamp}T23:59:59.999`,
      siteId,
    );
    const mine = shifts
      .filter((s) => s.staffId === staffId)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0];
    if (mine) {
      return {
        shiftLabel: mine.title,
        serviceType: null,
        individualId: null,
        individualName: null,
      };
    }
    const patterns = await this.listStaffingPatterns({ staffId });
    const weekday = now.getDay();
    const pattern = patterns.find(
      (p) =>
        p.active &&
        p.siteId === siteId &&
        p.days.includes(weekday) &&
        p.effectiveFrom <= stamp &&
        (p.effectiveTo == null || p.effectiveTo >= stamp),
    );
    if (!pattern) return null;
    return {
      shiftLabel: pattern.shiftLabel ?? "Scheduled shift",
      serviceType: pattern.serviceTags[0] ?? null,
      individualId: pattern.individualId,
      individualName: pattern.individualName ?? null,
    };
  }

  async listKioskTokens(siteId?: string): Promise<HrKioskToken[]> {
    const bucket = this.load();
    return bucket.kioskTokens
      .filter(
        (t) =>
          t.agencyId === this.agencyId &&
          t.active &&
          t.revokedAt == null &&
          (!siteId || t.siteId === siteId),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((t) => this.tokenSafe(t));
  }

  async generateKioskToken(
    siteId: string,
    label: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }> {
    const rawToken = randomTokenHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const now = nowIso();
    const row: LocalKioskTokenRow = {
      id: newId(),
      agencyId: this.agencyId,
      siteId,
      label: label.trim() ? label.trim() : null,
      active: true,
      createdBy: this.userId,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      tokenHash,
    };
    return this.mutate((b) => {
      b.kioskTokens.push(row);
      return { token: this.tokenSafe(row), rawToken };
    });
  }

  async revokeKioskToken(id: string): Promise<void> {
    this.mutate((b) => {
      const token = b.kioskTokens.find(
        (t) => t.id === id && t.agencyId === this.agencyId,
      );
      if (!token) throw new Error("Kiosk token not found.");
      token.active = false;
      token.revokedAt = nowIso();
    });
  }

  async rotateKioskToken(
    id: string,
  ): Promise<{ token: HrKioskToken; rawToken: string }> {
    const bucket = this.load();
    const current = bucket.kioskTokens.find(
      (t) => t.id === id && t.agencyId === this.agencyId,
    );
    if (!current || !current.active || current.revokedAt) {
      throw new Error("This token is already revoked.");
    }
    const siteId = current.siteId;
    const label = current.label ? `${current.label} (rotated ${todayStamp()})` : "";
    await this.revokeKioskToken(id);
    return this.generateKioskToken(siteId, label);
  }

  async issueClockCredential(
    staffId: string,
    employeeIdNumber: string,
    pin: string,
  ): Promise<HrClockCredential> {
    assertPinFormat(pin);
    if (!employeeIdNumber.trim()) {
      throw new Error("An employee ID number is required.");
    }
    const now = nowIso();
    const row: LocalCredentialRow = {
      staffId,
      agencyId: this.agencyId,
      employeeIdNumber: employeeIdNumber.trim(),
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: now,
      updatedBy: this.userId,
      pinHash: await bcrypt.hash(pin, 10),
    };
    return this.mutate((b) => {
      if (b.credentials.some((c) => c.staffId === staffId)) {
        throw new Error("This staffer already has a clock credential.");
      }
      b.credentials.push(row);
      return this.credentialSafe(row);
    });
  }

  async resetClockPin(
    staffId: string,
    newPin: string,
  ): Promise<HrClockCredential> {
    assertPinFormat(newPin);
    const pinHash = await bcrypt.hash(newPin, 10);
    return this.mutate((b) => {
      const c = b.credentials.find((x) => x.staffId === staffId);
      if (!c) throw new Error("Credential not found.");
      c.pinHash = pinHash;
      c.pinUpdatedAt = nowIso();
      c.failedAttempts = 0;
      c.lockedUntil = null;
      c.updatedBy = this.userId;
      return this.credentialSafe(c);
    });
  }

  async listClockCredentials(): Promise<HrClockCredential[]> {
    const bucket = this.load();
    return bucket.credentials
      .filter((c) => c.agencyId === this.agencyId)
      .map((c) => this.credentialSafe(c));
  }

  async unlockCredential(staffId: string): Promise<HrClockCredential> {
    return this.mutate((b) => {
      const c = b.credentials.find((x) => x.staffId === staffId);
      if (!c) throw new Error("Credential not found.");
      c.failedAttempts = 0;
      c.lockedUntil = null;
      return this.credentialSafe(c);
    });
  }

  async listOpenPunches(siteId: string): Promise<HrPunch[]> {
    const stamp = todayStamp();
    const from = `${stamp}T00:00:00`;
    const to = `${stamp}T23:59:59.999`;
    const bucket = this.load();
    const siteRows = bucket.punches.filter(
      (p) =>
        p.agencyId === this.agencyId &&
        p.siteId === siteId &&
        p.punchedAt >= from &&
        p.punchedAt <= to,
    );
    const byStaff = new Map<string, HrPunch[]>();
    for (const r of siteRows) {
      const list = byStaff.get(r.staffId) ?? [];
      list.push(r);
      byStaff.set(r.staffId, list);
    }
    const open: HrPunch[] = [];
    for (const staffRows of byStaff.values()) {
      if (!kioskSessionOpen(staffRows)) continue;
      const lastIn = [...staffRows]
        .filter((p) => p.kind === "in")
        .sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1))
        .pop();
      if (lastIn) open.push(lastIn);
    }
    return open.sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1));
  }

  async listMissedPunchReports(scope?: {
    staffId?: string;
    siteId?: string;
    status?: HrMissedPunchReport["status"];
  }): Promise<HrMissedPunchReport[]> {
    const bucket = this.load();
    return bucket.missedReports
      .filter(
        (r) =>
          r.agencyId === this.agencyId &&
          (!scope?.staffId || r.staffId === scope.staffId) &&
          (!scope?.siteId || r.siteId === scope.siteId) &&
          (!scope?.status || r.status === scope.status),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async reportMissedPunch(
    input: MissedPunchReportInput,
  ): Promise<HrMissedPunchReport> {
    validateMissedPunchInput(input);
    const report: HrMissedPunchReport = {
      id: newId(),
      agencyId: this.agencyId,
      staffId: input.staffId,
      siteId: input.siteId ?? null,
      workDate: input.workDate,
      claimedInAt: input.claimedInAt ?? null,
      claimedOutAt: input.claimedOutAt ?? null,
      reason: input.reason.trim(),
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      createdAt: nowIso(),
    };
    return this.mutate((b) => {
      b.missedReports.push(report);
      return report;
    });
  }

  async decideMissedPunchReport(
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<HrMissedPunchReport> {
    const reviewNote = note?.trim() ? note.trim() : null;
    return this.mutate((b) => {
      const report = b.missedReports.find(
        (r) => r.id === id && r.agencyId === this.agencyId,
      );
      if (!report) throw new Error("Missed-punch report not found.");
      if (report.status !== "pending") {
        throw new Error("This report has already been decided.");
      }
      const decidedAt = nowIso();
      if (approve) {
        // Correction ledger: the actual punch rows (source = 'correction')
        // plus a correction entry per punch, mirroring hr_punch_corrections.
        const claimed: Array<{ kind: "in" | "out"; at: string }> = [];
        if (report.claimedInAt)
          claimed.push({ kind: "in", at: report.claimedInAt });
        if (report.claimedOutAt)
          claimed.push({ kind: "out", at: report.claimedOutAt });
        for (const c of claimed) {
          const punch: HrPunch = {
            id: newId(),
            agencyId: this.agencyId,
            siteId: report.siteId,
            staffId: report.staffId,
            kind: c.kind,
            punchedAt: c.at,
            source: "correction",
            verificationMethod: "web",
            // A manager-entered web correction is a remote punch, exactly as
            // the stamp_punch_remote server trigger derives it.
            remote: true,
            note: `Missed-punch report approved${
              reviewNote ? `: ${reviewNote}` : ""
            }`,
            shiftId: null,
          };
          b.punches.push(punch);
          b.corrections.push({
            id: newId(),
            punchId: punch.id,
            staffId: report.staffId,
            requestedKind: c.kind,
            requestedAt: c.at,
            reason: report.reason,
            status: "approved",
            reviewedBy: this.userId,
            reviewedAt: decidedAt,
            reviewNote,
          });
        }
      }
      report.status = approve ? "approved" : "denied";
      report.reviewedBy = this.userId;
      report.reviewedAt = decidedAt;
      report.reviewNote = reviewNote;
      return report;
    });
  }

  async getPunchRules(): Promise<HrPunchRules> {
    const bucket = this.load();
    return bucket.punchRules ?? defaultPunchRules(this.agencyId);
  }

  async savePunchRules(
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
  ): Promise<HrPunchRules> {
    assertPunchRulesPatch(patch);
    return this.mutate((b) => {
      const merged: HrPunchRules = {
        ...(b.punchRules ?? defaultPunchRules(this.agencyId)),
        ...patch,
        agencyId: this.agencyId,
        updatedBy: this.userId,
        updatedAt: nowIso(),
      };
      b.punchRules = merged;
      return merged;
    });
  }
}

/* -------------------------------- factory -------------------------------- */

/**
 * Build the HR store for this session. Hosted when Supabase env is present,
 * localStorage-backed otherwise.
 */
export function createHrStore(opts: {
  agencyId: string;
  userId: string;
  /** Test-only: seeds a known kiosk token + PIN credential in the local impl. */
  kioskTestSeed?: KioskTestSeed;
}): HrStore {
  const client = createSupabaseBrowserClient();
  if (client) return new SupabaseHrStore(client, opts.agencyId, opts.userId);
  return new LocalHrStore(opts.agencyId, opts.userId, opts.kioskTestSeed);
}

/** CSV export is pure domain logic; re-exported here for page convenience. */
export { buildPayrollCsvExport };
