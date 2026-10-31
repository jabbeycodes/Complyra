/**
 * delegationScope.test.ts — simulation batch 10 regression: an RN whose
 * homes come from staff_assignments (NULL membership site) was refused
 * delegation creation at BOTH assigned sites ("Choose an individual at a
 * site you can manage.") because createDelegation gated on the
 * membership-home-only canAccessSite. The gate now mirrors
 * private.can_read_site (canActAtSite), and the create form can name
 * recipient DSPs, validated against the DSP scope rule.
 *
 * Run: node --import tsx --test src/data/delegationScope.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { canActAtSite, dspScopeCoversIndividual } from "./access";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
} from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";

const pw = DEMO_PASSWORD;

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: pw };
}

const NURSE_ID = "00000000-0000-4000-8000-0000000000n1";
const NURSE_USERNAME = "nadia.nurse";

/** Seed a nurse with a NULL membership site (the sim's Morgan Quinn shape). */
function seedAssignmentNurse(s: MemoryStore, agencyId: string) {
  s.db.profiles.push({
    id: NURSE_ID,
    fullName: "Nadia Nurse",
    email: "nadia.nurse@demo.complyrer.user",
    jobTitle: "Registered Nurse",
    username: NURSE_USERNAME,
    homeAgencyId: agencyId,
    mustChangePassword: false,
  });
  s.db.memberships.push({
    id: "00000000-0000-4000-8000-0000000000n1m",
    agencyId,
    userId: NURSE_ID,
    role: "nurse",
    roleKey: "nurse",
    siteId: null,
    expiresOn: null,
  });
  s.db.credentials.push({
    userId: NURSE_ID,
    email: "nadia.nurse@demo.complyrer.user",
    password: pw,
  });
}

function assignSite(
  s: MemoryStore,
  agencyId: string,
  userId: string,
  siteId: string,
  overrides: Partial<{ startsOn: string; endsOn: string | null }> = {},
) {
  s.db.assignments.push({
    id: `asg-${userId}-${siteId}`,
    agencyId,
    userId,
    individualId: null,
    siteId,
    startsOn: overrides.startsOn ?? "2026-01-01",
    endsOn: overrides.endsOn ?? null,
  });
}

function siteId(s: MemoryStore, name: string): string {
  return s.db.sites.find((row) => row.name === name)!.id;
}

function personId(s: MemoryStore, name: string): string {
  return s.db.individuals.find((row) => row.fullName === name)!.id;
}

function dspAtSite(s: MemoryStore, agencyId: string, site: string): string {
  const m = s.db.memberships.find(
    (row) => row.agencyId === agencyId && row.roleKey === "dsp" && row.siteId === site,
  );
  assert.ok(m, `a DSP membership exists at ${site}`);
  return m.userId;
}

async function nurseApi(s: MemoryStore) {
  const api = new LocalApi(s);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  seedAssignmentNurse(s, admin.agencyId);
  await api.signOut();
  const session = await api.signIn(login(NURSE_USERNAME));
  assert.equal(session.roleKey, "nurse");
  assert.equal(session.siteId, null);
  return { api, session, agencyId: admin.agencyId };
}

test("assignment nurse creates a delegation at her assigned site (batch 10 repro)", async () => {
  const s = store();
  const { api, session, agencyId } = await nurseApi(s);
  assignSite(s, agencyId, NURSE_ID, siteId(s, "Cedar House"));

  const { id } = await api.createDelegation({
    individualId: personId(s, "Ellis Hart"),
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    purpose: "Keep inhaler use safe.",
  });
  assert.ok(id);
  const workspace = await api.loadWorkspace(session);
  const item = workspace.planStacks
    .flatMap((stack) => stack.required)
    .find((view) => view.item.id === id)?.item;
  assert.equal(item?.kind, "delegation");
});

test("assignment nurse is refused at a site she is not assigned to", async () => {
  const s = store();
  const { api, agencyId } = await nurseApi(s);
  assignSite(s, agencyId, NURSE_ID, siteId(s, "Cedar House"));

  await assert.rejects(
    () =>
      api.createDelegation({
        individualId: personId(s, "Harper Soto"),
        taskTitle: "Blood sugar monitoring",
        purpose: "Track readings.",
      }),
    /outside your assigned access|site you can manage/,
  );
});

test("nurse with no assignments and no membership home is refused everywhere", async () => {
  const s = store();
  const { api } = await nurseApi(s);
  await assert.rejects(
    () =>
      api.createDelegation({
        individualId: personId(s, "Ellis Hart"),
        taskTitle: "Blood sugar monitoring",
        purpose: "Track readings.",
      }),
    /outside your assigned access|site you can manage/,
  );
  await assert.rejects(
    () => api.listDelegationRecipients(personId(s, "Ellis Hart")),
    /site you can manage/,
  );
});

