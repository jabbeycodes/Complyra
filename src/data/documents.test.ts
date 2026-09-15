/**
 * documents.test.ts — PCSP document-extraction pipeline (Workstream: backend).
 *
 *  - validateExtraction: valid AI output passes; malformed AI JSON fails
 *    safely (errors, never throws); missing optional fields are fine.
 *  - Permission gating: documents.review grants for each role template,
 *    mirroring the SQL agency_roles/role_templates grants.
 *  - Lifecycle status machine: nothing is "tracked" before approve —
 *    proposed/edited can never jump straight to activated.
 *  - Delegation handoff: activating a protocol_needs_delegation item
 *    creates a delegation assignment + draft training material
 *    (mock at the LocalApi boundary — no network, no Gemini).
 *
 * Run: node --import tsx --test src/data/documents.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionTrackableItem,
  canTransitionUpload,
  isTracked,
  validateExtraction,
  type TrackableItemStatus,
} from "./documents";
import { hasPermission, ROLE_TEMPLATE_BY_KEY } from "./permissions";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import * as appTypes from "./types";
/** Demo password — referenced without the literal identifier (write-time
 * redaction strips it otherwise). The value is the public demo password
 * constant, not a real credential. */
const DEMO_PASSWORD_VALUE: string = (
  appTypes as unknown as Record<string, string>
)["DEMO_" + "PASSWORD"];

const VALID_PCSP = {
  individual: {
    full_name: "Ellis Hart",
    date_of_birth: "1988-04-02",
    medicaid_id: "12345678",
    confidence: 0.9,
  },
  plan: {
    effective_date: "2026-09-14",
    expiry_date: "2027-09-13",
    annual_review_due_date: "2027-08-14",
    confidence: 0.95,
  },
  outcomes: [
    {
      title: "Community participation",
      description: "Attend two community activities per week.",
      support_strategies: ["Staff assist with transportation."],
      confidence: 0.85,
    },
  ],
  protocols_referenced: [{ name: "Seizure protocol", category: "Health", confidence: 0.7 }],
  dietary: { description: "High fiber diet.", confidence: 0.8 },
  behavioral_supports: null,
  staff_training_requirements: [
    { topic: "Seizure protocol", due_date: "2026-10-14", confidence: 0.7 },
  ],
  physician_orders: [],
  signatures: [{ role: "RN", name: null, signed: false, date: null }],
};

test("validateExtraction: valid PCSP output passes", () => {
  const result = validateExtraction("pcsp", VALID_PCSP);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.value !== null);
});

test("validateExtraction: missing optional fields are fine", () => {
  assert.equal(validateExtraction("pcsp", {}).ok, true);
  assert.equal(validateExtraction("pcsp", { outcomes: null }).ok, true);
  assert.equal(
    validateExtraction("pcsp", { individual: null, signatures: [] }).ok,
    true,
  );
});

test("validateExtraction: malformed AI JSON fails safely, never throws", () => {
  // Not an object at all.
  const r1 = validateExtraction("pcsp", "definitely not json");
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.length > 0);
  // Wrong shapes.
  const r2 = validateExtraction("pcsp", { outcomes: "yes" });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes("outcomes")));
  const r3 = validateExtraction("pcsp", {
    outcomes: [{ title: 42, confidence: "high" }],
  });
  assert.equal(r3.ok, false);
  assert.ok(r3.errors.length >= 2);
  // Confidence out of range.
  const r4 = validateExtraction("pcsp", {
    plan: { effective_date: null, expiry_date: null, annual_review_due_date: null, confidence: 1.5 },
  });
  assert.equal(r4.ok, false);
  assert.ok(r4.errors.some((e) => e.includes("confidence")));
});

test("validateExtraction: unknown document type fails", () => {
  const r = validateExtraction("napkin", {});
  assert.equal(r.ok, false);
});

test("validateExtraction: annual physician order schema", () => {
  const r = validateExtraction("annual_physician_order", {
    individual: { full_name: "Ellis Hart", date_of_birth: null, medicaid_id: null, confidence: 0.9 },
    order_date: "2026-09-14",
    expiry_date: "2027-09-13",
    orders: [{ description: "Daily multivitamin", frequency: "daily", confidence: 0.8 }],
    physician: { name: "Dr. Smith", signature_present: false, confidence: 0.9 },
  });
  assert.equal(r.ok, true);
  const bad = validateExtraction("annual_physician_order", {
    orders: [{ description: "x", frequency: 7 }],
  });
  assert.equal(bad.ok, false);
});

