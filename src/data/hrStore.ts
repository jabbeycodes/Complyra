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
  HrDocument,
  HrDocumentAck,
  HrOvertimeRules,
  HrPayPeriod,
  HrPunch,
  HrPunchCorrection,
  HrReadinessRequirement,
  HrShift,
  HrShiftSwap,
  HrStaffingPattern,
  HrTimecardApproval,
  HrTimeOffRequest,
  LedgerEntryInput,
  LeaveType,
  OvertimeRulesInput,
  ShiftSwapInput,
  ShiftSwapStatus,
} from "./hr";
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

  async clockIn(note?: string): Promise<HrPunch> {
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

  async clockIn(note?: string): Promise<HrPunch> {
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
      };
      b.punches.push(punch);
      return punch;
    });
  }

  async clockOut(note?: string): Promise<HrPunch> {
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
}

/* -------------------------------- factory -------------------------------- */

/**
 * Build the HR store for this session. Hosted when Supabase env is present,
 * localStorage-backed otherwise.
 */
export function createHrStore(opts: { agencyId: string; userId: string }): HrStore {
  const client = createSupabaseBrowserClient();
  if (client) return new SupabaseHrStore(client, opts.agencyId, opts.userId);
  return new LocalHrStore(opts.agencyId, opts.userId);
}

/** CSV export is pure domain logic; re-exported here for page convenience. */
export { buildPayrollCsvExport };
