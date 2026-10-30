import assert from "node:assert/strict";
import test from "node:test";
import type { CareScreeningData } from "../../data/careScreening";
import type { ConsentRegister } from "../../data/consents";
import type { LifeEventView } from "../../data/lifeEvents";
import {
  chartPlans,
  consentRecordStatus,
  consentTypeRows,
  groupLifeEventsByYear,
  planAckCount,
  planAwaitingMyAck,
  rightsPacketSummary,
} from "./chartSections";

const careData = (patch: Partial<CareScreeningData>): CareScreeningData => ({
  plans: [],
  acknowledgements: [],
  types: [],
  screenings: [],
  ...patch,
});

const plan = (id: string, status: string) =>
  ({
    id,
    agency_id: "a1",
    individual_id: "p1",
    title: `Plan ${id}`,
    items: [],
    status,
    previous_id: null,
    created_by: "u1",
    created_at: "2026-01-01T00:00:00.000Z",
    approved_by: null,
    approved_at: null,
    retired_at: null,
  }) as CareScreeningData["plans"][number];

test("chartPlans splits current plans from history like the chart", () => {
  const data = careData({
    plans: [plan("1", "active"), plan("2", "draft"), plan("3", "retired"), plan("4", "revised")],
  });
  const { current, history } = chartPlans(data);
  assert.deepEqual(current.map((p) => p.id), ["1", "2"]);
  assert.deepEqual(history.map((p) => p.id), ["3", "4"]);
});

test("planAwaitingMyAck needs an active plan, an ack role, and no prior ack", () => {
  const active = plan("1", "active");
  const data = careData({ plans: [active] });
  assert.equal(planAwaitingMyAck(data, active, "me", "dsp"), true);
  assert.equal(planAwaitingMyAck(data, active, "me", "auditor"), false);
  const acked = careData({
    plans: [active],
    acknowledgements: [{ plan_id: "1", user_id: "me", acknowledged_at: "2026-01-02T00:00:00.000Z" }],
  });
  assert.equal(planAwaitingMyAck(acked, active, "me", "dsp"), false);
  assert.equal(planAckCount(acked, "1"), 1);
  assert.equal(planAckCount(acked, "nope"), 0);
});

const register = (patch: Partial<ConsentRegister>): ConsentRegister => ({
  types: [
    { id: "service", label: "Service consent", required: true, medication: false },
    { id: "media", label: "Photo/media release", required: true, medication: false },
  ],
  records: [],
  revocations: [],
  individuals: [{ id: "p1", agencyId: "a1", siteId: "s1", fullName: "Ellis Hart" }],
  ...patch,
});

const record = (patch: Record<string, unknown>) =>
  ({
    id: "r1",
    agencyId: "a1",
    individualId: "p1",
    typeId: "service",
    covers: "Residential services",
    giver: "representative",
    giverName: "Dana Hart",
    relationship: "Sibling",
    signedOn: "2026-01-12",
    effectiveOn: "2026-01-12",
    reviewOn: "2027-01-12",
    supersedesId: null,
    createdBy: "u1",
    createdAt: "2026-01-12T15:00:00.000Z",
    activatedBy: "u1",
    activatedAt: "2026-01-12T15:05:00.000Z",
    ...patch,
  }) as ConsentRegister["records"][number];

test("consentTypeRows masks a Missing status for DSPs only", () => {
  const reg = register({ records: [record({ outcome: "yes" })] });
  const managerRows = consentTypeRows(reg, "p1", "house_manager");
  assert.equal(managerRows[0].status, "Active");
  assert.equal(managerRows[0].decision, "Yes - permission given");
  assert.equal(managerRows[1].status, "Missing");
  assert.equal(managerRows[1].decision, "No active permission on file");
  const dspRows = consentTypeRows(reg, "p1", "dsp");
  assert.equal(dspRows[1].status, "No active consent available");
  assert.equal(dspRows[1].historyLabel, "Active consent details");
  assert.equal(managerRows[1].historyLabel, "Version history (0)");
});

test("consentTypeRows carries the version history newest first", () => {
  const reg = register({
    records: [
      record({ id: "old", createdAt: "2025-01-12T15:00:00.000Z" }),
      record({ id: "new", createdAt: "2026-01-12T15:00:00.000Z", supersedesId: "old" }),
    ],
  });
  const rows = consentTypeRows(reg, "p1", "nurse");
  assert.deepEqual(rows[0].history.map((r) => r.id), ["new", "old"]);
  assert.equal(consentRecordStatus(reg, rows[0].history[1]), "Superseded");
});

const lifeEvent = (id: string, eventDate: string) =>
  ({
    id,
    agencyId: "a1",
    siteId: "s1",
    individualId: "p1",
    eventDate,
    category: "milestone",
    categoryLabel: "Milestone",
    title: `Event ${id}`,
    note: "",
    relatedGerId: null,
    recordedBy: "u1",
    recordedByName: "James Wilson",
    createdAt: `${eventDate}T20:00:00.000Z`,
    updatedBy: null,
    updatedByName: null,
    updatedAt: null,
    voidedBy: null,
    voidedByName: null,
    voidedAt: null,
    voidReason: null,
    voided: false,
  }) as unknown as LifeEventView;

test("groupLifeEventsByYear groups in order without re-sorting", () => {
  const groups = groupLifeEventsByYear([
    lifeEvent("a", "2026-03-01"),
    lifeEvent("b", "2026-01-15"),
    lifeEvent("c", "2025-06-01"),
  ]);
  assert.deepEqual(groups.map((g) => g.year), ["2026", "2025"]);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["a", "b"]);
});

test("rightsPacketSummary mirrors the shared derivation: latest packet, countdown, history", () => {
  const signer = { printedName: "Dana Hart", authority: "Guardian", authorityOther: "", signature: "Dana Hart", witness: "Casey Adams", accepted: true };
  const base = {
    agencyId: "a1", individualId: "i1", createdBy: "hm", signerName: "Dana Hart",
    reviewedBy: "James Wilson", evidenceName: null, copyVersion: "v1",
    signer: null, signedAt: null, filedAt: null, packetOn: null,
  } as const;
  const prior = { ...base, id: "prior", createdAt: "2024-05-01T10:00:00Z", packetOn: "2024-05-01", status: "signed" as const, signer, signedAt: "2024-05-01T10:05:00Z" };
  const latest = { ...base, id: "latest", createdAt: "2026-10-01T10:00:00Z", packetOn: "2026-10-01", status: "signed" as const, signer, signedAt: "2026-10-01T10:05:00Z" };
  const summary = rightsPacketSummary([prior, latest], "2026-10-30");
  assert.equal(summary.trackingText, "Renews in 336 days");
  assert.equal(summary.renewalOn, "2027-10-01");
  assert.equal(summary.latest?.id, "latest");
  assert.deepEqual(summary.history.map((packet) => packet.id), ["prior"]);

  const awaiting = { ...base, id: "next", createdAt: "2026-10-29T10:00:00Z", status: "awaiting_signature" as const };
  const unsigned = rightsPacketSummary([awaiting], "2026-10-30");
  assert.equal(unsigned.trackingText, "Not yet signed");
  assert.equal(unsigned.awaiting?.id, "next");
  assert.equal(rightsPacketSummary([], "2026-10-30").trackingText, "Not yet signed");
});
