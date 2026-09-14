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
} from "./seed";
import { DEMO_PASSWORD, blankDelegationForm } from "./types";
import {
  canonicalJson,
  sha256Hex,
  signatureDocumentHash,
  ESIGN_CONSENT_VERSION,
} from "../features/signatures/signatureUtils";
import {
  certificatePayload,
  delegationFormPayload,
  hmChecklistPayload,
  trainingChecklistDocId,
  trainingCountersignPayload,
} from "../features/signatures/documentPayloads";
import { todayIso } from "./chart";
import { ITEM_21_KEY, weekOfSundayIso } from "./hmChecklist";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

/** 1x1 transparent PNG — valid, tiny, passes adoption validation. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function adoptInput(overrides: Partial<{ consentGiven: boolean }> = {}) {
  return {
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
    ...overrides,
  };
}

async function adoptedApi(username: string) {
  const api = new LocalApi(store());
  await api.signIn(login(username));
  await api.adoptSignature(adoptInput());
  return api;
}

// ===== Hash contract =====

test("canonicalJson sorts keys deterministically", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    canonicalJson({ z: [{ b: 1, a: 2 }], a: null }),
    '{"a":null,"z":[{"a":2,"b":1}]}',
  );
});

test("documentHash equals sha256(canonicalJson(payload))", async () => {
  const payload = { obligationId: "abc", roster: [{ printName: "Zed" }] };
  const expected = await sha256Hex(canonicalJson(payload));
  assert.equal(await signatureDocumentHash("delegation_form", "abc", "rn_signature", payload), expected);
});

test("tampered payload recomputes to a different hash (tamper evidence)", async () => {
  const payload = { purpose: "Keep inhaler use safe." };
  const before = await signatureDocumentHash("delegation_form", "x", "rn_signature", payload);
  const after = await signatureDocumentHash("delegation_form", "x", "rn_signature", {
    purpose: "Keep inhaler use UNSAFE.",
  });
  assert.notEqual(before, after);
});

// ===== Adoption =====

test("getMySignature is null before adoption", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  assert.equal(await api.getMySignature(), null);
});

test("adoptSignature stores consent and images; getMySignature returns them", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_NURSE_USERNAME));
  const adopted = await api.adoptSignature(adoptInput());
  assert.equal(adopted.consentTextVersion, ESIGN_CONSENT_VERSION);
  assert.ok(adopted.signaturePath.includes(session.userId));
  assert.ok(adopted.initialsPath.includes(session.userId));
  assert.ok(adopted.adoptedAt);
  assert.ok(adopted.consentAt);
  const mine = await api.getMySignature();
  assert.deepEqual(mine, adopted);
  // The stored PNG round-trips as a viewable image.
  const url = await api.getSignatureImageUrl(adopted.signaturePath);
  assert.ok(url.startsWith("data:image/png;base64,"));
});

test("adoptSignature rejects when consent is not confirmed", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(() => api.adoptSignature(adoptInput({ consentGiven: false })), /consent/);
  assert.equal(await api.getMySignature(), null);
});

test("adoptSignature rejects non-PNG images", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(
    () =>
      api.adoptSignature({
        ...adoptInput(),
        signatureDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      }),
    /PNG/,
  );
});

test("adoptSignature rejects images over 200 KB", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const big = "data:image/png;base64," + "A".repeat(280_000);
  await assert.rejects(
    () => api.adoptSignature({ ...adoptInput(), initialsDataUrl: big }),
    /200 KB/,
  );
});

test("re-adoption replaces the stored images", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const first = await api.adoptSignature(adoptInput());
  const second = await api.adoptSignature(adoptInput());
  assert.ok(second.adoptedAt >= first.adoptedAt);
  assert.deepEqual(await api.getMySignature(), second);
});

// ===== applySignature core =====

test("applySignature requires adoption first", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(login(DEMO_NURSE_USERNAME));
  const person = (await api.loadWorkspace(nurse)).individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
    templateVersion: "complyrer_improved",
  });
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "rn_signature",
        kind: "signature",
        documentPayload: { obligationId: id },
      }),
    /Adopt your electronic signature/,
  );
});

test("applySignature records an event; a second sign of the same field rejects", async () => {
  const api = await adoptedApi(DEMO_NURSE_USERNAME);
  const session = (await api.getSession())!;
  const person = (await api.loadWorkspace(session)).individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
    templateVersion: "complyrer_improved",
  });
  const payload = { obligationId: id, purpose: "Daily checks." };
  const result = await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });
  assert.ok(result.eventId);
  assert.ok(result.signedAt);
  // Required contract: hash over the canonical payload only.
  assert.equal(result.documentHash, await sha256Hex(canonicalJson(payload)));
  const events = await api.getSignatureEvents("delegation_form", id);
  assert.equal(events.length, 1);
  assert.equal(events[0].signerName, session.fullName);
  assert.equal(events[0].kind, "signature");
  assert.equal(events[0].documentHash, result.documentHash);
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "rn_signature",
        kind: "signature",
        documentPayload: payload,
      }),
    /already been signed/,
  );
});

test("applySignature rejects unknown document types, fields, and kinds", async () => {
  const api = await adoptedApi(DEMO_NURSE_USERNAME);
  await assert.rejects(
    () =>
      api.applySignature({
        // @ts-expect-error intentional bad input
        documentType: "mystery_doc",
        documentId: "x",
        fieldName: "f",
        kind: "signature",
        documentPayload: {},
      }),
    /Unknown document type/,
  );
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: "x",
        fieldName: "nope",
        kind: "signature",
        documentPayload: {},
      }),
    /Unknown signature field/,
  );
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: "x",
        fieldName: "rn_signature",
        // @ts-expect-error intentional bad input
        kind: "doodle",
        documentPayload: {},
      }),
    /Unknown signature kind/,
  );
});

test("getSignatureEvents is empty before signing", async () => {
  const api = await adoptedApi(DEMO_NURSE_USERNAME);
  assert.deepEqual(await api.getSignatureEvents("delegation_form", "nope"), []);
});

// ===== Delegation signing + locks =====

async function delegationWithForm(api: LocalApi, username: string) {
  const session = await api.signIn(login(username));
  const ws = await api.loadWorkspace(session);
  const person = ws.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    purpose: "Keep inhaler use safe.",
    templateVersion: "complyrer_improved",
    procedures: "Step one.",
  });
  const refreshed = await api.loadWorkspace(session);
  const item = refreshed.planStacks
    .flatMap((s) => s.required)
    .find((v) => v.item.id === id)!.item;
  const payload = delegationFormPayload({
    obligationId: id,
    individualName: person.name,
    taskTitle: item.title ?? "",
    form: item.delegationForm!,
  });
  return { session, person, id, item, payload };
}

test("RN signs a delegation via applySignature; the form delegatingRn is stamped", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await api.adoptSignature(adoptInput());
  const { session, id, payload } = await delegationWithForm(api, DEMO_NURSE_USERNAME);
  const result = await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });
  assert.equal(result.documentHash, await sha256Hex(canonicalJson(payload)));
  const refreshed = await api.loadWorkspace(session);
  const item = refreshed.planStacks.flatMap((s) => s.required).find((v) => v.item.id === id)!.item;
  assert.ok(item.rnSignedAt);
  // Legacy render fields stay in sync with the event — always the session name.
  assert.equal(item.delegationForm!.delegatingRn.signatureName, session.fullName);
  assert.match(item.delegationForm!.delegatingRn.dateSigned ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("a signed delegation form rejects content edits (locked)", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await api.adoptSignature(adoptInput());
  const { id, payload } = await delegationWithForm(api, DEMO_NURSE_USERNAME);
  await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });
  await assert.rejects(
    () => api.updateDelegationForm({ obligationId: id, patch: { purpose: "Changed." } }),
    /locked/i,
  );
  await assert.rejects(
    () => api.rescindDelegationRow({ obligationId: id, rowIndex: 0, rescindedDate: "2026-09-13" }),
    /locked/i,
  );
});

test("a roster row can only be signed by the staff member named on it", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(login(DEMO_NURSE_USERNAME));
  await api.adoptSignature(adoptInput());
  const { person, id } = await delegationWithForm(api, DEMO_NURSE_USERNAME);
  // Name row 0 for the nurse BEFORE anyone signs (edits lock after signing).
  const form = blankDelegationForm();
  form.roster[0].printName = nurse.fullName;
  await api.updateDelegationForm({ obligationId: id, patch: { roster: form.roster } });
  const refreshed = await api.loadWorkspace(nurse);
  const item = refreshed.planStacks
    .flatMap((s) => s.required)
    .find((v) => v.item.id === id)!.item;
  const payload = delegationFormPayload({
    obligationId: id,
    individualName: person.name,
    taskTitle: item.title ?? "",
    form: item.delegationForm!,
  });
  await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });
  // Another staff member adopts but cannot sign someone else's row.
  const dspApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await dspApi.adoptSignature(adoptInput());
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:0",
        kind: "signature",
        documentPayload: payload,
      }),
    /Only .* can sign this row/,
  );
  // The named nurse signs their own row (sign back in: sessions are store-level).
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const rowResult = await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "row:0",
    kind: "signature",
    documentPayload: payload,
  });
  assert.ok(rowResult.eventId);
  const events = await api.getSignatureEvents("delegation_form", id);
  assert.equal(events.length, 2);
});

// ===== Training locks + correction flow =====

test("a signed training sheet locks line edits until a correction is requested", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.adoptSignature(adoptInput());
  const ws = await api.loadWorkspace(admin);
  const siteId = ws.sites[0].id;
  const dsp = ws.staff.find((s) => s.username === DEMO_DSP_USERNAME)!;
  await api.assignTraining({ userId: dsp.id, siteId, source: "checklist" });
  const profile = await api.getStaffTrainingProfile(dsp.id);
  const hm = ws.staff.find((s) => s.username === DEMO_HM_USERNAME)!;

  // DSP initials every line, then signs the sheet as themselves.
  const dspApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await dspApi.adoptSignature(adoptInput());
  for (const line of profile.requirements) {
    await dspApi.initialRequirementLine(line.id, {
      initials: "AM",
      trainerUserId: hm.id,
      method: "shadowing",
      hoursTotal: 1,
      hoursWithHm: 0.2,
    });
  }
  const docId = trainingChecklistDocId(dsp.id, siteId);
  const payload = trainingCountersignPayload({
    userId: dsp.id,
    siteId,
    lines: profile.requirements.map((r) => ({
      topicId: r.topicId,
      topicTitle: r.topicId,
      resolvedStatus: r.status,
    })),
  });
  await dspApi.applySignature({
    documentType: "training_checklist",
    documentId: docId,
    fieldName: "staff_sign",
    kind: "signature",
    documentPayload: payload,
  });

  // An administrator's correction edit is rejected while the sheet is signed.
  const lineId = profile.requirements[0].id;
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    () =>
      api.initialRequirementLine(lineId, {
        initials: "AM",
        trainerUserId: hm.id,
        method: "shadowing",
        hoursTotal: 2,
        hoursWithHm: 0.4,
      }),
    /locked/i,
  );

  // HM countersigns; then a correction unlocks the sheet and clears events.
  await api.applySignature({
    documentType: "training_checklist",
    documentId: docId,
    fieldName: "hm_countersign",
    kind: "signature",
    documentPayload: payload,
  });
  const counters = (await api.getStaffTrainingProfile(dsp.id)).countersignatures;
  assert.ok(counters.length > 0);
  await api.requestTrainingCorrection({
    countersignatureId: counters[0].id,
    reason: "Hours were recorded against the wrong site.",
  });
  assert.deepEqual(await api.getSignatureEvents("training_checklist", docId), []);
  // The correction edit now succeeds.
  await api.initialRequirementLine(lineId, {
    initials: "AM",
    trainerUserId: hm.id,
    method: "shadowing",
    hoursTotal: 2,
    hoursWithHm: 0.4,
  });
});

// ===== HM weekly checklist lock =====

test("a signed HM checklist rejects further answers (locked)", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const week = weekOfSundayIso(todayIso());
  const created = await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: week,
  });
  const hmApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await hmApi.signIn(login(hmStaff.username));
  await hmApi.adoptSignature(adoptInput());
  for (const item of created.items) {
    if (item.key === ITEM_21_KEY) continue;
    await hmApi.answerChecklistItem(created.id, item.key, "Y");
  }
  const [fresh] = await hmApi.listWeeklyChecklists({ siteId: site.id });
  await hmApi.applySignature({
    documentType: "hm_checklist",
    documentId: created.id,
    fieldName: "hm_signature",
    kind: "signature",
    documentPayload: hmChecklistPayload(fresh),
  });
  const events = await hmApi.getSignatureEvents("hm_checklist", created.id);
  assert.equal(events.length, 1);
  await assert.rejects(
    () => hmApi.answerChecklistItem(created.id, created.items[0].key, "N"),
    /no longer open|locked/i,
  );
  await assert.rejects(
    () =>
      hmApi.addServiceLogEntry(created.id, {
        kind: "call_in",
        detail: "Late add after submit.",
      }),
    /no longer open|locked/i,
  );
});

// ===== Certificate acknowledgment =====

test("certificate acknowledgment: only the holder can sign", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.adoptSignature(adoptInput());
  const ws = await api.loadWorkspace(admin);
  const dsp = ws.staff.find((s) => s.username === DEMO_DSP_USERNAME)!;
  // No demo user holds certificates.manage, so seed the certificate row
  // directly (fixture setup only — the API under test is applySignature).
  const mem = (api as unknown as { store: MemoryStore }).store;
  const certs = ((mem.db as unknown as { certificates?: unknown[] }).certificates ??= []);
  const cert = {
    id: crypto.randomUUID(),
    agencyId: admin.agencyId,
    userId: dsp.id,
    certName: "CPR",
    issuedOn: "2026-01-15",
    expiresOn: "2028-01-15",
    filePath: null,
    fileName: null,
    enteredBy: admin.userId,
    createdAt: new Date().toISOString(),
  };
  certs.unshift(cert);
  // Someone else cannot acknowledge the holder's certificate.
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "certificate",
        documentId: cert.id,
        fieldName: "staff_ack",
        kind: "initials",
        documentPayload: certificatePayload(cert),
      }),
    /Only the certificate holder/,
  );
  // The holder acknowledges with their initials.
  const dspApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await dspApi.adoptSignature(adoptInput());
  const result = await dspApi.applySignature({
    documentType: "certificate",
    documentId: cert.id,
    fieldName: "staff_ack",
    kind: "initials",
    documentPayload: certificatePayload(cert),
  });
  assert.ok(result.eventId);
  const events = await dspApi.getSignatureEvents("certificate", cert.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "initials");
});

// ===== Signature settings =====

test("getSignatureSettings defaults to all methods on", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_NURSE_USERNAME));
  assert.deepEqual(await api.getSignatureSettings(), {
    allowDraw: true,
    allowType: true,
    allowUpload: true,
  });
});

test("updateSignatureSettings rejects non-admins and all-methods-off", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () => api.updateSignatureSettings({ allowDraw: true, allowType: false, allowUpload: false }),
    /Only an administrator/,
  );
  const adminApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await adminApi.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    () =>
      adminApi.updateSignatureSettings({ allowDraw: false, allowType: false, allowUpload: false }),
    /at least one adoption method/,
  );
  const saved = await adminApi.updateSignatureSettings({
    allowDraw: true,
    allowType: false,
    allowUpload: true,
  });
  assert.deepEqual(saved, { allowDraw: true, allowType: false, allowUpload: true });
  assert.deepEqual(await adminApi.getSignatureSettings(), saved);
});
