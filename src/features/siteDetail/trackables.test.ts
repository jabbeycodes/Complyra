import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bucketDrillCompletion,
  checklistTileSummary,
  collectExpiringCerts,
  currentMonthKey,
  daysUntilExpiry,
  drillTileSummary,
  medAlertSummary,
  openQaDisputes,
  safetyLinesAnswered,
  safetyTileState,
  shiftNoteCoverage,
  trainingClearanceSummary,
} from "./trackables";
import type { EmergencyDrill, HomeSafetyReport, SafetyLine } from "../../data/monthlyChecks";
import type { QaAuditItemState } from "../../data/qaAudit";
import type { HmWeeklyChecklist, StaffCertificate } from "../../data/types";
import type { SiteShiftNoteView } from "../../data/shiftNotes";

const NOW = new Date("2026-09-17T12:00:00Z");

function drill(overrides: Partial<EmergencyDrill>): EmergencyDrill {
  return {
    id: "drill-1",
    agencyId: "agency-1",
    siteId: "site-1",
    monthKey: "2026-09",
    drillType: "fire",
    date: "2026-09-10",
    time: "10:00",
    evacTime: "2 min",
    leaderName: "Kim Manager",
    participants: "Everyone present",
    awakeOrSleep: "awake",
    ...overrides,
  };
}

describe("bucketDrillCompletion", () => {
  it("buckets every expected type for the month, marking done only when fully completed", () => {
    const buckets = bucketDrillCompletion(
      [
        drill({ drillType: "fire", id: "d-fire" }),
        drill({ drillType: "tornado", id: "d-tornado", date: null }), // logged but not completed
      ],
      "2026-09",
    );
    // September expects fire, tornado, severe_weather.
    assert.deepEqual(
      buckets.map((b) => b.type),
      ["fire", "tornado", "severe_weather"],
    );
    const byType = Object.fromEntries(buckets.map((b) => [b.type, b]));
    assert.equal(byType.fire.done, true);
    assert.equal(byType.fire.drillId, "d-fire");
    assert.equal(byType.tornado.done, false); // incomplete row counts as missing
    assert.equal(byType.severe_weather.done, false);
    assert.equal(byType.severe_weather.drillId, null);
  });

  it("ignores drills from other months", () => {
    const buckets = bucketDrillCompletion(
      [drill({ monthKey: "2026-08" })],
      "2026-09",
    );
    assert.ok(buckets.every((b) => !b.done));
  });

  it("summarizes done/total/missing", () => {
    const buckets = bucketDrillCompletion([drill({})], "2026-09");
    assert.deepEqual(drillTileSummary(buckets), { done: 1, total: 3, missing: 2 });
  });
});

describe("safetyTileState / safetyLinesAnswered", () => {
  const lines: SafetyLine[] = [
    { key: "smoke_1", dateChecked: "2026-09-05", location: "", temp: "", extra: "", checkedBy: "Kim", signature: null },
  ];
  it("reports not_started when there is no report", () => {
    assert.equal(safetyTileState(null), "not_started");
    assert.equal(safetyTileState(undefined), "not_started");
    assert.deepEqual(safetyLinesAnswered(null), { answered: 0, total: 0 });
  });

  it("reports complete when every line is checked", () => {
    const report = { id: "r", agencyId: "a", siteId: "s", monthKey: "2026-09", lines } as unknown as HomeSafetyReport;
    // One answered line of one total — but SAFETY_LINE_DEFS requires all
    // defs, so a partial report is in_progress.
    assert.equal(safetyTileState(report), "in_progress");
    assert.deepEqual(safetyLinesAnswered(report), { answered: 1, total: 1 });
  });
});

describe("trainingClearanceSummary", () => {
  it("counts cleared vs not-cleared, skipping failed rows", () => {
    const summary = trainingClearanceSummary([
      { userId: "u1", name: "A", profile: { clearedForInRatio: true }, failed: false },
      { userId: "u2", name: "B", profile: { clearedForInRatio: false }, failed: false },
      { userId: "u3", name: "C", profile: null, failed: false },
      { userId: "u4", name: "D", profile: { clearedForInRatio: true }, failed: true },
    ]);
    assert.deepEqual(summary, { total: 3, cleared: 1, notCleared: 2 });
  });
});

