import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  ESIGN_CONSENT_VERSION,
  signatureDocumentHash,
  suggestInitials,
} from "../features/signatures/signatureUtils";
import {
  latestLineEvent,
  lineNeedsReinitial,
  parseTrainingLineField,
  trainingChecklistDocId,
  trainingLineFieldName,
  trainingLinePayload,
  trainingLinePayloadFromView,
} from "../features/signatures/documentPayloads";
import { siteChecklistTopics } from "../features/training/topics";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

/** 1x1 transparent PNG — valid, tiny, passes adoption validation. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function adopt(api: LocalApi, username: string) {
  const session = await api.signIn(login(username));
  await api.adoptSignature({
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  });
  // 13 CSR 65-3.050: signing requires a fresh password re-entry on top of
  // the session, so the harness re-authenticates before signing.
  await api.verifySigningPassword(DEMO_PASSWORD);
  return session;
}

interface Fixture {
  api: LocalApi;
  dspId: string;
  hmId: string;
  hmName: string;
  siteId: string;
  requirementIds: string[];
}

/** Admin assigns `count` checklist topics to the DSP at the first site. */
async function fixture(count = 2): Promise<Fixture> {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const dsp = ws.staff.find((person) => person.username === DEMO_DSP_USERNAME)!;
  const hm = ws.staff.find((person) => person.roleKey === "house_manager")!;
  assert.ok(dsp && hm, "demo DSP and HM exist");
  const siteId = ws.sites[0].id;
  const topicIds = siteChecklistTopics()
    .slice(0, count)
    .map((topic) => topic.id);
  const created = await api.assignTraining({
    userId: dsp.id,
    siteId,
    source: "checklist",
    topicIds,
  });
  assert.equal(created.length, count);
  return {
    api,
    dspId: dsp.id,
    hmId: hm.id,
    hmName: hm.name,
    siteId,
    requirementIds: created.map((row) => row.id),
  };
}

/**
 * What the InitialLineModal submit does: save the line with the ADOPTED
 * initials text (derived from the signer's name — never typed), then stamp
 * the versioned per-line e-initials event.
 */
async function initialAndStamp(
  fx: Fixture,
  requirementId: string,
  adoptedInitialsText: string,
) {
  const { api, dspId, hmId, hmName, siteId } = fx;
  const before = await api.getStaffTrainingProfile(dspId);
  const line = before.requirements.find((row) => row.id === requirementId)!;
  // Mirrors the modal submit: the versioned field name is computed from a
  // fresh read, then the save bumps to exactly that version.
  const version = (line.signoff?.signoffVersion ?? 0) + 1;
  await api.initialRequirementLine(requirementId, {
    initials: adoptedInitialsText,
    signedOn: "2026-09-10",
    trainerUserId: hmId,
    method: "shadowing",
    hoursTotal: 2,
    hoursWithHm: 1,
  });
  const payload = trainingLinePayload({
    topicId: line.topicId,
    topicTitle: line.topicTitle,
    resolvedStatus: "complete",
    trainerName: hmName,
    hoursTotal: 2,
    hoursWithHm: 1,
    signedOn: "2026-09-10",
    na: false,
    naReason: null,
    signoffVersion: version,
  });
  await api.applySignature({
    documentType: "training_checklist",
    documentId: trainingChecklistDocId(dspId, siteId),
    fieldName: trainingLineFieldName(requirementId, version),
    kind: "initials",
    documentPayload: payload,
  });
  return payload;
}

test("per-line initialing stamps the ADOPTED e-initials (never typed)", async () => {
  const fx = await fixture(2);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  // The modal derives this from the adopted signer's name — no text input.
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  assert.ok(adoptedInitialsText.length > 0);

  const [lineId] = fx.requirementIds;
  const signedPayload = await initialAndStamp(fx, lineId, adoptedInitialsText);

  const docId = trainingChecklistDocId(dspId, siteId);
  const events = await api.getSignatureEvents("training_checklist", docId);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "initials");
  assert.equal(events[0].fieldName, trainingLineFieldName(lineId, 1));
  assert.equal(events[0].signerName, dspSession.fullName);

  const after = await api.getStaffTrainingProfile(dspId);
  const view = after.requirements.find((row) => row.id === lineId)!;
  assert.equal(view.resolvedStatus, "complete");
  assert.equal(view.signoff?.initials, adoptedInitialsText);
  assert.equal(view.signoff?.signoffVersion, 1);

  // The tamper seal recomputes identically from the live line later.
  assert.deepEqual(trainingLinePayloadFromView(view), signedPayload);
  const recomputed = await signatureDocumentHash(
    "training_checklist",
    docId,
    events[0].fieldName,
    trainingLinePayloadFromView(view),
  );
  assert.equal(recomputed, events[0].documentHash);
});

