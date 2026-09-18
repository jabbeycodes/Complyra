/**
 * End-to-end workflow tests for the GER (General Event Report) API on the
 * local (in-memory) implementation: create → submit → review →
 * approve/return, role gating, filtering, and High/Critical escalation
 * notifications.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_ADMIN_USERNAME,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import type { AddGerReportInput } from "./types";

function memory() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function setup() {
  const store = memory();
  const api = new LocalApi(store);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  // DSP and nurse share a home in the demo seed; use it so the workflow
  // (DSP creates, nurse reviews) stays in one scoped home.
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  const site = workspace.sites.find((s) => s.id === dspSession.siteId) ?? workspace.sites[0];
  const individual = workspace.individuals.find((p) => p.siteId === site.id) ?? workspace.individuals[0];
  return { store, api, admin, site, individual };
}

const COMPLETE_INPUT: AddGerReportInput = {
  siteId: "",
  individualId: "",
  eventDate: "2026-09-17",
  eventTime: "14:30",
  location: "Living room",
  eventType: "fall",
  severity: "moderate",
  description: "Individual slipped near the couch.",
  actionsTaken: "Checked for injury; applied ice.",
  notificationsMade: [{ channel: "guardian", name: "Jane Doe", notifiedAt: "2026-09-17T15:00" }],
  witnesses: "Jodie M.",
  reportedByName: "Dana Staff",
  signatureName: "Dana Staff",
};

function completeInput(siteId: string, individualId: string, overrides: Partial<AddGerReportInput> = {}): AddGerReportInput {
  return { ...COMPLETE_INPUT, siteId, individualId, ...overrides };
}

test("DSP drafts, completes, and submits a report; nurse approves it", async () => {
  const { store, api, site, individual } = await setup();
  void store;
  await api.signIn(login(DEMO_DSP_USERNAME));
  const draft = await api.addGerReport({ siteId: site.id, individualId: individual.id, eventDate: "2026-09-17", eventType: "fall" });
  assert.equal(draft.status, "draft");

  // Incomplete draft cannot be submitted.
  await assert.rejects(() => api.submitGerReport(draft.id), /Cannot submit/);

  await api.updateGerReport(draft.id, {
    location: "Living room",
    description: "Individual slipped near the couch.",
    actionsTaken: "Checked for injury; applied ice.",
    reportedByName: "Dana Staff",
    signatureName: "Dana Staff",
  });
  const submitted = await api.submitGerReport(draft.id);
  assert.equal(submitted.status, "submitted");

  // The author can no longer edit once submitted (DSP has no review perm).
  await assert.rejects(() => api.updateGerReport(draft.id, { location: "Kitchen" }), /can no longer be edited/);
  // The author cannot approve.
  await assert.rejects(() => api.reviewGerReport(draft.id, "approve"), /Not authorized/);

  // Nurse reviews and approves.
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const approved = await api.reviewGerReport(draft.id, "approve");
  assert.equal(approved.status, "approved");
  assert.ok(approved.reviewerName.length > 0);
  assert.ok(approved.reviewedAt.length > 0);

  // Approved reports are locked for everyone.
  await assert.rejects(() => api.updateGerReport(draft.id, { location: "Kitchen" }), /can no longer be edited/);
});

test("nurse returns a report for corrections and the author resubmits", async () => {
  const { api, site, individual } = await setup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  const draft = await api.addGerReport(completeInput(site.id, individual.id));
  await api.submitGerReport(draft.id);

  await api.signIn(login(DEMO_NURSE_USERNAME));
  // Returning without a note is rejected.
  await assert.rejects(() => api.reviewGerReport(draft.id, "return", ""), /note explaining/);
  const returned = await api.reviewGerReport(draft.id, "return", "Add the time the nurse was called.");
  assert.equal(returned.status, "returned");
  assert.match(returned.reviewNote, /nurse was called/);

  // The author fixes and resubmits.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.updateGerReport(draft.id, { actionsTaken: "Checked for injury; called the nurse at 15:05." });
  const resubmitted = await api.submitGerReport(draft.id);
  assert.equal(resubmitted.status, "submitted");
});

test("high-severity submission alerts the home's HM, the program manager, and the nurse", async () => {
  const { store, api, site, individual } = await setup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  const draft = await api.addGerReport(
    completeInput(site.id, individual.id, { severity: "high", eventType: "er_visit" }),
  );
  await api.submitGerReport(draft.id);
  const alerts = store.db.notifications.filter(
    (n) => n.entityType === "ger_report" && n.entityId === draft.id,
  );
  // The demo DSP's home has no house manager, so the HM role is broadcast.
  assert.equal(alerts.length, 3);
  assert.deepEqual(
    alerts.map((n) => n.roleKey).sort(),
    ["house_manager", "nurse", "program_manager"],
  );
  assert.ok(alerts.every((n) => n.type === "incident.followup"));
  assert.ok(alerts.every((n) => n.deepLink === `/reporting/${draft.id}`));
  assert.ok(alerts.every((n) => n.title.startsWith("High")));
});

test("low-severity submission still alerts the home's HM, the PM, and the nurse", async () => {
  const { store, api, site, individual } = await setup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  const draft = await api.addGerReport(completeInput(site.id, individual.id, { severity: "low" }));
  await api.submitGerReport(draft.id);
  const alerts = store.db.notifications.filter(
    (n) => n.entityType === "ger_report" && n.entityId === draft.id,
  );
  assert.equal(alerts.length, 3);
  assert.deepEqual(
    alerts.map((n) => n.roleKey).sort(),
    ["house_manager", "nurse", "program_manager"],
  );
  assert.ok(alerts.every((n) => n.title.startsWith("Low")));
});

test("listGerReports filters by individual, type, status, and date range", async () => {
  const { api, site, individual } = await setup();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const other = { ...individual, id: "other-ind" };
  void other;
  const r1 = await api.addGerReport(completeInput(site.id, individual.id, { eventType: "fall", eventDate: "2026-09-10" }));
  const r2 = await api.addGerReport(completeInput(site.id, individual.id, { eventType: "injury", eventDate: "2026-09-17" }));
  await api.submitGerReport(r2.id);

  assert.equal((await api.listGerReports(site.id)).length, 2);
  assert.equal(
    (await api.listGerReports(site.id, { individualId: individual.id, eventType: "", status: "", from: "", to: "" })).length,
    2,
  );
  assert.equal(
    (await api.listGerReports(site.id, { individualId: "", eventType: "fall", status: "", from: "", to: "" })).length,
    1,
  );
  assert.equal(
    (await api.listGerReports(site.id, { individualId: "", eventType: "", status: "submitted", from: "", to: "" })).length,
    1,
  );
  assert.equal(
    (await api.listGerReports(site.id, { individualId: "", eventType: "", status: "", from: "2026-09-15", to: "2026-09-18" })).length,
    1,
  );
  // Newest first.
  const listed = await api.listGerReports(site.id);
  assert.equal(listed[0].id, r2.id);
  assert.equal(listed[0].individualName.length > 0, true);
  // getGerReport resolves names too.
  const detail = await api.getGerReport(r1.id);
  assert.ok(detail.individualName.length > 0);
});

test("reports reject an individual from another home", async () => {
  const { api, site, individual } = await setup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () => api.addGerReport(completeInput(site.id, "definitely-not-here")),
    /not part of this home/,
  );
  void individual;
});

test("getGerReport on an unknown id rejects", async () => {
  const { api } = await setup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(() => api.getGerReport("missing"), /not found/i);
});
