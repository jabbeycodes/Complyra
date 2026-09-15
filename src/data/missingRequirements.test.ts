/**
 * missingRequirements.test.ts — missing-requirements aggregation across
 * staff certificates, training currency, individual documents, and missed
 * checklists.
 *
 * Run: node --import tsx --test src/data/missingRequirements.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMissing,
  missingByScope,
  missingBySite,
  type MissingInput,
} from "./missingRequirements";

const NOW = new Date("2026-09-14T12:00:00Z");

function input(overrides: Partial<MissingInput> = {}): MissingInput {
  return {
    now: NOW,
    requiredCertificateKinds: ["CPR", "CPI"],
    certificates: [],
    requiredTrainingTopics: ["Abuse and neglect"],
    trainings: [],
    staff: [{ userId: "u1", name: "Ava", siteName: "Maple" }],
    individuals: [{ id: "i1", name: "Cara", siteName: "Maple" }],
    requiredIndividualDocuments: ["ISP", "Emergency contacts"],
    individualDocuments: [],
    checklists: [],
    ...overrides,
  };
}

test("missing: staffer with nothing on file misses everything required", () => {
  const items = findMissing(input());
  const whats = items.map((item) => item.what).sort();
  assert.deepEqual(whats, [
    "Abuse and neglect training",
    "CPI certificate",
    "CPR certificate",
    "Emergency contacts",
    "ISP",
  ]);
  const scoped = missingByScope(items);
  assert.equal(scoped.staff.length, 3);
  assert.equal(scoped.individual.length, 2);
  assert.equal(scoped.site.length, 0);
});

test("missing: current records clear the list; expired ones flag as expired", () => {
  const items = findMissing(
    input({
      certificates: [
        { userId: "u1", staffName: "Ava", kind: "CPR", expiresOn: "2027-01-01" },
        { userId: "u1", staffName: "Ava", kind: "CPI", expiresOn: "2026-09-01" },
      ],
      trainings: [
        { userId: "u1", staffName: "Ava", topic: "Abuse and neglect", completedOn: "2026-06-01" },
      ],
      individualDocuments: [
        { individualId: "i1", individualName: "Cara", siteName: "Maple", documentType: "ISP" },
        { individualId: "i1", individualName: "Cara", siteName: "Maple", documentType: "Emergency contacts" },
      ],
    }),
  );
  assert.deepEqual(
    items.map((item) => item.what),
    ["CPI certificate (expired 2026-09-01)"],
  );
  assert.equal(items[0].expired, true);
});

test("missing: case-insensitive matching", () => {
  const items = findMissing(
    input({
      certificates: [{ userId: "u1", staffName: "Ava", kind: "cpr", expiresOn: "2027-01-01" }],
      trainings: [
        { userId: "u1", staffName: "Ava", topic: "ABUSE AND NEGLECT", completedOn: "2026-06-01" },
      ],
    }),
  );
  assert.ok(!items.some((item) => item.what.startsWith("CPR")), "cpr matches CPR");
  assert.ok(!items.some((item) => item.what.includes("Abuse")), "topic matches case-insensitively");
});

test("missing: only past-due checklists count as missing", () => {
  const items = findMissing(
    input({
      checklists: [
        { siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: false },
        { siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-20", submitted: false },
        { siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: true },
      ],
    }),
  );
  const scoped = missingByScope(items);
  assert.equal(scoped.site.length, 1, "only the unsubmitted past-due checklist");
});

test("missing: per-site rollup orders by count desc", () => {
  const items = findMissing(
    input({
      staff: [
        { userId: "u1", name: "Ava", siteName: "Maple" },
        { userId: "u2", name: "Ben", siteName: "Oak" },
      ],
      individuals: [],
    }),
  );
  const rollup = missingBySite(items);
  assert.equal(rollup.length, 2);
  // Each staffer misses 2 certs + 1 training = 3; tie breaks by site name.
  assert.deepEqual(
    rollup.map((row) => row.siteName),
    ["Maple", "Oak"],
  );
  assert.ok(rollup.every((row) => row.count === 3));
});
