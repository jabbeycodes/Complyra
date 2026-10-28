import { test } from "node:test";
import assert from "node:assert/strict";
import type { MedDoseMark, MedInventoryView } from "../../data/types";
import { computeMedCountdown, medCountdown } from "./medcount";

const TODAY = "2026-09-12";

function scheduled(
  partial: Partial<Parameters<typeof computeMedCountdown>[0]> = {},
): Parameters<typeof computeMedCountdown>[0] {
  return {
    kind: "scheduled",
    baseline: { countedOn: "2026-09-01", pills: 28 },
    dosesPerDay: 2,
    doseTimesCount: 2,
    givenDoseDates: [],
    wasted: [],
    prnCurrentCount: null,
    today: TODAY,
    ...partial,
  };
}

test("no baseline: the countdown invents no number", () => {
  const result = computeMedCountdown(scheduled({ baseline: null }));
  assert.equal(result.hasBaseline, false);
  assert.equal(result.pillsLeft, null);
  assert.equal(result.daysLeft, null);
  assert.equal(result.label, "No count recorded yet");
  assert.equal(result.countedLabel, null);
});

test("baseline with no use since: full count, days floored at the daily rate", () => {
  const result = computeMedCountdown(scheduled());
  assert.equal(result.pillsLeft, 28);
  assert.equal(result.daysLeft, 14);
  assert.equal(result.label, "28 pills left · about 14 days at 2 per day");
  assert.equal(result.countedLabel, "Counted Tue, Sep 1");
});

test("given doses after the baseline burn one dose's pills each", () => {
  const result = computeMedCountdown(
    scheduled({
      givenDoseDates: ["2026-09-02", "2026-09-02", "2026-09-05", "2026-09-12"],
    }),
  );
  // 4 given × (2 per day ÷ 2 dose times) = 4 pills.
  assert.equal(result.pillsLeft, 24);
  assert.equal(result.daysLeft, 12);
  assert.equal(result.label, "24 pills left · about 12 days at 2 per day");
});

test("the baseline day itself never burns, and future dates never count", () => {
  const result = computeMedCountdown(
    scheduled({
      givenDoseDates: ["2026-09-01", "2026-09-01", "2026-09-13"],
      wasted: [{ occurredOn: "2026-09-01", pills: 3 }],
    }),
  );
  assert.equal(result.pillsLeft, 28);
});

test("marks before the baseline are excluded (a newer count restarts)", () => {
  const result = computeMedCountdown(
    scheduled({
      baseline: { countedOn: "2026-09-10", pills: 40 },
      givenDoseDates: ["2026-09-02", "2026-09-09", "2026-09-11"],
    }),
  );
  assert.equal(result.pillsLeft, 39);
  assert.equal(result.daysLeft, 19);
});

test("wasted exceptions subtract their pills; the window applies to them too", () => {
  const result = computeMedCountdown(
    scheduled({
      wasted: [
        { occurredOn: "2026-09-03", pills: 2 },
        { occurredOn: "2026-08-30", pills: 5 },
      ],
    }),
  );
  assert.equal(result.pillsLeft, 26);
});

test("multi-pill doses: pills per dose = daily pills ÷ dose times", () => {
  const result = computeMedCountdown(
    scheduled({
      baseline: { countedOn: "2026-09-10", pills: 30 },
      dosesPerDay: 4,
      doseTimesCount: 2,
      givenDoseDates: ["2026-09-11"],
    }),
  );
  // One given dose at 2 pills per dose.
  assert.equal(result.pillsLeft, 28);
  assert.equal(result.daysLeft, 7);
  assert.equal(result.label, "28 pills left · about 7 days at 4 per day");
});

test("fractional doses (half tablets) stay exact", () => {
  const result = computeMedCountdown(
    scheduled({
      baseline: { countedOn: "2026-09-10", pills: 10 },
      dosesPerDay: 3,
      doseTimesCount: 2,
      givenDoseDates: ["2026-09-11"],
    }),
  );
  assert.equal(result.pillsLeft, 8.5);
  assert.equal(result.daysLeft, 2);
  assert.equal(result.label, "8.5 pills left · about 2 days at 3 per day");
});

test("day projection floors, never rounds up", () => {
  const result = computeMedCountdown(
    scheduled({ baseline: { countedOn: "2026-09-10", pills: 23 } }),
  );
  assert.equal(result.daysLeft, 11);
  assert.equal(result.label, "23 pills left · about 11 days at 2 per day");
});

test("the count floors at zero and says so", () => {
  const result = computeMedCountdown(
    scheduled({
      baseline: { countedOn: "2026-09-01", pills: 2 },
      givenDoseDates: ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
    }),
  );
  assert.equal(result.pillsLeft, 0);
  assert.equal(result.daysLeft, 0);
  assert.equal(result.label, "0 pills left · about 0 days at 2 per day");
});

test("singular wording for one pill and one day", () => {
  const result = computeMedCountdown(
    scheduled({
      baseline: { countedOn: "2026-09-11", pills: 3 },
      givenDoseDates: ["2026-09-12", "2026-09-12"],
    }),
  );
  assert.equal(result.label, "1 pill left · about 0 days at 2 per day");
  const oneDay = computeMedCountdown(
    scheduled({ baseline: { countedOn: "2026-09-11", pills: 2 } }),
  );
  assert.equal(oneDay.label, "2 pills left · about 1 day at 2 per day");
});

