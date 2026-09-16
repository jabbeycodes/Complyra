import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  applyRenewalUpload,
  canSeeRenewals,
  formatAllergiesLabel,
  normalizeAllergies,
  requiredForSigning,
  staffCanSignDelegation,
  type ObligationItem,
} from "./planStack";

const rnBlank = {
  delegatingRnUserId: null,
  rnSignedAt: null,
  rnSignatureName: null,
  rnSignatureMark: null,
  discontinuedAt: null,
  discontinueFileId: null,
  discontinueTitle: null,
} as const;

function item(partial: Partial<ObligationItem> & Pick<ObligationItem, "id" | "kind" | "mode" | "title">): ObligationItem {
  return {
    agencyId: "a",
    individualId: "i",
    detail: "",
    sourcePage: 1,
    documentVersionId: "v",
    enabled: true,
    frequency: "",
    shiftPeriods: [],
    expiresOn: null,
    createdFrom: "extraction",
    inventoryState: "present",
    proposed: false,
    ...rnBlank,
    ...partial,
  };
}

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

test("assigned staff see required docs as a list with the PCSP first", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(dsp);
  const stack = workspace.planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  );
  assert.ok(stack);
  assert.equal(stack.required[0].item.kind, "pcsp");
  assert.equal(
    stack.required.some((view) => view.item.kind === "protocol"),
    true,
  );
  assert.equal(
    stack.checked.some((view) => view.item.title.includes("HRST")),
    true,
  );
  const offDelegation = stack.required.find((view) => view.item.kind === "delegation");
  assert.equal(offDelegation?.item.enabled, false);
});

test("staff sign each required document then submit the packet", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(dsp);
  const stack = workspace.planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  await assert.rejects(() => client.submitPlanPacket(stack.individualId), /Sign every/);
  for (const view of stack.required.filter((item) => item.item.enabled)) {
    const row = view.mySignature;
    assert.ok(row);
    await client.markObligationOpened(row.id);
    await client.signObligation(row.id, dsp.fullName, "data:image/png;base64,aaa");
  }
  const training = stack.myTraining;
  assert.ok(training);
  await assert.rejects(
    () => client.signTrainingChecklist(training.checklist.id, "staff", dsp.fullName),
    /Check off every/,
  );
  for (const line of training.checklist.items) {
    await client.initialTrainingLine(training.checklist.id, line.id);
  }
  await client.signTrainingChecklist(training.checklist.id, "staff", dsp.fullName);
  await client.submitPlanPacket(stack.individualId);
  const after = (await client.loadWorkspace(dsp)).planStacks.find(
    (item) => item.individualId === stack.individualId,
  )!;
  assert.ok(after.mySubmissionAt);
  assert.equal(after.canSubmit, false);
});

test("a new assigned staff member must sign the current unexpired PCSP", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(admin);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  const outsider = workspace.staff.find((s) => s.site !== ellis.site)!;
  await client.assignStaff(ellis.id, outsider.id);
  const stack = (await client.loadWorkspace(admin)).planStacks.find(
    (item) => item.individualId === ellis.id,
  )!;
  const pcsp = stack.required.find((view) => view.item.kind === "pcsp")!;
  assert.equal(pcsp.assignedCount >= 2, true);
});

test("adding a protocol does not clear existing PCSP signatures", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(admin);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  const before = workspace.planStacks
    .find((item) => item.individualId === ellis.id)!
    .required.find((view) => view.item.kind === "pcsp")!;
  const signedBefore = before.signedCount;
  await client.addProtocol(ellis.id, "Aspiration protocol");
  const after = (await client.loadWorkspace(admin)).planStacks.find(
    (item) => item.individualId === ellis.id,
  )!;
  assert.equal(
    after.required.find((view) => view.item.kind === "pcsp")?.signedCount,
    signedBefore,
  );
  assert.equal(
    after.required.some((view) => view.item.title === "Aspiration protocol"),
    true,
  );
});

