import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SITE_DETAIL_TAB_IDS,
  canSeeSiteChecklists,
  canSeeSiteDrills,
  getSiteDetailTabs,
  type SiteDetailTabId,
} from "./siteTabs";
import { auditPeriodLabel, auditScoreDisplay } from "./SiteDetailPage";
import {
  DRILL_DUE_DAY,
  DRILL_QUARTER_RESPONSIBILITIES,
  EMERGENCY_DRILL_SCHEDULE,
  MEDICAL_EMERGENCY_RULE,
  drillScheduleYearSummary,
  isDrillLate,
  type DrillScheduleMonth,
} from "../../data/drillSchedule";
import type { EmergencyDrill } from "../../data/monthlyChecks";
import { metrics } from "../../domain";
import { defaultPermissions } from "../../data/permissions";
import type { SessionUser } from "../../data/types";

function sessionFor(
  roleKey: string,
  overrides: Partial<SessionUser> = {},
): SessionUser {
  const roleByKey: Record<string, string> = {
    administrator: "administrator",
    compliance_admin: "compliance_admin",
    house_manager: "manager",
    program_manager: "manager",
    nurse: "nurse",
    hr: "hr",
    auditor: "auditor",
    dsp: "dsp",
  };
  return {
    userId: "user-1",
    email: "user@example.com",
    username: "user1",
    fullName: "Test User",
    jobTitle: "Tester",
    role: roleByKey[roleKey] ?? "staff",
    roleKey,
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: defaultPermissions(roleKey),
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

// Issue #94: the standalone Drills tab is gone — drills live as the first
// section of the Checklists tab.
const EXPECTED_ORDER: SiteDetailTabId[] = [
  "overview",
  "individuals",
  "audits",
  "checklists",
  "training",
  "medications",
  "mileage",
  "shiftnotes",
  "staff",
];

describe("site detail tabs", () => {
  it("defines the canonical tab order with staff last", () => {
    assert.deepEqual([...SITE_DETAIL_TAB_IDS], EXPECTED_ORDER);
    assert.equal(
      SITE_DETAIL_TAB_IDS[SITE_DETAIL_TAB_IDS.length - 1],
      "staff",
      "staff tab must be last",
    );
  });

  it("every tab has a label (no empty placeholder tabs)", () => {
    for (const tab of getSiteDetailTabs(sessionFor("administrator"))) {
      assert.ok(tab.label && tab.label.length > 0, `tab ${tab.id} has a label`);
      assert.equal(typeof tab.visible, "function", `tab ${tab.id} has a gate`);
    }
  });

  it("keeps staff last even when permission filtering removes tabs", () => {
    // DSP: no hr.view_staff / members.invite / assign_roles -> no staff tab.
    const dspTabs = getSiteDetailTabs(sessionFor("dsp"));
    const ids = dspTabs.map((t) => t.id);
    assert.ok(!ids.includes("staff"), "DSP does not see the staff tab");
    assert.ok(ids.includes("overview"), "DSP still sees overview");
    assert.equal(
      ids[ids.length - 1],
      "shiftnotes",
      "last visible tab for DSP is shiftnotes",
    );
    // Administrator sees everything, staff still last.
    const adminIds = getSiteDetailTabs(sessionFor("administrator")).map((t) => t.id);
    assert.deepEqual(adminIds, EXPECTED_ORDER);
    assert.equal(adminIds[adminIds.length - 1], "staff");
  });

  it("gates restricted tabs for a non-privileged role", () => {
    const dsp = sessionFor("dsp");
    const dspTabs = getSiteDetailTabs(dsp).map((t) => t.id);
    // DSP has no audit.read, so no audits tab.
    assert.ok(!dspTabs.includes("audits"), "DSP does not see audits");
    // Issue #94: DSP now sees the checklists tab through the OLD Drills-tab
    // gate — drills are visible to everyone — but still fails the HM
    // checklist-permissions gate, so HM content stays hidden inside the tab.
    assert.ok(
      dspTabs.includes("checklists"),
      "DSP sees checklists through the drills gate",
    );
    assert.ok(canSeeSiteDrills(dsp), "DSP passes the drills gate");
    assert.ok(
      !canSeeSiteChecklists(dsp),
      "DSP fails the HM checklist-permissions gate",
    );
    // DSP does see shift notes (canSeeShiftNotes covers dsp).
    assert.ok(dspTabs.includes("shiftnotes"), "DSP sees shift notes");
  });

  it("excludes the standalone drills tab for everyone", () => {
    for (const roleKey of ["administrator", "dsp", "auditor", "nurse", "hr"]) {
      const ids = getSiteDetailTabs(sessionFor(roleKey)).map((t) => t.id);
      assert.ok(!ids.includes("drills" as SiteDetailTabId), `${roleKey} has no standalone drills tab`);
    }
  });

  it("auditor sees drills-first checklists but not HM checklist content", () => {
    const auditor = sessionFor("auditor");
    assert.ok(canSeeSiteDrills(auditor), "auditor passes the drills gate");
    assert.ok(
      !canSeeSiteChecklists(auditor),
      "auditor fails the HM checklist-permissions gate",
    );
    assert.ok(
      getSiteDetailTabs(auditor).map((t) => t.id).includes("checklists"),
      "auditor sees the checklists tab (drills first)",
    );
  });

  it("shows audits to the auditor role", () => {
    const ids = getSiteDetailTabs(sessionFor("auditor")).map((t) => t.id);
    assert.ok(ids.includes("audits"), "auditor sees audits");
  });

  it("shows only overview when there is no session", () => {
    assert.deepEqual(
      getSiteDetailTabs(null).map((t) => t.id),
      ["overview"],
    );
  });

  it("house manager sees checklists and the staff tab still last", () => {
    const ids = getSiteDetailTabs(sessionFor("house_manager")).map((t) => t.id);
    assert.ok(ids.includes("checklists"), "HM sees checklists");
    // HM template carries hr.view_staff, so the staff tab shows — and it must
    // still be last.
    assert.ok(ids.includes("staff"), "HM sees the staff tab");
    assert.equal(ids[ids.length - 1], "staff", "staff remains last for HM");
  });
});

describe("issue #94 drill schedule", () => {
  function drill(overrides: Partial<EmergencyDrill>): EmergencyDrill {
    return {
      id: "d1",
      agencyId: "a1",
      siteId: "s1",
      monthKey: "2026-08",
      drillType: "fire",
      date: "2026-08-05",
      time: null,
      evacTime: null,
      leaderName: null,
      participants: "",
      awakeOrSleep: "",
      ...overrides,
    };
  }

  it("defines the canonical 12-month schedule", () => {
    assert.equal(EMERGENCY_DRILL_SCHEDULE.length, 12);
    const byMonth: Record<number, DrillScheduleMonth> = Object.fromEntries(
      EMERGENCY_DRILL_SCHEDULE.map((m) => [m.month, m]),
    );
    assert.deepEqual(byMonth[1].drills, ["fire", "intruder"]);
    assert.equal(byMonth[1].shiftWindow, "7:00 AM - 3:00 PM");
    assert.deepEqual(byMonth[3].drills, ["fire", "tornado", "severe_weather"]);
    assert.equal(byMonth[4].shiftWindow, "3:00 PM - 11:00 PM");
    assert.equal(byMonth[7].shiftWindow, "11:00 PM - 7:00 AM");
    assert.equal(byMonth[10].shiftWindow, "Saturday 7:00 AM - Sunday 11:00 PM");
    assert.deepEqual(byMonth[12].drills, [
      "fire",
      "earthquake",
      "intruder",
      "missing_person",
    ]);
    assert.ok(byMonth[4].allStaffMedicalMonth, "April is a medical month");
    assert.ok(byMonth[10].allStaffMedicalMonth, "October is a medical month");
    assert.ok(
      MEDICAL_EMERGENCY_RULE.toLowerCase().includes("six months"),
      "medical rule is the six-month all-staff rule",
    );
  });

  it("keeps the quarterly responsibility rules", () => {
    assert.equal(DRILL_QUARTER_RESPONSIBILITIES[0].label, "1st Quarter");
    assert.equal(
      DRILL_QUARTER_RESPONSIBILITIES[0].responsibility,
      "AM staff responsible for drills",
    );
    assert.equal(
      DRILL_QUARTER_RESPONSIBILITIES[1].responsibility,
      "PM staff responsible for drills",
    );
    assert.equal(
      DRILL_QUARTER_RESPONSIBILITIES[2].responsibility,
      "Overnight staff responsible for drills",
    );
    assert.equal(
      DRILL_QUARTER_RESPONSIBILITIES[3].responsibility,
      "Weekend staff responsible for drills",
    );
  });

  it("flags drills recorded after the 7th as late", () => {
    assert.equal(DRILL_DUE_DAY, 7);
    assert.equal(isDrillLate("2026-08-07"), false, "due day itself is on time");
    assert.equal(isDrillLate("2026-08-08"), true, "day after is late");
    assert.equal(isDrillLate("2026-08-31"), true, "end of month is late");
    assert.equal(isDrillLate(""), false, "no date is not late");
  });

  it("maps completion state per month and drill type", () => {
    const records = [
      drill({ id: "fire-ontime", drillType: "fire", date: "2026-08-05" }),
      drill({ id: "tornado-early", drillType: "tornado", date: "2026-08-02" }),
      drill({ id: "tornado-late", drillType: "tornado", date: "2026-08-09" }),
      drill({ id: "quake-ontime", drillType: "earthquake", date: "2026-08-06" }),
      drill({ id: "sept-fire", drillType: "fire", date: "2026-09-02", monthKey: "2026-09" }),
    ];
    const summary = drillScheduleYearSummary(2026, records);
    const august = summary.find((m) => m.month.month === 8);
    assert.ok(august, "has an August entry");
    const fire = august.states.find((s) => s.type === "fire");
    assert.equal(fire?.status, "complete");
    assert.equal(fire?.late, false, "drill on the 5th is on time");
    const tornado = august.states.find((s) => s.type === "tornado");
    assert.equal(tornado?.status, "complete");
    assert.equal(
      tornado?.record?.id,
      "tornado-late",
      "latest dated record wins for the same month/type",
    );
    assert.equal(tornado?.late, true, "record on the 9th is late");
    const quake = august.states.find((s) => s.type === "earthquake");
    assert.equal(quake?.status, "complete");
    assert.equal(quake?.record?.id, "quake-ontime");
    assert.equal(quake?.late, false);
    assert.equal(august.allComplete, true);
    const january = summary.find((m) => m.month.month === 1);
    assert.equal(january?.allComplete, false, "January has no records");
    const september = summary.find((m) => m.month.month === 9);
    assert.equal(september?.allComplete, false, "September fire only is incomplete");
  });
});

describe("site hero scores", () => {
  it("uses the same ready percent as the program-site cards", () => {
    assert.equal(
      metrics([
        { status: "Compliant" },
        { status: "Compliant" },
        { status: "Overdue" },
      ] as Parameters<typeof metrics>[0]).score,
      67,
    );
  });
});

describe("audit score display", () => {
  it("reads numeric snapshots", () => {
    assert.equal(auditScoreDisplay(87.4), "87%");
  });

  it("reads common snapshot object shapes defensively", () => {
    assert.equal(auditScoreDisplay({ overall: 92 }), "92%");
    assert.equal(auditScoreDisplay({ overallScore: 81.2 }), "81%");
    assert.equal(auditScoreDisplay({ percent: 77 }), "77%");
  });

  it("returns null for missing or unrecognized snapshots", () => {
    assert.equal(auditScoreDisplay(null), null);
    assert.equal(auditScoreDisplay(undefined), null);
    assert.equal(auditScoreDisplay({ sections: [] }), null);
    assert.equal(auditScoreDisplay("high"), null);
  });

  it("labels audit periods", () => {
    assert.equal(
      auditPeriodLabel({
        id: "a1",
        year: 2026,
        quarter: 3,
        status: "finalized",
        auditorName: "",
        signedAt: null,
        createdAt: "",
        scoreJson: null,
      }),
      "Q3 2026",
    );
  });
});

describe("site detail copy", () => {
  it("labels drill types without raw slugs", async () => {
    const { formatDrillTypeLabel } = await import("./siteDetailCopy");
    assert.equal(formatDrillTypeLabel("fire"), "Fire");
    assert.equal(formatDrillTypeLabel("severe_weather"), "Severe weather");
  });

  it("does not print 0/0 for empty training checklists", async () => {
    const { trainingProgressLine } = await import("./siteDetailCopy");
    assert.equal(
      trainingProgressLine({ counts: { complete: 0, required: 0 } }, false),
      "No required training items yet.",
    );
    assert.equal(
      trainingProgressLine({ counts: { complete: 2, required: 5 } }, false),
      "2 of 5 training items complete",
    );
  });

  it("uses Not logged when a drill has no date", async () => {
    const { formatDrillDateStatus } = await import("./siteDetailCopy");
    assert.equal(formatDrillDateStatus(null), "Not logged");
    assert.equal(formatDrillDateStatus(""), "Not logged");
    assert.equal(formatDrillDateStatus("2026-08-05"), "2026-08-05");
  });
});
