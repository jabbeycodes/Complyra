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
  ESIGN_CONSENT_TEXT,
  ESIGN_CONSENT_VERSION,
  EdgeFunctionError,
  REAUTH_WINDOW_MS,
  ReauthRequiredError,
} from "../features/signatures/signatureUtils";
import {
  trainingChecklistDocId,
  trainingCountersignPayload,
  trainingLineFieldName,
  trainingLinePayload,
} from "../features/signatures/documentPayloads";
import { suggestInitials } from "../features/signatures/signatureUtils";
import { siteChecklistTopics } from "../features/training/topics";
import { edgeErrorFromBody } from "./hostedApi";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

/** 1x1 transparent PNG — valid, tiny, passes adoption validation. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function adoptInput() {
  return {
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  };
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
  return {
    api,
    dspId: dsp.id,
    hmId: hm.id,
    hmName: hm.name,
    siteId,
    requirementIds: created.map((row) => row.id),
  };
}

/** Adopt + password re-entry for a user on a fresh api (the signing ceremony). */
async function ceremonyApi(username: string) {
  const api = new LocalApi(store());
  await api.signIn(login(username));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  return api;
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

// ===== 13 CSR 65-3.050 second identification component =====

test("signing without a fresh password re-entry is rejected (reauth_required)", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  // No verifySigningPassword: the second ID component is missing.
  const err = await api
    .applySignature({
      documentType: "hm_checklist",
      documentId: "checklist:abc",
      fieldName: "hm_signature",
      kind: "signature",
      documentPayload: { sealed: true },
    })
    .then(
      () => null,
      (e: unknown) => e,
    );
  assert.ok(err instanceof ReauthRequiredError, "expected ReauthRequiredError");
  assert.equal(err.code, "reauth_required");
});

test("a stale password re-entry is rejected after the signing window", async () => {
  const api = await ceremonyApi(DEMO_DSP_USERNAME);
  const session = (await api.getSession())!;
  const mem = (api as unknown as { store: MemoryStore }).store;
  mem.signingReauthAt.set(
    session.userId,
    new Date(Date.now() - REAUTH_WINDOW_MS - 60_000).toISOString(),
  );
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "hm_checklist",
        documentId: "checklist:abc",
        fieldName: "hm_signature",
        kind: "signature",
        documentPayload: { sealed: true },
      }),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
});

test("verifySigningPassword rejects a wrong password and logs the failure", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  await assert.rejects(
    () => api.verifySigningPassword("not-the-password"),
    /not correct/,
  );
  const rows = await api.getSignatureAuditLog();
  assert.ok(
    rows.some((row) => row.action === "reauth_failed"),
    "failed attempt is in the audit trail",
  );
  // And the failed attempt does NOT unlock signing.
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "hm_checklist",
        documentId: "checklist:abc",
        fieldName: "hm_signature",
        kind: "signature",
        documentPayload: { sealed: true },
      }),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
});

test("signing out clears the password re-entry", async () => {
  const api = await ceremonyApi(DEMO_DSP_USERNAME);
  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "hm_checklist",
        documentId: "checklist:abc",
        fieldName: "hm_signature",
        kind: "signature",
        documentPayload: { sealed: true },
      }),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
});

// ===== Versioned per-line initials =====

test("a stale line version is rejected; the current version stamps", async () => {
  const fx = await fixture(1);
  const { api, dspId, hmId } = fx;
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  const [lineId] = fx.requirementIds;
  const docId = trainingChecklistDocId(dspId, fx.siteId);

  // Save twice (v1, then v2) without stamping either.
  const lineInput = {
    initials: adoptedInitialsText,
    signedOn: "2026-09-10",
    trainerUserId: hmId,
    method: "shadowing" as const,
    hoursTotal: 2,
    hoursWithHm: 1,
  };
  await api.initialRequirementLine(lineId, lineInput);
  await api.initialRequirementLine(lineId, lineInput);

  // The v1 field name is stale: the line moved on to v2.
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: docId,
        fieldName: trainingLineFieldName(lineId, 1),
        kind: "initials",
        documentPayload: { sealed: true },
      }),
    /stale version/,
  );
  // The current version stamps cleanly.
  const profile = await api.getStaffTrainingProfile(dspId);
  const line = profile.requirements.find((row) => row.id === lineId)!;
  assert.equal(line.signoff?.signoffVersion, 2);
  const result = await api.applySignature({
    documentType: "training_checklist",
    documentId: docId,
    fieldName: trainingLineFieldName(lineId, 2),
    kind: "initials",
    documentPayload: { sealed: true },
  });
  assert.ok(result.eventId);
});