test("per-line initials events do not lock sibling lines", async () => {
  const fx = await fixture(2);
  const { api } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);

  // Stamping line 1 must not freeze line 2 (the old any-event lock did).
  await initialAndStamp(fx, fx.requirementIds[0], adoptedInitialsText);
  await initialAndStamp(fx, fx.requirementIds[1], adoptedInitialsText);

  const events = await api.getSignatureEvents(
    "training_checklist",
    trainingChecklistDocId(fx.dspId, fx.siteId),
  );
  assert.equal(
    events.filter((event) => event.fieldName.startsWith("line:")).length,
    2,
  );
});

test("end signature blocked while any line is pending; N/A lines count as resolved", async () => {
  const fx = await fixture(3);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);

  await initialAndStamp(fx, fx.requirementIds[0], adoptedInitialsText);
  // Admin marks the second line N/A (paper rule: no blanks).
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.waiveRequirementLine(fx.requirementIds[1], "No vehicle used at this site.");

  // One line still pending -> staff signature rejected.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.signStaffChecklist({
        userId: dspId,
        siteId,
        role: "staff",
        signatureName: dspSession.fullName,
      }),
    /Initial or N\/A every training line/,
  );

  // N/A lines count as resolved: waiving the last line unlocks the signature.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.waiveRequirementLine(fx.requirementIds[2], "Covered in orientation packet.");
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: dspSession.fullName,
  });
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.ok(profile.countersignatures[0].staffSignedAt);
});

test("HM countersign requires the staff signature first (paper order)", async () => {
  const fx = await fixture(1);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  await initialAndStamp(fx, fx.requirementIds[0], adoptedInitialsText);

  // HM first -> rejected even though every line is resolved.
  const hmSession = await adopt(api, DEMO_HM_USERNAME);
  await assert.rejects(
    () =>
      api.signStaffChecklist({
        userId: dspId,
        siteId,
        role: "hm",
        signatureName: hmSession.fullName,
      }),
    /Staff must sign this sheet before the house manager/,
  );

  // Staff signs, then the HM countersign succeeds.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: dspSession.fullName,
  });
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "hm",
    signatureName: hmSession.fullName,
  });
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.ok(profile.countersignatures[0].hmSignedAt);
});

test("editing a line bumps the version and requires re-initialing; old stamp stays", async () => {
  const fx = await fixture(1);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  const [lineId] = fx.requirementIds;
  const docId = trainingChecklistDocId(dspId, siteId);

  await initialAndStamp(fx, lineId, adoptedInitialsText);

  // An administrator edits the line: void-and-redo bumps the version.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.adoptSignature({
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  });
  await api.initialRequirementLine(lineId, {
    initials: adoptedInitialsText,
    signedOn: "2026-09-10",
    trainerUserId: fx.hmId,
    method: "hands-on",
    hoursTotal: 3,
    hoursWithHm: 1,
  });
  const edited = await api.getStaffTrainingProfile(dspId);
  const editedView = edited.requirements.find((row) => row.id === lineId)!;
  assert.equal(editedView.signoff?.signoffVersion, 2);
  assert.equal(editedView.signoff?.hoursTotal, 3);

  const events = await api.getSignatureEvents("training_checklist", docId);
  const lineEvents = events.filter((event) => event.fieldName.startsWith("line:"));
  // The old v1 stamp stays as history...
  assert.equal(lineEvents.length, 1);
  assert.equal(lineEvents[0].fieldName, trainingLineFieldName(lineId, 1));
  // ...but the line needs re-initialing: latest stamp (v1) != signoff (v2).
  assert.equal(latestLineEvent(events, lineId)?.fieldName, trainingLineFieldName(lineId, 1));
  assert.ok(lineNeedsReinitial(editedView.signoff, events, lineId));

  // Re-initial stamps the new version under a fresh field name — no collision.
  // (The re-initial submit re-saves the line, so v2 -> v3 with a v3 stamp;
  // the v1 stamp stays as history.)
  // 13 CSR 65-3.050: only the assigned staff member may initial their own
  // line, so the DSP signs back in (their password re-entry is still fresh)
  // before re-initialling.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await initialAndStamp(fx, lineId, adoptedInitialsText);
  const restamped = await api.getSignatureEvents("training_checklist", docId);
  const restampedLineEvents = restamped.filter((event) =>
    event.fieldName.startsWith("line:"),
  );
  assert.equal(restampedLineEvents.length, 2);
  assert.equal(
    latestLineEvent(restamped, lineId)?.fieldName,
    trainingLineFieldName(lineId, 3),
  );
  const finalView = (await api.getStaffTrainingProfile(dspId)).requirements.find(
    (row) => row.id === lineId,
  )!;
  assert.equal(finalView.signoff?.signoffVersion, 3);
  assert.ok(!lineNeedsReinitial(finalView.signoff, restamped, lineId));
  // The new seal covers the edited content.
  const v2 = latestLineEvent(restamped, lineId)!;
  const recomputed = await signatureDocumentHash(
    "training_checklist",
    docId,
    v2.fieldName,
    trainingLinePayloadFromView(finalView),
  );
  assert.equal(recomputed, v2.documentHash);
});

