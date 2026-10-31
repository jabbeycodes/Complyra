import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_REVIEW_LEAD_DAYS,
  buildReconciliationChecklist,
  compareOrderExpiry,
  countDiscrepancies,
  daysUntilReview,
  normalizeScheduleTimes,
  orderExpiry,
  orderExpiryBoardLabel,
  orderNeedsReview,
  projectOrderToMedication,
  validateOrderInput,
  validateReconciliationItems,
} from "./medicationOrders";
import type { CreateMedicationOrderInput, MedicationOrder } from "./types";

const TODAY = "2026-10-27";

function draft(overrides: Partial<CreateMedicationOrderInput> = {}): CreateMedicationOrderInput {
  return {
    individualId: "ind-1",
    medicationName: "Levetiracetam",
    dose: "500 mg tablet",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    prescriberName: "Dr. Rivera",
    reason: "Seizure control",
    startDate: TODAY,
    ...overrides,
  };
}

function order(overrides: Partial<MedicationOrder> = {}): MedicationOrder {
  return {
    id: "ord-1",
    agencyId: "a",
    individualId: "ind-1",
    medicationName: "Levetiracetam",
    dose: "500 mg tablet",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    isPrn: false,
    startDate: TODAY,
    endReviewDate: null,
    prescriberName: "Dr. Rivera",
    reason: "Seizure control",
    status: "active",
    medicationId: null,
    createdBy: null,
    createdByName: "",
    activatedBy: null,
    activatedByName: "",
    activatedAt: null,
    discontinuedBy: null,
    discontinuedByName: "",
    discontinuedAt: null,
    discontinueReason: "",
    createdAt: `${TODAY}T00:00:00.000Z`,
    updatedAt: `${TODAY}T00:00:00.000Z`,
    ...overrides,
  };
}

test("validateOrderInput trims and normalizes a good draft", () => {
  const result = validateOrderInput(
    draft({ medicationName: "  Levetiracetam  ", scheduleTimes: ["20:00", "08:00", "08:00"] }),
    TODAY,
  );
  assert.equal(result.medicationName, "Levetiracetam");
  assert.deepEqual(result.scheduleTimes, ["08:00", "20:00"]);
  assert.equal(result.isPrn, false);
});

test("validateOrderInput rejects blank required fields", () => {
  assert.throws(() => validateOrderInput(draft({ medicationName: "  " }), TODAY), /medication name/i);
  assert.throws(() => validateOrderInput(draft({ dose: "" }), TODAY), /dose/i);
  assert.throws(() => validateOrderInput(draft({ route: "" }), TODAY), /route/i);
  assert.throws(() => validateOrderInput(draft({ prescriberName: "" }), TODAY), /prescriber/i);
  assert.throws(() => validateOrderInput(draft({ reason: "" }), TODAY), /reason/i);
});

test("validateOrderInput needs a schedule or dose times for non-PRN orders", () => {
  assert.throws(
    () => validateOrderInput(draft({ schedule: "", scheduleTimes: [] }), TODAY),
    /schedule/i,
  );
});

test("validateOrderInput drops dose times for PRN orders", () => {
  const result = validateOrderInput(
    draft({ isPrn: true, schedule: "As needed", scheduleTimes: ["08:00"] }),
    TODAY,
  );
  assert.equal(result.isPrn, true);
  assert.deepEqual(result.scheduleTimes, []);
});

test("validateOrderInput rejects an end date before the start date", () => {
  assert.throws(
    () => validateOrderInput(draft({ startDate: TODAY, endReviewDate: "2026-10-01" }), TODAY),
    /end . review date/i,
  );
});

test("normalizeScheduleTimes rejects malformed times", () => {
  assert.throws(() => normalizeScheduleTimes(["8:00"]), /HH:MM/);
  assert.throws(() => normalizeScheduleTimes(["24:00"]), /HH:MM/);
  assert.deepEqual(normalizeScheduleTimes(["09:30", "09:30"]), ["09:30"]);
});

test("orderExpiry classifies active orders by their review date", () => {
  assert.equal(orderExpiry(order({ endReviewDate: null }), TODAY), "ok");
  assert.equal(orderExpiry(order({ endReviewDate: "2026-12-01" }), TODAY), "ok");
  assert.equal(orderExpiry(order({ endReviewDate: "2026-11-05" }), TODAY), "expiring");
  assert.equal(orderExpiry(order({ endReviewDate: TODAY }), TODAY), "expiring");
  assert.equal(orderExpiry(order({ endReviewDate: "2026-10-20" }), TODAY), "expired");
});

test("orderExpiry only flags active orders", () => {
  assert.equal(orderExpiry(order({ status: "draft", endReviewDate: "2026-10-20" }), TODAY), "ok");
  assert.equal(
    orderExpiry(order({ status: "discontinued", endReviewDate: "2026-10-20" }), TODAY),
    "ok",
  );
});

