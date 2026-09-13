import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE, DEMO_DSP_USERNAME } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { siteChecklistTopics, individualChecklistTopics } from "../features/training/topics";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function adminApi() {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const dsp = workspace.staff.find((person) => person.username === DEMO_DSP_USERNAME);
  assert.ok(dsp, "demo DSP exists");
  return { api, session, workspace, dspId: dsp.id };
}

test("checklist seed has 53 site topics and 12 per-individual topics", () => {
  assert.equal(siteChecklistTopics().length, 53);
  assert.equal(individualChecklistTopics().length, 12);
  assert.ok(siteChecklistTopics().every((topic) => !topic.perIndividual));
  assert.ok(individualChecklistTopics().every((topic) => topic.perIndividual && topic.section === 6));
});

test("assignTraining generates the full checklist and is idempotent", async () => {
  const { api, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  const individualId = workspace.individuals[0].id;
  const created = await api.assignTraining({
    userId: dspId,
    siteId,
    individualId,
    source: "checklist",
  });
  assert.equal(created.length, 65);
  assert.equal(created.filter((row) => row.individualId === null).length, 53);
  assert.equal(created.filter((row) => row.individualId === individualId).length, 12);
  const again = await api.assignTraining({ userId: dspId, siteId, individualId, source: "checklist" });
  assert.equal(again.length, 0);
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.equal(profile.requirements.length, 65);
  assert.equal(profile.clearedForInRatio, false);
  assert.ok(profile.gateReasons.length > 0);
});

test("assignStaff auto-generates the checklist through the P2 hook", async () => {
  const { api, workspace, dspId } = await adminApi();
  const individual = workspace.individuals[0];
  await api.assignStaff(individual.id, dspId);
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.equal(profile.requirements.length, 65);
});

test("plan_version retraining targets assigned staff when a version activates", async () => {
  const { api, workspace, dspId } = await adminApi();
  const individual = workspace.individuals[0];
  await api.assignStaff(individual.id, dspId);
  const before = (await api.getStaffTrainingProfile(dspId)).requirements.filter(
    (row) => row.source === "plan_version",
  );
  // Find a draft requirement tied to a pending-review version for this individual.
  const st = (api as unknown as { store: MemoryStore }).store;
  const draft = st.db.requirements.find(
    (row) =>
      row.status === "Pending review" &&
      row.individualId === individual.id &&
      row.documentVersionId &&
      st.db.versions.some(
        (version) => version.id === row.documentVersionId && version.status === "pending_review",
      ),
  );
  assert.ok(draft, "seed has an approvable draft requirement");
  await api.approveRequirement(draft.id);
  const after = (await api.getStaffTrainingProfile(dspId)).requirements.filter(
    (row) => row.source === "plan_version",
  );
  assert.ok(after.length > before.length, "retraining lines were generated");
  assert.ok(after.every((row) => row.individualId === individual.id));
});

test("staff cannot sign the checklist before every line is initialed", async () => {
  const { api, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  await assert.rejects(
    () =>
      api.signStaffChecklist({
        userId: dspId,
        siteId,
        role: "staff",
        signatureName: "Alex Morgan",
      }),
    /Staff must sign their own training sheet|Initial or N\/A every training line/,
  );
});

test("full sign-off flow clears the in-ratio gate", async () => {
  const { api, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  const profile = await api.getStaffTrainingProfile(dspId);
  // Sign in as the DSP to initial their own lines and sign their own sheet.
  const dspApi = new LocalApi((api as unknown as { store: MemoryStore }).store);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  for (const line of profile.requirements) {
    await dspApi.initialRequirementLine(line.id, {
      initials: "AM",
      trainerName: "House Manager",
      method: "shadowing",
      hoursTotal: 1,
      hoursWithHm: 0.2,
    });
  }
  await dspApi.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: "Alex Morgan",
  });
  // Sessions are store-level: sign back in as admin before the HM countersign.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  // Admin countersigns as the house manager.
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "hm",
    signatureName: "Admin User",
  });
  const cleared = await api.getStaffTrainingProfile(dspId);
  assert.equal(cleared.clearedForInRatio, true);
  assert.deepEqual(cleared.gateReasons, []);
  assert.ok(cleared.hoursTotal >= 20);
  assert.ok(cleared.hoursWithHm >= 8);
  const rows = await api.listStaffNeedingClearance();
  assert.ok(rows.find((row) => row.userId === dspId)?.clearedForInRatio);
});

test("waiveRequirementLine marks a line N/A and excludes it from hours", async () => {
  const { api, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  const created = await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  await api.waiveRequirementLine(created[0].id, "Vehicle not used at this home.");
  const profile = await api.getStaffTrainingProfile(dspId);
  const waived = profile.requirements.find((row) => row.id === created[0].id);
  assert.equal(waived?.resolvedStatus, "waived_na");
  assert.equal(waived?.signoff?.na, true);
  assert.equal(profile.counts.waived, 1);
  await assert.rejects(() => api.waiveRequirementLine(created[0].id, "again"), /already initialed/);
});

test("legacy initialTrainingLine still works with and without the extended sign-off", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_DSP_USERNAME));
  const st = (api as unknown as { store: MemoryStore }).store;
  const dspId = session.userId;
  // Build a legacy checklist row owned by the DSP.
  const checklistId = crypto.randomUUID();
  st.db.trainingChecklists.push({
    id: checklistId,
    agencyId: session.agencyId,
    individualId: "individual-1",
    staffUserId: dspId,
    staffName: session.fullName,
    documentVersionId: null,
    items: [
      { id: "l1", title: "Test line 1", initialedAt: null },
      { id: "l2", title: "Test line 2", initialedAt: null },
    ],
    staffSignedAt: null,
    staffSignatureName: null,
    hmSignedAt: null,
    hmSignatureName: null,
  });
  const checklist = st.db.trainingChecklists.find((row) => row.id === checklistId)!;
  const [line1, line2] = checklist.items;
  // Backward compat: no third argument.
  await api.initialTrainingLine(checklist.id, line1.id);
  assert.ok(line1.initialedAt);
  // Extended: full sign-off detail.
  await api.initialTrainingLine(checklist.id, line2.id, {
    initials: "AM",
    trainerName: "HM",
    hoursTotal: 2,
    hoursWithHm: 2,
  });
  assert.ok(line2.initialedAt);
});