// ===== Signing order + attribution =====

test("HM countersignature before the staff signature is rejected", async () => {
  const fx = await fixture(1);
  const { api, dspId, siteId } = fx;
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  await initialAndStamp(fx, fx.requirementIds[0], suggestInitials(dspSession.fullName));

  const profile = await api.getStaffTrainingProfile(dspId);
  const payload = trainingCountersignPayload({
    userId: dspId,
    siteId,
    lines: profile.requirements.map((r) => ({
      topicId: r.topicId,
      topicTitle: r.topicTitle,
      resolvedStatus: r.status,
    })),
  });
  const docId = trainingChecklistDocId(dspId, siteId);

  // The HM adopts and re-authenticates, but staff has not signed yet.
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: docId,
        fieldName: "hm_countersign",
        kind: "signature",
        documentPayload: payload,
      }),
    /Staff must sign this sheet before the house manager/,
  );
});

test("another user cannot initial someone else's training line", async () => {
  const fx = await fixture(2);
  const { api, dspId, siteId, hmId } = fx;
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  const adoptedInitialsText = suggestInitials(dspSession.fullName);
  // The DSP saves the second line but has not stamped it yet.
  const [lineId] = fx.requirementIds.slice(1);
  await api.initialRequirementLine(lineId, {
    initials: adoptedInitialsText,
    signedOn: "2026-09-10",
    trainerUserId: hmId,
    method: "shadowing",
    hoursTotal: 2,
    hoursWithHm: 1,
  });

  // The HM is fully set up to sign, but the line belongs to the DSP.
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "training_checklist",
        documentId: trainingChecklistDocId(dspId, siteId),
        fieldName: trainingLineFieldName(lineId, 1),
        kind: "initials",
        documentPayload: { sealed: true },
      }),
    /Only the assigned staff member can initial their own training lines/,
  );
});

// ===== 13 CSR 65-3.050 audit trail =====

test("a sign_applied audit row is recorded on sign", async () => {
  const fx = await fixture(1);
  const { api } = fx;
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  await initialAndStamp(fx, fx.requirementIds[0], suggestInitials(dspSession.fullName));
  const rows = await api.getSignatureAuditLog();
  const signRow = rows.find((row) => row.action === "sign_applied");
  assert.ok(signRow, "sign_applied row exists");
  assert.ok(signRow!.deviceId, "device id recorded");
  assert.ok(
    signRow!.fieldName?.startsWith("line:"),
    "field name recorded on the audit row",
  );
});

test("login and logout write audit rows", async () => {
  const api = new LocalApi(store());
  await api.signIn(login(DEMO_DSP_USERNAME));
  let rows = await api.getSignatureAuditLog();
  assert.ok(rows.some((row) => row.action === "login"), "login row exists");
  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  rows = await api.getSignatureAuditLog();
  assert.ok(rows.some((row) => row.action === "logout"), "logout row exists");
});

test("document_viewed is recorded through logSignatureAudit", async () => {
  const api = await ceremonyApi(DEMO_DSP_USERNAME);
  await api.logSignatureAudit({
    action: "document_viewed",
    documentType: "delegation_form",
    documentId: "delegation:abc",
  });
  const rows = await api.getSignatureAuditLog({
    documentType: "delegation_form",
    documentId: "delegation:abc",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "document_viewed");
});

// ===== Consent v2 =====

test("consent v2 documents the password ceremony and typed-style adoption", () => {
  assert.equal(ESIGN_CONSENT_VERSION, "2026-09-13-v2");
  assert.match(ESIGN_CONSENT_TEXT, /re-enter(?:ing)? my password/i);
  assert.match(ESIGN_CONSENT_TEXT, /adopted electronic symbol/i);
  assert.match(ESIGN_CONSENT_TEXT, /same legal effect/i);
});

// ===== Hosted error contract =====

test("edgeErrorFromBody maps reauth_required to the password-sheet error", () => {
  const reauth = edgeErrorFromBody(
    { error: "Confirm it’s you: re-enter your password to sign.", code: "reauth_required" },
    undefined,
  );
  assert.ok(reauth instanceof ReauthRequiredError);
  assert.equal((reauth as ReauthRequiredError).code, "reauth_required");

  const other = edgeErrorFromBody(
    { error: "Only house managers can sign this checklist.", code: "not_hm" },
    undefined,
  );
  assert.ok(other instanceof EdgeFunctionError);
  assert.equal((other as EdgeFunctionError).code, "not_hm");
  assert.match(other.message, /house managers/);
});
