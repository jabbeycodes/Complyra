import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD, LOGIN_FAILED_MESSAGE } from "./types";
import { defaultPermissions } from "./permissions";
import { buildAcknowledgmentPdf } from "../pdf/acknowledgmentPdf";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function adminLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  };
}

function dspLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  };
}

test("assigned staff appear on one acknowledgment sheet and unsigned rows stay visible", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(session);
  const packet = workspace.packets.find((p) =>
    p.individual.fullName.includes("Jodie"),
  );
  assert.ok(packet);
  assert.ok(packet.rows.length >= 3);
  assert.equal(
    packet.rows.some((row) => row.staffName === "Alex Morgan" && !row.signedAt),
    true,
  );
  const pdf = buildAcknowledgmentPdf(session.agencyName, packet);
  const text = pdf.output("datauristring");
  assert.match(text, /application\/pdf/);
});

test("staff must open the document before signing their own row", async () => {
  const api = new LocalApi(store());
  const dsp = await api.signIn(dspLogin());
  const workspace = await api.loadWorkspace(dsp);
  const packet = workspace.packets.find((p) =>
    p.rows.some((row) => row.userId === dsp.userId && !row.signedAt),
  );
  assert.ok(packet);
  const row = packet.rows.find((item) => item.userId === dsp.userId)!;
  await assert.rejects(
    () => api.signRow(row.id, dsp.fullName, "data:image/png;base64,aaa"),
    /Open and review/,
  );
  await api.markOpened(row.id);
  await api.signRow(row.id, dsp.fullName, "data:image/png;base64,aaa");
  const signed = (await api.loadWorkspace(dsp)).packets
    .flatMap((item) => item.rows)
    .find((item) => item.id === row.id);
  assert.ok(signed?.signedAt);
});

test("a DSP cannot approve a draft or sign another person's row", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  const admin = await api.signIn(adminLogin());
  const jodie = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await api.createRequirementDraft({
    individualId: jodie.id,
    title: "Review transport instructions",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Jodie Williams · PCSP 2026 · v2",
    sourcePage: 4,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  await api.signOut();
  const dsp = await api.signIn(dspLogin());
  const draft = (await api.loadWorkspace(dsp)).requirements.find(
    (r) => r.title === "Review transport instructions",
  )!;
  await assert.rejects(() => api.approveRequirement(draft.id), /permission/);
  const foreign = (await api.loadWorkspace(dsp)).packets
    .flatMap((p) => p.rows)
    .find((row) => row.userId !== dsp.userId)!;
  await assert.rejects(
    () => api.signRow(foreign.id, "No", "data:image/png;base64,aaa"),
    /own acknowledgment/,
  );
});

test("login uses agency code and username, and invited members must change the temp password", async () => {
  const api = new LocalApi(store());
  await assert.rejects(
    () =>
      api.signIn({
        agencyCode: "evergreen-mo", // accepted in any case, stored as EVERGREEN-MO
        username: "sarah.mitchell",
        password: "wrong",
      }),
    new RegExp(LOGIN_FAILED_MESSAGE),
  );
  const admin = await api.signIn(adminLogin());
  assert.equal(admin.mustChangePassword, false);
  assert.equal(admin.agencyCode, "EVERGREEN-MO");
  const invited = await api.inviteMember({
    fullName: "Jordan Blake",
    username: "jordan.blake",
    tempPassword: "TempPass!1",
    roleKey: "dsp",
    jobTitle: "DSP",
  });
  assert.equal(invited.agencyCode, "EVERGREEN-MO");
  await api.signOut();
  const first = await api.signIn({
    agencyCode: invited.agencyCode,
    username: invited.username,
    password: "TempPass!1",
  });
  assert.equal(first.mustChangePassword, true);
  await api.changePassword("TempPass!1", "Jordan!own2");
  const after = await api.getSession();
  assert.equal(after?.mustChangePassword, false);
  await api.signOut();
  const again = await api.signIn({
    agencyCode: invited.agencyCode,
    username: invited.username,
    password: "Jordan!own2",
  });
  assert.equal(again.fullName, "Jordan Blake");
});

test("a new agency uses a state code and cannot see another tenant’s records", async () => {
  const api = new LocalApi(store());
  const created = await api.createAgency({
    name: "Longhorn Premier Medical Management",
    stateCode: "CA",
    slug: "lpmm",
    adminFullName: "Casey Nguyen",
    adminUsername: "casey.nguyen",
    adminTempPassword: "TempPass!1",
    provisionedBy: "self",
  });
  assert.equal(created.agencyCode, "LPMM-CA");
  assert.equal(created.status, "pending");
  const admin = await api.signIn({
    agencyCode: "lpmm-ca",
    username: "casey.nguyen",
    password: "TempPass!1",
  });
  assert.equal(admin.mustChangePassword, true);
  assert.equal(admin.agencyCode, "LPMM-CA");
  assert.equal(admin.agencyStatus, "pending");
  const workspace = await api.loadWorkspace(admin);
  assert.equal(workspace.individuals.length, 0);
  assert.equal(workspace.staff.length, 1);
  assert.equal(workspace.staff[0].name, "Casey Nguyen");
});

test("HR does not receive individual care records", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  await api.inviteMember({
    fullName: "Riley Hart",
    username: "riley.hart",
    tempPassword: "TempPass!1",
    roleKey: "hr",
    jobTitle: "HR coordinator",
  });
  await api.signOut();
  const hr = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "riley.hart",
    password: "TempPass!1",
  });
  assert.equal(hr.role, "hr");
  assert.equal(hr.permissions["individuals.view"], false);
  assert.equal(hr.permissions["members.invite"], true);
  const workspace = await api.loadWorkspace(hr);
  assert.equal(workspace.individuals.length, 0);
  assert.equal(workspace.packets.length, 0);
  assert.equal(workspace.plans.length, 0);
  assert.equal(typeof workspace.scorecard.score, "number");
  assert.ok(workspace.scorecard.total > 0);
});

