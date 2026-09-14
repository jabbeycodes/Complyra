import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  QA_ITEMS,
  QA_SECTIONS,
  applySystemPass,
  autoVerifyItem,
  buildQaAuditItems,
  nextQaDueDate,
  qaItemKey,
  qaQuarterMonths,
  qaScheduleTone,
  qaUndecidedItems,
  raiseQaDisputeState,
  rankQaSites,
  resolveQaDisputeState,
  scoreQaAudit,
  scoreQaItemState,
  skipQaItemState,
  type QaAuditItemState,
  type QaAutoVerifyContext,
} from "./qaAudit";
import { drillComplete } from "./monthlyChecks";

function blankItem(overrides: Partial<QaAuditItemState> = {}): QaAuditItemState {
  return {
    key: "safety.flashlight",
    itemId: "safety.flashlight",
    individualId: null,
    individualName: null,
    source: "auditor",
    locked: false,
    result: null,
    comment: "",
    status: "pending",
    systemEvidence: null,
    scoredBy: null,
    scoredByName: null,
    scoredAt: null,
    disputeNote: null,
    disputePhotos: [],
    disputeRaisedBy: null,
    disputeRaisedByName: null,
    disputeRaisedAt: null,
    disputeResolution: null,
    history: [],
    ...overrides,
  };
}

