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
import { DEMO_PASSWORD, LOGIN_FAILED_MESSAGE, LOGIN_NO_MEMBERSHIP_MESSAGE } from "./types";
import { defaultPermissions } from "./permissions";
import { buildAcknowledgmentPdf } from "../pdf/acknowledgmentPdf";
import { todayIso } from "./chart";

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
    p.individual.fullName.includes("Ellis"),
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
  const ellis = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await api.createRequirementDraft({
    individualId: ellis.id,
    title: "Review transport instructions",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Ellis Hart · PCSP 2026 · v2",
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
  const ellis = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await api.createRequirementDraft({
    individualId: ellis.id,
    title: "Review medication storage",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Ellis Hart · PCSP 2026 · v2",
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
  const ellis = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await api.createRequirementDraft({
    individualId: ellis.id,
    title: "House-created plan item",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Ellis Hart · PCSP 2026 · v2",
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
  );
  assert.equal(draft, undefined, "A Willow manager must not receive a Cedar draft.");
  await assert.rejects(() => api.approveRequirement("outside-site-draft"), /permission/);
});

test("a PM can reset another staff member’s password", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  await api.inviteMember({
    fullName: "Dana Qidp",
    username: "dana.qidp",
    tempPassword: "TempPass!1",
    roleKey: "program_manager",
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

test("a PM/admin can add a site and a person by hand or from a PCSP", async () => {
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

test("intake stores enrollment date on the Individual profile", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const site = await api.createSite({
    name: "Birch House",
    address: "10 Birch Way",
    programName: "Residential services",
  });
  const created = await api.createIndividual({
    fullName: "Riley Quinn",
    dateOfBirth: "1994-02-08",
    siteId: site.id,
    enrolledOn: "2026-09-12",
  });
  const workspace = await api.loadWorkspace(session);
  const stack = workspace.planStacks.find((row) => row.individualId === created.id);
  assert.equal(stack?.profile.enrolledOn, "2026-09-12");
});

test("intake defaults enrollment date to today when omitted", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const site = await api.createSite({
    name: "Aspen House",
    address: "22 Aspen Court",
    programName: "Residential services",
  });
  const created = await api.createIndividual({
    fullName: "Avery Patel",
    dateOfBirth: "1992-11-19",
    siteId: site.id,
  });
  const workspace = await api.loadWorkspace(session);
  const stack = workspace.planStacks.find((row) => row.individualId === created.id);
  assert.equal(stack?.profile.enrolledOn, todayIso());
});

test("Evergreen demo sites hard-cap at 2 Individuals", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const cedar = (await api.loadWorkspace(session)).sites.find((row) => row.name === "Cedar House")!;
  await assert.rejects(
    () =>
      api.createIndividual({
        fullName: "Should Not Fit",
        dateOfBirth: "1990-01-01",
        siteId: cedar.id,
      }),
    /This site already has 2 Individuals \(max 2\)/,
  );
  const site = await api.createSite({
    name: "Cypress House",
    address: "8 Cypress Lane",
    programName: "Residential services",
  });
  await api.createIndividual({
    fullName: "First Cypress",
    dateOfBirth: "1991-02-02",
    siteId: site.id,
  });
  await api.createIndividual({
    fullName: "Second Cypress",
    dateOfBirth: "1992-03-03",
    siteId: site.id,
  });
  await assert.rejects(
    () =>
      api.createIndividual({
        fullName: "Third Cypress",
        dateOfBirth: "1993-04-04",
        siteId: site.id,
      }),
    /This site already has 2 Individuals \(max 2\)/,
  );
});

test("production sites hard-cap at 3 Individuals", async () => {
  const memory = store();
  const evergreen = memory.db.agencies.find((row) => row.agencyCode === DEMO_AGENCY_CODE)!;
  evergreen.agencyCode = "ACME-TX";
  const api = new LocalApi(memory);
  const session = await api.signIn({
    agencyCode: "ACME-TX",
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const cedar = (await api.loadWorkspace(session)).sites.find((row) => row.name === "Cedar House")!;
  await api.createIndividual({
    fullName: "Third Seat",
    dateOfBirth: "1990-01-01",
    siteId: cedar.id,
  });
  await assert.rejects(
    () =>
      api.createIndividual({
        fullName: "Fourth Seat",
        dateOfBirth: "1991-02-02",
        siteId: cedar.id,
      }),
    /This site already has 3 Individuals \(max 3\)/,
  );
});

test("reassign onto a full demo house is blocked; empty house accepts the transfer", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(session);
  const cedar = workspace.sites.find((row) => row.name === "Cedar House")!;
  const willow = workspace.sites.find((row) => row.name === "Willow House")!;
  const willowPerson = workspace.individuals.find((row) => row.siteId === willow.id)!;
  await assert.rejects(
    () => api.reassignIndividualToSite(willowPerson.id, cedar.id),
    /This site already has 2 Individuals \(max 2\)/,
  );
  const empty = await api.createSite({
    name: "Birch House",
    address: "4 Birch Street",
    programName: "Residential services",
  });
  await api.reassignIndividualToSite(willowPerson.id, empty.id);
  const after = await api.loadWorkspace(session);
  assert.equal(
    after.individuals.find((row) => row.id === willowPerson.id)?.siteId,
    empty.id,
  );
});

test("nurse can create an appointment; DSP cannot", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  const ellis = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await api.signOut();
  const nurse = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  const created = await api.createAppointment({
    individualId: ellis.id,
    startsOn: "2026-09-24",
    startTime: "13:00",
    endTime: "13:45",
    timezone: "America/Chicago",
    consultant: "Dr. Elena Ruiz",
    specialty: "Primary care",
    reason: "Well visit",
    visitAddress: "3201 Pompey Drive",
  });
  const afterNurse = await api.loadWorkspace(nurse);
  const stack = afterNurse.planStacks.find((row) => row.individualId === ellis.id);
  const row = stack?.appointments.find((item) => item.id === created.id);
  assert.ok(row);
  assert.equal(row?.createdByName, nurse.fullName);
  assert.equal(row?.createdBy, nurse.userId);
  await api.updateAppointment(created.id, {
    startsOn: "2026-09-24",
    startTime: "13:00",
    endTime: "14:00",
    timezone: "America/Chicago",
    consultant: "Dr. Elena Ruiz",
    specialty: "Primary care",
    reason: "Annual physical",
    visitAddress: "3201 Pompey Drive",
  });
  const afterEdit = (await api.loadWorkspace(nurse)).planStacks.find(
    (item) => item.individualId === ellis.id,
  );
  const edited = afterEdit?.appointments.find((item) => item.id === created.id);
  assert.equal(edited?.createdBy, nurse.userId);
  assert.equal(edited?.updatedBy, nurse.userId);
  assert.equal(edited?.reason, "Annual physical");
  await api.signOut();
  const dsp = await api.signIn(dspLogin());
  const dspStack = (await api.loadWorkspace(dsp)).planStacks.find(
    (row) => row.individualId === ellis.id,
  );
  assert.ok(dspStack?.appointments.some((row) => row.consultant === "Dr. Priya Shah"));
  assert.ok(dspStack?.profile.allergies.some((row) => row.allergen === "Tree nuts"));
  await assert.rejects(
    () =>
      api.createAppointment({
        individualId: ellis.id,
        startsOn: "2026-09-25",
        startTime: "09:00",
        endTime: "09:30",
        timezone: "America/Chicago",
        consultant: "Should Fail",
      }),
    /cannot create or edit appointments/,
  );
  await assert.rejects(
    () =>
      api.updateIndividualAllergies(ellis.id, [
        { allergen: "Penicillin", reaction: "", status: "active" },
      ]),
    /cannot edit allergies/,
  );
});

test("removing an appointment is a soft-delete RN can still see", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  const ellis = (await api.loadWorkspace(nurse)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  const seedAppt = (await api.loadWorkspace(nurse)).planStacks.find(
    (row) => row.individualId === ellis.id,
  )!.appointments.find((row) => row.consultant === "Dr. Priya Shah")!;
  await api.deleteAppointment(seedAppt.id);
  const afterNurse = (await api.loadWorkspace(nurse)).planStacks.find(
    (row) => row.individualId === ellis.id,
  );
  const removed = afterNurse?.appointments.find((row) => row.id === seedAppt.id);
  assert.ok(removed?.deletedAt);
  assert.equal(removed?.deletedByName, nurse.fullName);
  assert.equal(removed?.createdByName, "Cameron Price");
  await api.signOut();
  const dsp = await api.signIn(dspLogin());
  const dspStack = (await api.loadWorkspace(dsp)).planStacks.find(
    (row) => row.individualId === ellis.id,
  );
  assert.equal(
    dspStack?.appointments.some((row) => row.id === seedAppt.id),
    false,
  );
});

test("assigned DSP can upload a consultation form and complete the visit", async () => {
  const api = new LocalApi(store());
  const dsp = await api.signIn(dspLogin());
  const ellis = (await api.loadWorkspace(dsp)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  const seedAppt = (await api.loadWorkspace(dsp)).planStacks.find(
    (row) => row.individualId === ellis.id,
  )!.appointments.find((row) => row.consultant === "Dr. Priya Shah")!;
  const file = new File(["%PDF-1.4 consultation"], "shah-visit.pdf", {
    type: "application/pdf",
  });
  await api.completeAppointment({
    appointmentId: seedAppt.id,
    file,
    comments: "Brought seizure log.",
  });
  const after = (await api.loadWorkspace(dsp)).planStacks.find(
    (row) => row.individualId === ellis.id,
  )!.appointments.find((row) => row.id === seedAppt.id)!;
  assert.equal(after.completedBy, dsp.userId);
  assert.equal(after.completedByName, dsp.fullName);
  assert.ok(after.completedAt);
  assert.equal(after.visitComments, "Brought seizure log.");
  assert.ok(after.consultationFileId);
  const stored = await api.getChartFile({
    type: "consultation",
    id: after.consultationFileId!,
  });
  assert.equal(stored?.name, "shah-visit.pdf");
  await assert.rejects(
    () =>
      api.completeAppointment({
        appointmentId: seedAppt.id,
        file,
      }),
    /already completed/,
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
  const ellis = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Ellis"),
  )!;
  await api.createRequirementDraft({
    individualId: ellis.id,
    title: "Reveiw transport instructions",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Ellis Hart · PCSP 2026 · v2",
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

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function pdfFile(name = "cpr.pdf", size = 2048): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

test("LIFEPATH-P4: certificate mutations require certificates.manage (admin default off)", async () => {
  const db = store();
  const api = new LocalApi(db);
  const session = await api.signIn(adminLogin());
  await assert.rejects(
    () =>
      api.addCertificate({
        userId: session.userId,
        certName: "CPR",
        issuedOn: isoPlus(-400),
        expiresOn: isoPlus(300),
      }),
    /permission/i,
  );
  // Explicitly granting it via the agency role (Roles & access flow) works.
  const roleRow = db.db.agencyRoles.find(
    (row) => row.agencyId === session.agencyId && row.key === "administrator",
  )!;
  roleRow.permissions["certificates.manage"] = true;
  const created = await api.addCertificate({
    userId: session.userId,
    certName: "CPR",
    issuedOn: isoPlus(-400),
    expiresOn: isoPlus(300),
  });
  assert.ok(created.id);
  assert.equal(created.certName, "CPR");
  assert.equal(created.filePath, null);
  assert.equal(created.enteredBy, session.userId);
  // Renewal date before issue date is rejected.
  await assert.rejects(
    () =>
      api.addCertificate({
        userId: session.userId,
        certName: "CPI",
        issuedOn: isoPlus(0),
        expiresOn: isoPlus(-10),
      }),
    /cannot be before the issue date/,
  );
});

test("LIFEPATH-P4: list/update/delete certificates and the expiring-soon panel", async () => {
  const db = store();
  const api = new LocalApi(db);
  const session = await api.signIn(adminLogin());
  db.db.agencyRoles.find(
    (row) => row.agencyId === session.agencyId && row.key === "administrator",
  )!.permissions["certificates.manage"] = true;

  await api.addCertificate({
    userId: session.userId,
    certName: "CPR",
    issuedOn: isoPlus(-400),
    expiresOn: isoPlus(30),
  });
  await api.addCertificate({
    userId: session.userId,
    certName: "L1MA",
    issuedOn: isoPlus(-400),
    expiresOn: isoPlus(-10),
  });
  await api.addCertificate({
    userId: session.userId,
    certName: "CPI",
    issuedOn: isoPlus(-400),
    expiresOn: isoPlus(400),
  });

  const list = await api.listCertificates(session.userId);
  assert.equal(list.length, 3);

  const soon = await api.certificatesExpiringSoon(90);
  // The demo seed now ships its own certificates; scope the assertions to the
  // three this test created for the signed-in admin.
  const mine = soon.filter((c) => c.userId === session.userId);
  assert.equal(mine.length, 2, "expired + 30-day certs, not the 400-day one");
  assert.equal(mine[0].daysRemaining <= 0, true);
  assert.equal(mine[0].staffName.length > 0, true);
  assert.equal(mine[1].daysRemaining <= 30, true);

  const cpr = list.find((c) => c.certName === "CPR")!;
  const updated = await api.updateCertificate(cpr.id, { certName: "CPR (renewed)" });
  assert.equal(updated.certName, "CPR (renewed)");

  await api.deleteCertificate(cpr.id);
  const after = await api.listCertificates(session.userId);
  assert.equal(after.length, 2);
  assert.equal(after.some((c) => c.id === cpr.id), false);
});

test("LIFEPATH-P4: certificate file upload links the scan and serves a download URL", async () => {
  const db = store();
  const api = new LocalApi(db);
  const session = await api.signIn(adminLogin());
  db.db.agencyRoles.find(
    (row) => row.agencyId === session.agencyId && row.key === "administrator",
  )!.permissions["certificates.manage"] = true;

  const cert = await api.uploadCertificateFile({
    userId: session.userId,
    file: pdfFile(),
    certName: "CPI",
    issuedOn: isoPlus(-100),
    expiresOn: isoPlus(265),
  });
  assert.ok(cert.filePath, "storage path linked");
  assert.equal(cert.fileName, "cpr.pdf");
  const url = await api.certificateFileUrl(cert.id);
  assert.match(url, /^blob:/);
  // Non-PDF/non-image and oversized files are rejected.
  await assert.rejects(
    () =>
      api.uploadCertificateFile({
        userId: session.userId,
        file: new File(["x"], "notes.txt", { type: "text/plain" }),
        certName: "CPI",
        issuedOn: isoPlus(-100),
        expiresOn: isoPlus(265),
      }),
    /PDF or image/,
  );
  await assert.rejects(
    () =>
      api.uploadCertificateFile({
        userId: session.userId,
        file: pdfFile("big.pdf", 10 * 1024 * 1024 + 1),
        certName: "CPI",
        issuedOn: isoPlus(-100),
        expiresOn: isoPlus(265),
      }),
    /10 MB/,
  );
});

test("LIFEPATH-P4: certificate reads require hr.view_staff or certificates.manage", async () => {
  const db = store();
  const api = new LocalApi(db);
  const session = await api.signIn(adminLogin());
  db.db.agencyRoles.find(
    (row) => row.agencyId === session.agencyId && row.key === "administrator",
  )!.permissions["certificates.manage"] = true;
  await api.addCertificate({
    userId: session.userId,
    certName: "CPR",
    issuedOn: isoPlus(-400),
    expiresOn: isoPlus(300),
  });
  await api.signIn(dspLogin());
  await assert.rejects(() => api.listCertificates(session.userId), /permission/i);
  await assert.rejects(() => api.certificatesExpiringSoon(90), /permission/i);
});

test("HR-ROLES: HR can add staff and assign operational roles, but cannot escalate", async () => {
  const db = store();
  const api = new LocalApi(db);
  const admin = await api.signIn(adminLogin());

  // Seed an HR staff member directly (mirrors the seed's row shapes).
  const hrUserId = "00000000-0000-4000-8000-0000000000hr";
  db.db.profiles.push({
    id: hrUserId,
    fullName: "Helen Recruit",
    email: "helen.recruit@demo.complyrer.user",
    jobTitle: "HR",
    username: "helen.recruit",
    homeAgencyId: admin.agencyId,
    mustChangePassword: false,
  });
  db.db.memberships.push({
    id: "00000000-0000-4000-8000-000000000hrm",
    agencyId: admin.agencyId,
    userId: hrUserId,
    role: "hr",
    roleKey: "hr",
    siteId: null,
    expiresOn: null,
  });
  db.db.credentials.push({
    userId: hrUserId,
    email: "helen.recruit@demo.complyrer.user",
    password: DEMO_PASSWORD,
  });

  const dspInvite = await api.inviteMember({
    fullName: "Dan Support",
    username: "dan.support",
    tempPassword: "TempPass!1",
    roleKey: "dsp",
    jobTitle: "DSP",
  });
  await api.signOut();

  // Sign in as HR.
  const hrSession = await api.signIn({
    agencyCode: admin.agencyCode,
    username: "helen.recruit",
    password: DEMO_PASSWORD,
  });
  assert.equal(hrSession.roleKey, "hr");

  // HR can add a staff member…
  const added = await api.inviteMember({
    fullName: "Amy Aide",
    username: "amy.aide",
    tempPassword: "TempPass!1",
    roleKey: "dsp",
    jobTitle: "DSP",
  });
  assert.equal(added.username, "amy.aide");

  // …and assign operational roles…
  const target = (await api.loadWorkspace(hrSession)).staff.find(
    (p) => p.username === dspInvite.username,
  )!;
  await api.assignMemberRole(target.id, "house_manager");

  // …but cannot grant administrator…
  await assert.rejects(
    () => api.assignMemberRole(target.id, "administrator"),
    /Only an administrator can grant that role/,
  );
  await assert.rejects(
    () => api.assignMemberRole(target.id, "compliance_admin"),
    /Only an administrator can grant that role/,
  );
  // …cannot invite an administrator…
  await assert.rejects(
    () =>
      api.inviteMember({
        fullName: "Eve Escalate",
        username: "eve.escalate",
        tempPassword: "TempPass!1",
        roleKey: "administrator",
        jobTitle: "Admin",
      }),
    /Only an administrator can invite someone to that role/,
  );
  // …and cannot edit the role templates themselves.
  await assert.rejects(
    () => api.updateAgencyRole("hr", { ...defaultPermissions("hr") }),
    /Only administrators can edit role access/,
  );

  // Administrators keep full control.
  await api.signOut();
  await api.signIn(adminLogin());
  await api.updateAgencyRole("dsp", {
    ...defaultPermissions("dsp"),
    "members.invite": true,
  });
  await api.assignMemberRole(target.id, "dsp");
});

test("demo nurse cameron.price can sign in and is a Cedar member", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  assert.equal(nurse.roleKey, "nurse");
  assert.equal(nurse.username, DEMO_NURSE_USERNAME);
  const workspace = await api.loadWorkspace(nurse);
  const maple = workspace.sites.find((site) => site.name === "Cedar House");
  assert.ok(maple);
  assert.equal(nurse.siteId, maple.id);
});

test("createDelegation refuses a person outside the nurse's site", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(admin);
  const oakwoodPerson = workspace.individuals.find((row) => row.site === "Willow House")!;
  await api.signOut();
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  await assert.rejects(
    () =>
      api.createDelegation({
        individualId: oakwoodPerson.id,
        taskTitle: "Cross-site leak",
        purpose: "Should not be allowed",
      }),
    /site you can manage|assigned access/,
  );
});

test("a requirement draft inherits the individual's site, not the first agency site", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const site = await api.createSite({
    name: "QA Audit House",
    address: "1 Audit Lane",
    programName: "Residential services",
  });
  const person = await api.createIndividual({
    fullName: "Nia Brooks",
    dateOfBirth: "1990-01-15",
    siteId: site.id,
  });
  await api.createRequirementDraft({
    individualId: person.id,
    title: "QA acknowledgment",
    category: "PCSP acknowledgments",
    ownerUserId: session.userId,
    source: "Nia Brooks · PCSP 2026 · v1",
    sourcePage: 1,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  const workspace = await api.loadWorkspace(session);
  const individual = workspace.individuals.find((row) => row.id === person.id)!;
  const requirement = workspace.requirements.find((row) => row.title === "QA acknowledgment")!;
  assert.equal(individual.site, "QA Audit House");
  assert.equal(individual.siteId, site.id);
  assert.equal(requirement.person, "Nia Brooks");
  assert.equal(requirement.site, "QA Audit House");
  assert.notEqual(requirement.site, "Cedar House");
});

test("inviting qa.pm creates a login that is recognized", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  const invited = await api.inviteMember({
    fullName: "QA Program Manager",
    username: "qa.pm",
    tempPassword: "TempPass!1",
    roleKey: "program_manager",
  });
  assert.equal(invited.username, "qa.pm");
  await api.signOut();
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "qa.pm",
    password: "TempPass!1",
  });
  assert.equal(session.roleKey, "program_manager");
  assert.equal(session.mustChangePassword, true);
  await api.changePassword("TempPass!1", "QaDpm!own2");
  const after = await api.getSession();
  assert.equal(after?.mustChangePassword, false);
  const workspace = await api.loadWorkspace(after!);
  assert.ok(workspace.sites.length > 0);
  assert.ok(workspace.staff.some((row) => row.username === "qa.pm"));
});

test("sign-in names a missing membership separately from a bad password", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  await api.signIn(adminLogin());
  const invited = await api.inviteMember({
    fullName: "No Seat",
    username: "qa.orphan",
    tempPassword: "TempPass!1",
    roleKey: "dsp",
  });
  const profile = memory.db.profiles.find((row) => row.username === invited.username)!;
  memory.db.memberships = memory.db.memberships.filter((row) => row.userId !== profile.id);
  await api.signOut();
  await assert.rejects(
    () =>
      api.signIn({
        agencyCode: DEMO_AGENCY_CODE,
        username: "qa.orphan",
        password: "TempPass!1",
      }),
    new RegExp(LOGIN_NO_MEMBERSHIP_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("issue #81: scoped contact/diagnosis updates enforce role gates", async () => {
  const hmApi = new LocalApi(store());
  const hm = await hmApi.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
password: DEMO_PASSWORD,
  });
  const hmPerson = (await hmApi.loadWorkspace(hm)).individuals[0];
  assert.ok(hmPerson);

  const provider = {
    id: "p-test",
    name: "Dr. Test",
    role: "PCP",
    phone: "",
    email: "",
    address: "",
    notes: "",
  };
  await hmApi.updateIndividualContacts(hmPerson.id, { guardians: [], providerContacts: [provider] });
  const hmStack = (await hmApi.loadWorkspace(hm)).planStacks.find(
    (item) => item.individualId === hmPerson.id,
  );
  assert.equal(hmStack?.profile.providerContacts[0]?.name, "Dr. Test");
  // The scoped contact update leaves the rest of the profile untouched.
  assert.equal(hmStack?.profile.legalName, hmPerson.name);
  await assert.rejects(
    () => hmApi.updateIndividualDiagnosis(hmPerson.id, "Diabetes"),
    /Only a nurse, PM, or administrator can edit diagnoses\./,
  );

  const nurseApi = new LocalApi(store());
  const nurse = await nurseApi.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
password: DEMO_PASSWORD,
  });
  const nursePerson = (await nurseApi.loadWorkspace(nurse)).individuals[0];
  assert.ok(nursePerson);
  await nurseApi.updateIndividualDiagnosis(nursePerson.id, "  Diabetes ");
  const nurseStack = (await nurseApi.loadWorkspace(nurse)).planStacks.find(
    (item) => item.individualId === nursePerson.id,
  );
  assert.equal(nurseStack?.profile.diagnosis, "Diabetes");
  await assert.rejects(
    () => nurseApi.updateIndividualContacts(nursePerson.id, { guardians: [], providerContacts: [] }),
    /Only a house manager, PM, or administrator can edit contacts\./,
  );

  const dspApi = new LocalApi(store());
  const dsp = await dspApi.signIn(dspLogin());
  const dspPerson = (await dspApi.loadWorkspace(dsp)).individuals[0];
  if (dspPerson) {
    await assert.rejects(
      () => dspApi.updateIndividualContacts(dspPerson.id, { guardians: [], providerContacts: [] }),
      /Only a house manager, PM, or administrator can edit contacts\./,
    );
  }
});

// ===== GER submit alerts + dashboard rows (issue follow-up) =====

function gerDraftInput(siteId: string, individualId: string, severity: string) {
  return {
    siteId,
    individualId,
    eventDate: "2026-09-17",
    eventTime: "14:30",
    location: "Living room",
    eventType: "fall",
    severity,
    description: "Resident slipped on a wet floor.",
    actionsTaken: "Checked for injury, applied ice.",
    reportedByName: "Test Staff",
    signatureName: "Test Staff",
  };
}

const SEVERITY_LABEL: Record<string, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};

test("submitting a GER at any severity alerts the home's HM directly, plus PM and nurse", async () => {
  for (const severity of ["low", "moderate", "high", "critical"]) {
    const memory = store();
    const api = new LocalApi(memory);
    // James Wilson is the house manager of Willow House.
    const hm = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_HM_USERNAME,
      password: DEMO_PASSWORD,
    });
    const willow = memory.db.sites.find((s) => s.name === "Willow House")!;
    const reese = memory.db.individuals.find((p) => p.siteId === willow.id)!;
    const draft = await api.addGerReport(gerDraftInput(willow.id, reese.id, severity));
    await api.submitGerReport(draft.id);

    const rows = memory.db.notifications.filter((n) => n.entityId === draft.id);
    assert.equal(rows.length, 3, `severity ${severity}: HM + PM + nurse alerts`);

    const direct = rows.find((n) => n.userId === hm.userId);
    assert.ok(direct, `severity ${severity}: home's HM gets a direct alert`);
    assert.equal(direct!.roleKey, null);
    assert.ok(direct!.title.startsWith(SEVERITY_LABEL[severity]));
    assert.ok(direct!.body.includes(`${severity} severity`));

    for (const roleKey of ["program_manager", "nurse"]) {
      const row = rows.find((n) => n.roleKey === roleKey);
      assert.ok(row, `severity ${severity}: ${roleKey} alerted`);
      assert.equal(row!.userId, null);
      assert.equal(row!.type, "incident.followup");
      assert.equal(row!.dedupeKey, `incident.followup:${draft.id}:${roleKey}`);
      assert.ok(row!.title.startsWith(SEVERITY_LABEL[severity]));
    }
  }
});

test("a high-severity submission keeps the escalation dedupe keys (no double-fire on resubmit)", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  const hm = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const willow = memory.db.sites.find((s) => s.name === "Willow House")!;
  const reese = memory.db.individuals.find((p) => p.siteId === willow.id)!;
  const draft = await api.addGerReport(gerDraftInput(willow.id, reese.id, "critical"));
  await api.submitGerReport(draft.id);
  const first = memory.db.notifications.filter((n) => n.entityId === draft.id);
  assert.equal(first.length, 3);

  // Reviewer returns it for corrections (Sarah Mitchell is an administrator).
  const admin = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  await api.reviewGerReport(draft.id, "return", "Add the witness statement.");
  assert.equal(admin.roleKey, "administrator");

  // Author resubmits — dedupe keys mean nobody is alerted twice.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  await api.submitGerReport(draft.id);
  const after = memory.db.notifications.filter((n) => n.entityId === draft.id);
  assert.equal(after.length, 3);
});

test("a home with no assigned HM falls back to the HM role broadcast", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  // Alex Morgan is a DSP at Cedar House, which has no house manager member
  // (Sarah Mitchell is the agency administrator there).
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const cedar = memory.db.sites.find((s) => s.name === "Cedar House")!;
  const ellis = memory.db.individuals.find((p) => p.siteId === cedar.id)!;
  const hmAtCedar = memory.db.memberships.filter(
    (m) => m.roleKey === "house_manager" && m.siteId === cedar.id,
  );
  assert.equal(hmAtCedar.length, 0);
  const draft = await api.addGerReport(gerDraftInput(cedar.id, ellis.id, "low"));
  await api.submitGerReport(draft.id);

  const rows = memory.db.notifications.filter((n) => n.entityId === draft.id);
  assert.equal(rows.length, 3);
  const broadcast = rows.find((n) => n.roleKey === "house_manager");
  assert.ok(broadcast, "HM role broadcast queued");
  assert.equal(broadcast!.userId, null);
  assert.ok(broadcast!.title.startsWith("Low"));
});

