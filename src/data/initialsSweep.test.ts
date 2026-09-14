import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD, blankDelegationForm } from "./types";
import {
  canonicalJson,
  sha256Hex,
  signatureDocumentHash,
  suggestInitials,
  delegationRosterRowKey,
  ESIGN_CONSENT_VERSION,
} from "../features/signatures/signatureUtils";
import {
  delegationFormPayload,
  delegationRowInitialsPayload,
} from "../features/signatures/documentPayloads";

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

async function adoptedApi(username: string) {
  const api = new LocalApi(store());
  await api.signIn(login(username));
  await api.adoptSignature(adoptInput());
  // 13 CSR 65-3.050: signing requires a fresh password re-entry on top of
  // the session, so the harness re-authenticates before signing.
  await api.verifySigningPassword(DEMO_PASSWORD);
  return api;
}

/** Delegation with row 0 named for the given user; RN signature applied. */
async function rnSignedDelegation(api: LocalApi, username: string) {
  const session = await api.signIn(login(username));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  const ws = await api.loadWorkspace(session);
  const person = ws.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    purpose: "Keep inhaler use safe.",
    templateVersion: "lifepath_exact",
  });
  // Name row 0 before anyone signs (roster edits lock after signing).
  const form = blankDelegationForm();
  form.roster[0].printName = session.fullName;
  await api.updateDelegationForm({ obligationId: id, patch: { roster: form.roster } });
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
  await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });
  return { session, person, id, item, payload };
}

function initialsPayload(parts: {
  id: string;
  personName: string;
  title: string;
  form: ReturnType<typeof blankDelegationForm>;
  rowKey: string;
}) {
  return delegationRowInitialsPayload({
    obligationId: parts.id,
    individualName: parts.personName,
    taskTitle: parts.title,
    form: parts.form,
    rowKey: parts.rowKey,
  });
}

// ===== Row key contract =====

test("delegationRosterRowKey is stable and name-derived, never an array index", () => {
  assert.equal(delegationRosterRowKey("Mary Jane"), "row:mary-jane:initials");
  assert.equal(
    delegationRosterRowKey("Mary Jane"),
    delegationRosterRowKey("Mary Jane"),
  );
  assert.equal(
    delegationRosterRowKey("  MARY  JANE "),
    "row:mary-jane:initials",
  );
  assert.notEqual(
    delegationRosterRowKey("Mary Jane"),
    delegationRosterRowKey("John Doe"),
  );
  assert.equal(delegationRosterRowKey(""), "row:unnamed:initials");
  assert.equal(delegationRosterRowKey("   "), "row:unnamed:initials");
  // Names with punctuation collapse to the same slug — degenerate, documented.
  assert.equal(delegationRosterRowKey("Mary-Jane"), "row:mary-jane:initials");
});

test("delegationRowInitialsPayload binds the row key to the whole-form snapshot", async () => {
  const form = blankDelegationForm();
  const rowKey = delegationRosterRowKey("Mary Jane");
  const payload = delegationRowInitialsPayload({
    obligationId: "d1",
    individualName: "Sylvester Drummer",
    taskTitle: "PRN Inhaler",
    form,
    rowKey,
  }) as Record<string, unknown>;
  assert.equal(payload.rowKey, rowKey);
  assert.equal(payload.obligationId, "d1");
  // No signature fields, signer names, or volatile timestamps in the snapshot.
  const roster = (payload.roster ?? []) as Array<Record<string, unknown>>;
  for (const row of roster) {
    assert.ok(!("staffSignature" in row), "staffSignature must be excluded");
    assert.ok(!("signatureName" in row), "signatureName must be excluded");
    assert.ok(!("signedAt" in row), "signedAt must be excluded");
    assert.ok(!("initials" in row), "initials must be excluded");
  }
  // Deterministic: same input -> same hash; the row key participates in it.
  const again = delegationRowInitialsPayload({
    obligationId: "d1",
    individualName: "Sylvester Drummer",
    taskTitle: "PRN Inhaler",
    form,
    rowKey,
  });
  assert.equal(
    await signatureDocumentHash("delegation_form", "d1", rowKey, payload),
    await signatureDocumentHash("delegation_form", "d1", rowKey, again),
  );
  const otherRow = delegationRowInitialsPayload({
    obligationId: "d1",
    individualName: "Sylvester Drummer",
    taskTitle: "PRN Inhaler",
    form,
    rowKey: delegationRosterRowKey("John Doe"),
  });
  assert.notEqual(
    await sha256Hex(canonicalJson(payload)),
    await sha256Hex(canonicalJson(otherRow)),
  );
});

