import { test } from "node:test";
import assert from "node:assert/strict";
import { lastRecordedCount, onHandLabel, recordedCountLabel } from "./medInventory";
import type { MedDeliverySummary } from "./types";

function delivery(over: Partial<MedDeliverySummary>): MedDeliverySummary {
  return {
    id: "d1",
    countedOn: "2026-11-02",
    countedAt: "2026-11-02T14:00:00Z",
    remainingPills: 30,
    pillsPerDay: 2,
    recordedBy: "u1",
    recordedByName: "Staff",
    expectedPills: null,
    varianceReason: null,
    ...over,
  };
}

test("lastRecordedCount: newest count record (view.deliveries is newest-first)", () => {
  const record = lastRecordedCount({
    deliveries: [
      delivery({ id: "new", remainingPills: 28, countedOn: "2026-11-03T09:00:00Z" }),
      delivery({ id: "old", remainingPills: 60 }),
    ],
  });
  assert.deepEqual(record, { pills: 28, countedOn: "2026-11-03" });
});

test("lastRecordedCount: no count record → null, never an invented figure", () => {
  assert.equal(lastRecordedCount({ deliveries: [] }), null);
});

test("recordedCountLabel always carries its label and never truncates the figure", () => {
  const label = recordedCountLabel({ pills: 1234.5, countedOn: "2026-11-02" });
  assert.match(label, /^Recorded count: 1234\.5 pills · counted /);
  assert.match(recordedCountLabel({ pills: 1, countedOn: "2026-11-02" }), /^Recorded count: 1 pill · /);
});

test("onHandLabel labels the computed headline figure", () => {
  assert.equal(onHandLabel(23), "On hand: 23 pills");
  assert.equal(onHandLabel(1), "On hand: 1 pill");
  assert.equal(onHandLabel(0), "On hand: 0 pills");
  assert.equal(onHandLabel(10000), "On hand: 10000 pills");
});