test("listSubmittedGerReports: admin sees every home, HMs see only their homes, others are refused", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  const willow = memory.db.sites.find((s) => s.name === "Willow House")!;
  const cedar = memory.db.sites.find((s) => s.name === "Cedar House")!;
  const reese = memory.db.individuals.find((p) => p.siteId === willow.id)!;
  const ellis = memory.db.individuals.find((p) => p.siteId === cedar.id)!;

  // One submitted report per home.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const willowDraft = await api.addGerReport(gerDraftInput(willow.id, reese.id, "moderate"));
  await api.submitGerReport(willowDraft.id);
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const cedarDraft = await api.addGerReport(gerDraftInput(cedar.id, ellis.id, "low"));
  await api.submitGerReport(cedarDraft.id);

  // Administrator: both homes, newest first, names resolved.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const all = await api.listSubmittedGerReports();
  assert.equal(all.length, 2);
  assert.ok(all.every((r) => r.status === "submitted"));
  assert.ok(all[0].individualName.length > 0 && all[0].siteName.length > 0);

  // House manager: only their own home.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const hmRows = await api.listSubmittedGerReports();
  assert.equal(hmRows.length, 1);
  assert.equal(hmRows[0].siteId, willow.id);
  assert.equal(hmRows[0].siteName, "Willow House");

  // DSP: no GER dashboard rows.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await assert.rejects(() => api.listSubmittedGerReports(), /Not authorized/);
});
