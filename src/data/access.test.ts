import { test } from "node:test";
import assert from "node:assert/strict";
import { canReadIndividual } from "./access";
import type { SessionUser, StaffAssignment } from "./types";

const dsp: SessionUser = {
  userId: "dsp-1",
  email: "dsp@example.invalid",
  username: "dsp",
  fullName: "Alex DSP",
  jobTitle: "DSP",
  role: "dsp",
  roleKey: "dsp",
  agencyId: "agency-1",
  agencyName: "Agency",
  agencyCode: "AGENCY-MO",
  siteId: null,
  mustChangePassword: false,
  expiresOn: null,
  permissions: { "individuals.view": true },
  platformAdmin: false,
  agencyStatus: "active",
};

const people = [
  { id: "maya", agencyId: "agency-1", siteId: "lawton" },
  { id: "jordan", agencyId: "agency-1", siteId: "lawton" },
  { id: "casey", agencyId: "agency-1", siteId: "cedar" },
];

function assignment(overrides: Partial<StaffAssignment>): StaffAssignment {
  return {
    id: "a-1",
    agencyId: "agency-1",
    userId: "dsp-1",
    individualId: null,
    siteId: null,
    startsOn: "2026-01-01",
    endsOn: null,
    ...overrides,
  };
}

const today = "2026-09-25";

test("a DSP assigned to one Individual can read their housemates at the same site", () => {
  const assignments = [assignment({ individualId: "maya" })];
  assert.equal(canReadIndividual(dsp, people[0], assignments, people, today), true);
  assert.equal(canReadIndividual(dsp, people[1], assignments, people, today), true);
});

test("a DSP cannot read Individuals at another site", () => {
  const assignments = [assignment({ individualId: "maya" })];
  assert.equal(canReadIndividual(dsp, people[2], assignments, people, today), false);
});

test("a site assignment covers every Individual at that site", () => {
  const assignments = [assignment({ siteId: "lawton" })];
  assert.equal(canReadIndividual(dsp, people[1], assignments, people, today), true);
  assert.equal(canReadIndividual(dsp, people[2], assignments, people, today), false);
});

test("reassignment does not end access to a site the DSP worked at", () => {
  const assignments = [
    assignment({ individualId: "maya", endsOn: "2026-09-24" }),
    assignment({ id: "a-2", individualId: "casey", startsOn: "2026-09-25" }),
  ];
  assert.equal(canReadIndividual(dsp, people[0], assignments, people, today), true);
  assert.equal(canReadIndividual(dsp, people[1], assignments, people, today), true);
  assert.equal(canReadIndividual(dsp, people[2], assignments, people, today), true);
});

test("an assignment that hasn't started yet gives no access", () => {
  const assignments = [assignment({ individualId: "maya", startsOn: "2026-10-01" })];
  assert.equal(canReadIndividual(dsp, people[0], assignments, people, today), false);
});

test("another DSP's assignment gives no access", () => {
  const assignments = [assignment({ userId: "dsp-2", individualId: "maya" })];
  assert.equal(canReadIndividual(dsp, people[1], assignments, people, today), false);
});

test("a DSP reads Individuals at the home site named on their membership, with no assignments", () => {
  const homeDsp: SessionUser = { ...dsp, siteId: "lawton" };
  assert.equal(canReadIndividual(homeDsp, people[0], [], people, today), true);
  assert.equal(canReadIndividual(homeDsp, people[1], [], people, today), true);
});

test("a DSP cannot read Individuals at another site on membership scope alone", () => {
  const homeDsp: SessionUser = { ...dsp, siteId: "lawton" };
  assert.equal(canReadIndividual(homeDsp, people[2], [], people, today), false);
});

test("a DSP with a membership home can still read an assigned Individual at another site", () => {
  const homeDsp: SessionUser = { ...dsp, siteId: "lawton" };
  const assignments = [assignment({ individualId: "casey" })];
  assert.equal(canReadIndividual(homeDsp, people[2], assignments, people, today), true);
  assert.equal(canReadIndividual(homeDsp, people[0], assignments, people, today), true);
});

test("a DSP with no membership home and no assignments reads nobody", () => {
  assert.equal(canReadIndividual(dsp, people[0], [], people, today), false);
  assert.equal(canReadIndividual(dsp, people[2], [], people, today), false);
});

