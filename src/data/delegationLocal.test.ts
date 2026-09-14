import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
  emailFor,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { DIGITAL_RECORD_MARK } from "../delegation/delegation";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username,
    password: DEMO_PASSWORD,
  };
}

const taylorLogin = () => login(emailFor("Taylor Reed").split("@")[0]);
const oakwoodDspLogin = () => login(emailFor("Jordan Lee").split("@")[0]);

function userIdFor(s: MemoryStore, fullName: string): string {
  return s.db.profiles.find((p) => p.fullName === fullName)!.id;
}

function mapleSiteId(s: MemoryStore): string {
  return s.db.sites.find((row) => row.name === "Maple House")!.id;
}

/** Fresh store, admin signed in, one template activated at Maple House and
 *  assigned to Jodie Williams (Maple). Material is still a draft. */
async function setupAssignedFlow() {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const templates = await api.listDelegationTemplates();
  const activation = await api.activateDelegationTemplate(
    templates[0].id,
    mapleSiteId(s),
  );
  const individual = s.db.individuals.find(
    (p) => p.fullName === "Jodie Williams",
  )!;
  const assignment = await api.assignDelegationToIndividual(
    activation.id,
    individual.id,
  );
  return { s, api, templates, activation, assignment };
}

/** Like setupAssignedFlow, but the nurse reviews and publishes the draft. */
async function setupPublishedFlow() {
  const flow = await setupAssignedFlow();
  await flow.api.signIn(login(DEMO_NURSE_USERNAME));
  const material = await flow.api.getDelegationTrainingMaterial(
    flow.assignment.id,
  );
  await flow.api.approveDelegationTrainingMaterial(
    flow.assignment.id,
    material!.draftContent,
  );
  return flow;
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

test("seed ships the eight-template library", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const templates = await api.listDelegationTemplates();
  assert.equal(templates.length, 8);
  assert.ok(templates.every((t) => t.agencyId === null && t.active));
  const names = templates.map((t) => t.name);
  for (const expected of [
    "Bowel movement (BM) protocol",
    "Seizure protocol",
    "High-fiber/high-protein diet",
    "Calorie intake tracking",
    "Choking/aspiration protocol",
    "G-tube feeding support",
    "Blood sugar monitoring",
    "Fall prevention",
  ]) {
    assert.ok(names.includes(expected), `missing template: ${expected}`);
  }
});

test("activation is visible only at the activated site", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const templates = await api.listDelegationTemplates();
  const activation = await api.activateDelegationTemplate(
    templates[0].id,
    mapleSiteId(s),
  );
  assert.equal(activation.siteId, mapleSiteId(s));
  assert.equal(activation.status, "active");
  // Oakwood HM sees nothing at his site.
  await api.signIn(login(DEMO_HM_USERNAME));
  assert.equal((await api.listSiteDelegationActivations()).length, 0);
  // Maple nurse sees the activation.
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const mapleView = await api.listSiteDelegationActivations();
  assert.equal(mapleView.length, 1);
  assert.equal(mapleView[0].id, activation.id);
});

test("DSP cannot activate, assign, or approve", async () => {
  const { s, api, templates, activation, assignment } =
    await setupAssignedFlow();
  await api.signIn(login(DEMO_DSP_USERNAME)); // Alex Morgan, DSP at Maple
  await assert.rejects(() =>
    api.activateDelegationTemplate(templates[0].id, mapleSiteId(s)),
  );
  const individual = s.db.individuals.find(
    (p) => p.fullName === "Jodie Williams",
  )!;
  await assert.rejects(() =>
    api.assignDelegationToIndividual(activation.id, individual.id),
  );
  const draft = s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!.draftContent;
  await assert.rejects(() =>
    api.approveDelegationTrainingMaterial(assignment.id, draft),
  );
});

