/**
 * Delegation roster-signing parity: LocalApi (the reference implementation)
 * vs the hosted apply-signature edge function.
 *
 * The hosted incident (2026-10-31): an RN created a delegation, signed it,
 * and the assigned DSP's Sign click failed with "Unknown signature field."
 * while the form stayed at "RN signed · 0/1 staff signed". Cause: the edge
 * function's checkDelegationForm had NO branch for the bare "row:<n>"
 * signature field the UI emits (it fell through to the unknown-field
 * refusal), and applyDomainTransition had no branch to write the roster
 * row's signedAt/signatureName — the fields delegationFormStatus counts.
 *
 * Batch-29 escalation: the Activity log showed the DSP's signature "applied"
 * while the form still read Unsigned / 0 of 1. That record is the INITIALS
 * stamp — the one call that could succeed — which writes a signature_events
 * row and its Activity-log mirror but, by design, is not the row signature
 * and never moves the count. The dangerous direction must stay impossible:
 * a "signed" event may never exist without the roster write, which the
 * handler's transition-before-insert order guarantees (pinned below).
 *
 * There is no Deno runtime in this environment, so the edge function cannot
 * be executed here (the same limitation the migration static tests note).
 * These tests therefore pin the contract two ways:
 *  1. The full RN-creates → RN-signs → DSP-signs → DSP-initials → status
 *     1/1 flow executed against LocalApi, whose semantics the edge function
 *     must mirror.
 *  2. Static assertions over supabase/functions/apply-signature/index.ts
 *     (the delegationMigration.test.ts pattern) that the edge dispatch
 *     contains the bare-row check + transition with LocalApi's rules and
 *     messages, so a future edit cannot silently drop them again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";

/** Second Cedar DSP (seed username = dotted full name). She can access the
 * same Cedar Individual as the row's named DSP, so the own-row rule — not
 * the access rule — is what refuses her attempt on his row. */
const OTHER_DSP_USERNAME = "taylor.reed";
import {
  DEMO_PASSWORD,
  blankDelegationForm,
  delegationFormStatus,
} from "./types";
import {
  delegationRosterRowKey,
  suggestInitials,
  ADOPTED_SIGNATURE_MARK,
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

/** A LocalApi on the shared store, signed in + adopted + re-authenticated. */
async function signingApi(s: MemoryStore, username: string) {
  const api = new LocalApi(s);
  const session = await api.signIn(login(username));
  await api.adoptSignature(adoptInput());
  await api.verifySigningPassword(DEMO_PASSWORD);
  return { api, session };
}

// ===== The full RN → DSP handoff (LocalApi reference flow) =====

test("RN creates, RN signs, DSP signs their roster row, status reaches 1/1, DSP initials", async () => {
  const s = store();
  // The DSP's view decides which Individual the delegation is for, so the
  // row signer is guaranteed access to the record.
  const { api: dspApi, session: dsp } = await signingApi(s, DEMO_DSP_USERNAME);
  const person = (await dspApi.loadWorkspace(dsp)).individuals[0];

  // RN creates the delegation and names row 0 for the DSP.
  const { api: nurseApi, session: nurse } = await signingApi(
    s,
    DEMO_NURSE_USERNAME,
  );
  const { id } = await nurseApi.createDelegation({
    individualId: person.id,
    taskTitle: "Insulin administration",
    purpose: "Administer insulin per the care plan.",
    templateVersion: "lifepath_exact",
  });
  const rosterForm = blankDelegationForm();
  rosterForm.roster[0].printName = dsp.fullName;
  await nurseApi.updateDelegationForm({
    obligationId: id,
    patch: { roster: rosterForm.roster },
  });

  // Staff cannot sign before the RN (LocalApi: signDelegationRow RN-first).
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:0",
        kind: "signature",
        documentPayload: { obligationId: id },
      }),
    /delegating RN must sign before staff sign their rows/,
  );

  // Another staff member cannot sign the DSP's row — before or after the RN.
  const { api: otherApi } = await signingApi(s, OTHER_DSP_USERNAME);
  await assert.rejects(
    () =>
      otherApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:0",
        kind: "signature",
        documentPayload: { obligationId: id },
      }),
    /Only .* can sign this row/,
  );

  // RN signs first.
  await nurseApi.signIn(login(DEMO_NURSE_USERNAME));
  const nurseWs = await nurseApi.loadWorkspace(nurse);
  const item = nurseWs.planStacks
    .flatMap((st) => st.required)
    .find((v) => v.item.id === id)!.item;
  const payload = delegationFormPayload({
    obligationId: id,
    individualName: person.name,
    taskTitle: item.title ?? "",
    form: item.delegationForm!,
  });
  await nurseApi.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: payload,
  });

  // Still not the other DSP's row.
  await otherApi.signIn(login(OTHER_DSP_USERNAME));
  await assert.rejects(
    () =>
      otherApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:0",
        kind: "signature",
        documentPayload: payload,
      }),
    /Only .* can sign this row/,
  );

  // Malformed and out-of-range row fields are refused with the same
  // messages the edge function must produce.
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:abc",
        kind: "signature",
        documentPayload: { obligationId: id },
      }),
    /Unknown signature field/,
  );
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:99",
        kind: "signature",
        documentPayload: { obligationId: id },
      }),
    /Roster row not found/,
  );

  // The DSP signs their own row with the bare index field the UI emits.
  const signed = await dspApi.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "row:0",
    kind: "signature",
    documentPayload: payload,
  });
  assert.ok(signed.eventId);

  // The roster row carries exactly the legacy writes the status counts.
  const after = await dspApi.loadWorkspace(dsp);
  const liveItem = after.planStacks
    .flatMap((st) => st.required)
    .find((v) => v.item.id === id)!.item;
  const row = liveItem.delegationForm!.roster[0];
  assert.ok(row.signedAt, "row signedAt is written");
  assert.equal(row.signatureName, dsp.fullName);
  assert.equal(row.staffSignature, ADOPTED_SIGNATURE_MARK);
  assert.equal(row.initials, suggestInitials(dsp.fullName));
  const status = delegationFormStatus(liveItem.delegationForm!);
  assert.equal(status.rowsNamed, 1);
  assert.equal(status.rowsSigned, 1);
  assert.equal(status.fullySigned, true);

  // The DSP initials their row (keyed field); signing state is untouched.
  const rowKey = delegationRosterRowKey(dsp.fullName);
  const initialsResult = await dspApi.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: rowKey,
    kind: "initials",
    documentPayload: delegationRowInitialsPayload({
      obligationId: id,
      individualName: person.name,
      taskTitle: liveItem.title ?? "",
      form: liveItem.delegationForm!,
      rowKey,
    }),
  });
  assert.ok(initialsResult.eventId);

  // All three stamps are on the event record the seal verifies against.
  const events = await dspApi.getSignatureEvents("delegation_form", id);
  assert.deepEqual(
    events.map((e) => e.fieldName).sort(),
    ["rn_signature", "row:0", rowKey].sort(),
  );

  // A second row signature is refused.
  await assert.rejects(
    () =>
      dspApi.applySignature({
        documentType: "delegation_form",
        documentId: id,
        fieldName: "row:0",
        kind: "signature",
        documentPayload: payload,
      }),
    /already been signed/,
  );
});