test("orderExpiry boundary respects the lead window exactly", () => {
  const boundary = order({
    endReviewDate: addDays(TODAY, ORDER_REVIEW_LEAD_DAYS),
  });
  assert.equal(orderExpiry(boundary, TODAY), "expiring");
  const justBeyond = order({ endReviewDate: addDays(TODAY, ORDER_REVIEW_LEAD_DAYS + 1) });
  assert.equal(orderExpiry(justBeyond, TODAY), "ok");
});

test("orderExpiryBoardLabel words the board line the way the notice does", () => {
  // Approaching the review date (within the lead window).
  assert.equal(
    orderExpiryBoardLabel(order({ endReviewDate: "2026-11-05" }), TODAY),
    "Order expires Nov 5, 2026",
  );
  // Past the review date.
  assert.equal(
    orderExpiryBoardLabel(order({ endReviewDate: "2026-10-20" }), TODAY),
    "Order expired Oct 20, 2026",
  );
  // Nothing to flag: on-schedule, open-ended, draft, discontinued.
  assert.equal(orderExpiryBoardLabel(order({ endReviewDate: "2026-12-01" }), TODAY), null);
  assert.equal(orderExpiryBoardLabel(order({ endReviewDate: null }), TODAY), null);
  assert.equal(
    orderExpiryBoardLabel(order({ status: "draft", endReviewDate: "2026-10-20" }), TODAY),
    null,
  );
  assert.equal(
    orderExpiryBoardLabel(order({ status: "discontinued", endReviewDate: "2026-10-20" }), TODAY),
    null,
  );
});

test("daysUntilReview and orderNeedsReview agree with orderExpiry", () => {
  assert.equal(daysUntilReview(order({ endReviewDate: null }), TODAY), null);
  assert.equal(daysUntilReview(order({ endReviewDate: "2026-10-30" }), TODAY), 3);
  assert.equal(orderNeedsReview(order({ endReviewDate: "2026-10-30" }), TODAY), true);
  assert.equal(orderNeedsReview(order({ endReviewDate: "2026-12-30" }), TODAY), false);
});

test("projectOrderToMedication maps scheduled and PRN orders", () => {
  const scheduled = projectOrderToMedication(order());
  assert.equal(scheduled.kind, "scheduled");
  assert.equal(scheduled.pillsPerDay, 2);
  assert.deepEqual(scheduled.doseTimes, ["08:00", "20:00"]);

  const prn = projectOrderToMedication(order({ isPrn: true, scheduleTimes: ["08:00"] }));
  assert.equal(prn.kind, "prn");
  assert.equal(prn.pillsPerDay, 0);
  assert.deepEqual(prn.doseTimes, []);
});

test("buildReconciliationChecklist matches orders to MAR medications", () => {
  const items = buildReconciliationChecklist({
    activeOrders: [
      order({ id: "ord-1", medicationId: "med-1", medicationName: "Levetiracetam", dose: "500 mg" }),
      order({ id: "ord-2", medicationId: null, medicationName: "Sertraline", dose: "50 mg" }),
    ],
    marMedications: [
      { id: "med-1", name: "Levetiracetam", strength: "500 mg", sourceOrderId: "ord-1" },
      { id: "med-9", name: "Melatonin", strength: "3 mg", sourceOrderId: null },
    ],
  });

  const lev = items.find((i) => i.orderId === "ord-1");
  assert.ok(lev);
  assert.equal(lev.decision, "continue");
  assert.equal(lev.discrepancy, false);

  const sertraline = items.find((i) => i.orderId === "ord-2");
  assert.ok(sertraline);
  assert.equal(sertraline.decision, "change");
  assert.equal(sertraline.discrepancy, true);

  const melatonin = items.find((i) => i.medicationId === "med-9");
  assert.ok(melatonin);
  assert.equal(melatonin.orderId, null);
  assert.equal(melatonin.decision, "stop");
  assert.equal(melatonin.discrepancy, true);
});

test("validateReconciliationItems requires a note for change/stop", () => {
  assert.throws(() => validateReconciliationItems([]), /at least one/i);
  assert.throws(
    () =>
      validateReconciliationItems([
        { medicationLabel: "Levetiracetam", decision: "stop", note: "" },
      ]),
    /note/i,
  );
  const ok = validateReconciliationItems([
    { orderId: "ord-1", medicationLabel: "Levetiracetam 500 mg", decision: "continue" },
    { orderId: "ord-2", medicationLabel: "Sertraline 50 mg", decision: "change", note: "New dose" },
  ]);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].note, "");
  assert.equal(countDiscrepancies(ok.map((i) => ({ discrepancy: i.discrepancy }))), 0);
});

test("compareOrderExpiry sorts worst-first then soonest", () => {
  const rows = [
    { expiry: "ok" as const, daysUntilReview: 40 },
    { expiry: "expired" as const, daysUntilReview: -3 },
    { expiry: "expiring" as const, daysUntilReview: 10 },
    { expiry: "expiring" as const, daysUntilReview: 2 },
  ];
  const sorted = [...rows].sort(compareOrderExpiry);
  assert.deepEqual(
    sorted.map((r) => r.expiry),
    ["expired", "expiring", "expiring", "ok"],
  );
  assert.equal(sorted[1].daysUntilReview, 2);
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
