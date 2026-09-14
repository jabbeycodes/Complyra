/**
 * Demo seed consistency tests: the QA demo must not show repeated
 * requirement titles, identical renewal dates, or empty staff tables.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { seedRequirements } from "../domain";
import { daysRemaining } from "./certificates";

const DEMO_TODAY = "2026-09-14";

function seed() {
  return structuredClone(createEvergreenSeed());
}

test("seeded requirement titles are unique (no repeated titles)", () => {
  const titles = seedRequirements.map((r) => r.title);
  const unique = new Set(titles);
  assert.equal(
    unique.size,
    titles.length,
    `duplicate requirement titles: ${titles.filter((t, i) => titles.indexOf(t) !== i).join(", ")}`,
  );
});

test("demo has four individuals, two per site, across two sites", () => {
  const data = seed();
  assert.equal(data.individuals.length, 4);
  assert.equal(data.sites.length, 2);
  for (const site of data.sites) {
    const count = data.individuals.filter((p) => p.siteId === site.id).length;
    assert.equal(count, 2, `${site.name} should house 2 individuals`);
  }
});

test("clinical renewal dates vary across individuals", () => {
  const data = seed();
  const dueDates = data.clinicalRenewals.map((r) => r.nextDueOn);
  assert.ok(dueDates.length > 0, "expected seeded clinical renewals");
  const distinct = new Set(dueDates);
  assert.ok(
    distinct.size > 1,
    "every individual has identical renewal dates — seed distinct reference dates",
  );
});

test("certificates seed shows a realistic mix incl. one expiring within 90 days", () => {
  const data = seed();
  assert.ok(data.certificates.length >= 4, "expected seeded certificates");
  const remaining = data.certificates.map((c) =>
    daysRemaining(c.expiresOn, DEMO_TODAY),
  );
  assert.ok(
    remaining.some((d) => d >= 0 && d <= 90),
    "expected at least one certificate expiring within 90 days of the demo date",
  );
  assert.ok(
    remaining.some((d) => d < 0),
    "expected at least one expired certificate so HR sees the overdue state",
  );
  assert.ok(
    remaining.some((d) => d > 90),
    "expected at least one comfortably current certificate",
  );
  // Every certificate must belong to a real staff profile.
  const staffIds = new Set(data.profiles.map((p) => p.id));
  for (const cert of data.certificates) {
    assert.ok(staffIds.has(cert.userId), `certificate ${cert.id} has no staff profile`);
    assert.ok(cert.certName.length > 0);
  }
});

test("training clearance roster includes all agency staff even with no training assigned", async () => {
  const data = seed();
  const p2 = data as unknown as { trainingRequirements?: unknown[] };
  assert.equal(
    (p2.trainingRequirements ?? []).length,
    0,
    "precondition: the demo seeds no P2 training requirements",
  );
  const api = new LocalApi(new MemoryStore(data));
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const rows = await api.listStaffNeedingClearance();
  const staffCount = data.memberships.filter(
    (m) => m.agencyId === session.agencyId,
  ).length;
  assert.ok(staffCount > 0, "precondition: the demo seeds staff memberships");
  assert.equal(
    rows.length,
    staffCount,
    `expected every staff member on the roster, got ${rows.length} of ${staffCount}`,
  );
  for (const row of rows) {
    assert.ok(row.fullName.length > 0);
    assert.equal(row.clearedForInRatio, false);
    assert.ok(
      row.gateReasons.includes("No training assigned yet"),
      `${row.fullName} should explain why they are not cleared`,
    );
  }
});
