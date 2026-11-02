/**
 * WAVE-7V (founder decision, 2026-11-02; sim batches 157/158/171/184):
 * compliance_admin is READ-AND-AUDIT by default.
 *
 * Pins:
 *  1. The TS default template's true-key set is EXACTLY the founder keep
 *     list (PermissionKey subset; the founder list's `isp.view` is not a
 *     canonical permission key — no code reads it).
 *  2. pageVisible outcomes for a compliance session under the narrowed
 *     template: the oversight surfaces it used to reach through write
 *     keys (Staff, Certificates, Review queue, Training) stay visible via
 *     canReadAsCompliance; Roles & access and Checklist assignments close;
 *     designed exclusions (Consents) and designed keeps (Weekly checklist
 *     oversight, Messages, Audit center) are unchanged.
 *  3. LocalApi: a compliance session is refused the removed WRITE powers
 *     (checklist assign + rollover, invite, assign role, document upload,
 *     certificate write) while its READS keep working; the administrator
 *     is unaffected.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";
import {
  PERMISSION_KEYS,
  ROLE_TEMPLATE_BY_KEY,
  defaultPermissions,
  type PermissionMap,
} from "./permissions";
import { pageVisible } from "./status";

const COMPLIANCE_USERNAME = "omar.haddad";

/** The founder keep list (2026-11-02), PermissionKey subset. */
const FOUNDER_KEEP_KEYS = [
  "audit.read",
  "audit.export",
  "individuals.view",
  "documents.view",
  "documents.review",
  "clinical.view",
  "delegation.templates.view",
  "hub.access",
  "messages.use",
  "mileage.manage",
  "acknowledgments.sign_own",
  "recognition.view_winners",
  "ger.review",
  "ger.resolve",
  "requirements.complete",
].sort();

function complianceSession(permissions: PermissionMap): SessionUser {
  return {
    userId: "compliance-user",
    email: "omar.haddad@example.invalid",
    fullName: "Omar Haddad",
    username: COMPLIANCE_USERNAME,
    jobTitle: "Compliance administrator",
    role: "compliance_admin",
    roleKey: "compliance_admin",
    agencyId: "agency-1",
    agencyCode: "EVERGREEN-MO",
    agencyName: "Evergreen Care",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions,
    platformAdmin: false,
    agencyStatus: "active",
  };
}

/** The pre-7V fat compliance map (all but hr.view_staff, qa.*, hub.* minus hub.access). */
function legacyCompliancePermissions(): PermissionMap {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key,
      !(
        key === "hr.view_staff" ||
        key.startsWith("qa.") ||
        (key.startsWith("hub.") && key !== "hub.access")
      ),
    ]),
  ) as PermissionMap;
}

test("7V: compliance_admin default template true-keys equal the founder keep list exactly", () => {
  const map = ROLE_TEMPLATE_BY_KEY.compliance_admin.permissions;
  const trueKeys = PERMISSION_KEYS.filter((key) => map[key]).sort();
  assert.deepEqual(trueKeys, FOUNDER_KEEP_KEYS);
});

test("7V: pageVisible — compliance keeps its oversight pages via the read path", () => {
  const session = complianceSession(defaultPermissions("compliance_admin"));
  // Read surfaces (before: via write keys; after: via canReadAsCompliance).
  for (const page of ["Staff", "Certificates", "Review queue", "Training"]) {
    assert.equal(pageVisible(session, page), true, `${page} stays visible (read-only)`);
  }
  // Designed keeps and oversight surfaces.
  for (const page of ["Audit center", "Audit Me", "Individuals", "Documents", "Messages", "Employee Hub", "Delegations", "Weekly checklist", "Activity log", "Acknowledgments", "QA Review", "Report Library", "Mileage"]) {
    assert.equal(pageVisible(session, page), true, `${page} stays visible`);
  }
  // Closed by the narrowing.
  for (const page of ["Roles & access", "Checklist assignments", "Document upload", "Intake", "Scheduling"]) {
    assert.equal(pageVisible(session, page), false, `${page} is closed to compliance`);
  }
  // Designed exclusion (founder, 2026-10-30): compliance never sees Consents.
  assert.equal(pageVisible(session, "Consents"), false, "Consents stays excluded by design");
});

test("7V: pageVisible — before/after on the write-key surfaces", () => {
  const before = complianceSession(legacyCompliancePermissions());
  const after = complianceSession(defaultPermissions("compliance_admin"));
  // Visible before (through write keys) AND after (through the read path).
  for (const page of ["Staff", "Certificates", "Review queue"]) {
    assert.equal(pageVisible(before, page), true, `${page}: visible before`);
    assert.equal(pageVisible(after, page), true, `${page}: visible after (read path)`);
  }
  // Roles & access flips: open before (roles.manage), closed after.
  assert.equal(pageVisible(before, "Roles & access"), true, "Roles & access: open before");
  assert.equal(pageVisible(after, "Roles & access"), false, "Roles & access: closed after");
});