const nurse: SessionUser = {
  ...dsp,
  userId: "nurse-1",
  email: "nurse@example.invalid",
  username: "nurse",
  fullName: "Nina Nurse",
  jobTitle: "Nurse",
  role: "nurse",
  roleKey: "nurse",
};

test("a nurse reads Individuals at a site a site assignment places her at, and not the other site", () => {
  const assignments = [assignment({ userId: "nurse-1", siteId: "lawton" })];
  assert.equal(canReadIndividual(nurse, people[0], assignments, people, today), true);
  assert.equal(canReadIndividual(nurse, people[1], assignments, people, today), true);
  assert.equal(canReadIndividual(nurse, people[2], assignments, people, today), false);
});

test("a nurse reads Individuals at the site of an Individual assignment, including housemates", () => {
  const assignments = [assignment({ userId: "nurse-1", individualId: "casey" })];
  assert.equal(canReadIndividual(nurse, people[2], assignments, people, today), true);
  assert.equal(canReadIndividual(nurse, people[0], assignments, people, today), false);
});

test("a nurse with no membership home and no assignments reads nobody", () => {
  // Pins the therap nurse model: caseload access is never inferred
  // from a NULL membership site.
  assert.equal(canReadIndividual(nurse, people[0], [], people, today), false);
  assert.equal(canReadIndividual(nurse, people[2], [], people, today), false);
});

test("a house manager reads Individuals at an assigned site beyond their membership home", () => {
  const hm: SessionUser = {
    ...nurse,
    userId: "hm-1",
    username: "hm",
    fullName: "Hana Manager",
    jobTitle: "House Manager",
    role: "manager",
    roleKey: "house_manager",
    siteId: "lawton",
  };
  const assignments = [assignment({ userId: "hm-1", siteId: "cedar" })];
  assert.equal(canReadIndividual(hm, people[0], assignments, people, today), true);
  assert.equal(canReadIndividual(hm, people[2], assignments, people, today), true);
  const unassigned: SessionUser = { ...hm, siteId: null };
  assert.equal(canReadIndividual(unassigned, people[0], [], people, today), false);
});

test("an ended nurse assignment no longer grants caseload access", () => {
  // Parity with hosted private.can_read_site, whose assignment branch
  // requires ends_on IS NULL OR ends_on >= current_date. (DSPs differ
  // by design: their access survives reassignment so they can correct
  // their own notes — see "reassignment does not end access" above.)
  const endedSite = [assignment({ userId: "nurse-1", siteId: "lawton", endsOn: "2026-09-24" })];
  assert.equal(canReadIndividual(nurse, people[0], endedSite, people, today), false);
  const endedIndividual = [assignment({ userId: "nurse-1", individualId: "casey", endsOn: "2026-09-24" })];
  assert.equal(canReadIndividual(nurse, people[2], endedIndividual, people, today), false);
  // An assignment ending today is still active today.
  const endsToday = [assignment({ userId: "nurse-1", siteId: "lawton", endsOn: today })];
  assert.equal(canReadIndividual(nurse, people[0], endsToday, people, today), true);
});

test("an ended house-manager assignment no longer grants caseload access", () => {
  const hm: SessionUser = {
    ...nurse,
    userId: "hm-1",
    username: "hm",
    fullName: "Hana Manager",
    jobTitle: "House Manager",
    role: "manager",
    roleKey: "house_manager",
    siteId: null,
  };
  const ended = [assignment({ userId: "hm-1", siteId: "cedar", endsOn: "2026-09-24" })];
  assert.equal(canReadIndividual(hm, people[2], ended, people, today), false);
  const active = [assignment({ userId: "hm-1", siteId: "cedar" })];
  assert.equal(canReadIndividual(hm, people[2], active, people, today), true);
});

test("DSPs correct only MAR entries they recorded; managers and nurses correct any", async () => {
  const { canCorrectDoseMark } = await import("./chart");
  assert.equal(canCorrectDoseMark("dsp", "dsp-1", { markedBy: "dsp-1" }), true);
  assert.equal(canCorrectDoseMark("dsp", "dsp-1", { markedBy: "dsp-2" }), false);
  assert.equal(canCorrectDoseMark("house_manager", "hm-1", { markedBy: "dsp-2" }), true);
  assert.equal(canCorrectDoseMark("nurse", "rn-1", { markedBy: "dsp-2" }), true);
  assert.equal(canCorrectDoseMark("hr", "hr-1", { markedBy: "hr-1" }), false);
});
