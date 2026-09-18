import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveInvestigationStatus,
  investigationDraftTitle,
  investigationEventFromRow,
  investigationFromRow,
  isInvestigationOpen,
  isInvestigationSourceMetric,
  sortInvestigations,
  summarizeInvestigations,
  validateInvestigationInput,
  type Investigation,
} from "./investigations";

function makeInvestigation(
  overrides: Partial<Investigation> = {},
): Investigation {
  return {
    id: "inv-1",
    agencyId: "agency-1",
    siteId: "site-1",
    sourceMetric: "drills",
    sourceRecordId: null,
    sourceLabel: "Fire drill · Sep 2026 missing",
    title: "Fire drill missing for September",
    description: "",
    assignedToUserId: null,
    dueOn: null,
    storedStatus: "open",
    createdByUserId: "user-1",
    createdByName: "Sarah Mitchell",
    createdAt: "2026-09-18T00:00:00Z",
    updatedAt: "2026-09-18T00:00:00Z",
    resolvedAt: null,
    deletedAt: null,
    history: [],
    ...overrides,
  };
}

describe("deriveInvestigationStatus", () => {
  it("returns the stored status when there is no due date", () => {
    assert.equal(
      deriveInvestigationStatus(
        { storedStatus: "in_progress", dueOn: null },
        new Date("2026-09-18T00:00:00Z"),
      ),
    "in_progress");
  });

  it("derives overdue when the due date has passed and it is not resolved", () => {
    assert.equal(
      deriveInvestigationStatus(
        { storedStatus: "open", dueOn: "2026-09-01" },
        new Date("2026-09-18T00:00:00Z"),
      ),
    "overdue");
  });

  it("keeps resolved resolved even when past due", () => {
    assert.equal(
      deriveInvestigationStatus(
        { storedStatus: "resolved", dueOn: "2026-09-01" },
        new Date("2026-09-18T00:00:00Z"),
      ),
    "resolved");
  });

  it("is open when due today", () => {
    assert.equal(
      deriveInvestigationStatus(
        { storedStatus: "open", dueOn: "2026-09-18" },
        new Date("2026-09-18T00:00:00Z"),
      ),
    "open");
  });
});

describe("isInvestigationOpen / summarizeInvestigations", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  it("counts open + overdue, excluding resolved", () => {
    const rows = [
      makeInvestigation({ storedStatus: "open" }),
      makeInvestigation({ storedStatus: "in_progress", dueOn: "2026-09-01" }),
      makeInvestigation({ storedStatus: "resolved", dueOn: "2026-09-01" }),
    ];
    assert.deepEqual(summarizeInvestigations(rows, now), { open: 2, overdue: 1 });
    assert.equal(isInvestigationOpen({ storedStatus: "resolved", dueOn: null }, now), false);
  });
});

describe("validateInvestigationInput", () => {
  it("requires a title", () => {
    assert.ok(validateInvestigationInput({}).includes(
      "Give the investigation a title.",
    ));
    assert.ok(validateInvestigationInput({ title: "  " }).includes(
      "Give the investigation a title.",
    ));
  });

  it("rejects bad due dates and bad source metrics", () => {
    assert.equal(validateInvestigationInput({ title: "t", dueOn: "next friday" }).length, 1);
    assert.equal(validateInvestigationInput({ title: "t", dueOn: "2026-02-30" }).length, 1);
    assert.equal(validateInvestigationInput({ title: "t", sourceMetric: "nonsense" }).length, 1);
    assert.equal(validateInvestigationInput({ title: "t", dueOn: "2026-09-30", sourceMetric: "meds" }).length, 0);
  });
});

describe("sortInvestigations", () => {
  it("orders overdue, open, in progress, then resolved", () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const rows = [
      makeInvestigation({ id: "resolved", storedStatus: "resolved" }),
      makeInvestigation({ id: "later", storedStatus: "open", dueOn: "2026-09-30" }),
      makeInvestigation({ id: "overdue", storedStatus: "open", dueOn: "2026-09-01" }),
      makeInvestigation({ id: "progress", storedStatus: "in_progress" }),
      makeInvestigation({ id: "sooner", storedStatus: "open", dueOn: "2026-09-20" }),
    ];
    assert.deepEqual(sortInvestigations(rows, now).map((r) => r.id), [
      "overdue",
      "sooner",
      "later",
      "progress",
      "resolved",
    ]);
  });
});

describe("source metrics", () => {
  it("guards metric keys", () => {
    assert.equal(isInvestigationSourceMetric("drills"), true);
    assert.equal(isInvestigationSourceMetric("qa_disputes"), true);
    assert.equal(isInvestigationSourceMetric("zzz"), false);
    assert.equal(isInvestigationSourceMetric(null), false);
  });

  it("drafts a title from the source label", () => {
    assert.equal(investigationDraftTitle("drills", "Fire drill · Sep 2026 missing"), 
      "Look into: Emergency drills — Fire drill · Sep 2026 missing",
    );
    assert.equal(investigationDraftTitle("general", " "), "Look into: General");
  });
});

describe("row mappers", () => {
  it("maps a DB row and defaults an unknown metric to general", () => {
    const row = {
      id: "i1",
      agency_id: "a1",
      site_id: "s1",
      source_metric: "bizarre",
      source_record_id: "r9",
      source_label: "lbl",
      title: "T",
      description: "D",
      assigned_to_user_id: null,
      assigned_to_name: null,
      due_on: null,
      status: "in_progress",
      created_by_user_id: "u1",
      created_by_name: "U",
      created_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-18T00:00:00Z",
      resolved_at: null,
      deleted_at: null,
    };
    const inv = investigationFromRow(row);
    assert.equal(inv.sourceMetric, "general");
    assert.equal(inv.storedStatus, "in_progress");
    assert.equal(inv.sourceRecordId, "r9");
    assert.deepEqual(inv.history, []);
  });

  it("maps an event row", () => {
    const event = investigationEventFromRow({
      id: "e1",
      investigation_id: "i1",
      event_type: "status_changed",
      from_status: "open",
      to_status: "in_progress",
      note: "",
      created_by_user_id: "u1",
      created_by_name: "U",
      created_at: "2026-09-18T01:00:00Z",
    });
    assert.equal(event.eventType, "status_changed");
    assert.equal(event.fromStatus, "open");
    assert.equal(event.toStatus, "in_progress");
  });
});