// ===== Roster row initials via applySignature =====

test("roster initials require adoption first", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(login(DEMO_NURSE_USERNAME));
  const person = (await api.loadWorkspace(nurse)).individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
    templateVersion: "lifepath_exact",
  });
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: delegationRosterRowKey(nurse.fullName),
        kind: "initials",
        documentPayload: { obligationId: id },
      }),
    /Adopt your electronic signature/,
  );
});

test("roster initials are rejected before the RN signs", async () => {
  const api = await adoptedApi(DEMO_NURSE_USERNAME);
  const session = (await api.getSession())!;
  const ws = await api.loadWorkspace(session);
  const person = ws.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
    templateVersion: "lifepath_exact",
  });
  const form = blankDelegationForm();
  form.roster[0].printName = session.fullName;
  await api.updateDelegationForm({
    obligationId: id,
    patch: { roster: form.roster },
  });
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: delegationRosterRowKey(session.fullName),
        kind: "initials",
        documentPayload: { obligationId: id },
      }),
    /delegating RN must sign before staff initial/,
  );
});

test("a staff member initials their own roster row with adopted initials", async () => {
  const api = new LocalApi(store());
  const { session, person, id, item } = await rnSignedDelegation(
    api,
    DEMO_NURSE_USERNAME,
  );
  const rowKey = delegationRosterRowKey(session.fullName);
  const payload = initialsPayload({
    id,
    personName: person.name,
    title: item.title ?? "",
    form: item.delegationForm!,
    rowKey,
  });
  const result = await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: rowKey,
    kind: "initials",
    documentPayload: payload,
  });
  assert.ok(result.eventId);
  assert.equal(result.documentHash, await sha256Hex(canonicalJson(payload)));
  const events = await api.getSignatureEvents("delegation_form", id);
  const initialed = events.find((e) => e.fieldName === rowKey)!;
  assert.ok(initialed);
  assert.equal(initialed.kind, "initials");
  assert.equal(initialed.signerName, session.fullName);
  assert.equal(initialed.documentHash, result.documentHash);
  // The legacy initials column stays in sync with the adopted initials…
  const refreshed = await api.loadWorkspace(session);
  const live = refreshed.planStacks
    .flatMap((s) => s.required)
    .find((v) => v.item.id === id)!.item;
  assert.equal(
    live.delegationForm!.roster[0].initials,
    suggestInitials(session.fullName),
  );
  // …but initialing is not the row signature: the row stays unsigned.
  assert.equal(live.delegationForm!.roster[0].signedAt, null);
});

test("a second initials stamp on the same row is rejected", async () => {
  const api = new LocalApi(store());
  const { session, person, id, item } = await rnSignedDelegation(
    api,
    DEMO_NURSE_USERNAME,
  );
  const rowKey = delegationRosterRowKey(session.fullName);
  const payload = initialsPayload({
    id,
    personName: person.name,
    title: item.title ?? "",
    form: item.delegationForm!,
    rowKey,
  });
  await api.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: rowKey,
    kind: "initials",
    documentPayload: payload,
  });
  await assert.rejects(
    () =>
      api.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: rowKey,
        kind: "initials",
        documentPayload: payload,
      }),
    /already been signed/,
  );
});

test("a roster row can only be initialed by the staff member named on it", async () => {
  const api = new LocalApi(store());
  const { session, id } = await rnSignedDelegation(api, DEMO_NURSE_USERNAME);
  const rowKey = delegationRosterRowKey(session.fullName);
  // Another staff member adopts but cannot initial someone else's row.
  const dspApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await dspApi.adoptSignature(adoptInput());
  await dspApi.verifySigningPassword(DEMO_PASSWORD);
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: rowKey,
        kind: "initials",
        documentPayload: { obligationId: id, rowKey },
      }),
    /Only .* can initial this row/,
  );
  // An unknown row slug is rejected.
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:nobody-here:initials",
        kind: "initials",
        documentPayload: { obligationId: id },
      }),
    /Roster row not found/,
  );
});