test("an auditor cannot approve requirements", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  const jodie = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await api.createRequirementDraft({
    individualId: jodie.id,
    title: "Review medication storage",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Jodie Williams · PCSP 2026 · v2",
    sourcePage: 4,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  await api.inviteMember({
    fullName: "Quinn Auditor",
    username: "quinn.auditor",
    tempPassword: "TempPass!1",
    roleKey: "auditor",
    expiresOn: "2026-12-31",
  });
  await api.signOut();
  const auditor = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "quinn.auditor",
    password: "TempPass!1",
  });
  assert.equal(auditor.permissions["audit.export"], true);
  const draft = (await api.loadWorkspace(auditor)).requirements.find(
    (r) => r.title === "Review medication storage",
  )!;
  await assert.rejects(() => api.approveRequirement(draft.id), /permission/);
});

test("an administrator can edit template access and cannot demote the last admin", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  await api.updateAgencyRole("dsp", {
    ...defaultPermissions("dsp"),
    "members.invite": true,
  });
  const workspace = await api.loadWorkspace(admin);
  const dspRole = workspace.roles.find((row) => row.key === "dsp");
  assert.equal(dspRole?.permissions["members.invite"], true);
  await assert.rejects(
    () => api.assignMemberRole(admin.userId, "dsp"),
    /at least one agency administrator/,
  );
});

test("a house manager can upload but cannot approve", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  const jodie = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await api.createRequirementDraft({
    individualId: jodie.id,
    title: "House-created plan item",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Jodie Williams · PCSP 2026 · v2",
    sourcePage: 4,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  await api.signOut();
  const hm = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "james.wilson",
    password: DEMO_PASSWORD,
  });
  assert.equal(hm.permissions["documents.upload"], true);
  assert.equal(hm.permissions["requirements.approve"], false);
  const draft = (await api.loadWorkspace(hm)).requirements.find(
    (r) => r.title === "House-created plan item",
  )!;
  await assert.rejects(() => api.approveRequirement(draft.id), /permission/);
});

test("a DPM can reset another staff member’s password", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  await api.inviteMember({
    fullName: "Dana Qidp",
    username: "dana.qidp",
    tempPassword: "TempPass!1",
    roleKey: "degreed_professional_manager",
  });
  await api.signOut();
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "dana.qidp",
    password: "TempPass!1",
  });
  await api.changePassword("TempPass!1", "Dana!own2");
  const dsp = (await api.loadWorkspace((await api.getSession())!)).staff.find(
    (row) => row.username === DEMO_DSP_USERNAME,
  )!;
  const reset = await api.resetMemberPassword(dsp.id);
  assert.match(reset.tempPassword, /^Reset!/);
  await api.signOut();
  const next = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: reset.tempPassword,
  });
  assert.equal(next.mustChangePassword, true);
});