test("PRN: pills from the projection count, no day projection, no rate", () => {
  const result = computeMedCountdown({
    kind: "prn",
    baseline: { countedOn: "2026-09-08", pills: 12 },
    dosesPerDay: 0,
    doseTimesCount: 0,
    givenDoseDates: [],
    wasted: [],
    prnCurrentCount: 11,
    today: TODAY,
  });
  assert.equal(result.pillsLeft, 11);
  assert.equal(result.daysLeft, null);
  assert.equal(result.label, "11 pills left · as needed — no daily rate");
  assert.equal(result.countedLabel, "Counted Tue, Sep 8");
});

test("PRN without a projection count falls back to baseline minus wasted", () => {
  const result = computeMedCountdown({
    kind: "prn",
    baseline: { countedOn: "2026-09-08", pills: 12 },
    dosesPerDay: 0,
    doseTimesCount: 0,
    givenDoseDates: [],
    wasted: [{ occurredOn: "2026-09-09", pills: 2 }],
    prnCurrentCount: null,
    today: TODAY,
  });
  assert.equal(result.pillsLeft, 10);
});

function inventory(partial: Partial<MedInventoryView>): MedInventoryView {
  return {
    id: "inv-1",
    agencyId: "agency",
    individualId: "person-1",
    medicationId: "med-1",
    medicationName: "Levetiracetam",
    strength: "500 mg",
    kind: "scheduled",
    doseTimes: ["08:00", "20:00"],
    dosesPerDay: 2,
    lowThresholdDays: 7,
    reorderAcknowledgedOn: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    currentCount: 6,
    daysRemaining: 3,
    reorderPointPills: 14,
    status: "low",
    alertActive: true,
    prnDosesSinceDelivery: 0,
    quantityOnDelivery: 28,
    deliveredOn: "2026-09-01",
    lastCountedOn: "2026-09-01",
    deliveries: [],
    doseExceptions: [],
    ...partial,
  } as MedInventoryView;
}

function mark(partial: Partial<MedDoseMark>): MedDoseMark {
  return {
    id: "mark-1",
    agencyId: "agency",
    individualId: "person-1",
    medicationId: "med-1",
    doseDate: TODAY,
    doseTime: "08:00",
    status: "given",
    markedBy: "user-1",
    markedByName: "Alex Morgan",
    markedAt: "2026-09-12T13:05:00.000Z",
    ...partial,
  };
}

test("adapter: without a delivery record the row's maintained count shows as-is", () => {
  // No delivery rows: quantityOnDelivery is the backend-maintained
  // current count, so even a Given today must not burn it a second time.
  const result = medCountdown(inventory({}), [mark({})], TODAY);
  assert.equal(result.pillsLeft, 28);
  assert.equal(result.label, "28 pills left · about 14 days at 2 per day");
  assert.equal(result.countedLabel, "Counted Tue, Sep 1");
});

test("compute: a maintained count never burns, whatever the window holds", () => {
  const result = computeMedCountdown(
    scheduled({
      maintainedCount: true,
      givenDoseDates: ["2026-09-05", "2026-09-12"],
      wasted: [{ occurredOn: "2026-09-06", pills: 4 }],
    }),
  );
  assert.equal(result.pillsLeft, 28);
  assert.equal(result.daysLeft, 14);
});

test("adapter: the newest delivery row is the baseline when one exists", () => {
  const view = inventory({
    lastCountedOn: "2026-09-10",
    deliveredOn: "2026-09-10",
    quantityOnDelivery: 99,
    deliveries: [
      {
        id: "del-1",
        countedOn: "2026-09-10",
        remainingPills: 40,
        pillsPerDay: 2,
        recordedBy: "Sarah Mitchell",
      },
    ],
  });
  const result = medCountdown(view, [mark({ doseDate: "2026-09-05" })], TODAY);
  assert.equal(result.pillsLeft, 40);
  // A Given after the delivery baseline burns from it.
  const burned = medCountdown(view, [mark({ doseDate: "2026-09-11" })], TODAY);
  assert.equal(burned.pillsLeft, 39);
});

const DELIVERY_BASELINE = {
  lastCountedOn: "2026-09-01",
  deliveries: [
    {
      id: "del-1",
      countedOn: "2026-09-01",
      remainingPills: 28,
      pillsPerDay: 2,
      recordedBy: "Sarah Mitchell",
    },
  ],
};

test("adapter: only Given marks for this med burn; other statuses and meds do not", () => {
  const marks = [
    mark({ status: "missed" }),
    mark({ status: "loa" }),
    mark({ medicationId: "med-other" }),
    mark({ doseTime: "20:00" }),
  ];
  const result = medCountdown(inventory(DELIVERY_BASELINE), marks, TODAY);
  assert.equal(result.pillsLeft, 27);
});

test("adapter: refused/held exceptions never burn; wasted does", () => {
  const view = inventory({
    ...DELIVERY_BASELINE,
    doseExceptions: [
      {
        id: "ex-1",
        agencyId: "agency",
        individualId: "person-1",
        medicationId: "med-1",
        occurredOn: "2026-09-06",
        kind: "refused",
        pillsAffected: 2,
        reason: "Refused",
        createdBy: "user-1",
        createdAt: "2026-09-06T13:00:00.000Z",
      },
      {
        id: "ex-2",
        agencyId: "agency",
        individualId: "person-1",
        medicationId: "med-1",
        occurredOn: "2026-09-06",
        kind: "wasted",
        pillsAffected: 2,
        reason: "Dropped",
        createdBy: "user-1",
        createdAt: "2026-09-06T13:00:00.000Z",
      },
    ],
  });
  const result = medCountdown(view, [], TODAY);
  assert.equal(result.pillsLeft, 26);
});

test("adapter: a med with no count date has no countdown number", () => {
  const result = medCountdown(inventory({ lastCountedOn: null }), [], TODAY);
  assert.equal(result.hasBaseline, false);
  assert.equal(result.label, "No count recorded yet");
});