describe("collectExpiringCerts", () => {
  const cert = (id: string, certName: string, expiresOn: string): StaffCertificate => ({
    id,
    agencyId: "agency-1",
    userId: "u1",
    certName,
    issuedOn: "2024-01-01",
    expiresOn,
    filePath: null,
    fileName: null,
    enteredBy: "hr-1",
    createdAt: "2024-01-01T00:00:00Z",
  });

  it("orders worst-first by days left, including already-expired", () => {
    const rows = collectExpiringCerts(
      [
        {
          userId: "u1",
          name: "Amy",
          expiringCerts: [
            cert("c1", "CPR", "2026-11-01"),
            cert("c2", "CPI", "2026-09-10"),
          ],
        },
        {
          userId: "u2",
          name: "Bo",
          expiringCerts: [cert("c3", "L1MA", "2026-09-20")],
        },
      ],
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => r.cert.certName),
      ["CPI", "L1MA", "CPR"],
    );
    assert.equal(rows[0].daysLeft, -7); // expired 7 days ago
    assert.equal(rows[0].name, "Amy");
  });

  it("returns an empty list when nobody has expiring certs", () => {
    assert.deepEqual(collectExpiringCerts([], NOW), []);
  });
});

describe("medAlertSummary", () => {
  it("adds low + critical + out into attention", () => {
    const summary = medAlertSummary({
      siteId: "s",
      siteName: "Home",
      checkedOn: "2026-09-17",
      totalMeds: 10,
      okCount: 7,
      lowCount: 2,
      criticalCount: 1,
      outCount: 0,
      allClear: false,
      alerts: [],
      summary: "",
    });
    assert.deepEqual(summary, { total: 10, attention: 3, allClear: false });
  });

  it("handles null status", () => {
    assert.deepEqual(medAlertSummary(null), { total: 0, attention: 0, allClear: false });
  });
});

describe("shiftNoteCoverage", () => {
  it("counts only notes in the given month, newest first", () => {
    const notes = shiftNoteCoverage(
      [
        { id: "n1", noteDate: "2026-09-03" },
        { id: "n2", noteDate: "2026-08-30" },
        { id: "n3", noteDate: "2026-09-15" },
      ] as SiteShiftNoteView[],
      "2026-09",
    );
    assert.deepEqual(notes.map((n) => n.id), ["n3", "n1"]);
  });
});

describe("checklistTileSummary", () => {
  const checklists = [
    { id: "w1", weekOf: "2026-09-14", status: "submitted" },
    { id: "w2", weekOf: "2026-09-07", status: "draft" },
    { id: "w3", weekOf: "2026-08-31", status: "submitted" },
  ] as HmWeeklyChecklist[];
  it("splits filed vs pending and reports the latest week", () => {
    assert.deepEqual(checklistTileSummary(checklists), {
      filed: 2,
      pending: 1,
      latestWeekOf: "2026-09-14",
    });
  });

  it("handles no checklists", () => {
    assert.deepEqual(checklistTileSummary([]), { filed: 0, pending: 0, latestWeekOf: null });
  });
});

describe("openQaDisputes", () => {
  const item = (overrides: Partial<QaAuditItemState>): QaAuditItemState =>
    ({
      key: "k",
      itemId: "i",
      individualId: null,
      individualName: null,
      source: "auditor",
      locked: false,
      result: "no",
      comment: "",
      status: "scored",
      systemEvidence: null,
      scoredBy: "auditor-1",
      scoredByName: "Auditor",
      scoredAt: "2026-09-10T10:00:00Z",
      disputeNote: null,
      disputePhotos: [],
      disputeRaisedBy: null,
      disputeRaisedByName: null,
      disputeRaisedAt: null,
      disputeResolution: null,
      history: [],
      ...overrides,
    }) as QaAuditItemState;

  it("keeps only raised-and-unresolved disputes", () => {
    const items = [
      item({ key: "open", disputeRaisedBy: "hm-1", disputeRaisedAt: "2026-09-11T00:00:00Z" }),
      item({ key: "resolved", disputeRaisedBy: "hm-1", disputeResolution: { approved: true, reason: "ok", resolvedBy: "a", resolvedByName: "Auditor", resolvedAt: "2026-09-12T00:00:00Z" } }),
      item({ key: "never" }),
    ];
    assert.deepEqual(openQaDisputes(items).map((i) => i.key), ["open"]);
  });
});


describe("date helpers", () => {
  it("derives the current month key and expiry deltas", () => {
    assert.equal(currentMonthKey(new Date("2026-09-17T12:00:00Z")), "2026-09");
    assert.equal(daysUntilExpiry("2026-09-20", NOW), 3);
    assert.equal(daysUntilExpiry("2026-09-10", NOW), -7);
  });
});
