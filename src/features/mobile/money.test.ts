import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountTextOf,
  blankMoneyValues,
  houseEntryDetail,
  houseEntryTitle,
  houseRepeatValues,
  houseSignedAmount,
  houseTodayRows,
  houseTodayTotals,
  orderCategoriesByUse,
  personalEntryDetail,
  personalEntryTitle,
  personalRecentRows,
  personalRepeatValues,
  personalSignedAmount,
  signedAmountText,
  spendingChooserBalanceCents,
  spendingEntriesFor,
} from "./money";
import type {
  HouseCardEntryView,
  HouseCardLedgerRow,
} from "../../data/houseCard";
import type { PersonalSpendingEntryView } from "../../data/personalSpending";

const TODAY = "2026-10-30";

function houseEntry(
  patch: Partial<HouseCardEntryView>,
): HouseCardEntryView {
  return {
    id: "h1",
    agencyId: "a1",
    siteId: "cedar",
    entryDate: TODAY,
    kind: "purchase",
    location: "Hy-Vee",
    amountCents: 1244,
    category: "groceries_household",
    individualId: null,
    note: "",
    receiptPhoto: null,
    recordedBy: "u1",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: "2026-10-30T14:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    individualName: null,
    voidedByName: null,
    voided: false,
    postCloseCorrection: false,
    ...patch,
  };
}

function personalEntry(
  patch: Partial<PersonalSpendingEntryView>,
): PersonalSpendingEntryView {
  return {
    id: "p1",
    agencyId: "a1",
    siteId: "cedar",
    individualId: "ellis",
    entryDate: TODAY,
    kind: "spend",
    location: "Walmart",
    purpose: "Clothing — new shoes",
    amountCents: 4599,
    note: "",
    receiptPhoto: null,
    recordedBy: "u1",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: "2026-10-30T14:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    voidedByName: null,
    voided: false,
    runningBalanceCents: 0,
    overBalance: false,
    postCloseCorrection: false,
    ...patch,
  };
}

test("blank sheet values default to today with nothing carried over", () => {
  const values = blankMoneyValues(TODAY, "purchase");
  assert.equal(values.entryDate, TODAY);
  assert.equal(values.kind, "purchase");
  assert.equal(values.amountText, "");
  assert.equal(values.category, "");
  assert.equal(values.receiptPhoto, null);
});

test("category grid orders by most recent use, unused keep canonical order", () => {
  const entries = [
    houseEntry({ id: "a", category: "groceries_household", createdAt: "2026-10-28T10:00:00.000Z" }),
    houseEntry({ id: "b", category: "gas", createdAt: "2026-10-29T10:00:00.000Z" }),
    houseEntry({ id: "c", category: "groceries_household", createdAt: "2026-10-30T09:00:00.000Z" }),
  ];
  assert.deepEqual(orderCategoriesByUse(entries), [
    "groceries_household",
    "gas",
    "health_card",
    "food_stamps",
  ]);
});

test("category grid ignores voided entries and non-purchases", () => {
  const entries = [
    houseEntry({ id: "a", category: "gas", createdAt: "2026-10-30T10:00:00.000Z", voidedAt: "2026-10-30T11:00:00.000Z" }),
    houseEntry({ id: "b", kind: "credit", category: null, createdAt: "2026-10-30T12:00:00.000Z" }),
  ];
  assert.deepEqual(orderCategoriesByUse(entries), [
    "groceries_household",
    "gas",
    "health_card",
    "food_stamps",
  ]);
});

test("today rows keep ledger order and totals exclude voided entries", () => {
  const ledger: HouseCardLedgerRow<HouseCardEntryView>[] = [
    { entry: houseEntry({ id: "y", entryDate: "2026-10-29" }), runningBalanceCents: 5000 },
    { entry: houseEntry({ id: "t1", amountCents: 2000 }), runningBalanceCents: 3000 },
    {
      entry: houseEntry({
        id: "t2",
        amountCents: 1500,
        voidedAt: "2026-10-30T15:00:00.000Z",
        voided: true,
      }),
      runningBalanceCents: 3000,
    },
    {
      entry: houseEntry({ id: "t3", kind: "credit", category: null, amountCents: 10000 }),
      runningBalanceCents: 13000,
    },
  ];
  assert.deepEqual(
    houseTodayRows(ledger, TODAY).map((row) => row.entry.id),
    ["t1", "t2", "t3"],
  );
  assert.deepEqual(houseTodayTotals(ledger, TODAY), {
    spentCents: 2000,
    receivedCents: 10000,
  });
});

/* Batch 49: the Quick log's Personal Spending surface disagreed by
 * user — one DSP saw per-person amounts, others saw the picker with
 * no amounts at all. The chooser carried no amounts, and the person
 * view collapsed "not loaded yet" into a factual $0.00 / empty
 * ledger. These helpers keep the two states distinct. */