test("an initials stamp alone does not move the signed count (batch-29 shape)", async () => {
  const s = store();
  const { api: dspApi, session: dsp } = await signingApi(s, DEMO_DSP_USERNAME);
  const person = (await dspApi.loadWorkspace(dsp)).individuals[0];
  const { api: nurseApi, session: nurse } = await signingApi(
    s,
    DEMO_NURSE_USERNAME,
  );
  const { id } = await nurseApi.createDelegation({
    individualId: person.id,
    taskTitle: "Wound care",
    purpose: "Dressing changes per protocol.",
    templateVersion: "lifepath_exact",
  });
  const rosterForm = blankDelegationForm();
  rosterForm.roster[0].printName = dsp.fullName;
  await nurseApi.updateDelegationForm({
    obligationId: id,
    patch: { roster: rosterForm.roster },
  });
  const nurseWs = await nurseApi.loadWorkspace(nurse);
  const item = nurseWs.planStacks
    .flatMap((st) => st.required)
    .find((v) => v.item.id === id)!.item;
  await nurseApi.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: "rn_signature",
    kind: "signature",
    documentPayload: delegationFormPayload({
      obligationId: id,
      individualName: person.name,
      taskTitle: item.title ?? "",
      form: item.delegationForm!,
    }),
  });

  // The DSP initials ONLY — the one hosted call that could succeed.
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  const rowKey = delegationRosterRowKey(dsp.fullName);
  await dspApi.applySignature({
    documentType: "delegation_form",
    documentId: id,
    fieldName: rowKey,
    kind: "initials",
    documentPayload: delegationRowInitialsPayload({
      obligationId: id,
      individualName: person.name,
      taskTitle: item.title ?? "",
      form: item.delegationForm!,
      rowKey,
    }),
  });

  // The event exists — this is the record the Activity log mirrors…
  const events = await dspApi.getSignatureEvents("delegation_form", id);
  assert.ok(
    events.some((e) => e.fieldName === rowKey && e.kind === "initials"),
  );
  // …but an initials stamp is not the row signature: the count stays 0.
  const live = (await dspApi.loadWorkspace(dsp)).planStacks
    .flatMap((st) => st.required)
    .find((v) => v.item.id === id)!.item;
  assert.equal(live.delegationForm!.roster[0].signedAt, null);
  const status = delegationFormStatus(live.delegationForm!);
  assert.equal(status.rowsNamed, 1);
  assert.equal(status.rowsSigned, 0);
  assert.equal(status.fullySigned, false);
});

