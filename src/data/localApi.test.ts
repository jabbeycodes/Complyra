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
  assert.equal(soon.length, 2, "expired + 30-day certs, not the 400-day one");
  assert.equal(soon[0].daysRemaining <= 0, true);
  assert.equal(soon[0].staffName.length > 0, true);
  assert.equal(soon[1].daysRemaining <= 30, true);

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
