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
  applyDailyMedDrop,
  countdownLabel,
  medIsLow,
  toMedicationView,
  trainingLinesFromObligations,
} from "./chart";
import { applyRenewalUpload, defaultRenewals } from "./planStack";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

function orderFile() {
  return new File(["physician discontinue order"], "discontinue-order.pdf", {
    type: "application/pdf",
  });
}

test("scheduled meds drop by pills per day; PRN does not", () => {
  const scheduled = applyDailyMedDrop(
    {
      id: "1",
      agencyId: "a",
      individualId: "i",
      name: "Keppra",
      strength: "500 mg",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 2,
      remainingPills: 20,
      lastDeliveryOn: "2026-09-10",
      lastCountdownOn: "2026-09-10",
    },
    "2026-09-12",
  );
  assert.equal(scheduled.remainingPills, 16);
  assert.equal(scheduled.lastCountdownOn, "2026-09-12");

  const prn = applyDailyMedDrop(
    {
      id: "2",
      agencyId: "a",
      individualId: "i",
      name: "Lorazepam",
      strength: "0.5 mg",
      kind: "prn",
      controlled: true,
      pillsPerDay: 0,
      remainingPills: 12,
      lastDeliveryOn: "2026-09-08",
      lastCountdownOn: "2026-09-08",
    },
    "2026-09-12",
  );
  assert.equal(prn.remainingPills, 12);
});

test("controlled meds flag low earlier than regular meds", () => {
  const regular = toMedicationView(
    {
      id: "1",
      agencyId: "a",
      individualId: "i",
      name: "Keppra",
      strength: "500 mg",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 2,
      remainingPills: 16,
      lastDeliveryOn: "2026-09-12",
      lastCountdownOn: "2026-09-12",
    },
    "2026-09-12",
  );
  assert.equal(regular.daysLeft, 8);
  assert.equal(regular.low, false);
  assert.equal(medIsLow({ ...regular, remainingPills: 14 }), true);

  const controlled = toMedicationView(
    {
      id: "2",
      agencyId: "a",
      individualId: "i",
      name: "Oxycodone",
      strength: "5 mg",
      kind: "scheduled",
      controlled: true,
      pillsPerDay: 2,
      remainingPills: 22,
      lastDeliveryOn: "2026-09-12",
      lastCountdownOn: "2026-09-12",
    },
    "2026-09-12",
  );
  assert.equal(controlled.daysLeft, 11);
  assert.equal(controlled.low, false);
  assert.equal(medIsLow({ ...controlled, remainingPills: 20 }), true);
});

test("annual countdown uses date done plus 12 months", () => {
  const [physical] = defaultRenewals("a", "i", "2026-09-12");
  const next = applyRenewalUpload(physical, {
    uploadedOn: "2026-09-12",
    documentTitle: "Physical",
    evidenceKind: "consultation",
    fileId: "file-1",
  });
  assert.equal(next.lastUploadedOn, "2026-09-12");
  assert.equal(next.nextDueOn, "2027-09-12");
  assert.equal(countdownLabel(next.nextDueOn, "2026-09-12"), "365 days left");
});

test("turning a delegation off without an order fails", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(admin)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  const delegation = stack.required.find((view) => view.item.kind === "delegation")!;
  await client.updateObligation(delegation.item.id, { enabled: true });
  await assert.rejects(
    () => client.updateObligation(delegation.item.id, { enabled: false }),
    /discontinuation order/,
  );
});

test("a discontinuation order turns the delegation off and stays downloadable", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(admin)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  const delegation = stack.required.find((view) => view.item.kind === "delegation")!;
  await client.updateObligation(delegation.item.id, { enabled: true });
  await client.discontinueDelegation({
    obligationId: delegation.item.id,
    title: "Physician discontinue order",
    file: orderFile(),
  });
  const after = (await client.loadWorkspace(admin)).planStacks.find(
    (item) => item.individualId === stack.individualId,
  )!;
  const off = after.required.find((view) => view.item.kind === "delegation")!;
  assert.equal(off.item.enabled, false);
  assert.ok(off.item.discontinueFileId);
  const file = await client.getChartFile({
    type: "discontinue",
    id: off.item.discontinueFileId!,
  });
  assert.ok(file);
  assert.equal(file.name, "discontinue-order.pdf");
});

test("DSP cannot discontinue a delegation", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(admin)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  const delegation = stack.required.find((view) => view.item.kind === "delegation")!;
  await client.updateObligation(delegation.item.id, { enabled: true });
  await client.signOut();
  await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await assert.rejects(
    () =>
      client.discontinueDelegation({
        obligationId: delegation.item.id,
        title: "Nope",
        file: orderFile(),
      }),
    /PM or nurse/,
  );
});

test("chart seed includes Ellis meds and Alex training", async () => {
  const memory = new MemoryStore(structuredClone(createEvergreenSeed()));
  const hmProfile = memory.db.profiles.find((p) => p.username === DEMO_HM_USERNAME)!;
  memory.db.memberships.find((m) => m.userId === hmProfile.id)!.siteId =
    memory.db.individuals.find((p) => p.fullName.includes("Ellis"))!.siteId;
  const client = new LocalApi(memory);
  const hm = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(hm)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  assert.ok(stack.carePlan);
  assert.ok(stack.medications.some((row) => row.name === "Levetiracetam"));
  assert.ok(stack.medications.some((row) => row.controlled && row.kind === "prn"));
  assert.ok(
    stack.staffTraining.some((row) => row.checklist.staffName === "Alex Morgan"),
  );
  const nurse = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  const nurseStack = (await client.loadWorkspace(nurse)).planStacks.find(
    (item) => item.individualId === stack.individualId,
  )!;
  assert.ok(nurseStack.renewals.length >= 4);
});

test("first site assignment gives every home staff a check-off sheet", async () => {
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
  const after = await client.loadWorkspace(admin);
  const maplePeople = after.individuals.filter((p) => p.site === ellis.site);
  for (const person of maplePeople) {
    const stack = after.planStacks.find((item) => item.individualId === person.id)!;
    assert.equal(
      stack.staffTraining.some((row) => row.checklist.staffUserId === outsider.id),
      true,
      `missing training for ${person.name}`,
    );
  }
});

test("staff check off each training line before they can sign", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const stack = (await client.loadWorkspace(dsp)).planStacks.find((item) =>
    item.individualName.includes("Ellis"),
  )!;
  assert.ok(stack.myTraining);
  assert.equal(stack.canSubmit, false);
  const [first] = stack.myTraining.checklist.items;
  await client.initialTrainingLine(stack.myTraining.checklist.id, first.id);
  const mid = (await client.loadWorkspace(dsp)).planStacks.find(
    (item) => item.individualId === stack.individualId,
  )!;
  assert.ok(mid.myTraining?.checklist.items[0].initialedAt);
  await assert.rejects(
    () =>
      client.signTrainingChecklist(mid.myTraining!.checklist.id, "staff", dsp.fullName),
    /Check off every/,
  );
});

test("training lines come from required obligations", () => {
  const lines = trainingLinesFromObligations([
    {
      id: "1",
      agencyId: "a",
      individualId: "i",
      kind: "pcsp",
      mode: "required",
      title: "PCSP for Ellis Hart",
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
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
  ]);
  assert.ok(lines.some((line) => line.title.includes("PCSP")));
  assert.ok(lines.some((line) => line.title.includes("Emergency contacts")));
});