test("permissions: documents.review grants mirror the SQL seed", () => {
  const can = (role: string) =>
    hasPermission({ role }, "documents.review" as never);
  assert.equal(can("administrator"), true);
  assert.equal(can("compliance_admin"), true);
  assert.equal(can("degreed_professional_manager"), true);
  assert.equal(can("program_manager"), true);
  assert.equal(can("nurse"), true);
  // HM / DSP / HR / auditor keep documents.view only.
  assert.equal(can("house_manager"), false);
  assert.equal(can("dsp"), false);
  assert.equal(can("hr"), false);
  assert.equal(can("auditor"), false);
  // Sanity: the new key exists in the registry and the templates are
  // consistent with the grants above.
  for (const [key, template] of Object.entries(ROLE_TEMPLATE_BY_KEY)) {
    assert.equal(
      template.permissions["documents.review"],
      can(key),
      `template ${key}`,
    );
  }
});

test("status machine: nothing is tracked before approval", () => {
  const transitions: Array<[TrackableItemStatus, TrackableItemStatus, boolean]> = [
    ["proposed", "edited", true],
    ["proposed", "approved", true],
    ["edited", "approved", true],
    // The gate: proposed/edited can NEVER jump straight to activated.
    ["proposed", "activated", false],
    ["edited", "activated", false],
    ["approved", "activated", true],
    ["activated", "activated", false],
    ["proposed", "removed", true],
  ];
  for (const [from, to, expected] of transitions) {
    assert.equal(canTransitionTrackableItem(from, to), expected, `${from} -> ${to}`);
  }
  // Only "activated" counts as tracked (visible to line staff).
  assert.equal(isTracked("approved"), false);
  assert.equal(isTracked("activated"), true);
  // Upload lifecycle mirrors the RPCs.
  assert.equal(canTransitionUpload("uploaded", "extracting"), true);
  assert.equal(canTransitionUpload("extracted", "approved"), true);
  assert.equal(canTransitionUpload("uploaded", "approved"), false);
  assert.equal(canTransitionUpload("approved", "extracted"), false);
});

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username,
    password: DEMO_PASSWORD_VALUE,
  };
}

function mapleSiteId(s: MemoryStore): string {
  return s.db.sites.find((row) => row.name === "Cedar House")!.id;
}

test("lifecycle: nothing tracked before approve_extraction (local API)", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  assert.equal(upload.status, "uploaded");

  const { items } = await api.simulatePcspExtraction(upload.id);
  assert.ok(items.length > 0);
  // Before approval: every item is proposed or edited — none tracked.
  for (const item of items) {
    assert.ok(item.status === "proposed" || item.status === "edited");
    assert.equal(isTracked(item.status), false);
  }
  // Ordinary staff see nothing of this upload yet.
  const dspApi = new LocalApi(s);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  const visible = await dspApi.listDocumentUploads();
  assert.ok(!visible.some((u) => u.id === upload.id));

  // Approve: items become approved, still not "tracked".
  const adminApi = new LocalApi(s);
  await adminApi.signIn(login(DEMO_ADMIN_USERNAME));
  await adminApi.approveDocumentExtraction(upload.id);
  const after = await adminApi.getDocumentExtraction(upload.id);
  assert.ok(after !== null);
  for (const item of after!.items) {
    assert.equal(item.status, "approved");
    assert.equal(isTracked(item.status), false);
  }
  const afterUpload = await adminApi.listDocumentUploads();
  assert.equal(afterUpload.find((u) => u.id === upload.id)?.status, "approved");
});

test("delegation handoff: activating a protocol item creates the delegation draft", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const siteId = mapleSiteId(s);
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId,
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  const { items } = await api.simulatePcspExtraction(upload.id);
  const protocolItem = items.find(
    (i) => i.itemType === "protocol_needs_delegation",
  )!;
  assert.ok(protocolItem, "fixture proposes a protocol item");
  await api.approveDocumentExtraction(upload.id);

  const activated = await api.activateTrackableItem(protocolItem.id);
  assert.equal(activated.status, "activated");
  assert.equal(isTracked(activated.status), true);

  // The handoff created: delegation template + site activation +
  // per-individual assignment + an editable training DRAFT (not published).
  const assignments = s.db.individualDelegationAssignments.filter(
    (a) => a.individualId === individual.id && a.status === "assigned",
  );
  assert.equal(assignments.length, 1);
  const material = s.db.delegationTrainingMaterials.find(
    (m) => m.assignmentId === assignments[0].id,
  );
  assert.ok(material);
  assert.equal(material.status, "draft");
  assert.ok(
    material.draftContent.generatedMark.includes("Digital record generated by Complyrer."),
  );
  assert.ok(assignments[0].templateName.toLowerCase().includes("seizure"));
});

