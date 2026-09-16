/**
 * Kiosk time-clock manager UI tests (Worker 4).
 *
 * Mocked-store component tests: WhosHereNow, PunchExceptions,
 * MissedPunchReview, PunchRulesConfig, and KioskAdmin render from seeded
 * data (SSR has no effects, so components accept `initial*` seeds), plus
 * unit tests for the kiosk store adapter and the Worker 1 punch-insights
 * integration. Types are Worker 1's hr.ts shapes, which match the kiosk
 * migration. No real PII, no network, no localStorage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeHubShell, type HubStaffEntry, type HubSite } from "./EmployeeHubPage";
import { TimeClockTab } from "./EmployeeHubPage";
import { WhosHereNow } from "./WhosHereNow";
import { PunchExceptions } from "./PunchExceptions";
import { MissedPunchReview } from "./MissedPunchReview";
import { PunchRulesConfig, describePunchRules } from "./PunchRulesConfig";
import { KioskAdmin, KioskTokenReveal } from "./KioskAdmin";
import { RemotePunchAdmin } from "./RemotePunchAdmin";
import {
  adaptKioskStore,
  adaptRemotePunchStore,
  isKioskStoreAvailable,
  isRemotePunchAvailable,
  type ClockCredential,
  type KioskToken,
  type MissedPunchReport,
  type PunchRules,
  type RemotePunchGrant,
} from "./kioskContracts";
import {
  detectPunchExceptions,
  findAutoClockoutCandidates,
  remotePunchRows,
  scheduledVsActual,
  scoreTimecard,
  type PunchException,
} from "./punchInsights";
import { DEFAULT_PUNCH_RULES } from "../../data/hr";
import type { HrPunch, HrShift } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";

const PM_PERMISSIONS: Record<string, boolean> = {
  "hub.access": true,
  "hub.manage_schedule": true,
  "hub.manage_staffing": true,
  "hub.review_timecards": true,
  "hub.approve_time_off": true,
  "hub.view_team": true,
  "hub.approve_payroll": true,
  "hub.manage_documents": true,
  "hub.manage_pay_settings": true,
};

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "user-pat",
    email: "pat@example.com",
    username: "pmorgan",
    fullName: "Pat Morgan",
    jobTitle: "Program Manager",
    role: "program_manager",
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST01",
    siteId: "site-1",
    mustChangePassword: false,
    expiresOn: null,
    permissions: PM_PERMISSIONS,
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

const staffList: HubStaffEntry[] = [
  { userId: "user-pat", fullName: "Pat Morgan", email: "pat@example.com", roleKey: "program_manager", siteId: "site-1" },
  { userId: "user-alex", fullName: "Alex Rivera", email: "alex.rivera@example.com", roleKey: "dsp", siteId: "site-1" },
  { userId: "user-sam", fullName: "Sam Chen", email: "sam@example.com", roleKey: "dsp", siteId: "site-2" },
];

const sites: HubSite[] = [
  { id: "site-1", name: "Maple House" },
  { id: "site-2", name: "Oak House" },
];

function punch(overrides: Partial<HrPunch>): HrPunch {
  return {
    id: "punch-1",
    agencyId: "agency-1",
    siteId: "site-1",
    staffId: "user-alex",
    kind: "in",
    punchedAt: "2026-09-16T08:00:00",
    source: "kiosk",
    note: null,
    shiftId: null,
    ...overrides,
  };
}

function shift(overrides: Partial<HrShift> = {}): HrShift {
  return {
    id: "shift-1",
    agencyId: "agency-1",
    siteId: "site-1",
    staffId: "user-alex",
    title: "DSP day shift",
    startsAt: "2026-09-16T08:00:00",
    endsAt: "2026-09-16T16:00:00",
    status: "published",
    notes: null,
    createdBy: "user-pat",
    ...overrides,
  };
}

const RULES: PunchRules = {
  agencyId: "agency-1",
  roundingMinutes: 5,
  roundingApplies: "payroll",
  graceMinutes: 5,
  autoClockoutBufferMinutes: 30,
  autoApprovalScoreThreshold: 90,
  updatedBy: null,
  updatedAt: "2026-09-16T09:00:00",
};

/**
 * Stub store carrying the full kiosk surface (Worker 3's 14 methods) so
 * components render their real UI instead of the setup note. Only the
 * "still being set up" tests use a bare store.
 */
