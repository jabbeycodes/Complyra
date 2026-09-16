/**
 * Smoke test for the Employee Hub page.
 *
 * Renders the presentational EmployeeHubShell with a fake session and an
 * in-memory stub HrStore (the real localStorage-backed implementation is NOT
 * imported here), then asserts the tab structure and permission gating.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeHubShell, describeOvertimeRules, swapClaimable, type HubStaffEntry, type HubSite } from "./EmployeeHubPage";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import type {
  ComplianceEvidence,
  HrDocument,
  HrDocumentAck,
  HrPayPeriod,
  HrPunch,
  HrPunchCorrection,
  HrReadinessRequirement,
  HrShift,
  HrStaffingPattern,
  HrTimecardApproval,
  HrTimeOffRequest,
} from "../../data/hr";
import {
  computePatternWeeklyHours,
  currentLeaveBalance,
  timeOffRequestHours,
  validateAccrualPolicy,
  validateShiftSwap,
  validateTimeOffBalance,
  validateStaffingPattern,
} from "../../data/hr";
import { StaffingBoard } from "./StaffingBoard";

const EMPTY_EVIDENCE: ComplianceEvidence = {
  certs: [],
  trainings: [],
  delegations: [],
  docAcks: [],
};

function makeSession(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: "user-alex",
    email: "alex.rivera@example.com",
    username: "arivera",
    fullName: "Alex Rivera",
    jobTitle: "Direct Support Professional",
    role: "dsp",
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST01",
    siteId: "site-1",
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

const PM_PERMISSIONS: Record<string, boolean> = {
  "hub.access": true,
  "hub.manage_schedule": true,
  "hub.manage_staffing": true,
  "hub.review_timecards": true,
  "hub.approve_time_off": true,
  "hub.view_team": true,
  "hub.approve_payroll": true,
  "hub.manage_documents": true,
};

const pmSession = makeSession({
  userId: "user-pat",
  fullName: "Pat Morgan",
  role: "manager",
  roleKey: "program_manager",
  jobTitle: "Program Manager",
  permissions: PM_PERMISSIONS,
});

const pmPaySession = makeSession({
  userId: "user-pat",
  fullName: "Pat Morgan",
  role: "manager",
  roleKey: "program_manager",
  jobTitle: "Program Manager",
  permissions: { ...PM_PERMISSIONS, "hub.manage_pay_settings": true },
});

const dspSession = makeSession({
  role: "dsp",
  roleKey: "dsp",
  permissions: { "hub.access": true },
});

const staffList: HubStaffEntry[] = [
  { userId: "user-pat", fullName: "Pat Morgan", email: "pat@example.com", roleKey: "program_manager", siteId: "site-1" },
  { userId: "user-alex", fullName: "Alex Rivera", email: "alex.rivera@example.com", roleKey: "dsp", siteId: "site-1" },
  { userId: "user-sam", fullName: "Sam Chen", email: "sam@example.com", roleKey: "dsp", siteId: "site-2" },
];

const sites: HubSite[] = [
  { id: "site-1", name: "Maple House" },
  { id: "site-2", name: "Oak House" },
];

/** In-memory stub HrStore with canned data — never touches localStorage. */
function makeStubStore(): HrStore {
  const shifts: HrShift[] = [
    {
      id: "shift-1",
      agencyId: "agency-1",
      siteId: "site-1",
      staffId: "user-alex",
      title: "DSP day shift",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      status: "published",
      notes: null,
      createdBy: "user-pat",
    },
  ];
  const docs: HrDocument[] = [
    {
      id: "doc-1",
      agencyId: "agency-1",
      title: "Employee Handbook",
      category: "handbook",
      body: "Welcome to the agency.",
      fileUrl: null,
      requiresAck: true,
      active: true,
    },
  ];
  const periods: HrPayPeriod[] = [
    {
      id: "period-1",
      agencyId: "agency-1",
      startsOn: "2026-09-01",
      endsOn: "2026-09-15",
      status: "open",
      lockedBy: null,
      lockedAt: null,
    },
  ];
  const requirements: HrReadinessRequirement[] = [
    {
      id: "req-1",
      agencyId: "agency-1",
      key: "CPR",
      label: "CPR certification",
      kind: "certificate",
      dueEveryDays: 730,
      requiredRoleKeys: [],
      active: true,
    },
  ];
  const accrualPolicies = [
    {
      id: "pol-1",
      agencyId: "agency-1",
      leaveType: "pto" as const,
      tenureBands: [
        { minYears: 0, maxYears: 2 as number | null, hoursPerPeriod: 3.08 },
        { minYears: 2, maxYears: null as number | null, hoursPerPeriod: 4.62 },
      ],
      carryoverCapHours: 40,
      carryoverBasis: "calendar_year" as const,
      effectiveFrom: "2026-01-01",
      effectiveTo: null as string | null,
      active: true,
      createdBy: "user-pat",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const ledgerEntries = [
    { id: "le-1", agencyId: "agency-1", staffId: "user-alex", payPeriodId: null as string | null, periodStart: "2026-08-01", leaveType: "pto" as const, accrued: 6.16, used: 0, adjustment: 0, balance: 6.16, note: null as string | null, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "le-2", agencyId: "agency-1", staffId: "user-alex", payPeriodId: null as string | null, periodStart: "2026-09-01", leaveType: "pto" as const, accrued: 6.16, used: 8, adjustment: 0, balance: 4.32, note: null as string | null, createdAt: "2026-09-01T00:00:00.000Z" },
  ];
  const patterns: HrStaffingPattern[] = [
    {
      id: "pat-1",
      agencyId: "agency-1",
      siteId: null,
      staffId: "user-alex",
      staffName: "Alex Rivera",
      individualId: null,
      individualName: "Demo Client A",
      siteName: null,
      shiftLabel: null,
      days: [1, 2, 3, 4, 5],
      windows: [
        { start: "07:30", end: "08:30" },
        { start: "16:30", end: "17:30" },
      ],
      weeklyHours: 10,
      serviceTags: ["In-Home Respite"],
      requiresIsdTraining: true,
      onCall: false,
      notes: null,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      active: true,
    },
    {
      id: "pat-2",
      agencyId: "agency-1",
      siteId: "site-1",
      staffId: "user-sam",
      staffName: "Sam Chen",
      individualId: null,
      individualName: null,
      siteName: "Maple House",
      shiftLabel: "1st shift",
      days: [6, 0],
      windows: [{ start: "07:00", end: "15:00" }],
      weeklyHours: 16,
      serviceTags: ["Residential"],
      requiresIsdTraining: false,
      onCall: true,
      notes: null,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      active: true,
    },
  ];
  const notFound = (what: string) => Promise.reject(new Error(`${what} not found.`));
  const store: HrStore = {
    listShifts: async () => shifts,
    createShift: async (input) => ({ ...input, id: "shift-new", agencyId: "agency-1", createdBy: "user-pat" }),
    updateShift: async (id, patch) => {
      const s = shifts.find((x) => x.id === id);
      if (!s) throw new Error("not found");
      return { ...s, ...patch };
    },
    deleteShift: async () => {},
    listPunches: async () => [] as HrPunch[],
    clockIn: async () => ({ id: "p1", agencyId: "agency-1", siteId: null, staffId: "user-alex", shiftId: null, kind: "in", punchedAt: new Date().toISOString(), source: "web", note: null }),
    clockOut: async () => ({ id: "p2", agencyId: "agency-1", siteId: null, staffId: "user-alex", shiftId: null, kind: "out", punchedAt: new Date().toISOString(), source: "web", note: null }),
    listPunchCorrections: async () => [] as HrPunchCorrection[],
    requestPunchCorrection: async (punchId, req) => ({
      id: "c1", agencyId: "agency-1", punchId, staffId: "user-alex",
      requestedKind: req.requestedKind, requestedAt: req.requestedAt, reason: req.reason,
      status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null,
    }),
    decidePunchCorrection: async (id, approve) => ({
      id, agencyId: "agency-1", punchId: "p1", staffId: "user-alex",
      requestedKind: "in", requestedAt: null, reason: "", status: approve ? "approved" : "denied",
      reviewedBy: "user-pat", reviewedAt: new Date().toISOString(), reviewNote: null,
    }),
    listPayPeriods: async () => periods,
    createPayPeriod: async (startsOn, endsOn) => ({ id: "p-new", agencyId: "agency-1", startsOn, endsOn, status: "open", lockedBy: null, lockedAt: null }),
    lockPayPeriod: async (id) => {
      const p = periods.find((x) => x.id === id);
      if (!p) throw new Error("not found");
      return { ...p, status: "locked" };
    },
    markPayPeriodExported: async (id) => {
      const p = periods.find((x) => x.id === id);
      if (!p) throw new Error("not found");
      return { ...p, status: "exported" };
    },
    getTimecardApproval: async () => null as HrTimecardApproval | null,
    submitTimecard: async (periodId) => ({ id: "a1", agencyId: "agency-1", payPeriodId: periodId, staffId: "user-alex", status: "submitted", submittedAt: new Date().toISOString(), decidedBy: null, decidedAt: null, note: null }),
    decideTimecard: async (periodId, staffId, status) => ({ id: "a1", agencyId: "agency-1", payPeriodId: periodId, staffId, status, submittedAt: new Date().toISOString(), decidedBy: "user-pat", decidedAt: new Date().toISOString(), note: null }),
    listDocuments: async () => docs,
    createDocument: async (input) => ({ ...input, id: "doc-new", agencyId: "agency-1" }),
    updateDocument: async (id, patch) => {
      const d = docs.find((x) => x.id === id);
      if (!d) throw new Error("not found");
      return { ...d, ...patch };
    },
    acknowledgeDocument: async (docId, signatureName) => ({
      id: "ack1", agencyId: "agency-1", docId, staffId: "user-alex", signatureName, ackedAt: new Date().toISOString(),
    }),
    listDocumentAcks: async () => [] as HrDocumentAck[],
    listTimeOffRequests: async () => [] as HrTimeOffRequest[],
    createTimeOffRequest: async (input) => ({ ...input, id: "t1", agencyId: "agency-1", siteId: null, staffId: "user-alex", status: "pending", decidedBy: null, decidedAt: null, decisionNote: null }),
    decideTimeOffRequest: async (id, approve) => ({
      id, agencyId: "agency-1", siteId: null, staffId: "user-alex", kind: "pto",
      startsOn: "2026-09-20", endsOn: "2026-09-21", reason: "Family trip",
      status: approve ? "approved" : "denied",
      decidedBy: "user-pat", decidedAt: new Date().toISOString(), decisionNote: null,
    }),
    listReadinessRequirements: async () => requirements,
    saveReadinessRequirement: async (input) => ({ ...input, id: input.id ?? "req-new", agencyId: "agency-1" }),
    getComplianceEvidence: async () => EMPTY_EVIDENCE,
    listStaffingPatterns: async (scope) =>
      scope.staffId ? patterns.filter((p) => p.staffId === scope.staffId) : patterns,
    createStaffingPattern: async (input) => ({
      ...input,
      id: "pat-new",
      agencyId: "agency-1",
    }),
    updateStaffingPattern: async (id, patch) => {
      const p = patterns.find((x) => x.id === id);
      if (!p) throw new Error("not found");
      return { ...p, ...patch };
    },
    setStaffingPatternActive: async () => {},
    // Phase-2 surface (accrual, overtime rules, shift swaps).
    getOvertimeRules: async () => ({
      agencyId: "agency-1",
      weeklyThresholdHours: 40,
      dailyThresholdHours: null as number | null,
      seventhConsecutiveDay: false,
      seventhDayThresholdHours: 8,
      updatedBy: null,
      updatedAt: new Date().toISOString(),
    }),
    saveOvertimeRules: async (input) => ({
      agencyId: "agency-1",
      weeklyThresholdHours: input.weeklyThresholdHours,
      dailyThresholdHours: input.dailyThresholdHours,
      seventhConsecutiveDay: input.seventhConsecutiveDay,
      seventhDayThresholdHours: input.seventhDayThresholdHours,
      updatedBy: "user-pat",
      updatedAt: new Date().toISOString(),
    }),
    listAccrualPolicies: async () => accrualPolicies,
    createAccrualPolicy: async (input) => ({
      ...input,
      id: "pol-new",
      agencyId: "agency-1",
      active: true,
      createdBy: "user-pat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateAccrualPolicy: async (id, patch) => {
      const p = accrualPolicies.find((x) => x.id === id);
      if (!p) throw new Error("policy not found");
      return { ...p, ...patch };
    },
    setAccrualPolicyActive: async (id, active) => {
      const p = accrualPolicies.find((x) => x.id === id);
      if (!p) throw new Error("policy not found");
      return { ...p, active };
    },
    listLedgerEntries: async () => ledgerEntries,
    postLedgerEntry: async (input) => ({
      id: "le-new",
      agencyId: "agency-1",
      payPeriodId: input.payPeriodId ?? null,
      periodStart: input.periodStart ?? "2026-09-01",
      staffId: input.staffId,
      leaveType: input.leaveType,
      accrued: input.accrued ?? 0,
      used: input.used ?? 0,
      adjustment: input.adjustment ?? 0,
      balance: (input.accrued ?? 0) - (input.used ?? 0) + (input.adjustment ?? 0),
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    }),
    listShiftSwaps: async () => [],
    createShiftSwap: async (input) => ({
      id: "swap-new",
      agencyId: "agency-1",
      requesterId: "user-alex",
      offeredShiftId: input.offeredShiftId,
      requestedShiftId: input.requestedShiftId ?? null,
      targetStaffId: input.targetStaffId ?? null,
      status: "pending" as const,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    claimShiftSwap: async (id, claimerId) => ({
      id,
      agencyId: "agency-1",
      requesterId: "user-pat",
      offeredShiftId: "shift-1",
      requestedShiftId: null,
      targetStaffId: claimerId,
      status: "pending" as const,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    decideShiftSwap: async (id, approve, decidedBy, note) => ({
      id,
      agencyId: "agency-1",
      requesterId: "user-alex",
      offeredShiftId: "shift-1",
      requestedShiftId: null,
      targetStaffId: null,
      status: (approve ? "approved" : "denied") as "approved" | "denied",
      decidedBy,
      decidedAt: new Date().toISOString(),
      decisionNote: note?.trim() ? note.trim() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    cancelShiftSwap: async (id) => ({
      id,
      agencyId: "agency-1",
      requesterId: "user-alex",
      offeredShiftId: "shift-1",
      requestedShiftId: null,
      targetStaffId: null,
      status: "cancelled" as const,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    // Kiosk time-clock surface (Worker 3) — stubs for page tests.
    verifyKioskPin: async () => ({ ok: false as const, reason: "bad_pin" as const }),
    resolveKioskToken: async () => ({
      siteId: "site-1",
      siteName: "Maple House",
      agencyId: "agency-1",
    }),
    submitKioskPunch: async (token, input) => ({
      id: "kp1",
      agencyId: "agency-1",
      siteId: "site-1",
      staffId: input.staffId,
      kind: input.kind,
      punchedAt: input.punchedAt,
      source: "kiosk",
      note: input.note ?? null,
      shiftId: input.shiftId ?? null,
      verificationMethod: "kiosk_pin",
      offline: input.offline,
      remote: false,
    }),
    hasRemotePunch: async () => false,
    grantRemotePunch: async (staffId, grantedBy) => ({
      staffId,
      grantedBy: grantedBy ?? "user-pat",
      grantedAt: new Date().toISOString(),
      employeeIdNumber: null,
    }),
    revokeRemotePunch: async () => {},
    listRemotePunchGrants: async () => [],
    suggestKioskShift: async () => null,
    listKioskTokens: async () => [],
    generateKioskToken: async (siteId, label) => ({
      token: {
        id: "tok1",
        agencyId: "agency-1",
        siteId,
        label,
        active: true,
        createdBy: "user-pat",
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      },
      rawToken: "raw-token-stub",
    }),
    revokeKioskToken: async () => {},
    rotateKioskToken: async (id) => ({
      token: {
        id: "tok2",
        agencyId: "agency-1",
        siteId: "site-1",
        label: `rotated from ${id}`,
        active: true,
        createdBy: "user-pat",
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      },
      rawToken: "raw-token-stub-2",
    }),
    issueClockCredential: async (staffId, employeeIdNumber) => ({
      staffId,
      agencyId: "agency-1",
      employeeIdNumber,
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: new Date().toISOString(),
      updatedBy: "user-pat",
    }),
    resetClockPin: async (staffId) => ({
      staffId,
      agencyId: "agency-1",
      employeeIdNumber: "1001",
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: new Date().toISOString(),
      updatedBy: "user-pat",
    }),
    listClockCredentials: async () => [],
    unlockCredential: async (staffId) => ({
      staffId,
      agencyId: "agency-1",
      employeeIdNumber: "1001",
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: new Date().toISOString(),
      updatedBy: "user-pat",
    }),
    listOpenPunches: async () => [],
    listMissedPunchReports: async () => [],
    reportMissedPunch: async (input) => ({
      id: "mrp1",
      agencyId: "agency-1",
      staffId: input.staffId,
      siteId: input.siteId ?? null,
      workDate: input.workDate,
      claimedInAt: input.claimedInAt ?? null,
      claimedOutAt: input.claimedOutAt ?? null,
      reason: input.reason,
      status: "pending" as const,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      createdAt: new Date().toISOString(),
    }),
    decideMissedPunchReport: async (id, approve, note) => ({
      id,
      agencyId: "agency-1",
      staffId: "user-alex",
      siteId: "site-1",
      workDate: "2026-09-16",
      claimedInAt: "2026-09-16T08:00:00",
      claimedOutAt: null,
      reason: "Forgot",
      status: (approve ? "approved" : "denied") as "approved" | "denied",
      reviewedBy: "user-pat",
      reviewedAt: new Date().toISOString(),
      reviewNote: note?.trim() ? note.trim() : null,
      createdAt: new Date().toISOString(),
    }),
    getPunchRules: async () => ({
      agencyId: "agency-1",
      roundingMinutes: 15,
      roundingApplies: "payroll" as const,
      graceMinutes: 5,
      autoClockoutBufferMinutes: 30,
      autoApprovalScoreThreshold: 90,
      updatedBy: null,
      updatedAt: new Date().toISOString(),
    }),
    savePunchRules: async (patch) => ({
      agencyId: "agency-1",
      roundingMinutes: patch.roundingMinutes ?? 15,
      roundingApplies: patch.roundingApplies ?? ("payroll" as const),
      graceMinutes: patch.graceMinutes ?? 5,
      autoClockoutBufferMinutes: patch.autoClockoutBufferMinutes ?? 30,
      autoApprovalScoreThreshold: patch.autoApprovalScoreThreshold ?? 90,
      updatedBy: "user-pat",
      updatedAt: new Date().toISOString(),
    }),
  };
  void notFound;
  return store;
}

function render(session: SessionUser, initialTab?: string): string {
  return renderToStaticMarkup(
    <EmployeeHubShell session={session} store={makeStubStore()} staffList={staffList} sites={sites} initialTab={initialTab} />,
  );
}

function renderWith(session: SessionUser, store: HrStore, initialTab?: string): string {
  return renderToStaticMarkup(
    <EmployeeHubShell session={session} store={store} staffList={staffList} sites={sites} initialTab={initialTab} />,
  );
}

const EMPLOYEE_TAB_LABELS = ["My Schedule", "Staffing", "Time Clock", "My Timecard", "My Compliance", "Documents", "Time Off"];
const MANAGER_TAB_LABELS = ["Team Schedule", "Attendance", "Timecards", "Team Compliance", "Payroll"];

describe("EmployeeHubShell", () => {
  it("renders the page heading", () => {
    const html = render(pmSession);
    assert.ok(html.includes("Employee Hub"), "heading");
  });

  it("shows all employee tabs for a program manager", () => {
    const html = render(pmSession);
    for (const label of EMPLOYEE_TAB_LABELS) {
      assert.ok(html.includes(label), `employee tab "${label}"`);
    }
  });

  it("shows all manager tabs for a program manager", () => {
    const html = render(pmSession);
    for (const label of MANAGER_TAB_LABELS) {
      assert.ok(html.includes(label), `manager tab "${label}"`);
    }
  });

  it("shows employee tabs but no manager tabs for a dsp", () => {
    const html = render(dspSession);
    for (const label of EMPLOYEE_TAB_LABELS) {
      assert.ok(html.includes(label), `employee tab "${label}"`);
    }
    for (const label of MANAGER_TAB_LABELS) {
      assert.ok(!html.includes(label), `manager tab "${label}" hidden`);
    }
  });

  it("honours initialTab", () => {
    const html = render(pmSession, "payroll");
    assert.ok(html.includes("Export-first payroll"), "payroll tab content");
    assert.ok(html.includes('aria-selected="true"'), "selected tab marked");
  });

  it("defaults to the first employee tab", () => {
    const html = render(pmSession);
    // "My Schedule" is the first tab and its content renders by default.
    assert.ok(html.includes("My Schedule"), "default tab label");
  });
});

function renderBoard(editable: boolean): string {
  return renderToStaticMarkup(
    <StaffingBoard
      patterns={BOARD_PATTERNS}
      staffList={staffList}
      sites={sites}
      editable={editable}
      loading={false}
      error=""
      onEdit={() => {}}
      onToggleActive={() => {}}
    />,
  );
}

const BOARD_PATTERNS: HrStaffingPattern[] = [
  {
    id: "pat-1",
    agencyId: "agency-1",
    siteId: null,
    staffId: "user-alex",
    staffName: "Alex Rivera",
    individualId: null,
    individualName: "Demo Client A",
    siteName: null,
    shiftLabel: null,
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: "07:30", end: "08:30" },
      { start: "16:30", end: "17:30" },
    ],
    weeklyHours: 10,
    serviceTags: ["In-Home Respite"],
    requiresIsdTraining: true,
    onCall: false,
    notes: null,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "pat-2",
    agencyId: "agency-1",
    siteId: "site-1",
    staffId: "user-sam",
    staffName: "Sam Chen",
    individualId: null,
    individualName: null,
    siteName: "Maple House",
    shiftLabel: "1st shift",
    days: [6, 0],
    windows: [{ start: "07:00", end: "15:00" }],
    weeklyHours: 16,
    serviceTags: ["Residential"],
    requiresIsdTraining: false,
    onCall: true,
    notes: null,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    active: true,
  },
];

describe("Staffing tab", () => {
  it("shows the staffing config to a program manager with hub.manage_staffing", () => {
    const html = render(pmSession, "staffing");
    assert.ok(html.includes("Add pattern"), "add-pattern button");
  });

  it("shows a read-only staffing tab to a dsp without hub.manage_staffing", () => {
    const html = render(dspSession, "staffing");
    assert.ok(html.includes("Staffing"), "tab renders");
    assert.ok(!html.includes("Add pattern"), "no add-pattern button");
    assert.ok(html.includes("Read-only view"), "read-only notice");
  });

  it("staffing board renders day chips, window pills, tags, and flags", () => {
    const html = renderBoard(false);
    // Day chips (Mon..Sun, active days highlighted).
    assert.ok(html.includes("Mon"), "Mon chip");
    assert.ok(html.includes("Sun"), "Sun chip");
    assert.ok(html.includes("hub-day-chip on"), "highlighted days");
    // Window pills via formatWindowLabel.
    assert.ok(html.includes("7:30a"), "morning window pill");
    assert.ok(html.includes("4:30p"), "afternoon window pill");
    // Assignment lines.
    assert.ok(html.includes("Demo Client A"), "individual assignment");
    assert.ok(html.includes("1st shift"), "shift label");
    // Service tag + flags.
    assert.ok(html.includes("In-Home Respite"), "service tag");
    assert.ok(html.includes("ISD training required"), "ISD flag");
    assert.ok(html.includes("On call"), "on-call flag");
    // Week-hours badges: per-staff totals in the staff headers.
    assert.ok(html.includes("10h/week"), "staff week hours");
    assert.ok(html.includes("16h/week"), "second staff week hours");
  });

  it("editable board shows edit and deactivate controls; read-only board hides them", () => {
    const editableHtml = renderBoard(true);
    assert.ok(editableHtml.includes("Deactivate"), "deactivate control");
    assert.ok(editableHtml.includes("Edit staffing pattern for"), "edit control");
    const readOnlyHtml = renderBoard(false);
    assert.ok(!readOnlyHtml.includes("Deactivate"), "no deactivate control");
    assert.ok(!readOnlyHtml.includes("Edit staffing pattern for"), "no edit control");
  });
});

describe("staffing pattern domain", () => {
  it("accepts a well-formed pattern", () => {
    const errors = validateStaffingPattern({
      staffId: "user-alex",
      days: [1, 2, 3, 4, 5],
      windows: [
        { start: "07:30", end: "08:30" },
        { start: "16:30", end: "17:30" },
      ],
      weeklyHours: 10,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
    });
    assert.deepEqual(errors, []);
  });

  it("rejects missing staff, no days, overlapping windows, and bad dates", () => {
    const errors = validateStaffingPattern({
      staffId: "",
      days: [],
      windows: [
        { start: "08:00", end: "12:00" },
        { start: "11:00", end: "14:00" },
      ],
      weeklyHours: 99,
      effectiveFrom: "bad-date",
      effectiveTo: null,
    });
    assert.ok(errors.length >= 4, `expected several errors, got: ${errors.join(" | ")}`);
  });

  it("computes weekly hours as days x windows", () => {
    assert.equal(
      computePatternWeeklyHours(
        [1, 2, 3, 4, 5],
        [
          { start: "07:30", end: "08:30" },
          { start: "16:30", end: "17:30" },
        ],
      ),
      10,
    );
    // Overnight window spans midnight.
    assert.equal(
      computePatternWeeklyHours([1], [{ start: "23:00", end: "07:00" }]),
      8,
    );
  });
});

describe("phase-2 domain adapters", () => {
  it("describes overtime rules in plain English", () => {
    assert.equal(
      describeOvertimeRules({
        weeklyThresholdHours: 40,
        dailyThresholdHours: null,
        seventhConsecutiveDay: false,
        seventhDayThresholdHours: 8,
      }),
      "Overtime after 40 hours per week.",
    );
    const full = describeOvertimeRules({
      weeklyThresholdHours: 40,
      dailyThresholdHours: 10,
      seventhConsecutiveDay: true,
      seventhDayThresholdHours: 8,
    });
    assert.ok(full.includes("Overtime after 40 hours per week."), "weekly");
    assert.ok(full.includes("Daily overtime after 10 hours in a day."), "daily");
    assert.ok(
      full.includes("Seventh consecutive day: overtime after 8 hours."),
      "seventh day",
    );
  });

  it("computes the current leave balance from the latest ledger entry", () => {
    const entries = [
      { id: "le-1", agencyId: "agency-1", staffId: "user-alex", payPeriodId: null as string | null, periodStart: "2026-08-01", leaveType: "pto" as const, accrued: 6.16, used: 0, adjustment: 0, balance: 6.16, note: null as string | null, createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "le-2", agencyId: "agency-1", staffId: "user-alex", payPeriodId: null as string | null, periodStart: "2026-09-01", leaveType: "pto" as const, accrued: 6.16, used: 8, adjustment: 0, balance: 4.32, note: null as string | null, createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    assert.equal(currentLeaveBalance(entries, "pto"), 4.32);
    assert.equal(currentLeaveBalance(entries, "sick"), 0, "other leave type");
    assert.equal(currentLeaveBalance([], "pto"), 0, "no entries");
  });

  it("computes requested hours as inclusive days x hours per day", () => {
    assert.equal(timeOffRequestHours("2026-09-20", "2026-09-22"), 24);
    assert.equal(timeOffRequestHours("2026-09-20", "2026-09-20"), 8);
    assert.throws(
      () => timeOffRequestHours("2026-09-20", "2026-09-19"),
      /cannot be before/,
      "inverted range throws",
    );
  });

  it("validates accrual policies", () => {
    assert.deepEqual(
      validateAccrualPolicy({
        leaveType: "pto",
        tenureBands: [{ minYears: 0, maxYears: null, hoursPerPeriod: 3.08 }],
        carryoverCapHours: 40,
        carryoverBasis: "calendar_year",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      }),
      [],
    );
    const problems = validateAccrualPolicy({
      leaveType: "pto",
      tenureBands: [],
      carryoverCapHours: -1,
      carryoverBasis: "calendar_year",
      effectiveFrom: "",
      effectiveTo: null,
    });
    assert.ok(problems.length >= 2, `expected errors, got: ${problems.join(" | ")}`);
  });

  it("validates time-off balances", () => {
    const within = validateTimeOffBalance(8, 40, "pto");
    assert.equal(within.ok, true, "within balance");
    assert.equal(within.errors.length, 0);
    const exceeds = validateTimeOffBalance(48, 40, "pto");
    assert.equal(exceeds.ok, false, "exceeding balance is not ok");
    assert.ok(exceeds.errors.length > 0, "has errors");
    const low = validateTimeOffBalance(36, 40, "pto");
    assert.equal(low.ok, true, "still ok under the balance");
    assert.ok(low.warnings.length > 0, "warns about low remaining balance");
  });

  it("validates shift swaps", () => {
    const shift = {
      id: "shift-1",
      agencyId: "agency-1",
      staffId: "user-alex",
      siteId: null as string | null,
      title: "Day shift",
      startsAt: "2026-09-20T09:00:00.000Z",
      endsAt: "2026-09-20T17:00:00.000Z",
      status: "published" as const,
      notes: null as string | null,
      createdBy: "user-pat",
    };
    const valid = validateShiftSwap({
      offeredShift: shift,
      requesterId: "user-alex",
      requesterShifts: [],
      claimerId: "user-pat",
      claimerShifts: [],
      claimedShift: null,
      nowIso: "2026-09-19T12:00:00.000Z",
    });
    assert.deepEqual(valid, []);
    const selfClaim = validateShiftSwap({
      offeredShift: shift,
      requesterId: "user-alex",
      requesterShifts: [],
      claimerId: "user-alex",
      claimerShifts: [],
      claimedShift: null,
      nowIso: "2026-09-19T12:00:00.000Z",
    });
    assert.ok(selfClaim.length > 0, "requester cannot claim their own shift");
    const pastShift = validateShiftSwap({
      offeredShift: { ...shift, startsAt: "2026-09-18T09:00:00.000Z", endsAt: "2026-09-18T17:00:00.000Z" },
      requesterId: "user-alex",
      requesterShifts: [],
      claimerId: "user-pat",
      claimerShifts: [],
      claimedShift: null,
      nowIso: "2026-09-19T12:00:00.000Z",
    });
    assert.ok(pastShift.length > 0, "past shifts are not eligible");
  });

  it("guards swap claiming: never on own posting, only pending and open/targeted", () => {
    const base = {
      id: "sw-1",
      agencyId: "agency-1",
      requesterId: "user-pat",
      offeredShiftId: "shift-1",
      requestedShiftId: null,
      targetStaffId: null as string | null,
      status: "pending",
      decidedBy: null as string | null,
      decidedAt: null as string | null,
      decisionNote: null as string | null,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    assert.equal(swapClaimable(base, "user-pat"), false, "own posting hidden");
    assert.equal(swapClaimable(base, "user-alex"), true, "open swap claimable");
    assert.equal(
      swapClaimable({ ...base, targetStaffId: "user-sam" }, "user-alex"),
      false,
      "targeted at someone else",
    );
    assert.equal(
      swapClaimable({ ...base, targetStaffId: "user-alex" }, "user-alex"),
      true,
      "targeted at me",
    );
    assert.equal(
      swapClaimable({ ...base, status: "approved" }, "user-alex"),
      false,
      "no longer pending",
    );
  });
});

describe("phase-2 pay settings", () => {
  it("shows overtime rules and accrual policy cards with hub.manage_pay_settings", () => {
    const html = renderWith(pmPaySession, makeStubStore(), "payroll");
    assert.ok(html.includes("Overtime rules"), "overtime rules card");
    assert.ok(html.includes("Accrual policies"), "accrual policies card");
    assert.ok(html.includes("Pay settings"), "pay settings section");
  });

  it("hides pay settings without hub.manage_pay_settings", () => {
    const html = renderWith(pmSession, makeStubStore(), "payroll");
    assert.ok(!html.includes("Overtime rules"), "no overtime rules card");
    assert.ok(!html.includes("Accrual policies"), "no accrual policies card");
  });

  it("renders the swap board for the dsp", () => {
    const html = renderWith(dspSession, makeStubStore(), "schedule");
    assert.ok(html.includes("Post a shift for swap"), "swap form");
    assert.ok(html.includes("Open swaps"), "open swaps list");
  });

  it("renders swap approvals on the team schedule for a manager", () => {
    const html = renderWith(pmSession, makeStubStore(), "team-schedule");
    assert.ok(html.includes("Shift swap approvals"), "approvals section");
  });
});
