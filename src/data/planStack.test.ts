import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { requiredForSigning } from "./planStack";

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
    item.individualName.includes("Jodie"),
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
    item.individualName.includes("Jodie"),
  )!;
  await assert.rejects(() => client.submitPlanPacket(stack.individualId), /Sign every/);
  for (const view of stack.required.filter((item) => item.item.enabled)) {
    const row = view.mySignature;
    assert.ok(row);
    await client.markObligationOpened(row.id);
    await client.signObligation(row.id, dsp.fullName, "data:image/png;base64,aaa");
  }
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
  const jodie = workspace.individuals.find((p) => p.name.includes("Jodie"))!;
  const outsider = workspace.staff.find((s) => s.site !== jodie.site)!;
  await client.assignStaff(jodie.id, outsider.id);
  const stack = (await client.loadWorkspace(admin)).planStacks.find(
    (item) => item.individualId === jodie.id,
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
  const jodie = workspace.individuals.find((p) => p.name.includes("Jodie"))!;
  const before = workspace.planStacks
    .find((item) => item.individualId === jodie.id)!
    .required.find((view) => view.item.kind === "pcsp")!;
  const signedBefore = before.signedCount;
  await client.addProtocol(jodie.id, "Aspiration protocol");
  const after = (await client.loadWorkspace(admin)).planStacks.find(
    (item) => item.individualId === jodie.id,
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
  const jodie = (await client.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await client.updateIndividualProfile(jodie.id, {
    ...jodie.profile!,
    goesBy: "Jo",
    dmhId: "999",
  });
  const dspClient = api();
  const dsp = await dspClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspJodie = (await dspClient.loadWorkspace(dsp)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await assert.rejects(
    () =>
      dspClient.updateIndividualProfile(dspJodie.id, {
        ...dspJodie.profile!,
        goesBy: "Nope",
      }),
    /cover-page/,
  );
});

test("requiredForSigning skips off, expired, and inventory items", () => {
  const today = "2026-09-12";
  const items = requiredForSigning(
    [
      {
        id: "1",
        agencyId: "a",
        individualId: "i",
        kind: "pcsp",
        mode: "required",
        title: "PCSP",
        detail: "",
        sourcePage: 1,
        documentVersionId: "v",
        enabled: true,
        frequency: "",
        shiftPeriods: [],
        expiresOn: "2027-01-01",
        createdFrom: "extraction",
        inventoryState: "present",
        proposed: false,
      },
      {
        id: "2",
        agencyId: "a",
        individualId: "i",
        kind: "inventory",
        mode: "checked",
        title: "HRST",
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
      },
      {
        id: "3",
        agencyId: "a",
        individualId: "i",
        kind: "pcsp",
        mode: "required",
        title: "Old PCSP",
        detail: "",
        sourcePage: 1,
        documentVersionId: "v0",
        enabled: true,
        frequency: "",
        shiftPeriods: [],
        expiresOn: "2025-01-01",
        createdFrom: "extraction",
        inventoryState: "present",
        proposed: false,
      },
    ],
    today,
  );
  assert.deepEqual(
    items.map((item) => item.title),
    ["PCSP"],
  );
});
