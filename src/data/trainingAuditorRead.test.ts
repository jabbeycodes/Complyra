/**
 * AUDITOR-NAV (wave 7U, sim batches 159/172): API-level pins for the
 * auditor's read path in LocalApi.
 *
 * The nav fix (pageVisible) opens Delegations/Training/Staff/Certificates/
 * Review queue to the auditor, but two of those pages read through
 * permission asserts that were keyed on write-ish permissions:
 *  - Training roster + cross-profile training reads asserted hr.view_staff.
 *  - Certificate reads asserted certificates.manage || hr.view_staff.
 * Both now also admit canReadAsAuditor (auditor role + audit.read). Every
 * WRITE on those surfaces keeps its original gate — the auditor must still
 * be refused by assign/initial/waive and by certificate writes.
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
import { DEMO_PASSWORD } from "./types";

const AUDITOR_USERNAME = "mark.delaney";
const HR_USERNAME = "tanya.brooks";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function apiAs(username: string) {
  return apiAsOn(store(), username);
}

async function apiAsOn(shared: MemoryStore, username: string) {
  const api = new LocalApi(shared);
  const session = await api.signIn(login(username));
  const workspace = await api.loadWorkspace(session);
  const dsp = workspace.staff.find((person) => person.username === DEMO_DSP_USERNAME);
  assert.ok(dsp, "demo DSP exists");
  return { api, session, workspace, dspId: dsp.id };
}

test("auditor can read the training roster and another staffer's training profile", async () => {
  const { api, dspId } = await apiAs(AUDITOR_USERNAME);
  const rows = await api.listStaffNeedingClearance();
  assert.ok(rows.length > 0, "roster should list agency staff");
  assert.ok(rows.some((row) => row.userId === dspId), "roster includes the demo DSP");
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.equal(profile.userId, dspId);
});

test("auditor can read certificates but cannot write them", async () => {
  const { api, dspId } = await apiAs(AUDITOR_USERNAME);
  // Reads resolve (possibly empty lists) instead of throwing the gate error.
  const certs = await api.listCertificates(dspId);
  assert.ok(Array.isArray(certs));
  const soon = await api.certificatesExpiringSoon(90);
  assert.ok(Array.isArray(soon));
  // Writes stay behind certificates.manage — the auditor must be refused.
  await assert.rejects(
    () =>
      api.addCertificate({
        userId: dspId,
        certName: "CPR",
        issuedOn: "2026-01-01",
        expiresOn: "2027-01-01",
      }),
    /do not have permission/,
  );
});

test("auditor training writes stay refused (assign / waive / initial)", async () => {
  // One shared store: an admin assigns the DSP a real checklist first, so the
  // initial-line attempt hits the permission gate on a line that exists.
  const shared = store();
  const admin = new LocalApi(shared);
  const adminSession = await admin.signIn(login(DEMO_ADMIN_USERNAME));
  const adminWorkspace = await admin.loadWorkspace(adminSession);
  const dsp = adminWorkspace.staff.find((person) => person.username === DEMO_DSP_USERNAME);
  assert.ok(dsp, "demo DSP exists");
  const siteId = adminWorkspace.sites[0].id;
  const created = await admin.assignTraining({ userId: dsp.id, siteId, source: "checklist" });
  assert.ok(created.length > 0, "checklist assigned");

  const { api } = await apiAsOn(shared, AUDITOR_USERNAME);
  await assert.rejects(
    () => api.assignTraining({ userId: dsp.id, siteId, source: "checklist" }),
    /do not have permission/,
  );
  await assert.rejects(
    () => api.waiveRequirementLine(created[0].id, "reason"),
    /do not have permission/,
  );
  await assert.rejects(
    () =>
      api.initialRequirementLine(created[0].id, {
        initials: "MD",
        trainerUserId: dsp.id,
        method: "classroom",
        hoursTotal: 1,
        hoursWithHm: 0,
        signedOn: "2026-11-02",
      }),
    /do not have permission/,
  );
});

test("a DSP still cannot read the roster, other profiles, or certificates", async () => {
  const { api, workspace } = await apiAs(DEMO_DSP_USERNAME);
  const other = workspace.staff.find((person) => person.username === "casey.adams") ??
    workspace.staff.find((person) => person.username !== DEMO_DSP_USERNAME);
  assert.ok(other, "another staff member exists");
  await assert.rejects(() => api.listStaffNeedingClearance(), /do not have permission/);
  await assert.rejects(() => api.getStaffTrainingProfile(other.id), /do not have permission/);
  await assert.rejects(() => api.listCertificates(other.id), /do not have permission/);
});

test("HR roster and certificate reads still work (no regression)", async () => {
  const { api, dspId } = await apiAs(HR_USERNAME);
  const rows = await api.listStaffNeedingClearance();
  assert.ok(rows.some((row) => row.userId === dspId));
  const profile = await api.getStaffTrainingProfile(dspId);
  assert.equal(profile.userId, dspId);
  const certs = await api.listCertificates(dspId);
  assert.ok(Array.isArray(certs));
});
