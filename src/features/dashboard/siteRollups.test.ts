import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anyRollupVisible,
  certificateSiteRollup,
  currentMonthKey,
  drillSiteRollup,
  investigationSiteRollup,
  medSiteRollup,
  rollupMetricVisibility,
  shiftNoteSiteRollup,
  toneBadgeStatus,
  trainingSiteRollup,
  worstTone,
} from "./siteRollups";
import type { EmergencyDrill } from "../../data/monthlyChecks";
import type { Investigation } from "../../data/investigations";
import type {
  ExpiringCertificate,
  MedSupplyStatus,
  SessionUser,
  StaffClearanceRow,
} from "../../data/types";
import type { SiteShiftNoteView } from "../../data/shiftNotes";

function drill(overrides: Partial<EmergencyDrill>): EmergencyDrill {
  return {
    id: "d1",
    agencyId: "a1",
    siteId: "s1",
    monthKey: "2026-09",
    drillType: "fire",
    date: "2026-09-10",
    time: "10:00",
    evacTime: "3:00",
    leaderName: "Jordan Lee",
    participants: "staff + individuals",
    awakeOrSleep: "awake",
    ...overrides,
  };
}

function session(
  roleKey: string,
  permissions: Record<string, boolean> = {},
): SessionUser {
  return {
    userId: "u1",
    email: "u@example.com",
    username: "u1",
    fullName: "Test User",
    jobTitle: "",
    role: roleKey as SessionUser["role"],
    roleKey,
    agencyId: "a1",
    agencyName: "Test Agency",
    agencyCode: "TEST",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions,
    platformAdmin: false,
    agencyStatus: "active",
  };
}

test("worstTone returns the most severe tone, ok for empty", () => {
  assert.equal(worstTone([]), "ok");
  assert.equal(worstTone(["ok", "warning", "ok"]), "warning");
  assert.equal(worstTone(["warning", "ok", "critical"]), "critical");
});

test("toneBadgeStatus maps to the app's Badge statuses", () => {
  assert.equal(toneBadgeStatus("ok"), "On track");
  assert.equal(toneBadgeStatus("warning"), "Needs attention");
  assert.equal(toneBadgeStatus("critical"), "Overdue");
});

test("drill rollup is ok when every required type for the month is complete", () => {
  // September requires fire + tornado + severe_weather.
  const rows = [
    drill({ id: "d1", drillType: "fire" }),
    drill({ id: "d2", drillType: "tornado" }),
    drill({ id: "d3", drillType: "severe_weather" }),
  ];
  const result = drillSiteRollup(rows, "s1", "2026-09", "2026-09-20", 7);
  assert.equal(result.allDone, true);
  assert.equal(result.tone, "ok");
  assert.equal(result.label, "3 of 3 drills complete");
  assert.deepEqual(result.missing, []);
});

test("drill rollup warns when drills are missing but the due day has not passed", () => {
  const rows = [drill({ drillType: "fire" })];
  const result = drillSiteRollup(rows, "s1", "2026-09", "2026-09-05", 7);
  assert.equal(result.allDone, false);
  assert.equal(result.tone, "warning");
  assert.deepEqual(result.missing, ["tornado", "severe_weather"]);
  assert.deepEqual(result.missingLabels, ["Tornado", "Severe weather"]);
});

test("drill rollup is critical when drills are missing past the due day", () => {
  const rows = [drill({ drillType: "fire" })];
  const result = drillSiteRollup(rows, "s1", "2026-09", "2026-09-20", 7);
  assert.equal(result.tone, "critical");
});

test("drill rollup ignores other sites and incomplete rows", () => {
  const rows = [
    drill({ drillType: "fire", siteId: "other" }),
    drill({ drillType: "tornado", date: null }), // incomplete: does not count
  ];
  const result = drillSiteRollup(rows, "s1", "2026-09", "2026-09-05", 7);
  // Fire was logged at a different site; the tornado row is incomplete
  // (missing date), so neither counts for s1.
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.missing, ["fire", "tornado", "severe_weather"]);
  assert.equal(result.tone, "warning");
});

test("training rollup is ok when every staff member is cleared", () => {
  const rows = [
    { clearedForInRatio: true, overdueCount: 0 },
    { clearedForInRatio: true, overdueCount: 0 },
  ] as StaffClearanceRow[];
  const result = trainingSiteRollup(rows);
  assert.equal(result.tone, "ok");
  assert.equal(result.label, "2 of 2 cleared for in-ratio");
});

test("training rollup warns when some staff are not cleared", () => {
  const rows = [
    { clearedForInRatio: true, overdueCount: 0 },
    { clearedForInRatio: false, overdueCount: 0 },
  ] as StaffClearanceRow[];
  assert.equal(trainingSiteRollup(rows).tone, "warning");
});

test("training rollup is critical when any staff has overdue lines", () => {
  const rows = [
    { clearedForInRatio: true, overdueCount: 2 },
  ] as StaffClearanceRow[];
  const result = trainingSiteRollup(rows);
  assert.equal(result.tone, "critical");
  assert.equal(result.overdueStaff, 1);
});