test("assignment instantiates a draft and notifies reviewers, not all staff", async () => {
  const { s, assignment } = await setupAssignedFlow();
  const material = s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!;
  assert.equal(material.status, "draft");
  assert.equal(material.draftContent.individualName, "Jodie Williams");
  assert.equal(material.draftContent.templateName, assignment.templateName);
  assert.equal(material.draftContent.generatedMark, DIGITAL_RECORD_MARK);
  assert.equal(material.draftContent.individualNotes, "");
  const reviewNotes = s.db.notifications.filter(
    (n) => n.type === "delegation.review_ready",
  );
  const notified = new Set(reviewNotes.map((n) => n.userId));
  // Reviewers: the Maple nurse and the agency admin (agency-scoped).
  assert.ok(notified.has(userIdFor(s, "Cameron Price")));
  assert.ok(notified.has(userIdFor(s, "Sarah Mitchell")));
  // DSPs are staff, not reviewers: no review_ready for them.
  assert.ok(!notified.has(userIdFor(s, "Alex Morgan")));
  assert.ok(!notified.has(userIdFor(s, "Taylor Reed")));
  assert.ok(!notified.has(userIdFor(s, "James Wilson")));
  assert.equal(reviewNotes.length, 2);
});

test("draft content stays hidden from site staff until published", async () => {
  const { api, assignment } = await setupAssignedFlow();
  // Ordinary site staff (DSP at Maple) sees nothing while it's a draft.
  await api.signIn(login(DEMO_DSP_USERNAME));
  assert.equal(await api.getDelegationTrainingMaterial(assignment.id), null);
  // After the reviewer submits it for review, staff still sees nothing.
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await api.submitDelegationForReview(assignment.id);
  await api.signIn(login(DEMO_DSP_USERNAME));
  assert.equal(await api.getDelegationTrainingMaterial(assignment.id), null);
  // The reviewer can see the in-review draft.
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const material = await api.getDelegationTrainingMaterial(assignment.id);
  assert.ok(material);
  assert.equal(material!.status, "in_review");
});

test("publishing notifies each site staff member exactly once", async () => {
  const { s, api, assignment } = await setupPublishedFlow();
  const published = s.db.notifications.filter(
    (n) => n.type === "delegation.published",
  );
  const mapleStaffIds = s.db.memberships
    .filter((m) => m.siteId === mapleSiteId(s))
    .map((m) => m.userId);
  assert.ok(mapleStaffIds.length > 0);
  assert.equal(published.length, mapleStaffIds.length);
  assert.deepEqual(
    published.map((n) => n.userId).sort(),
    [...new Set(mapleStaffIds)].sort(),
  );
  // Oakwood staff got nothing.
  assert.ok(
    !published.some(
      (n) => n.userId === userIdFor(s, "Jordan Lee"),
    ),
  );
  // The published content carries the digital-record mark.
  const material = s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!;
  assert.equal(material.status, "published");
  assert.equal(material.publishedContent!.generatedMark, DIGITAL_RECORD_MARK);
  assert.ok(material.approvedAt);
  assert.ok(material.approvedBy);
});

test("staff open, sign, and cannot sign twice or without opening", async () => {
  const { api, assignment } = await setupPublishedFlow();
  await api.signIn(login(DEMO_DSP_USERNAME)); // Alex Morgan
  assert.equal(await api.getMyDelegationAck(assignment.id), null);
  await api.openDelegationMaterial(assignment.id);
  let ack = await api.getMyDelegationAck(assignment.id);
  assert.ok(ack?.openedAt);
  assert.equal(ack?.signedAt, null);
  await api.signDelegationAcknowledgment(assignment.id, "Alex Morgan", "Alex Morgan");
  ack = await api.getMyDelegationAck(assignment.id);
  assert.ok(ack?.signedAt);
  assert.equal(ack?.signatureName, "Alex Morgan");
  // Cannot sign twice.
  await assert.rejects(() =>
    api.signDelegationAcknowledgment(assignment.id, "Alex Morgan", "Alex Morgan"),
  );
  // Taylor Reed (DSP at Maple) cannot sign without opening first.
  await api.signIn(taylorLogin());
  await assert.rejects(() =>
    api.signDelegationAcknowledgment(assignment.id, "Taylor Reed", "Taylor Reed"),
  );
});

test("staff cannot sign another staff member's acknowledgment", async () => {
  const { s, api, assignment } = await setupPublishedFlow();
  await api.signIn(login(DEMO_DSP_USERNAME)); // Alex Morgan
  await api.openDelegationMaterial(assignment.id);
  await api.signDelegationAcknowledgment(assignment.id, "Alex Morgan", "Alex Morgan");
  // Taylor's row is untouched: Alex's signing never crossed rows.
  await api.signIn(taylorLogin());
  assert.equal(await api.getMyDelegationAck(assignment.id), null);
  // Taylor opens and signs her own; both rows stay owned by their signers.
  await api.openDelegationMaterial(assignment.id);
  await api.signDelegationAcknowledgment(assignment.id, "Taylor Reed", "Taylor Reed");
  const rows = s.db.delegationAcknowledgments.filter(
    (r) => r.assignmentId === assignment.id,
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const signer = s.db.profiles.find((p) => p.id === row.staffId)!.fullName;
    assert.equal(row.signatureName, signer);
  }
  const alexRow = rows.find(
    (r) => r.staffId === userIdFor(s, "Alex Morgan"),
  )!;
  assert.ok(alexRow.signedAt);
});