test("recipient list holds only DSPs who cover the Individual's site", async () => {
  const s = store();
  const { api, agencyId } = await nurseApi(s);
  assignSite(s, agencyId, NURSE_ID, siteId(s, "Cedar House"));

  const cedarDsp = dspAtSite(s, agencyId, siteId(s, "Cedar House"));
  const willowDsp = dspAtSite(s, agencyId, siteId(s, "Willow House"));
  const recipients = await api.listDelegationRecipients(personId(s, "Ellis Hart"));
  const ids = recipients.map((row) => row.userId);
  assert.ok(ids.includes(cedarDsp), "home-site DSP is offered");
  assert.ok(!ids.includes(willowDsp), "other-site DSP is not offered");
});

test("chosen recipients land on the form roster; other-site DSPs are rejected", async () => {
  const s = store();
  const { api, session, agencyId } = await nurseApi(s);
  assignSite(s, agencyId, NURSE_ID, siteId(s, "Cedar House"));
  const cedarDsp = dspAtSite(s, agencyId, siteId(s, "Cedar House"));
  const willowDsp = dspAtSite(s, agencyId, siteId(s, "Willow House"));
  const cedarDspName = s.db.profiles.find((p) => p.id === cedarDsp)!.fullName;

  const { id } = await api.createDelegation({
    individualId: personId(s, "Ellis Hart"),
    taskTitle: "Fall prevention",
    purpose: "Keep transfers safe.",
    recipientUserIds: [cedarDsp],
  });
  const workspace = await api.loadWorkspace(session);
  const item = workspace.planStacks
    .flatMap((stack) => stack.required)
    .find((view) => view.item.id === id)!.item;
  assert.equal(item.delegationForm?.roster[0].printName, cedarDspName);
  assert.equal(item.delegationForm?.roster[0].staffUserId, cedarDsp);
  assert.equal(item.delegationForm?.roster[1].printName, "");

  await assert.rejects(
    () =>
      api.createDelegation({
        individualId: personId(s, "Ellis Hart"),
        taskTitle: "Fall prevention",
        purpose: "Keep transfers safe.",
        recipientUserIds: [willowDsp],
      }),
    /Choose recipients from the staff who work at this individual's site/,
  );
});

test("canActAtSite mirrors can_read_site's assignment branch", () => {
  const today = "2026-09-25";
  const nurse = {
    userId: "nurse-1",
    agencyId: "agency-1",
    siteId: null,
    roleKey: "nurse",
  } as SessionUser;
  const people = [
    { id: "maya", siteId: "lawton" },
    { id: "casey", siteId: "cedar" },
  ];
  const base = {
    id: "a-1",
    agencyId: "agency-1",
    userId: "nurse-1",
    individualId: null,
    siteId: null as string | null,
    startsOn: "2026-01-01",
    endsOn: null as string | null,
  };
  // Site assignment covers the site; the other site stays out of reach.
  assert.equal(
    canActAtSite(nurse, "lawton", [{ ...base, siteId: "lawton" }], people, today),
    true,
  );
  assert.equal(
    canActAtSite(nurse, "cedar", [{ ...base, siteId: "lawton" }], people, today),
    false,
  );
  // An assignment to an Individual covers that Individual's site.
  assert.equal(
    canActAtSite(nurse, "cedar", [{ ...base, individualId: "casey" }], people, today),
    true,
  );
  // Ended and not-yet-started assignments do not cover.
  assert.equal(
    canActAtSite(
      nurse,
      "lawton",
      [{ ...base, siteId: "lawton", endsOn: "2026-09-24" }],
      people,
      today,
    ),
    false,
  );
  assert.equal(
    canActAtSite(
      nurse,
      "lawton",
      [{ ...base, siteId: "lawton", startsOn: "2026-10-01" }],
      people,
      today,
    ),
    false,
  );
  // A NULL membership site alone never implies coverage.
  assert.equal(canActAtSite(nurse, "lawton", [], people, today), false);
});

test("dspScopeCoversIndividual: home site, Individual assignment, site assignment", () => {
  const today = "2026-09-25";
  const person = { id: "maya", agencyId: "agency-1", siteId: "lawton" };
  const people = [person, { id: "casey", siteId: "cedar" }];
  const dsp = { userId: "dsp-1", agencyId: "agency-1", siteId: null as string | null };
  const base = {
    id: "a-1",
    agencyId: "agency-1",
    userId: "dsp-1",
    individualId: null as string | null,
    siteId: null as string | null,
    startsOn: "2026-01-01",
    endsOn: null as string | null,
  };
  assert.equal(dspScopeCoversIndividual(dsp, person, [], people, today), false);
  assert.equal(
    dspScopeCoversIndividual({ ...dsp, siteId: "lawton" }, person, [], people, today),
    true,
  );
  assert.equal(
    dspScopeCoversIndividual(dsp, person, [{ ...base, individualId: "maya" }], people, today),
    true,
  );
  assert.equal(
    dspScopeCoversIndividual(dsp, person, [{ ...base, siteId: "lawton" }], people, today),
    true,
  );
  assert.equal(
    dspScopeCoversIndividual(dsp, person, [{ ...base, siteId: "cedar" }], people, today),
    false,
  );
});