function makeKioskStore(): HrStore {
  const credential = (staffId: string) => ({
    staffId,
    agencyId: "agency-1",
    employeeIdNumber: "1042",
    failedAttempts: 0,
    lockedUntil: null,
    pinUpdatedAt: "2026-09-16T09:00:00",
    updatedBy: "user-pat",
  });
  return {
    listKioskTokens: async () => [],
    generateKioskToken: async (siteId: string, label: string) => ({
      token: {
        id: "tok-1",
        agencyId: "agency-1",
        siteId,
        label,
        active: true,
        createdBy: "user-pat",
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      },
      rawToken: "raw-token-stub",
    }),
    revokeKioskToken: async () => {},
    rotateKioskToken: async (id: string) => ({
      token: {
        id: "tok-2",
        agencyId: "agency-1",
        siteId: "site-1",
        label: `rotated from ${id}`,
        active: true,
        createdBy: "user-pat",
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      },
      rawToken: "raw-token-stub-2",
    }),
    issueClockCredential: async (staffId: string) => credential(staffId),
    resetClockPin: async (staffId: string) => credential(staffId),
    listClockCredentials: async () => [],
    unlockCredential: async (staffId: string) => credential(staffId),
    listOpenPunches: async () => [],
    listMissedPunchReports: async () => [],
    reportMissedPunch: async (input: {
      staffId: string;
      siteId?: string | null;
      workDate: string;
      claimedInAt?: string | null;
      claimedOutAt?: string | null;
      reason: string;
    }) => ({
      id: "mrp-1",
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
    decideMissedPunchReport: async (id: string, approve: boolean, note?: string) => ({
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
    getPunchRules: async () => RULES,
    savePunchRules: async (patch: Partial<PunchRules>) => ({ ...RULES, ...patch }),
  } as unknown as HrStore;
}

/* ------------------------------ WhosHereNow ------------------------------ */

describe("WhosHereNow", () => {
  it("lists open punches with elapsed time, shift label, and remote chip", () => {
    const ninetyMinAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    const openPunches: HrPunch[] = [
      punch({
        id: "op-1",
        punchedAt: ninetyMinAgo,
        shiftId: "shift-1",
        verificationMethod: "kiosk_pin",
        remote: true,
      }),
    ];
    const store = makeKioskStore();
    const html = renderToStaticMarkup(
      <WhosHereNow
        session={makeSession()}
        store={store}
        staffList={staffList}
        sites={sites}
        initialOpenPunches={openPunches}
        initialShifts={[shift()]}
      />,
    );
    assert.ok(html.includes("Who&#x27;s here now") || html.includes("Who's here now"));
    assert.ok(html.includes("Alex Rivera"), "staff name is listed");
    assert.ok(html.includes("1h 30m"), "elapsed time is shown");
    assert.ok(html.includes("DSP day shift"), "scheduled shift label is shown");
    assert.ok(html.includes("kiosk pin"), "verification method chip is shown");
    assert.ok(html.includes("Remote"), "remote punch chip is shown");
    assert.ok(!html.includes("<img"), "no photo thumbnails");
  });

  it("renders a setup note when the kiosk store surface is missing", () => {
    const store = {} as unknown as HrStore;
    assert.equal(isKioskStoreAvailable(store), false);
    const html = renderToStaticMarkup(
      <WhosHereNow session={makeSession()} store={store} staffList={staffList} sites={sites} />,
    );
    assert.ok(html.includes("still being set up"));
  });

  it("shows the site picker to multi-site managers only", () => {
    const store = makeKioskStore();
    const managerHtml = renderToStaticMarkup(
      <WhosHereNow session={makeSession()} store={store} staffList={staffList} sites={sites} initialOpenPunches={[]} />,
    );
    assert.ok(managerHtml.includes("All sites"), "manager sees the site picker");
    const hmHtml = renderToStaticMarkup(
      <WhosHereNow
        session={makeSession({
          role: "manager",
          permissions: { "hub.access": true, "hub.view_team": true, "hub.manage_staffing": false },
        })}
        store={store}
        staffList={staffList}
        sites={sites}
        initialOpenPunches={[]}
      />,
    );
    assert.ok(!hmHtml.includes("All sites"), "house manager sees their site only");
  });
});

/* ---------------------------- PunchExceptions ---------------------------- */

describe("PunchExceptions", () => {
  const seeded: PunchException[] = [
    {
      kind: "late",
      staffId: "user-alex",
      detail: "Clocked in 12 min after the DSP day shift start.",
      at: "2026-09-16T08:12:00",
      punchId: "punch-1",
    },
    {
      kind: "overtime_trending",
      staffId: "user-sam",
      detail: "Actual paired minutes exceed scheduled minutes for 2026-09-16.",
      at: "2026-09-16T12:00:00",
      punchId: null,
    },
    {
      kind: "remote",
      staffId: "user-alex",
      detail: "Punched in from a personal device at 8:00 AM — reviewable, not a scoring demerit.",
      at: "2026-09-16T08:00:00",
      punchId: "punch-remote",
    },
  ];

  it("renders filter chips with counts and one-tap actions per row", () => {
    const store = {} as unknown as HrStore;
    const html = renderToStaticMarkup(
      <PunchExceptions
        session={makeSession()}
        store={store}
        staffList={staffList}
        sites={sites}
        initialExceptions={seeded}
      />,
    );
    assert.ok(html.includes("Punch exceptions"));
    assert.ok(html.includes("Late (1)"), "late filter chip with count");
    assert.ok(html.includes("Overtime trending (1)"), "overtime filter chip with count");
    assert.ok(html.includes("Remote (1)"), "remote filter chip with count");
    assert.ok(html.includes("Alex Rivera"));
    assert.ok(html.includes("Sam Chen"));
    assert.ok(html.includes("Approve"), "one-tap approve action");
    assert.ok(html.includes("Flag"), "one-tap flag action");
    assert.ok(html.includes("Review upcoming shifts"), "overtime hint for system-level rows");
    assert.ok(html.includes("not a scoring demerit"), "remote hint for review rows");
    assert.ok(!html.includes("<img"), "no photo thumbnails");
  });

  it("shows an empty state when there is nothing flagged", () => {
    const store = {} as unknown as HrStore;
    const html = renderToStaticMarkup(
      <PunchExceptions
        session={makeSession()}
        store={store}
        staffList={staffList}
        sites={sites}
        initialExceptions={[]}
      />,
    );
    assert.ok(html.includes("No exceptions"));
  });
});

/* ---------------------------- MissedPunchReview --------------------------- */

describe("MissedPunchReview", () => {
  const reports: MissedPunchReport[] = [
    {
      id: "mpr-1",
      agencyId: "agency-1",
      staffId: "user-alex",
      siteId: "site-1",
      workDate: "2026-09-15",
      claimedInAt: null,
      claimedOutAt: "2026-09-15T16:05:00",
      reason: "Kiosk was unplugged at clock-out.",
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      createdAt: "2026-09-15T16:10:00",
    },
    {
      id: "mpr-2",
      agencyId: "agency-1",
      staffId: "user-sam",
      siteId: "site-2",
      workDate: "2026-09-14",
      claimedInAt: "2026-09-14T08:02:00",
      claimedOutAt: null,
      reason: "Forgot to clock in.",
      status: "approved",
      reviewedBy: "user-pat",
      reviewedAt: "2026-09-14T12:00:00",
      reviewNote: "Verified against the house log.",
      createdAt: "2026-09-14T08:05:00",
    },
  ];

  it("lists pending reports with decide actions and decided history", () => {
    const store = makeKioskStore();
    const html = renderToStaticMarkup(
      <MissedPunchReview
        session={makeSession()}
        store={store}
        staffList={staffList}
        initialReports={reports}
      />,
    );
    assert.ok(html.includes("Missed-punch review"));
    assert.ok(html.includes("Alex Rivera"), "pending report staff");
    assert.ok(html.includes("Clock out →"), "claimed clock-out label");
    assert.ok(html.includes("Kiosk was unplugged"), "reason");
    assert.ok(html.includes("Decide"), "decide action");
    assert.ok(html.includes("Decided (1)"), "decided history section");
    assert.ok(html.includes("Verified against the house log"), "review note in history");
    assert.ok(html.includes("Clock in →"), "claimed clock-in label on the decided row");
  });
});

/* ---------------------------- PunchRulesConfig --------------------------- */

describe("PunchRulesConfig", () => {
  it("shows the plain-English summary of the active rules", () => {
    const store = {} as unknown as HrStore;
    const html = renderToStaticMarkup(
      <PunchRulesConfig store={store} initialRules={RULES} />,
    );
    assert.ok(html.includes("Clock settings"));
    assert.ok(html.includes("rounded to the nearest 5 minutes"), "rounding summary");
    assert.ok(html.includes("for payroll only"), "rounding scope summary");
    assert.ok(html.includes("within 5 minutes of a shift start"), "grace summary");
    assert.ok(html.includes("30 minutes after their shift end"), "auto-clock-out summary");
    assert.ok(html.includes("scoring 90 or higher"), "auto-approval summary");
  });

  it("describePunchRules covers the off states", () => {
    const summary = describePunchRules({
      ...RULES,
      roundingMinutes: 0,
      autoClockoutBufferMinutes: 0,
      autoApprovalScoreThreshold: 0,
    });
    assert.ok(summary.includes("not rounded"));
    assert.ok(summary.includes("Automatic clock-out is off"));
    assert.ok(summary.includes("No timecard auto-approvals"));
  });

  it("adaptKioskStore translates the Worker-3 rules shape to the migration shape", async () => {
    const w3rules = {
      agencyId: "agency-1",
      clockInGraceMinutes: 7,
      clockOutGraceMinutes: 7,
      roundToMinutes: 10,
      maxShiftHours: 16,
      requireAttestation: false,
      requirePhoto: false,
      updatedBy: null,
      updatedAt: "2026-09-16T09:00:00",
    };
    let savedPatch: unknown = null;
    const store = {
      getPunchRules: async () => w3rules,
      savePunchRules: async (patch: unknown) => {
        savedPatch = patch;
        return { ...w3rules, roundToMinutes: 5, clockInGraceMinutes: 3, clockOutGraceMinutes: 3 };
      },
    } as unknown as HrStore;
    const kiosk = adaptKioskStore(store);
    const loaded = await kiosk.getPunchRules();
    assert.equal(loaded.roundingMinutes, 10, "roundToMinutes maps to roundingMinutes");
    assert.equal(loaded.graceMinutes, 7, "clockInGraceMinutes maps to graceMinutes");
    const saved = await kiosk.savePunchRules({ roundingMinutes: 5, graceMinutes: 3 });
    assert.ok(savedPatch && typeof savedPatch === "object", "a patch was passed to the store");
    assert.equal(saved.roundingMinutes, 5);
    assert.equal(saved.graceMinutes, 3);
  });

  it("adaptKioskStore rejects with a setup error when methods are missing", async () => {
    const kiosk = adaptKioskStore({} as unknown as HrStore);
    await assert.rejects(() => kiosk.listOpenPunches("site-1"), /still being set up/);
    await assert.rejects(() => kiosk.getPunchRules(), /still being set up/);
  });

  it("hr.ts DEFAULT_PUNCH_RULES carries the migration defaults", () => {
    assert.equal(DEFAULT_PUNCH_RULES.roundingMinutes, 0);
    assert.equal(DEFAULT_PUNCH_RULES.roundingApplies, "payroll");
    assert.equal(DEFAULT_PUNCH_RULES.graceMinutes, 5);
    assert.equal(DEFAULT_PUNCH_RULES.autoClockoutBufferMinutes, 30);
    assert.equal(DEFAULT_PUNCH_RULES.autoApprovalScoreThreshold, 90);
  });
});

/* ------------------------------- KioskAdmin ------------------------------ */

describe("KioskAdmin", () => {
  const tokens: KioskToken[] = [
    {
      id: "tok-1",
      agencyId: "agency-1",
      siteId: "site-1",
      label: "Front desk",
      active: true,
      createdBy: "user-pat",
      createdAt: "2026-09-10T09:00:00",
      lastUsedAt: null,
      revokedAt: null,
    },
  ];
  const credentials: ClockCredential[] = [
    {
      staffId: "user-alex",
      agencyId: "agency-1",
      employeeIdNumber: "1042",
      failedAttempts: 0,
      lockedUntil: null,
      pinUpdatedAt: "2026-09-10T09:00:00",
      updatedBy: "user-pat",
    },
  ];

  it("lists tokens with rotate/revoke and credentials with reset", () => {
    const store = makeKioskStore();
    const html = renderToStaticMarkup(
      <KioskAdmin
        session={makeSession()}
        store={store}
        sites={sites}
        staffList={staffList}
        initialTokens={tokens}
        initialCredentials={credentials}
      />,
    );
    assert.ok(html.includes("Pairing tokens"));
    assert.ok(html.includes("Front desk"), "token label");
    assert.ok(html.includes("Maple House"), "token site");
    assert.ok(html.includes("Rotate"), "rotate action");
    assert.ok(html.includes("Revoke"), "revoke action");
    assert.ok(html.includes("Clock credentials"));
    assert.ok(html.includes("Alex Rivera"), "credential staff");
    assert.ok(html.includes("ID 1042"), "employee ID number");
    assert.ok(html.includes("Reset PIN"), "reset action");
    assert.ok(html.includes("never recoverable"), "PIN warning");
  });

  it("gates the token section on hub.manage_staffing and credentials on hub.manage_pay_settings", () => {
    const store = makeKioskStore();
    const staffingOnly = renderToStaticMarkup(
      <KioskAdmin
        session={makeSession({
          permissions: { "hub.access": true, "hub.manage_staffing": true, "hub.manage_pay_settings": false },
        })}
        store={store}
        sites={sites}
        staffList={staffList}
        initialTokens={tokens}
        initialCredentials={credentials}
      />,
    );
    assert.ok(staffingOnly.includes("Pairing tokens"));
    assert.ok(!staffingOnly.includes("Clock credentials"), "credentials hidden without hub.manage_pay_settings");

    const payOnly = renderToStaticMarkup(
      <KioskAdmin
        session={makeSession({
          permissions: { "hub.access": true, "hub.manage_staffing": false, "hub.manage_pay_settings": true },
        })}
        store={store}
        sites={sites}
        staffList={staffList}
        initialTokens={tokens}
        initialCredentials={credentials}
      />,
    );
    assert.ok(!payOnly.includes("Pairing tokens"), "tokens hidden without hub.manage_staffing");
    assert.ok(payOnly.includes("Clock credentials"));
  });

  it("KioskTokenReveal shows the token once with the kiosk URL and bookmark instructions", () => {
    const html = renderToStaticMarkup(
      <KioskTokenReveal
        title="New token"
        secret="raw-token-abc123"
        secretLabel="Pairing token — shown once"
        kioskUrl="https://app.example.com/#/clock/k/raw-token-abc123"
        warning="Copy it now. It won't be shown again."
        onDismiss={() => {}}
      />,
    );
    assert.ok(html.includes("raw-token-abc123"), "raw token shown");
    assert.ok(html.includes("#/clock/k/raw-token-abc123"), "full kiosk URL shown");
    assert.ok(html.includes("bookmark this on the house laptop"), "bookmark instructions");
    assert.ok(html.includes("Copy URL"), "copy action");
  });
});

/* ------------------------------ shell wiring ----------------------------- */

describe("EmployeeHubShell kiosk tab", () => {
  it("shows the Kiosk tab to managers and the setup note before the store lands", () => {
    const store = {
      listPayPeriods: async () => [],
    } as unknown as HrStore;
    const html = renderToStaticMarkup(
      <EmployeeHubShell
        session={makeSession()}
        store={store}
        staffList={staffList}
        sites={sites}
        initialTab="kiosk"
      />,
    );
    assert.ok(html.includes("Kiosk"), "Kiosk tab is present");
    assert.ok(html.includes("still being set up"), "setup note renders before the store surface lands");
  });
});

/* ----------------------------- punch insights ---------------------------- */

describe("punchInsights (Worker 1 integration)", () => {
  it("detectPunchExceptions flags late and offline punches", () => {
    const exceptions = detectPunchExceptions({
      punches: [
        punch({
          id: "p-in",
          kind: "in",
          punchedAt: "2026-09-16T08:12:00",
          verificationMethod: "kiosk_pin",
        }),
        punch({
          id: "p-out",
          kind: "out",
          punchedAt: "2026-09-16T16:00:00",
          verificationMethod: "kiosk_pin",
          offline: true,
        }),
      ],
      shifts: [shift()],
      rules: RULES,
      nowIso: "2026-09-16T17:00:00",
    });
    const kinds = exceptions.map((e) => e.kind);
    assert.ok(kinds.includes("late"), "12 min past a 5-min grace is late");
    assert.ok(kinds.includes("offline"), "offline punches are flagged");
    const late = exceptions.find((e) => e.kind === "late");
    assert.equal(late?.punchId, "p-in");
  });

  it("remotePunchRows lists personal-device punches as reviewable, not demerits", () => {
    const punches = [
      punch({ id: "p-r-in", kind: "in", punchedAt: "2026-09-16T08:00:00", remote: true }),
      punch({ id: "p-r-out", kind: "out", punchedAt: "2026-09-16T16:00:00", remote: true }),
      punch({ id: "p-k-in", kind: "in", punchedAt: "2026-09-16T08:00:00" }),
    ];
    const rows = remotePunchRows(punches);
    assert.equal(rows.length, 2, "only remote punches produce rows");
    assert.ok(rows.every((r) => r.kind === "remote"));
    assert.ok(rows[0].detail.includes("personal device"));
    assert.ok(rows[0].detail.includes("not a scoring demerit"));

    // Remote punches never lower the timecard score.
    const scored = scoreTimecard({
      punches: [
        punch({ id: "p-r-in", kind: "in", punchedAt: "2026-09-16T08:00:00", remote: true }),
        punch({ id: "p-r-out", kind: "out", punchedAt: "2026-09-16T16:00:00", remote: true }),
      ],
      shifts: [shift()],
      rules: RULES,
      nowIso: "2026-09-16T17:00:00",
    });
    assert.equal(scored.score, 100, "on-time remote punches score 100");
    assert.equal(scored.autoApprovable, true, "remote punches are not scoring demerits");
  });

  it("findAutoClockoutCandidates surfaces still-open punches past the buffer", () => {
    const candidates = findAutoClockoutCandidates({
      openPunches: [
        punch({ id: "p-open", kind: "in", punchedAt: "2026-09-16T08:00:00", shiftId: "shift-1" }),
      ],
      shifts: [shift()],
      rules: RULES,
      nowIso: "2026-09-16T17:00:00",
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].punch.id, "p-open");
    assert.equal(candidates[0].shift.id, "shift-1");
    assert.equal(candidates[0].clockOutAt, "2026-09-16T16:00:00");
  });

  it("scheduledVsActual reports per-day scheduled, actual, and variance", () => {
    const rows = scheduledVsActual({
      staffId: "user-alex",
      punches: [
        punch({ id: "p-in", kind: "in", punchedAt: "2026-09-16T08:00:00" }),
        punch({ id: "p-out", kind: "out", punchedAt: "2026-09-16T15:30:00" }),
      ],
      shifts: [shift()],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, "2026-09-16");
    assert.equal(rows[0].scheduledMinutes, 480);
    assert.equal(rows[0].actualMinutes, 450);
    assert.equal(rows[0].varianceMinutes, -30);
    assert.deepEqual(rows[0].shiftLabels, ["DSP day shift"]);
  });

  it("scoreTimecard penalizes flags and gates auto-approval on hard flags", () => {
    const flagged = scoreTimecard({
      punches: [
        punch({
          id: "p-in",
          kind: "in",
          punchedAt: "2026-09-16T08:12:00",
          verificationMethod: "kiosk_pin",
        }),
        punch({
          id: "p-out",
          kind: "out",
          punchedAt: "2026-09-16T16:00:00",
          verificationMethod: "kiosk_pin",
          offline: true,
        }),
      ],
      shifts: [shift()],
      rules: RULES,
      nowIso: "2026-09-16T17:00:00",
    });
    assert.ok(flagged.score < 100, `late + offline lowers the score (got ${flagged.score})`);
    assert.equal(flagged.autoApprovable, false, "offline punch blocks auto-approval");

    const clean = scoreTimecard({
      punches: [
        punch({
          id: "p-in",
          kind: "in",
          punchedAt: "2026-09-16T08:00:00",
          verificationMethod: "kiosk_pin",
        }),
        punch({
          id: "p-out",
          kind: "out",
          punchedAt: "2026-09-16T16:00:00",
          verificationMethod: "kiosk_pin",
        }),
      ],
      shifts: [shift()],
      rules: RULES,
      nowIso: "2026-09-16T17:00:00",
    });
    assert.equal(clean.score, 100);
    assert.equal(clean.autoApprovable, true, "a clean timecard at threshold 90 auto-approves");
  });
});

/* ---------------------------- RemotePunchAdmin --------------------------- */

describe("RemotePunchAdmin", () => {
  const grants: RemotePunchGrant[] = [
    {
      staffId: "user-alex",
      grantedBy: "user-pat",
      grantedAt: "2026-09-10T09:00:00",
      employeeIdNumber: null,
    },
  ];

  function makeRemoteStore(grantList: RemotePunchGrant[] = grants): HrStore {
    return {
      hasRemotePunch: async (staffId: string) => grantList.some((g) => g.staffId === staffId),
      grantRemotePunch: async (staffId: string) => ({
        staffId,
        grantedBy: "user-pat",
        grantedAt: new Date().toISOString(),
        employeeIdNumber: null,
      }),
      revokeRemotePunch: async () => {},
      listRemotePunchGrants: async () => grantList,
    } as unknown as HrStore;
  }

  it("lists staff with grant status and granted-by/when", () => {
    const html = renderToStaticMarkup(
      <RemotePunchAdmin
        session={makeSession()}
        store={makeRemoteStore()}
        staffList={staffList}
        initialGrants={grants}
      />,
    );
    assert.ok(html.includes("Remote punch access"));
    assert.ok(html.includes("Alex Rivera"), "granted staff listed");
    assert.ok(html.includes("Granted"), "grant status chip");
    assert.ok(html.includes("Pat Morgan"), "granted-by name shown");
    assert.ok(html.includes("Revoke"), "revoke action for granted staff");
    assert.ok(html.includes("Sam Chen"), "ungranted staff listed");
    assert.ok(html.includes("Kiosk only"), "ungranted status chip");
    assert.ok(html.includes("Grant"), "grant action for ungranted staff");
  });

  it("hides entirely without hub.manage_pay_settings", () => {
    const html = renderToStaticMarkup(
      <RemotePunchAdmin
        session={makeSession({
          permissions: { "hub.access": true, "hub.manage_staffing": true, "hub.manage_pay_settings": false },
        })}
        store={makeRemoteStore()}
        staffList={staffList}
        initialGrants={grants}
      />,
    );
    assert.equal(html, "", "nothing renders without the permission");
  });

  it("shows a setup note before the remote surface lands", () => {
    const store = {} as unknown as HrStore;
    assert.equal(isRemotePunchAvailable(store), false);
    const html = renderToStaticMarkup(
      <RemotePunchAdmin session={makeSession()} store={store} staffList={staffList} />,
    );
    assert.ok(html.includes("still being set up"));
  });

  it("adaptRemotePunchStore normalizes grants and rejects when methods are missing", async () => {
    const remote = adaptRemotePunchStore(makeRemoteStore());
    assert.equal(await remote.hasRemotePunch("user-alex"), true);
    assert.equal(await remote.hasRemotePunch("user-sam"), false);
    const list = await remote.listRemotePunchGrants();
    assert.equal(list.length, 1);
    assert.equal(list[0].grantedBy, "user-pat");
    const granted = await remote.grantRemotePunch("user-sam");
    assert.equal(granted.staffId, "user-sam");

    const missing = adaptRemotePunchStore({} as unknown as HrStore);
    await assert.rejects(() => missing.listRemotePunchGrants(), /still being set up/);
    await assert.rejects(() => missing.hasRemotePunch("user-alex"), /still being set up/);
  });
});

/* ------------------------------ TimeClockTab ----------------------------- */

describe("TimeClockTab remote-punch gate", () => {
  const baseStore = {
    listPunches: async () => [],
  } as unknown as HrStore;

  it("replaces punch buttons with the kiosk message when the grant is denied", () => {
    const html = renderToStaticMarkup(
      <TimeClockTab
        session={makeSession()}
        store={baseStore}
        onChanged={() => {}}
        initialGrant="denied"
      />,
    );
    assert.ok(html.includes("Clock in on the house kiosk laptop"), "kiosk message shown");
    assert.ok(!html.includes("hub-clock-btn"), "no punch buttons available");
  });

  it("punches normally when the grant is allowed", () => {
    const html = renderToStaticMarkup(
      <TimeClockTab
        session={makeSession()}
        store={baseStore}
        onChanged={() => {}}
        initialGrant="allowed"
      />,
    );
    assert.ok(html.includes("Clock In"), "punch button available");
    assert.ok(!html.includes("Clock in on the house kiosk laptop"), "no kiosk message");
  });

  it("keeps legacy punching when the store predates the grant surface", () => {
    const html = renderToStaticMarkup(
      <TimeClockTab session={makeSession()} store={baseStore} onChanged={() => {}} />,
    );
    assert.ok(html.includes("Clock In"), "punch button available without the grant surface");
    assert.ok(!html.includes("Clock in on the house kiosk laptop"), "no kiosk message");
  });
});