test("HM/DPM sees per-staff acknowledgment status with overdue flags", async () => {
  const { s, api, assignment } = await setupPublishedFlow();
  // Backdate publication past the 7-day due window.
  s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!.approvedAt = daysAgo(8.5);
  // Alex opens and signs; Taylor and Cameron do not.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.openDelegationMaterial(assignment.id);
  await api.signDelegationAcknowledgment(assignment.id, "Alex Morgan", "Alex Morgan");
  // The nurse (reviewer) reads the roster.
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const roster = await api.listDelegationAckStatus(assignment.id);
  assert.equal(roster.length, 3); // Alex, Taylor, Cameron at Maple
  const byName = Object.fromEntries(roster.map((r) => [r.staffName, r]));
  assert.ok(byName["Alex Morgan"].signedAt);
  assert.equal(byName["Alex Morgan"].overdue, false);
  assert.equal(byName["Taylor Reed"].signedAt, null);
  assert.equal(byName["Taylor Reed"].overdue, true);
  assert.equal(byName["Cameron Price"].overdue, true);
});

test("overdue sweep notifies staff and managers idempotently", async () => {
  const { s, api, assignment } = await setupPublishedFlow();
  s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!.approvedAt = daysAgo(8.5);
  await api.signIn(login(DEMO_NURSE_USERNAME)); // holds delegation.training.review
  const first = await api.sweepDelegationAckOverdue();
  // 3 unsigned Maple staff (Alex, Taylor, Cameron) + 1 manager with
  // delegation.activate (Sarah Mitchell, agency-scoped admin).
  assert.equal(first, 4);
  const overdueNotes = () =>
    s.db.notifications.filter((n) => n.type === "delegation.ack_overdue");
  assert.equal(overdueNotes().length, 4);
  assert.ok(
    overdueNotes().some((n) => /overdue/.test(n.body)),
    "expected the overdue body copy",
  );
  const before = s.db.notifications.length;
  const second = await api.sweepDelegationAckOverdue();
  assert.equal(second, 0);
  assert.equal(s.db.notifications.length, before);
});

test("sweep skips fresh publications and signed staff", async () => {
  // Freshly published: nothing is past due yet.
  const fresh = await setupPublishedFlow();
  await fresh.api.signIn(login(DEMO_NURSE_USERNAME));
  assert.equal(await fresh.api.sweepDelegationAckOverdue(), 0);
  // Stale publication, but Alex already signed: he is skipped.
  const { s, api, assignment } = await setupPublishedFlow();
  s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignment.id,
  )!.approvedAt = daysAgo(8.5);
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.openDelegationMaterial(assignment.id);
  await api.signDelegationAcknowledgment(assignment.id, "Alex Morgan", "Alex Morgan");
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const inserted = await api.sweepDelegationAckOverdue();
  // Taylor + Cameron (unsigned staff) + Sarah (manager); Alex skipped.
  assert.equal(inserted, 3);
  const notified = s.db.notifications
    .filter((n) => n.type === "delegation.ack_overdue")
    .map((n) => n.userId);
  assert.ok(!notified.includes(userIdFor(s, "Alex Morgan")));
  assert.ok(notified.includes(userIdFor(s, "Taylor Reed")));
  assert.ok(notified.includes(userIdFor(s, "Sarah Mitchell")));
});

test("HM at another site cannot see the ack roster", async () => {
  const { api, assignment } = await setupPublishedFlow();
  await api.signIn(login(DEMO_HM_USERNAME)); // James Wilson, HM at Oakwood
  await assert.rejects(() => api.listDelegationAckStatus(assignment.id));
  // And an Oakwood DSP is outside the delegation entirely: cross-site
  // access throws rather than leaking anything.
  await api.signIn(oakwoodDspLogin());
  await assert.rejects(() => api.getDelegationTrainingMaterial(assignment.id));
});