test("a correction clears the end signatures but keeps per-line stamps", async () => {
  const fx = await fixture(1);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  const [lineId] = fx.requirementIds;
  const docId = trainingChecklistDocId(dspId, siteId);
  await initialAndStamp(fx, lineId, adoptedInitialsText);

  // Staff signs, then the HM countersigns.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: dspSession.fullName,
  });
  const hmSession = await adopt(api, DEMO_HM_USERNAME);
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "hm",
    signatureName: hmSession.fullName,
  });
  const countersignatureId = (
    await api.getStaffTrainingProfile(dspId)
  ).countersignatures[0].id;

  // A correction unlocks the sheet: the end signatures go away, the
  // per-line versioned stamps stay as history.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.requestTrainingCorrection({
    countersignatureId,
    reason: "Hours need re-checking.",
  });
  const events = await api.getSignatureEvents("training_checklist", docId);
  assert.ok(
    events.some(
      (event) => event.fieldName === trainingLineFieldName(lineId, 1),
    ),
    "the v1 line stamp survives the correction",
  );
  assert.ok(
    !events.some((event) => event.fieldName === "staff_sign"),
    "the staff end signature is cleared",
  );
  assert.ok(
    !events.some((event) => event.fieldName === "hm_countersign"),
    "the HM countersignature event is cleared",
  );

  // The sheet can be re-signed without re-initialing the line.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: dspSession.fullName,
  });
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.ok(profile.countersignatures[0].staffSignedAt);
});

test("versioned line field names do not collide and parse round-trips", () => {
  const id = "9f2c1a40-1111-4222-8333-444455556666";
  const v1 = trainingLineFieldName(id, 1);
  const v2 = trainingLineFieldName(id, 2);
  assert.notEqual(v1, v2);
  assert.deepEqual(parseTrainingLineField(v1), { requirementId: id, version: 1 });
  assert.deepEqual(parseTrainingLineField(v2), { requirementId: id, version: 2 });
  assert.equal(parseTrainingLineField("staff_sign"), null);
  assert.equal(parseTrainingLineField("hm_countersign"), null);
  assert.equal(parseTrainingLineField("row:3"), null);
});

test("applySignature rejects line fields with no matching sign-off", async () => {
  const fx = await fixture(2);
  const { api, dspId, siteId } = fx;
  await adopt(api, DEMO_DSP_USERNAME);
  const docId = trainingChecklistDocId(dspId, siteId);
  const payload = { topicId: "t", sealed: true };

  // Unknown requirement.
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: docId,
        fieldName: trainingLineFieldName("00000000-0000-0000-0000-000000000000", 1),
        kind: "initials",
        documentPayload: payload,
      }),
    /Unknown signature field/,
  );

  // Version with no matching sign-off (line was never initialed).
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: docId,
        fieldName: trainingLineFieldName(fx.requirementIds[0], 1),
        kind: "initials",
        documentPayload: payload,
      }),
    /no matching sign-off/,
  );

  // N/A lines are resolved without an initials stamp.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.waiveRequirementLine(fx.requirementIds[1], "Not applicable here.");
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: docId,
        fieldName: trainingLineFieldName(fx.requirementIds[1], 1),
        kind: "initials",
        documentPayload: payload,
      }),
    /no matching sign-off/,
  );
});

test("a whole-document end signature still freezes per-line edits", async () => {
  const fx = await fixture(1);
  const { api, dspId, siteId } = fx;
  const dspSession = await adopt(api, DEMO_DSP_USERNAME);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  const [lineId] = fx.requirementIds;
  await initialAndStamp(fx, lineId, adoptedInitialsText);

  // Staff end-signs via the e-signature field (the UI's TrainingSignField path).
  await api.applySignature({
    documentType: "training_checklist",
    documentId: trainingChecklistDocId(dspId, siteId),
    fieldName: "staff_sign",
    kind: "signature",
    documentPayload: { userId: dspId, siteId, lines: [] },
  });

  // Editing the line afterwards is locked.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    () =>
      api.initialRequirementLine(lineId, {
        initials: adoptedInitialsText,
        signedOn: "2026-09-10",
        trainerUserId: fx.hmId,
        hoursTotal: 2,
        hoursWithHm: 0,
      }),
    /locked/i,
  );
});
