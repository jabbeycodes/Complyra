/**
 * dspScope.test.ts — DSP-ASSIGNED-SCOPE (founder ruling, 2026-10-31:
 * "DSPs only see what they are assigned"). Pins the selection-layer
 * scoping for every DSP-facing surface:
 *   1. Sites & programs — workspace sites are the DSP's assigned homes
 *      (membership home + active staff_assignments), nothing else.
 *   2. Consents — the register narrows to Individuals the DSP may read.
 *   3. Delegations — only delegations whose roster names the DSP (or
 *      that carry their signature record).
 *   4. Requirements — only requirements the DSP owns.
 *   5. Acknowledgments — only sheets carrying the DSP's signature row.
 *   6. Activity log — not a DSP surface at all (pageVisible refuses).
 *   7. Individuals — the PR #196 canReadIndividual model at workspace
 *      level: cross-home Individuals never reach a DSP workspace.
 *
 * Run: node --import tsx --test src/data/dspScope.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { packetsVisibleTo, requirementsVisibleTo, sitesVisibleTo } from "./dashboard";
import { scopeConsentRegister, type ConsentRegister } from "./consents";
import { delegationAssignedToUser, type ObligationItem, type ObligationView } from "./planStack";
import { pageVisible } from "./status";
import { blankDelegationForm, type PacketDetail, type SessionUser } from "./types";
import { createEvergreenSeed, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";

const pw = DEMO_PASSWORD;

function session(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: "dsp-1",
    email: "dsp@example.invalid",
    username: "dsp",
    fullName: "Casey Adams",
    jobTitle: "DSP",
    role: "dsp",
    roleKey: "dsp",
    agencyId: "agency-1",
    agencyName: "Agency",
    agencyCode: "AGENCY-MO",
    siteId: "willow",
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  };
}

const dsp = session({});
const hm = session({
  userId: "hm-1",
  username: "hm",
  fullName: "James Wilson",
  jobTitle: "House Manager",
  role: "manager",
  roleKey: "house_manager",
});

// ── 4. Requirements ─────────────────────────────────────────────────

test("requirementsVisibleTo: a DSP sees only requirements they own", () => {
  const rows = [
    { id: "r1", owner: "Casey Adams" },
    { id: "r2", owner: "Alex Morgan" },
    { id: "r3", owner: "Casey Adams" },
    { id: "r4", owner: "Unassigned" },
  ];
  assert.deepEqual(
    requirementsVisibleTo(dsp, rows).map((r) => r.id),
    ["r1", "r3"],
  );
});

test("requirementsVisibleTo: other roles keep the caller's list untouched", () => {
  const rows = [{ id: "r1", owner: "Alex Morgan" }];
  assert.equal(requirementsVisibleTo(hm, rows), rows);
});

// ── 5. Acknowledgments ──────────────────────────────────────────────

function packet(rowUserIds: string[]): PacketDetail {
  return {
    rows: rowUserIds.map((userId, i) => ({
      id: `row-${i}`,
      agencyId: "agency-1",
      packetId: "packet-1",
      userId,
      staffName: userId,
      addedManually: false,
      addReason: null,
      openedAt: null,
      signedAt: null,
      signatureName: null,
      signatureMark: null,
    })),
  } as unknown as PacketDetail;
}

test("packetsVisibleTo: a DSP sees only sheets carrying their own row", () => {
  const mine = packet(["hm-1", "dsp-1"]);
  const foreign = packet(["hm-1", "dsp-2"]);
  const empty = packet([]);
  assert.deepEqual(packetsVisibleTo(dsp, [mine, foreign, empty]), [mine]);
});

test("packetsVisibleTo: other roles keep every sheet", () => {
  const sheets = [packet(["dsp-2"]), packet([])];
  assert.equal(packetsVisibleTo(hm, sheets), sheets);
});

// ── 3. Delegations ──────────────────────────────────────────────────

function delegationView(roster: { printName: string; staffUserId?: string | null }[], mySignature: ObligationView["mySignature"] = null): ObligationView {
  const form = blankDelegationForm();
  form.roster = form.roster.map((row, i) => ({
    ...row,
    printName: roster[i]?.printName ?? "",
    staffUserId: roster[i]?.staffUserId ?? null,
  }));
  const item = {
    id: "ob-1",
    agencyId: "agency-1",
    individualId: "person-1",
    kind: "delegation",
    mode: "required",
    title: "PRN inhaler",
    detail: "",
    sourcePage: null,
    documentVersionId: null,
    enabled: true,
    frequency: "",
    shiftPeriods: [],
    expiresOn: null,
    createdFrom: "manual",
    inventoryState: "unchecked",
    proposed: false,
    delegatingRnUserId: null,
    rnSignedAt: "2026-01-01T00:00:00.000Z",
    rnSignatureName: "Nina Nurse",
    rnSignatureMark: null,
    discontinuedAt: null,
    discontinueFileId: null,
    discontinueTitle: null,
    delegationForm: form,
  } as ObligationItem;
  return { item, mySignature, signedCount: 0, assignedCount: 0 };
}

test("delegationAssignedToUser: roster row seeded with the DSP's user id", () => {
  const view = delegationView([{ printName: "Casey Adams", staffUserId: "dsp-1" }]);
  assert.equal(delegationAssignedToUser(view, dsp), true);
});

test("delegationAssignedToUser: hand-typed roster row keyed by printed name", () => {
  const view = delegationView([{ printName: "Casey Adams", staffUserId: null }]);
  assert.equal(delegationAssignedToUser(view, dsp), true);
});

test("delegationAssignedToUser: a signature record for the viewer counts", () => {
  const view = delegationView([], {
    id: "sig-1",
    agencyId: "agency-1",
    obligationId: "ob-1",
    userId: "dsp-1",
    staffName: "Casey Adams",
    openedAt: null,
    signedAt: null,
    signatureName: null,
    signatureMark: null,
  });
  assert.equal(delegationAssignedToUser(view, dsp), true);
});

test("delegationAssignedToUser: another DSP's delegation is not theirs", () => {
  const view = delegationView([{ printName: "Alex Morgan", staffUserId: "dsp-2" }]);
  assert.equal(delegationAssignedToUser(view, dsp), false);
});

test("delegationAssignedToUser: non-delegation items never match", () => {
  const view = delegationView([{ printName: "Casey Adams", staffUserId: "dsp-1" }]);
  (view.item as { kind: string }).kind = "pcsp";
  assert.equal(delegationAssignedToUser(view, dsp), false);
});

// ── 2. Consents ─────────────────────────────────────────────────────

test("scopeConsentRegister: cross-home Individuals, records and revocations drop out", () => {
  const register = {
    types: [],
    individuals: [
      { id: "p-willow", agencyId: "agency-1", siteId: "willow", fullName: "Harper Soto" },
      { id: "p-cedar", agencyId: "agency-1", siteId: "cedar", fullName: "Ellis Hart" },
    ],
    records: [
      { id: "c-willow", individualId: "p-willow" },
      { id: "c-cedar", individualId: "p-cedar" },
    ],
    revocations: [
      { consentId: "c-willow", revokedOn: "2026-01-01", revokedBy: "hm-1", revokedByName: "James Wilson", reason: "x" },
      { consentId: "c-cedar", revokedOn: "2026-01-01", revokedBy: "hm-1", revokedByName: "James Wilson", reason: "x" },
    ],
  } as unknown as ConsentRegister;
  const scoped = scopeConsentRegister(register, new Set(["p-willow"]));
  assert.deepEqual(scoped.individuals.map((p) => p.id), ["p-willow"]);
  assert.deepEqual(scoped.records.map((r) => r.id), ["c-willow"]);
  assert.deepEqual(scoped.revocations.map((v) => v.consentId), ["c-willow"]);
});

// ── 6. Activity log ─────────────────────────────────────────────────

test("pageVisible: DSPs do not get the Activity log, even with audit + people permissions", () => {
  const loaded = session({ permissions: { "individuals.view": true, "audit.read": true } });
  assert.equal(pageVisible(loaded, "Activity log"), false);
});

test("pageVisible: other roles keep the Activity log; DSP keeps Consents and Delegations", () => {
  const nurse = session({
    userId: "nurse-1",
    username: "nurse",
    fullName: "Cameron Price",
    jobTitle: "Nurse",
    role: "nurse",
    roleKey: "nurse",
    siteId: null,
    permissions: { "individuals.view": true },
  });
  assert.equal(pageVisible(nurse, "Activity log"), true);
  assert.equal(pageVisible(dsp, "Consents"), true);
  assert.equal(pageVisible(dsp, "Delegations"), true);
  assert.equal(pageVisible(dsp, "Sites & programs"), true);
});

// ── 1 + 7. Workspace integration (Evergreen demo, LocalApi) ────────

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

async function caseyApi(s: MemoryStore) {
  const api = new LocalApi(s);
  const casey = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "casey.adams",
    password: pw,
  });
  assert.equal(casey.roleKey, "dsp");
  return { api, casey };
}

test("workspace: a DSP's sites and Individuals are only their membership home", async () => {
  const s = store();
  const { api, casey } = await caseyApi(s);
  const workspace = await api.loadWorkspace(casey);
  assert.deepEqual(workspace.sites.map((site) => site.name), ["Willow House"]);
  assert.ok(workspace.individuals.length > 0);
  assert.ok(workspace.individuals.every((p) => p.site === "Willow House"));
  // sitesVisibleTo over the delivered workspace agrees (desktop + mobile).
  assert.deepEqual(
    sitesVisibleTo(casey, workspace.sites, workspace.staff, workspace.assignmentSiteIds).map((site) => site.name),
    ["Willow House"],
  );
});

test("workspace: an active assignment adds that home to a DSP's sites and Individuals", async () => {
  const s = store();
  const { api, casey } = await caseyApi(s);
  const cedar = s.db.sites.find((row) => row.name === "Cedar House")!;
  s.db.assignments.push({
    id: "asg-casey-cedar",
    agencyId: casey.agencyId,
    userId: casey.userId,
    individualId: null,
    siteId: cedar.id,
    startsOn: "2026-01-01",
    endsOn: null,
  });
  const workspace = await api.loadWorkspace(casey);
  assert.deepEqual(
    workspace.sites.map((site) => site.name).sort(),
    ["Cedar House", "Willow House"],
  );
  assert.ok(workspace.assignmentSiteIds.includes(cedar.id));
  assert.ok(workspace.individuals.some((p) => p.site === "Cedar House"));
  // An ended assignment does not add the home.
  const s2 = store();
  const second = await caseyApi(s2);
  const cedar2 = s2.db.sites.find((row) => row.name === "Cedar House")!;
  s2.db.assignments.push({
    id: "asg-casey-cedar-ended",
    agencyId: second.casey.agencyId,
    userId: second.casey.userId,
    individualId: null,
    siteId: cedar2.id,
    startsOn: "2026-01-01",
    endsOn: "2026-06-01",
  });
  const workspace2 = await second.api.loadWorkspace(second.casey);
  assert.deepEqual(workspace2.sites.map((site) => site.name), ["Willow House"]);
});

test("workspace: a DSP's consent register holds only their homes' Individuals", async () => {
  const s = store();
  const { api, casey } = await caseyApi(s);
  const register = await api.getConsents();
  const workspace = await api.loadWorkspace(casey);
  const readable = new Set(workspace.individuals.map((p) => p.id));
  assert.ok(register.individuals.length > 0);
  assert.ok(register.individuals.every((p) => readable.has(p.id)));
  assert.ok(register.records.every((r) => readable.has(r.individualId)));
});

test("workspace: acknowledgment sheets narrow to a DSP's own rows; an admin's do not", async () => {
  const s = store();
  const { api, casey } = await caseyApi(s);
  // The seed's one sheet (Ellis Hart's) carries Alex Morgan's row, not
  // Casey Adams's — so over that sheet Casey must see nothing and Alex
  // must see it.
  const alex = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "alex.morgan",
    password: pw,
  });
  const alexWorkspace = await api.loadWorkspace(alex);
  assert.ok(alexWorkspace.packets.length > 0);
  assert.ok(
    alexWorkspace.packets.every((p) => p.rows.some((row) => row.userId === alex.userId)),
  );
  assert.deepEqual(packetsVisibleTo(alex, alexWorkspace.packets), alexWorkspace.packets);
  assert.deepEqual(packetsVisibleTo(casey, alexWorkspace.packets), []);
  // Non-DSP sessions get the list back untouched.
  const admin = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "sarah.mitchell",
    password: pw,
  });
  const adminWorkspace = await api.loadWorkspace(admin);
  assert.equal(packetsVisibleTo(admin, adminWorkspace.packets), adminWorkspace.packets);
});
