import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  compareMileageTrips,
  computeTripMiles,
  monthKeyOf,
  monthLabel,
  nextMonthStart,
  roundMiles,
  splitMilesAmongRiders,
  summarizeMonthlyMileage,
  validateTripInput,
} from "./mileage";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultPermissions,
  hasPermission,
} from "./permissions";
import type { MileageTrip } from "./types";

// ---------- trip math ----------

test("computeTripMiles is stop minus start, rounded to one decimal", () => {
  assert.equal(computeTripMiles(45210, 45236), 26);
  assert.equal(computeTripMiles(100, 100), 0);
  assert.equal(computeTripMiles(10.25, 12.36), 2.1);
});

test("roundMiles rounds to one decimal", () => {
  assert.equal(roundMiles(2.05), 2.1);
  assert.equal(roundMiles(2.04), 2);
});

test("riders split the miles equally", () => {
  const shares = splitMilesAmongRiders(26, ["sylvester", "brandon"]);
  assert.equal(shares.get("sylvester"), 13);
  assert.equal(shares.get("brandon"), 13);
});

test("a lone rider gets all the miles", () => {
  const shares = splitMilesAmongRiders(10, ["sylvester"]);
  assert.equal(shares.get("sylvester"), 10);
});

test("rounding remainder goes to the last rider so shares sum to the total", () => {
  const shares = splitMilesAmongRiders(10, ["a", "b", "c"]);
  const values = [...shares.values()];
  assert.equal(values.length, 3);
  assert.equal(roundMiles(values[0] + values[1] + values[2]), 10);
  assert.equal(values[0], 3.3);
  assert.equal(values[1], 3.3);
  assert.equal(values[2], 3.4);
});

test("no riders means no shares", () => {
  assert.equal(splitMilesAmongRiders(10, []).size, 0);
});

test("validateTripInput rejects an inverted odometer", () => {
  const errors = validateTripInput({
    tripDate: "2026-09-10",
    odometerStart: 500,
    odometerEnd: 499,
    riderIds: ["a"],
    reason: "Clinic run",
    driverName: "Alex Morgan",
  });
  assert.ok(errors.some((e) => e.field === "odometerEnd"));
});

test("validateTripInput requires date, riders, reason, and driver", () => {
  const errors = validateTripInput({
    tripDate: "not-a-date",
    odometerStart: 100,
    odometerEnd: 120,
    riderIds: [],
    reason: "  ",
    driverName: "",
  });
  const fields = errors.map((e) => e.field);
  assert.ok(fields.includes("tripDate"));
  assert.ok(fields.includes("riders"));
  assert.ok(fields.includes("reason"));
  assert.ok(fields.includes("driverName"));
});

test("validateTripInput passes a well-formed trip", () => {
  assert.deepEqual(
    validateTripInput({
      tripDate: "2026-09-10",
      odometerStart: 100,
      odometerEnd: 120,
      riderIds: ["a"],
      reason: "Clinic run",
      driverName: "Alex Morgan",
    }),
    [],
  );
});

test("month helpers label and bound the paper month", () => {
  assert.equal(monthKeyOf("2026-09-10"), "2026-09");
  assert.equal(monthLabel("2026-09"), "September 2026");
  assert.equal(nextMonthStart("2026-09"), "2026-10-01");
  assert.equal(nextMonthStart("2026-12"), "2027-01-01");
});

function trip(overrides: Partial<MileageTrip> = {}): MileageTrip {
  return {
    id: "t",
    agencyId: "a",
    siteId: "s",
    tripDate: "2026-09-10",
    odometerStart: 100,
    odometerEnd: 120,
    miles: 20,
    riderIds: ["sylvester", "brandon"],
    reason: "Clinic",
    driverName: "Alex",
    signatureName: "Alex",
    createdBy: "u",
    createdAt: "2026-09-10T10:00:00Z",
    ...overrides,
  };
}

test("summarizeMonthlyMileage totals miles and per-individual shares", () => {
  const trips = [
    trip({ id: "t1", miles: 20, riderIds: ["sylvester", "brandon"] }),
    trip({ id: "t2", miles: 30, riderIds: ["sylvester"] }),
    trip({ id: "t3", tripDate: "2026-09-20", miles: 9, riderIds: ["brandon"] }),
  ];
  const summary = summarizeMonthlyMileage(trips, ["sylvester", "brandon", "nobody"]);
  assert.equal(summary.month, "2026-09");
  assert.equal(summary.tripCount, 3);
  assert.equal(summary.totalMiles, 59);
  assert.deepEqual(
    summary.individualTotals.map((row) => [row.individualId, row.miles]),
    [
      ["sylvester", 40], // 10 + 30
      ["brandon", 19], // 10 + 9
      ["nobody", 0],
    ],
  );
});