test("DPM can edit cover fields and a DSP cannot", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const ellis = (await client.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await client.updateIndividualProfile(ellis.id, {
    ...ellis.profile!,
    goesBy: "Jo",
    dmhId: "999",
  });
  const dspClient = api();
  const dsp = await dspClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspEllis = (await dspClient.loadWorkspace(dsp)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await assert.rejects(
    () =>
      dspClient.updateIndividualProfile(dspEllis.id, {
        ...dspEllis.profile!,
        goesBy: "Nope",
      }),
    /cover-page/,
  );
});

test("requiredForSigning skips off, expired, and inventory items", () => {
  const today = "2026-09-12";
  const items = requiredForSigning(
    [
      item({
        id: "1",
        kind: "pcsp",
        mode: "required",
        title: "PCSP",
        expiresOn: "2027-01-01",
      }),
      item({
        id: "2",
        kind: "inventory",
        mode: "checked",
        title: "HRST",
      }),
      item({
        id: "3",
        kind: "pcsp",
        mode: "required",
        title: "Old PCSP",
        documentVersionId: "v0",
        expiresOn: "2025-01-01",
      }),
    ],
    today,
  );
  assert.deepEqual(
    items.map((row) => row.title),
    ["PCSP"],
  );
});

test("RN, DPM, and HM see renewals; DSP does not", () => {
  assert.equal(canSeeRenewals("nurse"), true);
  assert.equal(canSeeRenewals("degreed_professional_manager"), true);
  assert.equal(canSeeRenewals("house_manager"), true);
  assert.equal(canSeeRenewals("dsp"), false);
});

test("staff cannot sign a delegation until the RN has signed", () => {
  const waiting = item({
    id: "d",
    kind: "delegation",
    mode: "required",
    title: "Delegation",
    enabled: true,
  });
  assert.equal(staffCanSignDelegation(waiting), false);
  assert.equal(
    staffCanSignDelegation({ ...waiting, rnSignedAt: "2026-09-12T12:00:00.000Z" }),
    true,
  );
});

test("uploading evidence resets the next due date by the interval", () => {
  const next = applyRenewalUpload(
    {
      id: "r",
      agencyId: "a",
      individualId: "i",
      kind: "annual_physical",
      title: "Annual physical",
      intervalMonths: 12,
      lastUploadedOn: "2025-09-01",
      nextDueOn: "2026-09-01",
      lastDocumentTitle: null,
      lastEvidenceKind: null,
      fileId: null,
    },
    {
      uploadedOn: "2026-09-12",
      documentTitle: "Dr. Patel consult",
      evidenceKind: "consultation",
    },
  );
  assert.equal(next.nextDueOn, "2027-09-12");
  assert.equal(next.lastDocumentTitle, "Dr. Patel consult");
  assert.equal(next.lastEvidenceKind, "consultation");
});

test("DSP does not see clinical renewal dates", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(dsp)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  assert.equal(stack.renewals.length, 0);
  const nurseClient = api();
  const nurse = await nurseClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  const renewal = (await nurseClient.loadWorkspace(nurse)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!.renewals[0];
  await assert.rejects(
    () =>
      client.uploadRenewalEvidence({
        renewalId: renewal.id,
        evidenceKind: "pdf",
        documentTitle: "Should fail",
      }),
    /House Manager/,
  );
});

test("nurse, DPM/admin, and HM see physical, vision, and dental dates", async () => {
  for (const username of [DEMO_NURSE_USERNAME, DEMO_ADMIN_USERNAME, DEMO_HM_USERNAME]) {
    const client = api();
    const user = await client.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username,
      password: DEMO_PASSWORD,
    });
    const stack = (await client.loadWorkspace(user)).planStacks[0];
    const kinds = stack.renewals.map((row) => row.kind);
    assert.equal(kinds.includes("annual_physical"), true);
    assert.equal(kinds.includes("vision"), true);
    assert.equal(kinds.includes("dental"), true);
  }
});

test("uploading a consult resets only that renewal date", async () => {
  const client = api();
  const nurse = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(nurse)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  const vision = stack.renewals.find((row) => row.kind === "vision")!;
  const dentalBefore = stack.renewals.find((row) => row.kind === "dental")!.nextDueOn;
  await client.uploadRenewalEvidence({
    renewalId: vision.id,
    evidenceKind: "doctor_notes",
    documentTitle: "Optometry notes",
    uploadedOn: "2026-09-12",
  });
  const after = (await client.loadWorkspace(nurse)).planStacks.find(
    (item) => item.individualId === stack.individualId,
  )!;
  assert.equal(after.renewals.find((row) => row.kind === "vision")?.nextDueOn, "2027-09-12");
  assert.equal(after.renewals.find((row) => row.kind === "dental")?.nextDueOn, dentalBefore);
});

test("delegating RN must sign before staff, even if DPM turned the form on", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const mark = "data:image/png;base64,aaa";

  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const ellis = (await client.loadWorkspace(admin)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  const delegation = ellis.required.find((view) => view.item.kind === "delegation")!;
  await client.updateObligation(delegation.item.id, { enabled: true });
  await assert.rejects(
    () => client.signDelegationRn(delegation.item.id, admin.fullName, mark),
    /delegating RN/,
  );
  await client.signOut();

  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspStack = (await client.loadWorkspace(dsp)).planStacks.find(
    (item) => item.individualId === ellis.individualId,
  )!;
  const dspRow = dspStack.required.find((view) => view.item.kind === "delegation")!.mySignature!;
  await client.markObligationOpened(dspRow.id);
  await assert.rejects(
    () => client.signObligation(dspRow.id, dsp.fullName, mark),
    /delegating RN/,
  );
  await client.signOut();

  const nurse = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  await client.signDelegationRn(delegation.item.id, nurse.fullName, mark);
  await client.signOut();

  await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await client.signObligation(dspRow.id, dsp.fullName, mark);
  const signed = (await client.loadWorkspace(dsp)).planStacks
    .find((item) => item.individualId === ellis.individualId)!
    .required.find((view) => view.item.kind === "delegation")!;
  assert.ok(signed.mySignature?.signedAt);
  assert.ok(signed.item.rnSignedAt);
});

test("allergies normalize and format for the consultation packet", () => {
  assert.deepEqual(
    normalizeAllergies([
      { allergen: "  Tree nuts ", reaction: " hives ", status: "active" },
      { allergen: " ", reaction: "x", status: "resolved" },
    ]),
    [{ allergen: "Tree nuts", reaction: "hives", status: "active" }],
  );
  assert.equal(
    formatAllergiesLabel([{ allergen: "Tree nuts", reaction: "Noted on diet order", status: "active" }]),
    "Tree nuts (active) — Noted on diet order",
  );
});