// ===== Edge function contract (static, no Deno runtime here) =====

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const edge = readFileSync(
  join(root, "supabase", "functions", "apply-signature", "index.ts"),
  "utf8",
);

function section(startMarker: string, endMarker: string): string {
  const start = edge.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} exists`);
  const end = edge.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} follows ${startMarker}`);
  return edge.slice(start, end);
}

test("edge: bare row parse mirrors LocalApi's Number() semantics", () => {
  assert.ok(edge.includes("function rowIndexOf(fieldName: string)"));
  assert.ok(edge.includes("Number(fieldName.slice(4))"));
  assert.ok(edge.includes('fieldName.startsWith("row:")'));
});

test("edge: checkDelegationForm accepts the bare row signature field", () => {
  const check = section(
    "async function checkDelegationForm",
    "async function checkHmChecklist",
  );
  // The bare-row branch exists (this was the hosted bug: it fell through).
  assert.ok(check.includes("rowIndexOf(fieldName)"));
  // Own-row identity rule, with the LocalApi message and a 403.
  assert.ok(check.includes("Only ${printName} can sign this row."));
  assert.ok(check.includes('"not_line_owner"'));
  // Signing order and state rules, with LocalApi's messages.
  assert.ok(check.includes("The delegating RN must sign first."));
  assert.ok(check.includes('"rn_first"'));
  assert.ok(check.includes("This delegation is turned off."));
  assert.ok(check.includes("Name the staff member on that row first."));
  assert.ok(check.includes("That row is already signed."));
  assert.ok(check.includes('"already_signed"'));
  // Kind discipline mirrors the initials branch's inverse message.
  assert.ok(check.includes("Roster rows are signed, not initialed."));
  // The unknown-field fallthrough is retained for everything else.
  assert.ok(check.includes('return fail("Unknown signature field.", 400);'));
});

test("edge: initials branch keeps LocalApi's rule order and messages", () => {
  const check = section(
    "async function checkDelegationForm",
    "async function checkHmChecklist",
  );
  assert.ok(check.includes("Only ${printName} can initial this row."));
  // Turned-off guard (LocalApi initialDelegationRow) is enforced hosted too.
  const initialsAt = check.indexOf("Roster rows are initialed, not signed.");
  const offAt = check.indexOf("This delegation is turned off.");
  assert.ok(initialsAt >= 0 && offAt > initialsAt);
});

test("edge: RN branch refuses a turned-off delegation", () => {
  const check = section(
    "async function checkDelegationForm",
    "async function checkHmChecklist",
  );
  assert.ok(check.includes("Turn the delegation on before the RN signs."));
});

test("edge: domain transition writes the roster row the status counts", () => {
  const transition = section(
    "async function applyDomainTransition",
    "async function checkDomainRules",
  );
  assert.ok(transition.includes("rowIndexOf(fieldName)"));
  assert.ok(transition.includes("row.signatureName = fullName;"));
  assert.ok(transition.includes("row.staffSignature = adopted.signature_path;"));
  assert.ok(transition.includes("row.initials = suggestInitials(fullName);"));
  assert.ok(transition.includes("row.signedAt = now;"));
});

test("edge: the domain transition lands before any signature event is written", () => {
  // Atomicity in effect (batch 29): the handler must run the domain
  // transition — the roster write — BEFORE inserting the signature_events
  // row whose Activity-log mirror announces the signing. A failed
  // transition aborts the stamp, so a logged signature can never exist
  // without the document reflecting it.
  const transitionAt = edge.indexOf("await applyDomainTransition()");
  const insertAt = edge.indexOf('.from("signature_events")\n    .insert({');
  assert.ok(transitionAt >= 0, "handler awaits the domain transition");
  assert.ok(insertAt > transitionAt, "event insert follows the transition");
  assert.ok(
    edge.includes(
      "signature_events row is never written without its domain transition",
    ),
  );
});

test("edge: legacy initials derive like the client's suggestInitials", () => {
  // The old hosted derivation used first + LAST word (and one letter for a
  // single-word name); LocalApi/client use first + SECOND word (two
  // letters). The divergent helper must not come back.
  assert.ok(!edge.includes("textInitials"));
  assert.ok(edge.includes("function suggestInitials(fullName: string)"));
  assert.ok(edge.includes("parts[0].slice(0, 2).toUpperCase()"));
  assert.ok(edge.includes("(parts[0][0] + parts[1][0]).toUpperCase()"));
});