test("spending entries are null (not an empty ledger) before the lists load", () => {
  assert.equal(spendingEntriesFor(null, "ellis"), null);
  assert.equal(spendingChooserBalanceCents(null, "ellis"), null);
});

test("spending entries resolve per person once the lists load", () => {
  const lists = [
    {
      personId: "ellis",
      entries: [
        personalEntry({ id: "p1", kind: "deposit", amountCents: 10000 }),
        personalEntry({ id: "p2", kind: "spend", amountCents: 4599 }),
      ],
    },
    { personId: "morgan", entries: [] },
  ];
  assert.deepEqual(
    spendingEntriesFor(lists, "ellis")?.map((row) => row.id),
    ["p1", "p2"],
  );
  // A loaded home with no row for the person is a factual empty
  // ledger — an empty list, never the not-loaded null.
  assert.deepEqual(spendingEntriesFor(lists, "morgan"), []);
  assert.deepEqual(spendingEntriesFor(lists, "unknown-person"), []);
});

test("chooser balance is the person's derived balance, voided entries excluded", () => {
  const lists = [
    {
      personId: "ellis",
      entries: [
        personalEntry({ id: "p1", kind: "deposit", amountCents: 10000 }),
        personalEntry({ id: "p2", kind: "spend", amountCents: 4599 }),
        personalEntry({
          id: "p3",
          kind: "spend",
          amountCents: 1200,
          voided: true,
          voidedAt: "2026-10-30T15:00:00.000Z",
        }),
      ],
    },
  ];
  assert.equal(spendingChooserBalanceCents(lists, "ellis"), 5401);
  assert.equal(spendingChooserBalanceCents(lists, "morgan"), 0);
});

test("personal recent rows are newest first and honor the limit", () => {
  const views = [
    personalEntry({ id: "p1" }),
    personalEntry({ id: "p2" }),
    personalEntry({ id: "p3" }),
  ];
  assert.deepEqual(
    personalRecentRows(views, 2).map((row) => row.id),
    ["p3", "p2"],
  );
  assert.equal(personalRecentRows(views).length, 3);
});

test("repeat values carry the entry but reset the date and drop the receipt", () => {
  const receipt = {
    id: "r1",
    name: "receipt.jpg",
    dataUrl: "data:image/jpeg;base64,xx",
    capturedAt: "2026-10-28T10:00:00.000Z",
    capturedBy: "u1",
  };
  const house = houseRepeatValues(
    houseEntry({
      entryDate: "2026-10-28",
      category: "gas",
      individualId: "ellis",
      amountCents: 3000,
      receiptPhoto: receipt,
    }),
    TODAY,
  );
  assert.equal(house.entryDate, TODAY);
  assert.equal(house.amountText, "30.00");
  assert.equal(house.category, "gas");
  assert.equal(house.individualId, "ellis");
  assert.equal(house.receiptPhoto, null);

  const personal = personalRepeatValues(
    personalEntry({ entryDate: "2026-10-28", receiptPhoto: receipt }),
    TODAY,
  );
  assert.equal(personal.entryDate, TODAY);
  assert.equal(personal.amountText, "45.99");
  assert.equal(personal.purpose, "Clothing — new shoes");
  assert.equal(personal.receiptPhoto, null);
});

test("row titles and details fall back in words, never blank", () => {
  assert.equal(houseEntryTitle(houseEntry({ location: "" })), "Funds received");
  assert.equal(houseEntryTitle(houseEntry({})), "Hy-Vee");
  assert.equal(
    houseEntryDetail(
      houseEntry({ category: "gas", individualName: "Ellis Hart" }),
    ),
    "Purchase · Gas · Ellis Hart",
  );
  assert.equal(
    personalEntryTitle(personalEntry({ location: "", kind: "deposit", purpose: "" })),
    "Funds received",
  );
  assert.equal(
    personalEntryTitle(personalEntry({ location: "", kind: "spend" })),
    "Spend",
  );
  assert.equal(
    personalEntryDetail(personalEntry({})),
    "Spent · Clothing — new shoes",
  );
  assert.equal(
    personalEntryDetail(personalEntry({ kind: "deposit", purpose: "" })),
    "Funds received",
  );
});

test("signed amounts state direction with + and − signs", () => {
  assert.equal(signedAmountText("in", 2500), "+$25.00");
  assert.equal(signedAmountText("out", 1244), "−$12.44");
  assert.equal(houseSignedAmount(houseEntry({ kind: "purchase" })), "−$12.44");
  assert.equal(
    houseSignedAmount(houseEntry({ kind: "credit", amountCents: 5000 })),
    "+$50.00",
  );
  assert.equal(personalSignedAmount(personalEntry({})), "−$45.99");
  assert.equal(
    personalSignedAmount(personalEntry({ kind: "deposit", amountCents: 1000 })),
    "+$10.00",
  );
  assert.equal(amountTextOf(5), "0.05");
});
