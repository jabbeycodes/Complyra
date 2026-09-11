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
        agencyCode: "evergreen-mo",
        username: "sarah.mitchell",
        password: "wrong",
      }),
    new RegExp(LOGIN_FAILED_MESSAGE),
  );
  const admin = await api.signIn(adminLogin());
  assert.equal(admin.mustChangePassword, false);
  assert.equal(admin.agencyCode, "evergreen-mo");
  const invited = await api.inviteMember({
    fullName: "Jordan Blake",
    username: "jordan.blake",
    tempPassword: "TempPass!1",
    role: "dsp",
    jobTitle: "DSP",
  });
  assert.equal(invited.agencyCode, "evergreen-mo");
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
  assert.equal(created.agencyCode, "lpmm-ca");
  const admin = await api.signIn({
    agencyCode: "LPMM-CA",
    username: "casey.nguyen",
    password: "TempPass!1",
  });
  assert.equal(admin.mustChangePassword, true);
  assert.equal(admin.agencyCode, "lpmm-ca");
  const workspace = await api.loadWorkspace(admin);
  assert.equal(workspace.individuals.length, 0);
  assert.equal(workspace.staff.length, 1);
  assert.equal(workspace.staff[0].name, "Casey Nguyen");
});
