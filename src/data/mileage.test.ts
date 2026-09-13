import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_ADMIN_USERNAME,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  assertCanBackfillMileage,
  canBackfillMileage,
  compareMileageTrips,
  computeTripMiles,
  getLastOdometerEnd,
  getPreviousOdometerEnd,
  hasBackfillMarker,
  latestMileageTrip,
  monthKeyOf,
  monthLabel,
  nextMonthStart,
  roundMiles,
  splitMilesAmongRiders,
  stripBackfillMarker,
  summarizeMonthlyMileage,
  summarizeWeeklyMileage,
  summarizeYearlyMileage,
  validateOdometerContinuity,
  validateTripInput,
  weekBucketOfDay,
  withBackfillMarker,
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
    backfilled: false,
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

async function clientAs(username: string) {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username,
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

// ---------- Odometer continuity ----------

function baseTrip(overrides: Partial<MileageTrip> = {}): MileageTrip {
  return {
    id: "trip-1",
    agencyId: "agency-1",
    siteId: "site-1",
    tripDate: "2026-09-10",
    odometerStart: 45210,
    odometerEnd: 45236,
    miles: 26,
    riderIds: ["a"],
    reason: "Doctor appointment",
    backfilled: false,
    driverName: "Alex Morgan",
    signatureName: "Alex Morgan",
    createdBy: "user-1",
    createdAt: "2026-09-10T08:00:00.000Z",
    ...overrides,
  };
}

test("validateOdometerContinuity passes when the start continues the last end", () => {
  assert.equal(validateOdometerContinuity(45236, 45236), null);
});

test("validateOdometerContinuity passes for the first trip ever (no previous end)", () => {
  assert.equal(validateOdometerContinuity(100, null), null);
});

test("validateOdometerContinuity blocks a mismatched start with a fix-it message", () => {
  const message = validateOdometerContinuity(45000, 45236);
  assert.ok(message);
  assert.match(message, /must continue from the last trip's end/);
  assert.match(message, /45,236/);
  assert.match(message, /Fix it to continue/);
});

test("latestMileageTrip picks the newest date and breaks ties by creation order", () => {
  const trips = [
    baseTrip({ id: "a", tripDate: "2026-09-10", odometerEnd: 100, createdAt: "2026-09-10T01:00:00.000Z" }),
    baseTrip({ id: "b", tripDate: "2026-09-10", odometerEnd: 150, createdAt: "2026-09-10T02:00:00.000Z" }),
    baseTrip({ id: "c", tripDate: "2026-09-09", odometerEnd: 999, createdAt: "2026-09-11T01:00:00.000Z" }),
  ];
  assert.equal(latestMileageTrip(trips)?.id, "b");
  assert.equal(getLastOdometerEnd(trips), 150);
  assert.equal(getLastOdometerEnd([]), null);
});

test("getPreviousOdometerEnd returns the end of the trip right before the given one", () => {
  const trips = [
    baseTrip({ id: "a", tripDate: "2026-09-10", odometerEnd: 100, createdAt: "2026-09-10T01:00:00.000Z" }),
    baseTrip({ id: "b", tripDate: "2026-09-11", odometerEnd: 200, createdAt: "2026-09-11T01:00:00.000Z" }),
    baseTrip({ id: "c", tripDate: "2026-09-12", odometerEnd: 300, createdAt: "2026-09-12T01:00:00.000Z" }),
  ];
  assert.equal(getPreviousOdometerEnd(trips, "b"), 100);
  assert.equal(getPreviousOdometerEnd(trips, "c"), 200);
  assert.equal(getPreviousOdometerEnd(trips, "a"), null);
  assert.equal(getPreviousOdometerEnd(trips, "missing"), null);
});

// ---------- Weekly breakdown ----------

test("weekBucketOfDay buckets days 1–7, 8–14, 15–21, 22–28, 29–31", () => {
  assert.equal(weekBucketOfDay(1), 0);
  assert.equal(weekBucketOfDay(7), 0);
  assert.equal(weekBucketOfDay(8), 1);
  assert.equal(weekBucketOfDay(14), 1);
  assert.equal(weekBucketOfDay(15), 2);
  assert.equal(weekBucketOfDay(21), 2);
  assert.equal(weekBucketOfDay(22), 3);
  assert.equal(weekBucketOfDay(28), 3);
  assert.equal(weekBucketOfDay(29), 4);
  assert.equal(weekBucketOfDay(31), 4);
});

test("summarizeWeeklyMileage buckets per-individual shares into weeks 1–5", () => {
  const trips = [
    baseTrip({ id: "w1", tripDate: "2026-09-03", miles: 20, riderIds: ["a", "b"] }),
    baseTrip({ id: "w2", tripDate: "2026-09-10", miles: 30, riderIds: ["a"] }),
    baseTrip({ id: "w5", tripDate: "2026-09-30", miles: 10, riderIds: ["b"] }),
  ];
  const result = summarizeWeeklyMileage(trips, ["a", "b", "c"]);
  assert.equal(result.month, "2026-09");
  assert.equal(result.hasWeek5, true);
  const byId = Object.fromEntries(result.rows.map((row) => [row.individualId, row]));
  assert.deepEqual(byId["a"].weeks, [10, 30, 0, 0, 0]);
  assert.equal(byId["a"].monthlyTotal, 40);
  assert.deepEqual(byId["b"].weeks, [10, 0, 0, 0, 10]);
  assert.equal(byId["b"].monthlyTotal, 20);
  assert.deepEqual(byId["c"].weeks, [0, 0, 0, 0, 0]);
  assert.equal(byId["c"].monthlyTotal, 0);
});

test("summarizeWeeklyMileage reports no week 5 when nothing falls on days 29–31", () => {
  const trips = [
    baseTrip({ id: "w1", tripDate: "2026-09-03", miles: 20, riderIds: ["a"] }),
    baseTrip({ id: "w4", tripDate: "2026-09-28", miles: 8, riderIds: ["a"] }),
  ];
  const result = summarizeWeeklyMileage(trips, ["a"]);
  assert.equal(result.hasWeek5, false);
  assert.deepEqual(result.rows[0].weeks, [20, 0, 0, 8, 0]);
  assert.equal(result.rows[0].monthlyTotal, 28);
});

// ---------- Yearly summary ----------

test("summarizeYearlyMileage rolls up Jan–Dec per individual plus a grand total row", () => {
  const trips = [
    baseTrip({ id: "j1", tripDate: "2026-01-15", miles: 20, riderIds: ["a", "b"] }),
    baseTrip({ id: "j2", tripDate: "2026-01-20", miles: 30, riderIds: ["a"] }),
    baseTrip({ id: "f1", tripDate: "2026-02-02", miles: 10, riderIds: ["b"] }),
    baseTrip({ id: "old", tripDate: "2025-12-20", miles: 100, riderIds: ["a"] }),
  ];
  const result = summarizeYearlyMileage(trips, ["a", "b", "c"], 2026);
  assert.equal(result.year, 2026);
  assert.equal(result.rows.length, 3);
  const byId = Object.fromEntries(result.rows.map((row) => [row.individualId, row]));
  assert.equal(byId["a"].months[0], 40); // 10 + 30 in January
  assert.equal(byId["a"].months[1], 0);
  assert.equal(byId["a"].yearlyTotal, 40);
  assert.equal(byId["b"].months[0], 10);
  assert.equal(byId["b"].months[1], 10);
  assert.equal(byId["b"].yearlyTotal, 20);
  assert.equal(byId["c"].yearlyTotal, 0); // pre-populated with zeros
  assert.equal(result.grandTotal.months[0], 50);
  assert.equal(result.grandTotal.months[1], 10);
  assert.equal(result.grandTotal.yearlyTotal, 60);
});

// ---------- LocalApi integration: continuity + yearly ----------

test("addMileageTrip enforces odometer continuity against the latest trip", async () => {
  const { client, site, people } = await dspClient();
  await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  assert.equal(await client.getLastMileageOdometerEnd(site.id), 45236);
  await assert.rejects(
    () =>
      client.addMileageTrip({
        ...tripInput(site.id, [people[0].id]),
        tripDate: "2026-09-11",
        odometerStart: 45000,
        odometerEnd: 45010,
      }),
    /must continue from the last trip's end/,
  );
  const second = await client.addMileageTrip({
    ...tripInput(site.id, [people[0].id]),
    tripDate: "2026-09-11",
    odometerStart: 45236,
    odometerEnd: 45250,
  });
  assert.equal(second.miles, 14);
  assert.equal(await client.getLastMileageOdometerEnd(site.id), 45250);
});

test("updateMileageTrip validates the start against the previous trip's end", async () => {
  const { client, site, people } = await dspClient();
  const first = await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  const second = await client.addMileageTrip({
    ...tripInput(site.id, [people[0].id]),
    tripDate: "2026-09-11",
    odometerStart: 45236,
    odometerEnd: 45250,
  });
  assert.equal(await client.getPreviousMileageOdometerEnd(site.id, first.id), null);
  assert.equal(await client.getPreviousMileageOdometerEnd(site.id, second.id), 45236);
  await assert.rejects(
    () => client.updateMileageTrip(second.id, { odometerStart: 45000 }),
    /must continue from the last trip's end/,
  );
  const updated = await client.updateMileageTrip(second.id, { odometerEnd: 45260 });
  assert.equal(updated.miles, 24);
});

test("getMileageYearlySummary rolls up per-individual months and the grand total", async () => {
  const { client, site, people } = await dspClient();
  const [first, second] = people;
  await client.addMileageTrip({
    ...tripInput(site.id, [first.id, second.id]),
    tripDate: "2026-01-05",
    odometerStart: 100,
    odometerEnd: 120,
  });
  await client.addMileageTrip({
    ...tripInput(site.id, [first.id]),
    tripDate: "2026-01-20",
    odometerStart: 120,
    odometerEnd: 150,
  });
  await client.addMileageTrip({
    ...tripInput(site.id, [second.id]),
    tripDate: "2026-02-02",
    odometerStart: 150,
    odometerEnd: 160,
  });
  const yearly = await client.getMileageYearlySummary(
    site.id,
    2026,
    people.map((p) => p.id),
  );
  assert.equal(yearly.rows.length, people.length);
  const byId = Object.fromEntries(
    yearly.rows.map((row) => [row.individualId, row]),
  );
  assert.equal(byId[first.id].months[0], 40);
  assert.equal(byId[first.id].months[1], 0);
  assert.equal(byId[first.id].yearlyTotal, 40);
  assert.equal(byId[second.id].months[0], 10);
  assert.equal(byId[second.id].months[1], 10);
  assert.equal(byId[second.id].yearlyTotal, 20);
  assert.equal(yearly.grandTotal.months[0], 50);
  assert.equal(yearly.grandTotal.months[1], 10);
  assert.equal(yearly.grandTotal.yearlyTotal, 60);
});

// ---------- Admin backfill override ----------

test("canBackfillMileage allows administrator, compliance_admin, house_manager, and platform admins", () => {
  assert.equal(canBackfillMileage({ roleKey: "administrator", platformAdmin: false }), true);
  assert.equal(canBackfillMileage({ roleKey: "compliance_admin", platformAdmin: false }), true);
  assert.equal(canBackfillMileage({ roleKey: "house_manager", platformAdmin: false }), true);
  assert.equal(canBackfillMileage({ roleKey: "dsp", platformAdmin: true }), true);
});

test("canBackfillMileage blocks DSP, nurse, HR, and auditor staff", () => {
  for (const roleKey of ["dsp", "nurse", "hr", "auditor", "degreed_professional_manager", "program_manager"]) {
    assert.equal(canBackfillMileage({ roleKey, platformAdmin: false }), false, roleKey);
  }
  assert.equal(canBackfillMileage(null), false);
});

test("assertCanBackfillMileage throws for staff but not for house managers", () => {
  assert.doesNotThrow(() =>
    assertCanBackfillMileage({ roleKey: "house_manager", platformAdmin: false }),
  );
  assert.throws(
    () => assertCanBackfillMileage({ roleKey: "dsp", platformAdmin: false }),
    /Only administrators, compliance administrators, and house managers/,
  );
});

test("backfill reason marker round-trips without leaking into display text", () => {
  assert.equal(hasBackfillMarker("[backfill] Doctor appointment"), true);
  assert.equal(hasBackfillMarker("Doctor appointment"), false);
  assert.equal(stripBackfillMarker("[backfill] Doctor appointment"), "Doctor appointment");
  assert.equal(stripBackfillMarker("Doctor appointment"), "Doctor appointment");
  assert.equal(withBackfillMarker("Doctor appointment"), "[backfill] Doctor appointment");
  // idempotent: never double-prefix
  assert.equal(withBackfillMarker("[backfill] Doctor appointment"), "[backfill] Doctor appointment");
});

test("house_manager can backfill a forgotten trip out of sequence", async () => {
  const { client, site, people } = await clientAs(DEMO_HM_USERNAME);
  await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  const backfilled = await client.addMileageTrip({
    ...tripInput(site.id, [people[0].id]),
    tripDate: "2026-09-05", // older trip logged late: start does not continue the chain
    odometerStart: 44000,
    odometerEnd: 44020,
    backfill: true,
  });
  assert.equal(backfilled.backfilled, true);
  assert.equal(backfilled.miles, 20);
  assert.equal(backfilled.reason, "Doctor appointment"); // marker stripped for display

  const rows = await client.listMileageTrips(site.id, "2026-09");
  const found = rows.find((row) => row.id === backfilled.id)!;
  assert.equal(found.backfilled, true); // badge flag present in the log view

  const summary = await client.getMileageMonthlySummary(
    site.id,
    "2026-09",
    people.map((p) => p.id),
  );
  assert.equal(summary.totalMiles, 46); // 26 + 20 both counted
});

test("administrator can backfill; inverted odometer still rejected with backfill", async () => {
  const { client, site, people } = await clientAs(DEMO_ADMIN_USERNAME);
  await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  const backfilled = await client.addMileageTrip({
    ...tripInput(site.id, [people[0].id]),
    tripDate: "2026-09-06",
    odometerStart: 44000,
    odometerEnd: 44020,
    backfill: true,
  });
  assert.equal(backfilled.backfilled, true);
  await assert.rejects(
    () =>
      client.addMileageTrip({
        ...tripInput(site.id, [people[0].id]),
        odometerStart: 44500,
        odometerEnd: 44490, // end < start is never allowed, even on backfill
        backfill: true,
      }),
    /cannot be less than the starting reading/,
  );
});

test("staff backfill attempts are rejected at the API level", async () => {
  for (const username of [DEMO_DSP_USERNAME, DEMO_NURSE_USERNAME]) {
    const { client, site, people } = await clientAs(username);
    await client.addMileageTrip(tripInput(site.id, [people[0].id]));
    await assert.rejects(
      () =>
        client.addMileageTrip({
          ...tripInput(site.id, [people[0].id]),
          tripDate: "2026-09-05",
          odometerStart: 44000,
          odometerEnd: 44020,
          backfill: true,
        }),
      /Only administrators, compliance administrators, and house managers/,
      username,
    );
    const first = (await client.listMileageTrips(site.id, "2026-09"))[0];
    await assert.rejects(
      () => client.updateMileageTrip(first.id, { backfill: true }),
      /Only administrators, compliance administrators, and house managers/,
      username,
    );
  }
});

test("continuity is still enforced for everyone without the backfill flag", async () => {
  const { client, site, people } = await clientAs(DEMO_HM_USERNAME);
  await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  // house manager WITHOUT the flag is held to the chain like everyone else
  await assert.rejects(
    () =>
      client.addMileageTrip({
        ...tripInput(site.id, [people[0].id]),
        tripDate: "2026-09-11",
        odometerStart: 44000,
        odometerEnd: 44020,
      }),
    /must continue from the last trip's end/,
  );
});

test("updateMileageTrip can mark a trip backfilled; staff cannot", async () => {
  const { client, site, people } = await clientAs(DEMO_ADMIN_USERNAME);
  const trip = await client.addMileageTrip(tripInput(site.id, [people[0].id]));
  assert.equal(trip.backfilled, false);
  const marked = await client.updateMileageTrip(trip.id, { backfill: true });
  assert.equal(marked.backfilled, true);
  // the flag survives later edits that do not mention backfill
  const edited = await client.updateMileageTrip(trip.id, { reason: "Grocery run" });
  assert.equal(edited.backfilled, true);
  assert.equal(edited.reason, "Grocery run");
});
