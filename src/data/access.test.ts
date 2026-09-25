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

test("DSPs correct only MAR entries they recorded; managers and nurses correct any", async () => {
  const { canCorrectDoseMark } = await import("./chart");
  assert.equal(canCorrectDoseMark("dsp", "dsp-1", { markedBy: "dsp-1" }), true);
  assert.equal(canCorrectDoseMark("dsp", "dsp-1", { markedBy: "dsp-2" }), false);
  assert.equal(canCorrectDoseMark("house_manager", "hm-1", { markedBy: "dsp-2" }), true);
  assert.equal(canCorrectDoseMark("nurse", "rn-1", { markedBy: "dsp-2" }), true);
  assert.equal(canCorrectDoseMark("hr", "hr-1", { markedBy: "hr-1" }), false);
});