test("7V: the compliance read path requires role AND audit.read, and widens no one else", () => {
  // Compliance role with audit.read stripped (agency customized it off):
  // the write-key surfaces close — the predicate is not a role-only pass.
  const stripped = defaultPermissions("compliance_admin");
  stripped["audit.read"] = false;
  const strippedSession = complianceSession(stripped);
  for (const page of ["Staff", "Certificates", "Review queue"]) {
    assert.equal(pageVisible(strippedSession, page), false, `${page}: closed without audit.read`);
  }
  // Another role holding audit.read gains nothing from the predicate.
  const nurse = {
    ...complianceSession(defaultPermissions("nurse")),
    role: "nurse",
    roleKey: "nurse",
  } as SessionUser;
  assert.equal(pageVisible(nurse, "Staff"), false, "nurse gains no Staff access");
  assert.equal(pageVisible(nurse, "Certificates"), false, "nurse gains no Certificates access");
});

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function apiAs(username: string) {
  const shared = store();
  const api = new LocalApi(shared);
  const session = await api.signIn(login(username));
  const workspace = await api.loadWorkspace(session);
  return { api, session, workspace };
}

test("7V: LocalApi refuses compliance's removed write powers", async () => {
  const { api, workspace } = await apiAs(COMPLIANCE_USERNAME);
  const site = workspace.sites[0];
  const hm = workspace.staff.find((person) => person.roleKey === "house_manager");
  assert.ok(site && hm, "demo site and HM exist");

  await assert.rejects(
    () => api.assignWeeklyChecklist({ siteId: site.id, hmUserId: hm.id, weekOf: "2026-11-01" }),
    /Only a PM or agency administrator can assign weekly checklists/,
  );
  await assert.rejects(
    () => api.rolloverWeeklyChecklists(),
    /Only a PM or agency administrator can run the weekly rollover/,
  );
  await assert.rejects(
    () =>
      api.inviteMember({
        fullName: "New Person",
        username: "new.person",
        tempPassword: "TempPass!1",
        roleKey: "dsp",
        jobTitle: "DSP",
      }),
    /do not have permission/,
  );
  await assert.rejects(
    () => api.assignMemberRole(hm.id, "dsp"),
    /do not have permission/,
  );
  const individual = workspace.individuals[0];
  assert.ok(individual, "demo individual exists");
  await assert.rejects(
    () =>
      api.uploadDocument({
        individualId: individual.id,
        file: new File(["x"], "plan.pdf", { type: "application/pdf" }),
        pageCount: 1,
        effectiveOn: "2026-11-01",
      }),
    /do not have permission/,
  );
  await assert.rejects(
    () =>
      api.addCertificate({
        userId: hm.id,
        certName: "CPR",
        issuedOn: "2026-01-01",
        expiresOn: "2027-01-01",
      }),
    /do not have permission/,
  );
});

test("7V: LocalApi keeps compliance's reads working", async () => {
  const { api, workspace } = await apiAs(COMPLIANCE_USERNAME);
  const dsp = workspace.staff.find((person) => person.username === DEMO_DSP_USERNAME);
  assert.ok(dsp, "demo DSP exists");
  const roster = await api.listStaffNeedingClearance();
  assert.ok(roster.length > 0, "training roster readable");
  const profile = await api.getStaffTrainingProfile(dsp.id);
  assert.equal(profile.userId, dsp.id, "cross-profile training read works");
  const certs = await api.listCertificates(dsp.id);
  assert.ok(Array.isArray(certs), "certificate reads work");
  const soon = await api.certificatesExpiringSoon(90);
  assert.ok(Array.isArray(soon), "certificate expiry reads work");
  // Oversight read of weekly checklists still works (not an assigner path).
  const lists = await api.listWeeklyChecklists();
  assert.ok(Array.isArray(lists), "weekly checklist oversight read works");
});

test("7V: the administrator is unaffected (assign + invite still work)", async () => {
  const { api, workspace } = await apiAs(DEMO_ADMIN_USERNAME);
  const site = workspace.sites[0];
  const hm = workspace.staff.find((person) => person.roleKey === "house_manager");
  assert.ok(site && hm, "demo site and HM exist");
  const created = await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hm.id,
    weekOf: "2027-01-03",
  });
  assert.ok(created.id, "admin can still assign checklists");
  const invited = await api.inviteMember({
    fullName: "Admin Invited",
    username: "admin.invited",
    tempPassword: "TempPass!1",
    roleKey: "dsp",
    jobTitle: "DSP",
  });
  assert.ok(invited.username, "admin can still invite members");
});