test("compareMileageTrips orders by date then creation", () => {
  const a = trip({ id: "a", tripDate: "2026-09-10", createdAt: "2026-09-10T09:00:00Z" });
  const b = trip({ id: "b", tripDate: "2026-09-10", createdAt: "2026-09-10T10:00:00Z" });
  const c = trip({ id: "c", tripDate: "2026-09-11", createdAt: "2026-09-09T10:00:00Z" });
  assert.deepEqual([b, c, a].sort(compareMileageTrips).map((t) => t.id), ["a", "b", "c"]);
});

// ---------- permission defaults ----------

test("LIFEPATH-P7: mileage.manage defaults — on for service roles, off for auditor", () => {
  assert.ok(PERMISSION_KEYS.includes("mileage.manage"));
  assert.equal(PERMISSION_LABELS["mileage.manage"], "Log vehicle mileage");
  for (const role of [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
    "program_manager",
    "dsp",
    "nurse",
    "hr",
  ]) {
    assert.equal(
      defaultPermissions(role)["mileage.manage"],
      true,
      `${role} should log mileage`,
    );
  }
  assert.equal(defaultPermissions("auditor")["mileage.manage"], false);
});

test("LIFEPATH-P7: hasPermission honors mileage.manage from role templates", () => {
  assert.equal(hasPermission({ role: "dsp" }, "mileage.manage"), true);
  assert.equal(hasPermission({ role: "auditor" }, "mileage.manage"), false);
  assert.equal(
    hasPermission({ permissions: { "mileage.manage": false } }, "mileage.manage"),
    false,
  );
});

// ---------- LocalApi integration ----------

async function dspClient() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const site = store.db.sites.find(
    (s) => s.agencyId === session.agencyId && s.name === "Maple House",
  )!;
  const people = store.db.individuals.filter(
    (p) => p.agencyId === session.agencyId && p.siteId === site.id,
  );
  assert.ok(people.length >= 2, "seed needs two individuals at Maple House");
  return { client, store, session, site, people };
}

function tripInput(siteId: string, riderIds: string[]) {
  return {
    siteId,
    tripDate: "2026-09-10",
    odometerStart: 45210,
    odometerEnd: 45236,
    riderIds,
    reason: "Doctor appointment",
    driverName: "Alex Morgan",
    signatureName: "Alex Morgan",
  };
}

test("DSP logs a trip; miles computed; riders split equally", async () => {
  const { client, site, people } = await dspClient();
  const [first, second] = people;
  const saved = await client.addMileageTrip(tripInput(site.id, [first.id, second.id]));
  assert.equal(saved.miles, 26);

  const rows = await client.listMileageTrips(site.id, "2026-09");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].riderShares.map((s) => [s.individualId, s.miles]),
    [
      [first.id, 13],
      [second.id, 13],
    ],
  );
});

test("monthly summary totals miles and per-individual shares", async () => {
  const { client, site, people } = await dspClient();
  const [first, second] = people;
  await client.addMileageTrip(tripInput(site.id, [first.id, second.id]));
  await client.addMileageTrip({
    ...tripInput(site.id, [first.id]),
    tripDate: "2026-09-12",
    odometerStart: 45236,
    odometerEnd: 45266,
  });
  // A trip in another month must not leak into September's totals.
  await client.addMileageTrip({
    ...tripInput(site.id, [first.id]),
    tripDate: "2026-10-01",
    odometerStart: 45266,
    odometerEnd: 45276,
  });

  const summary = await client.getMileageMonthlySummary(
    site.id,
    "2026-09",
    people.map((p) => p.id),
  );
  assert.equal(summary.tripCount, 2);
  assert.equal(summary.totalMiles, 56);
  const byId = Object.fromEntries(
    summary.individualTotals.map((row) => [row.individualId, row.miles]),
  );
  assert.equal(byId[first.id], 43); // 13 + 30
  assert.equal(byId[second.id], 13);
});

test("updateMileageTrip recomputes miles and validates the odometer", async () => {
  const { client, site, people } = await dspClient();
  const saved = await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  const updated = await client.updateMileageTrip(saved.id, { odometerEnd: 45250 });
  assert.equal(updated.miles, 40);
  await assert.rejects(
    () => client.updateMileageTrip(saved.id, { odometerEnd: 45000 }),
    /ending odometer/,
  );
});

test("deleteMileageTrip removes the trip from the monthly log", async () => {
  const { client, site, people } = await dspClient();
  const saved = await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  await client.deleteMileageTrip(saved.id);
  assert.deepEqual(await client.listMileageTrips(site.id, "2026-09"), []);
});

test("addMileageTrip rejects an inverted odometer and riders outside the home", async () => {
  const { client, site, people, store, session } = await dspClient();
  await assert.rejects(
    () =>
      client.addMileageTrip({
        ...tripInput(site.id, [people[0].id]),
        odometerStart: 500,
        odometerEnd: 499,
      }),
    /ending odometer/,
  );
  const otherSitePerson = store.db.individuals.find(
    (p) => p.agencyId === session.agencyId && p.siteId !== site.id,
  )!;
  await assert.rejects(
    () => client.addMileageTrip(tripInput(site.id, [otherSitePerson.id])),
    /not part of this home/,
  );
});
