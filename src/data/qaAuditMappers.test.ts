import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapQaAuditRow,
  mapQaAuditItemRow,
  mapQaScheduleRow,
  qaAuditItemToRow,
} from "./qaAuditApi";
import type { QaAuditItemState } from "./qaAudit";

test("mapQaAuditRow converts a db row to a QaAudit", () => {
  const audit = mapQaAuditRow({
    id: "qa-1",
    agency_id: "ag-1",
    site_id: "site-1",
    year: 2026,
    quarter: 3,
    status: "finalized",
    auditor_id: "u-1",
    auditor_name: "Casey Auditor",
    auditor_signature_name: "Casey Auditor",
    auditor_signature_mark: "CA",
    signed_at: "2026-09-14T12:00:00.000Z",
    score: { pct: 92, pass: 80, fail: 7, excluded: 7, criticalFails: [] },
    created_at: "2026-09-14T11:00:00.000Z",
    updated_at: "2026-09-14T12:00:00.000Z",
  });
  assert.equal(audit.id, "qa-1");
  assert.equal(audit.quarter, 3);
  assert.equal(audit.status, "finalized");
  assert.equal(audit.score?.pct, 92);
});

test("mapQaScheduleRow converts a db row to a QaAuditSchedule", () => {
  const s = mapQaScheduleRow({
    id: "qs-1",
    agency_id: "ag-1",
    site_id: "site-1",
    next_due: "2026-12-01",
    assigned_auditor_id: "u-1",
    assigned_auditor_name: "Casey Auditor",
    active: true,
    created_at: "2026-09-14T11:00:00.000Z",
    updated_at: "2026-09-14T11:00:00.000Z",
  });
  assert.equal(s.nextDue, "2026-12-01");
  assert.equal(s.assignedAuditorName, "Casey Auditor");
  assert.equal(s.active, true);
});

const ITEM: QaAuditItemState = {
  key: "home.personalized-decor::ind-1",
  itemId: "home.personalized-decor",
  individualId: "ind-1",
  individualName: "Alex Individual",
  source: "system",
  locked: true,
  result: "yes",
  comment: "",
  status: "scored",
  systemEvidence: "3/3 required drills complete",
  scoredBy: null,
  scoredByName: null,
  scoredAt: null,
  disputeNote: null,
  disputePhotos: [],
  disputeRaisedBy: null,
  disputeRaisedByName: null,
  disputeRaisedAt: null,
  disputeResolution: null,
  history: [
    {
      at: "2026-09-14T11:00:00.000Z",
      actor: "system",
      actorName: "Complyrer",
      action: "auto_verified",
      detail: "3/3 required drills complete",
    },
  ],
};

test("qaAuditItemToRow -> mapQaAuditItemRow round-trips a locked system item", () => {
  const row = qaAuditItemToRow("qa-1", "ag-1", ITEM);
  assert.equal(row.audit_id, "qa-1");
  assert.equal(row.agency_id, "ag-1");
  assert.equal(row.locked, true);
  assert.equal(row.system_evidence, "3/3 required drills complete");
  const back = mapQaAuditItemRow({ id: "row-1", ...row });
  assert.deepEqual(back, ITEM);
});

test("mapQaAuditItemRow tolerates null jsonb columns", () => {
  const item = mapQaAuditItemRow({
    id: "row-2",
    item_key: "safety.extinguisher",
    item_id: "safety.extinguisher",
    individual_id: null,
    individual_name: null,
    source: "auditor",
    locked: false,
    result: null,
    comment: "",
    status: "pending",
    system_evidence: null,
    scored_by: null,
    scored_by_name: null,
    scored_at: null,
    dispute_note: null,
    dispute_photos: null,
    dispute_raised_by: null,
    dispute_raised_by_name: null,
    dispute_raised_at: null,
    dispute_resolution: null,
    history: null,
  });
  assert.deepEqual(item.disputePhotos, []);
  assert.deepEqual(item.history, []);
  assert.equal(item.disputeResolution, null);
  assert.equal(item.individualId, null);
});