test("training rollup handles an empty roster", () => {
  const result = trainingSiteRollup([]);
  assert.equal(result.tone, "ok");
  assert.equal(result.label, "No staff assigned");
});

test("certificate rollup: none, expiring, and expired", () => {
  assert.equal(certificateSiteRollup([]).tone, "ok");
  const expiring = [{ daysRemaining: 12 }, { daysRemaining: 40 }] as ExpiringCertificate[];
  const warn = certificateSiteRollup(expiring);
  assert.equal(warn.tone, "warning");
  assert.equal(warn.label, "2 expiring in 60 days");
  const withExpired = [...expiring, { daysRemaining: -3 }] as ExpiringCertificate[];
  const crit = certificateSiteRollup(withExpired);
  assert.equal(crit.tone, "critical");
  assert.equal(crit.expired, 1);
  assert.ok(crit.label.includes("1 expired"));
});

test("med rollup follows low/critical/out counts", () => {
  const base = {
    siteId: "s1",
    siteName: "Home",
    checkedOn: "2026-09-17",
    totalMeds: 4,
    okCount: 4,
    lowCount: 0,
    criticalCount: 0,
    outCount: 0,
    allClear: true,
    alerts: [],
    summary: "",
  } as MedSupplyStatus;
  assert.equal(medSiteRollup(base).tone, "ok");
  const low = medSiteRollup({ ...base, allClear: false, lowCount: 2, okCount: 2 });
  assert.equal(low.tone, "warning");
  assert.equal(low.alerts, 2);
  const critical = medSiteRollup({ ...base, allClear: false, criticalCount: 1, okCount: 3 });
  assert.equal(critical.tone, "critical");
  const out = medSiteRollup({ ...base, allClear: false, outCount: 1, okCount: 3 });
  assert.equal(out.tone, "critical");
});

test("shift-note rollup: zero notes is critical, partial warns, full coverage is ok", () => {
  const mk = (noteDate: string) => ({ noteDate }) as SiteShiftNoteView;
  assert.equal(shiftNoteSiteRollup([], "2026-09", 3).tone, "critical");
  assert.equal(shiftNoteSiteRollup([mk("2026-09-02")], "2026-09", 3).tone, "warning");
  assert.equal(
    shiftNoteSiteRollup([mk("2026-09-02"), mk("2026-09-03"), mk("2026-09-04")], "2026-09", 3).tone,
    "ok",
  );
  // Notes from other months do not count; empty homes are not flagged.
  assert.equal(shiftNoteSiteRollup([mk("2026-08-30")], "2026-09", 2).tone, "critical");
  assert.equal(shiftNoteSiteRollup([], "2026-09", 0).tone, "ok");
});

test("investigation rollup summarizes the site's open and overdue counts", () => {
  const rows = [
    { siteId: "s1", storedStatus: "open", dueOn: "2026-12-01" },
    { siteId: "s1", storedStatus: "in_progress", dueOn: "2026-09-01" }, // overdue
    { siteId: "s1", storedStatus: "resolved", dueOn: null },
    { siteId: "other", storedStatus: "open", dueOn: "2026-12-01" },
  ] as Investigation[];
  const result = investigationSiteRollup(rows, "s1", new Date("2026-09-17T12:00:00Z"));
  assert.equal(result.open, 2);
  assert.equal(result.overdue, 1);
  assert.equal(result.tone, "critical");
  const empty = investigationSiteRollup(rows, "nope", new Date("2026-09-17T12:00:00Z"));
  assert.equal(empty.tone, "ok");
  assert.equal(empty.label, "No open investigations");
});

test("rollupMetricVisibility mirrors the API read gates", () => {
  const admin = rollupMetricVisibility(
    session("administrator", {
      "hr.view_staff": true,
      "certificates.manage": true,
      "investigations.manage": true,
    }),
  );
  assert.deepEqual(admin, {
    drills: true,
    training: true,
    certificates: true,
    meds: true,
    shiftNotes: true,
    investigations: true,
  });
  assert.ok(anyRollupVisible(admin));

  const auditor = rollupMetricVisibility(session("auditor"));
  assert.equal(auditor.training, false);
  assert.equal(auditor.certificates, false);
  assert.equal(auditor.investigations, false);
  // Auditors may read shift notes and already receive drill records in the workspace.
  assert.equal(auditor.shiftNotes, true);
  assert.equal(auditor.drills, true);
  assert.ok(anyRollupVisible(auditor));

  const hr = rollupMetricVisibility(session("hr", { "hr.view_staff": true, "certificates.manage": true }));
  assert.equal(hr.training, true);
  assert.equal(hr.certificates, true);
  assert.equal(hr.investigations, false);
  assert.equal(hr.meds, false);
  assert.equal(hr.shiftNotes, false);

  // Drills ride in the preloaded workspace payload, so they stay visible to
  // every Overview viewer; every other metric needs its read permission.
  const bare = rollupMetricVisibility(session("nobody", {}));
  assert.deepEqual(bare, {
    drills: true,
    training: false,
    certificates: false,
    meds: false,
    shiftNotes: false,
    investigations: false,
  });
});

test("currentMonthKey slices the yyyy-MM prefix", () => {
  assert.equal(currentMonthKey("2026-09-17"), "2026-09");
});