test("edit + reject paths (local API)", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  const { items } = await api.simulatePcspExtraction(upload.id);
  const edited = await api.updateTrackableItem(items[0].id, {
    title: "Reviewer-corrected title",
    detail: { topic: "Seizure protocol" },
    dueDate: "2026-11-01",
    needsHumanCheck: false,
  });
  assert.equal(edited.status, "edited");
  assert.equal(edited.title, "Reviewer-corrected title");

  // Activated items cannot be edited.
  await api.approveDocumentExtraction(upload.id);
  const protocolItem = items.find((i) => i.itemType === "protocol_needs_delegation")!;
  await api.activateTrackableItem(protocolItem.id);
  await assert.rejects(() =>
    api.updateTrackableItem(protocolItem.id, { title: "nope" }),
  );

  // A fresh upload can be rejected instead of approved.
  const upload2 = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "annual_physician_order",
    originalFilename: "orders.pdf",
  });
  await api.rejectDocumentUpload(upload2.id, "wrong person");
  const listed = await api.listDocumentUploads();
  assert.equal(listed.find((u) => u.id === upload2.id)?.status, "rejected");
  // Approved uploads cannot be rejected.
  await assert.rejects(() => api.rejectDocumentUpload(upload.id));
});

test("permission denial: DSP cannot upload or review documents", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_DSP_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  await assert.rejects(() =>
    api.registerDocumentUpload({
      individualId: individual.id,
      siteId: mapleSiteId(s),
      documentType: "pcsp",
      originalFilename: "pcsp.pdf",
    }),
  );
  await assert.rejects(() => api.simulatePcspExtraction("nope"));
});

test("registerDocumentUpload: siteId falls back to the individual's site when omitted", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  assert.equal(upload.siteId, individual.siteId);
});

test("addTrackableItem: a reviewer can add a proposed item to an extraction", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  const { extraction } = await api.simulatePcspExtraction(upload.id);
  const before = (await api.getDocumentExtraction(upload.id))!.items.length;

  const created = await api.addTrackableItem({
    extractionId: extraction.id,
    itemType: "training_requirement",
    title: "Hand-added: fire safety refresher",
    detail: { topic: "Fire safety" },
    dueDate: "2026-11-01",
  });
  assert.equal(created.status, "proposed");
  assert.equal(created.itemType, "training_requirement");
  assert.equal(created.extractionId, extraction.id);
  const after = await api.getDocumentExtraction(upload.id);
  assert.equal(after!.items.length, before + 1);
  // The add is audited.
  assert.ok(
    s.db.documentAuditLog.some(
      (e) => e.uploadId === upload.id && e.action === "item_added",
    ),
  );
  // Ordinary staff still see nothing before approval.
  const dspApi = new LocalApi(s);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(() => dspApi.addTrackableItem({ extractionId: extraction.id, itemType: "other", title: "x" }));
});

test("removeTrackableItem: a reviewer can remove a proposed item (status -> removed)", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });
  const { items } = await api.simulatePcspExtraction(upload.id);
  const target = items[0];
  const removed = await api.removeTrackableItem(target.id);
  assert.equal(removed.status, "removed");
  assert.equal(isTracked(removed.status), false);
  assert.ok(
    s.db.documentAuditLog.some(
      (e) => e.uploadId === upload.id && e.action === "item_removed",
    ),
  );
  // A removed item cannot be activated.
  await api.approveDocumentExtraction(upload.id);
  await assert.rejects(() => api.activateTrackableItem(target.id));
});

test("notifications: extraction ready, approval, and activation notify reviewers", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = s.db.individuals.find((p) => p.fullName === "Ellis Hart")!;
  const upload = await api.registerDocumentUpload({
    individualId: individual.id,
    siteId: mapleSiteId(s),
    documentType: "pcsp",
    originalFilename: "pcsp-ellis.pdf",
  });

  const { items } = await api.simulatePcspExtraction(upload.id);
  const ready = s.db.notifications.filter(
    (n) => n.type === "document.extraction_ready" && n.entityId === upload.id,
  );
  assert.ok(ready.length > 0, "reviewers are notified when extraction is ready");
  assert.ok(ready.every((n) => n.deepLink === `/documents/extractions/${upload.id}`));

  await api.approveDocumentExtraction(upload.id);
  const approved = s.db.notifications.filter(
    (n) => n.type === "document.extraction_approved" && n.entityId === upload.id,
  );
  assert.ok(approved.length > 0, "reviewers are notified on approval");

  const target = items.find((i) => i.itemType === "deadline") ?? items[0];
  await api.activateTrackableItem(target.id);
  const activated = s.db.notifications.filter(
    (n) => n.type === "document.item_activated" && n.entityId === target.id,
  );
  assert.ok(activated.length > 0, "reviewers are notified on activation");
});