test("a DPM/admin can add a site and a person by hand or from a PCSP", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const site = await api.createSite({
    name: "Poplar House",
    address: "12 Poplar Lane",
    programName: "Residential services",
  });
  const manual = await api.createIndividual({
    fullName: "Nora Fields",
    dateOfBirth: "1991-04-12",
    siteId: site.id,
    goesBy: "Nora",
  });
  const workspace = await api.loadWorkspace(session);
  assert.equal(workspace.sites.some((row) => row.name === "Poplar House"), true);
  assert.equal(workspace.individuals.some((row) => row.id === manual.id), true);
  const stack = workspace.planStacks.find((row) => row.individualId === manual.id);
  assert.ok(stack);
  assert.equal(stack.renewals.some((row) => row.kind === "annual_physical"), true);

  const file = new File(["%PDF-1.4 fictional"], "nora-pcsp.pdf", {
    type: "application/pdf",
  });
  const fromPlan = await api.createIndividual({
    fullName: "Eli Navarro",
    dateOfBirth: "1988-11-02",
    siteId: site.id,
    file,
    pageCount: 10,
    effectiveOn: "2026-09-12",
  });
  const after = await api.loadWorkspace(session);
  assert.equal(
    after.plans.some((plan) => plan.person === fromPlan.name && plan.status === "Pending review"),
    true,
  );
});

test("a DSP cannot add a site or an individual", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(dspLogin());
  const workspace = await api.loadWorkspace(session);
  await assert.rejects(
    () =>
      api.createSite({
        name: "Should Fail",
        address: "1 Nowhere",
        programName: "Residential services",
      }),
    /administrator/,
  );
  await assert.rejects(
    () =>
      api.createIndividual({
        fullName: "Should Fail",
        dateOfBirth: "1990-01-01",
        siteId: workspace.sites[0].id,
      }),
    /house manager/,
  );
});

test("the platform owner can approve a pending agency", async () => {
  const api = new LocalApi(store());
  const created = await api.createAgency({
    name: "Cedar Ridge",
    stateCode: "MO",
    slug: "cedarridge",
    adminFullName: "Pat Admin",
    adminUsername: "pat.admin",
    adminTempPassword: "TempPass!1",
    provisionedBy: "self",
  });
  assert.equal(created.status, "pending");
  const owner = await api.signIn({
    agencyCode: "COMPLYRER-MO",
    username: "platform.owner",
    password: DEMO_PASSWORD,
  });
  assert.equal(owner.platformAdmin, true);
  const pending = await api.listPendingAgencies();
  const cedar = pending.find((row) => row.agencyCode === "CEDARRIDGE-MO");
  assert.ok(cedar);
  await api.setAgencyStatus(cedar.id, "active");
  await api.signOut();
  const admin = await api.signIn({
    agencyCode: "CEDARRIDGE-MO",
    username: "pat.admin",
    password: "TempPass!1",
  });
  assert.equal(admin.agencyStatus, "active");
});

test("managers can correct a requirement and the fix is audit-logged", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  const jodie = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await api.createRequirementDraft({
    individualId: jodie.id,
    title: "Reveiw transport instructions",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Jodie Williams · PCSP 2026 · v2",
    sourcePage: 4,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  const draft = (await api.loadWorkspace(admin)).requirements.find(
    (r) => r.title === "Reveiw transport instructions",
  )!;
  await api.approveRequirement(draft.id);
  await api.updateRequirement(draft.id, {
    title: "Review transport instructions",
    dueOn: "2026-12-01",
    frequency: "Monthly",
  });
  const fixed = (await api.loadWorkspace(admin)).requirements.find(
    (r) => r.id === draft.id,
  )!;
  assert.equal(fixed.title, "Review transport instructions");
  assert.equal(fixed.due, "2026-12-01");
  assert.equal(fixed.frequency, "Monthly");
  assert.equal(fixed.status, "Upcoming");
  const entry = (await api.loadWorkspace(admin)).activity.find((a) =>
    a.detail.includes("Review transport instructions"),
  );
  assert.ok(entry, "expected an audit entry for the correction");
  assert.match(entry!.detail, /corrected/);
  await assert.rejects(
    () => api.updateRequirement(draft.id, { title: "   " }),
    /Enter a title/,
  );
  await api.signOut();
  await api.signIn(dspLogin());
  await assert.rejects(
    () => api.updateRequirement(draft.id, { title: "Nope" }),
    /permission/i,
  );
});