describe("qa checklist definition", () => {
  it("has 7 sections and 74 base items", () => {
    assert.equal(QA_SECTIONS.length, 7);
    assert.equal(QA_ITEMS.length, 74);
  });

  it("expands to 94 items for a 2-individual site", () => {
    const rows = buildQaAuditItems([
      { id: "p1", fullName: "Person One" },
      { id: "p2", fullName: "Person Two" },
    ]);
    assert.equal(rows.length, 94);
  });

  it("keys are unique per individual", () => {
    const rows = buildQaAuditItems([{ id: "p1", fullName: "Person One" }]);
    const keys = rows.map((r) => qaItemKey(r.itemId, r.individualId));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("uses Complyrer-original wording (no LifePath form phrases)", () => {
    const banned = ["bubble packs", "CMRO", "red book", "Procedure #204", "Procedure #208"];
    for (const item of QA_ITEMS) {
      for (const phrase of banned) {
        assert.ok(
          !item.text.toLowerCase().includes(phrase.toLowerCase()),
          `item ${item.id} contains banned phrase "${phrase}"`,
        );
      }
    }
  });
});

describe("qa scoring", () => {
  it("counts yes/no and excludes na, skipped, and pending", () => {
    const items = [
      blankItem({ key: "a", itemId: "safety.flashlight", result: "yes", status: "scored" }),
      blankItem({ key: "b", itemId: "safety.flashlight", result: "no", status: "scored" }),
      blankItem({ key: "c", itemId: "safety.flashlight", result: "na", status: "scored" }),
      blankItem({ key: "d", itemId: "safety.flashlight", result: "skipped", status: "scored" }),
      blankItem({ key: "e", itemId: "safety.flashlight", result: null, status: "pending" }),
    ];
    const score = scoreQaAudit(items);
    assert.equal(score.pass, 1);
    assert.equal(score.fail, 1);
    assert.equal(score.excluded, 3);
    assert.equal(score.pct, 50);
  });

  it("flags critical fails as blockers", () => {
    const items = [
      blankItem({ key: "x", itemId: "home.no-phi-visible", result: "no", status: "scored" }),
      blankItem({ key: "y", itemId: "safety.flashlight", result: "yes", status: "scored" }),
    ];
    const score = scoreQaAudit(items);
    assert.deepEqual(score.criticalFails, ["x"]);
    assert.equal(score.pct, 50);
  });

  it("reports pct null when nothing is decided", () => {
    const score = scoreQaAudit([blankItem()]);
    assert.equal(score.pct, null);
  });

  it("computes per-section scores", () => {
    const items = [
      blankItem({ key: "a", itemId: "safety.flashlight", result: "yes", status: "scored" }),
      blankItem({ key: "b", itemId: "safety.flashlight", result: "no", status: "scored" }),
      blankItem({ key: "c", itemId: "home.clean-odor-free", result: "yes", status: "scored" }),
    ];
    const score = scoreQaAudit(items);
    assert.equal(score.sections.safety.pct, 50);
    assert.equal(score.sections.home.pct, 100);
    assert.equal(score.sections.vehicle.pct, null);
  });
});

describe("locked system items", () => {
  const ctx: QaAutoVerifyContext = {
    siteId: "s1",
    months: ["2026-07"],
    auditYear: 2026,
    drills: [],
    trips: [],
    packets: [],
    assignments: [],
    safetyReports: [],
  };

  it("auto-verification never fails — unprovable items return null", () => {
    assert.equal(autoVerifyItem("drills_on_schedule", ctx, null), null);
    assert.equal(autoVerifyItem("mileage_log_current", ctx, null), null);
    assert.equal(autoVerifyItem("isp_ack_all_staff", ctx, "p1"), null);
    assert.equal(autoVerifyItem("delegations_all_staff", ctx, "p1"), null);
    assert.equal(autoVerifyItem("safety_report_filed", ctx, null), null);
  });

  it("passes drills when every required type is complete", () => {
    const drills = [
      { id: "d1", agencyId: "a", siteId: "s1", monthKey: "2026-07", drillType: "fire", date: "2026-07-03", time: "10:00", evacTime: null, leaderName: "Kim", participants: "all", awakeOrSleep: "awake" },
      { id: "d2", agencyId: "a", siteId: "s1", monthKey: "2026-07", drillType: "tornado", date: "2026-07-10", time: "10:00", evacTime: null, leaderName: "Kim", participants: "all", awakeOrSleep: "awake" },
      { id: "d3", agencyId: "a", siteId: "s1", monthKey: "2026-07", drillType: "intruder", date: "2026-07-17", time: "10:00", evacTime: null, leaderName: "Kim", participants: "all", awakeOrSleep: "awake" },
    ] as QaAutoVerifyContext["drills"];
    assert.ok(drills.every(drillComplete));
    const pass = autoVerifyItem("drills_on_schedule", { ...ctx, drills }, null);
    assert.ok(pass?.pass);
    assert.match(pass.evidence, /3\/3/);
  });

  it("does not pass drills when one required type is missing", () => {
    const drills = [
      { id: "d1", agencyId: "a", siteId: "s1", monthKey: "2026-07", drillType: "fire", date: "2026-07-03", time: "10:00", evacTime: null, leaderName: "Kim", participants: "all", awakeOrSleep: "awake" },
    ] as QaAutoVerifyContext["drills"];
    assert.equal(autoVerifyItem("drills_on_schedule", { ...ctx, drills }, null), null);
  });

  it("passes mileage when every audit month has a trip", () => {
    const pass = autoVerifyItem(
      "mileage_log_current",
      { ...ctx, months: ["2026-07", "2026-08"], trips: [{ siteId: "s1", date: "2026-07-05" }, { siteId: "s1", date: "2026-08-06" }] },
      null,
    );
    assert.ok(pass?.pass);
  });

  it("does not pass mileage when a month has no trips", () => {
    const pass = autoVerifyItem(
      "mileage_log_current",
      { ...ctx, months: ["2026-07", "2026-08"], trips: [{ siteId: "s1", date: "2026-07-05" }] },
      null,
    );
    assert.equal(pass, null);
  });

  it("passes ISP acknowledgment only when every named row signed", () => {
    const packets = [
      {
        individualId: "p1",
        startsOn: "2026-01-15",
        rows: [
          { staffName: "Ann", signedAt: "2026-02-01" },
          { staffName: "Bob", signedAt: null },
        ],
      },
    ];
    assert.equal(autoVerifyItem("isp_ack_all_staff", { ...ctx, packets }, "p1"), null);
    const signed = [
      {
        individualId: "p1",
        startsOn: "2026-01-15",
        rows: [
          { staffName: "Ann", signedAt: "2026-02-01" },
          { staffName: "Bob", signedAt: "2026-02-02" },
        ],
      },
    ];
    const pass = autoVerifyItem("isp_ack_all_staff", { ...ctx, packets: signed }, "p1");
    assert.ok(pass?.pass);
    assert.match(pass.evidence, /2 staff/);
  });

  it("ignores packets from other years for ISP acknowledgment", () => {
    const packets = [
      { individualId: "p1", startsOn: "2025-01-15", rows: [{ staffName: "Ann", signedAt: "2025-02-01" }] },
    ];
    assert.equal(autoVerifyItem("isp_ack_all_staff", { ...ctx, packets }, "p1"), null);
  });

  it("passes delegations only when every active assignment is fully signed", () => {
    const assignments = [
      { individualId: "p1", status: "assigned", acks: [{ signedAt: "2026-01-01" }, { signedAt: null }] },
    ];
    assert.equal(autoVerifyItem("delegations_all_staff", { ...ctx, assignments }, "p1"), null);
    const signed = [{ individualId: "p1", status: "assigned", acks: [{ signedAt: "2026-01-01" }] }];
    assert.ok(autoVerifyItem("delegations_all_staff", { ...ctx, assignments: signed }, "p1")?.pass);
  });

  it("does not auto-pass delegations when the individual has none", () => {
    assert.equal(autoVerifyItem("delegations_all_staff", { ...ctx, assignments: [] }, "p1"), null);
  });

  it("passes safety reports only when all lines are checked every month", () => {
    const safetyReports = [
      { siteId: "s1", monthKey: "2026-07", lines: [{ dateChecked: "2026-07-05" }, { dateChecked: null }] },
    ];
    assert.equal(autoVerifyItem("safety_report_filed", { ...ctx, safetyReports }, null), null);
    const complete = [{ siteId: "s1", monthKey: "2026-07", lines: [{ dateChecked: "2026-07-05" }] }];
    assert.ok(autoVerifyItem("safety_report_filed", { ...ctx, safetyReports: complete }, null)?.pass);
  });

  it("locked items reject scoring, skipping, and disputes", () => {
    const auto = blankItem({ itemId: "emergency.drills-on-schedule", key: "emergency.drills-on-schedule" });
    const locked = applySystemPass(auto, "3/3 required drills complete");
    assert.equal(locked.locked, true);
    assert.equal(locked.result, "yes");
    assert.equal(locked.source, "system");
    assert.throws(() => scoreQaItemState(locked, "no", "", "u1", "Auditor"), /locked/);
    assert.throws(() => skipQaItemState(locked, true, "u1", "Auditor"), /locked/);
    assert.throws(
      () => raiseQaDisputeState(locked, "wrong", [{ id: "p", name: "p.jpg", dataUrl: "x", capturedAt: "t", capturedBy: "u" }], "u2", "HM"),
      /cannot be disputed/,
    );
  });
});

describe("dispute state machine", () => {
  const photo = { id: "ph1", name: "extinguisher.jpg", dataUrl: "data:image/jpeg;base64,x", capturedAt: "2026-09-01", capturedBy: "u2" };

  function scoredNo() {
    return scoreQaItemState(blankItem(), "no", "Tag expired", "u1", "Auditor Ann");
  }

  it("raises a dispute with photo evidence and a note", () => {
    const disputed = raiseQaDisputeState(scoredNo(), "Tag replaced 9/2", [photo], "u2", "HM Hal");
    assert.equal(disputed.status, "disputed");
    assert.equal(disputed.disputePhotos.length, 1);
    assert.equal(disputed.disputeResolution, null);
  });

  it("requires a note and at least one photo", () => {
    assert.throws(() => raiseQaDisputeState(scoredNo(), "  ", [photo], "u2", "HM"), /note/);
    assert.throws(() => raiseQaDisputeState(scoredNo(), "note", [], "u2", "HM"), /photo/);
  });

  it("rejects disputes on unscored items", () => {
    assert.throws(() => raiseQaDisputeState(blankItem(), "note", [photo], "u2", "HM"), /scored/);
  });

  it("approving a dispute flips no to yes and records the trail", () => {
    const resolved = resolveQaDisputeState(
      raiseQaDisputeState(scoredNo(), "Tag replaced", [photo], "u2", "HM Hal"),
      true,
      "Photo shows a current tag",
      "u1",
      "Auditor Ann",
    );
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.result, "yes");
    assert.equal(resolved.disputeResolution?.approved, true);
    assert.ok(resolved.history.length >= 3);
  });

  it("rejecting a dispute keeps the score and records the reason", () => {
    const resolved = resolveQaDisputeState(
      raiseQaDisputeState(scoredNo(), "Tag replaced", [photo], "u2", "HM Hal"),
      false,
      "Photo is blurry — tag date unreadable",
      "u1",
      "Auditor Ann",
    );
    assert.equal(resolved.result, "no");
    assert.equal(resolved.disputeResolution?.approved, false);
  });

  it("requires a resolution reason", () => {
    const disputed = raiseQaDisputeState(scoredNo(), "note", [photo], "u2", "HM");
    assert.throws(() => resolveQaDisputeState(disputed, true, "  ", "u1", "Auditor"), /reason/);
  });

  it("cannot re-score while a dispute is open", () => {
    const disputed = raiseQaDisputeState(scoredNo(), "note", [photo], "u2", "HM");
    assert.throws(() => scoreQaItemState(disputed, "yes", "", "u1", "Auditor"), /dispute/);
  });
});

describe("ranking", () => {
  it("orders by score desc with trend and critical-fail tie-breaks", () => {
    const ranked = rankQaSites([
      { siteId: "b", siteName: "Beta", score: 90, previousScore: 80, trend: 10, criticalFails: 0, auditId: "a1", finalizedAt: "t" },
      { siteId: "a", siteName: "Alpha", score: 90, previousScore: 88, trend: 2, criticalFails: 0, auditId: "a2", finalizedAt: "t" },
      { siteId: "c", siteName: "Gamma", score: 95, previousScore: null, trend: null, criticalFails: 3, auditId: "a3", finalizedAt: "t" },
      { siteId: "d", siteName: "Delta", score: null, previousScore: null, trend: null, criticalFails: 0, auditId: null, finalizedAt: null },
    ]);
    assert.deepEqual(ranked.map((r) => r.siteId), ["c", "b", "a", "d"]);
  });
});

describe("scheduling", () => {
  it("quarters roll forward by 3 months", () => {
    assert.equal(nextQaDueDate("2026-09-14"), "2026-12-14");
    assert.equal(nextQaDueDate("2026-11-30"), "2027-02-28");
  });

  it("tones flag due-soon and overdue", () => {
    assert.equal(qaScheduleTone("2026-09-01", "2026-09-14"), "overdue");
    assert.equal(qaScheduleTone("2026-09-20", "2026-09-14"), "due_soon");
    assert.equal(qaScheduleTone("2026-12-01", "2026-09-14"), "current");
  });

  it("quarter months are correct", () => {
    assert.deepEqual(qaQuarterMonths(2026, 3), ["2026-07", "2026-08", "2026-09"]);
  });

  it("undecided items block finalization", () => {
    const items = [blankItem({ key: "a" }), blankItem({ key: "b", result: "yes", status: "scored" })];
    assert.deepEqual(qaUndecidedItems(items), ["a"]);
  });
});
