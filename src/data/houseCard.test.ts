import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOUSE_CARD_LOW_BALANCE_CENTS,
  buildHouseCardLedger,
  computeBalanceCents,
  formatCents,
  isLowBalance,
  isPostCloseCorrection,
  recentHouseCardLocations,
  summarizeHouseCardMonth,
  validateHouseCardDraft,
  type HouseCardEntryRow,
  type HouseCardMonthClose,
} from "./houseCard";
import { createEvergreenSeed } from "./seed";
import { centralTodayIso } from "./menuRecords";

let seq = 0;
function row(partial: Partial<HouseCardEntryRow>): HouseCardEntryRow {
  seq += 1;
  return {
    id: `e${seq}`,
    agencyId: "agency",
    siteId: "site",
    entryDate: "2026-10-05",
    kind: "purchase",
    location: "Store",
    amountCents: 1000,
    category: "groceries_household",
    individualId: null,
    note: "",
    receiptPhoto: null,
    recordedBy: "u1",
    recordedByName: "Recorder",
    recordedByRole: "dsp",
    createdAt: `2026-10-05T1${seq % 10}:00:00.000Z`,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    ...partial,
  };
}

const NAMES = new Map([
  ["ind-ellis", "Ellis Hart"],
  ["ind-morgan", "Morgan Pruitt"],
]);

test("balance: credits and refunds add, purchases subtract, voided never count", () => {
  const entries = [
    row({ kind: "credit", category: null, amountCents: 60000, entryDate: "2026-10-01" }),
    row({ amountCents: 10000, entryDate: "2026-10-02" }),
    row({ kind: "refund", category: null, amountCents: 1500, entryDate: "2026-10-03" }),
    row({
      amountCents: 9999,
      entryDate: "2026-10-04",
      voidedBy: "u1",
      voidedAt: "2026-10-04T20:00:00.000Z",
      voidReason: "Wrong amount.",
    }),
  ];
  assert.equal(computeBalanceCents(entries), 51500);
});

test("month summary: opening balance carries from all prior months", () => {
  const entries = [
    row({ kind: "credit", category: null, amountCents: 50000, entryDate: "2026-09-01" }),
    row({ amountCents: 12000, entryDate: "2026-09-15" }),
    row({ kind: "credit", category: null, amountCents: 60000, entryDate: "2026-10-01" }),
    row({ amountCents: 5000, entryDate: "2026-10-10" }),
  ];
  const october = summarizeHouseCardMonth(entries, "2026-10", NAMES);
  assert.equal(october.openingBalanceCents, 38000);
  assert.equal(october.totalCreditedCents, 60000);
  assert.equal(october.totalSpentCents, 5000);
  assert.equal(october.closingBalanceCents, 93000);
  assert.equal(october.entryCount, 2);
});

test("month summary: totals by category and by Individual, voided excluded", () => {
  const entries = [
    row({ kind: "credit", category: null, amountCents: 60000, entryDate: "2026-10-01" }),
    row({ amountCents: 8000, entryDate: "2026-10-02" }), // groceries
    row({ amountCents: 4000, category: "gas", individualId: "ind-ellis", entryDate: "2026-10-03" }),
    row({ amountCents: 1200, category: "health_card", individualId: "ind-morgan", entryDate: "2026-10-04" }),
    row({ amountCents: 9000, category: "food_stamps", individualId: "ind-ellis", entryDate: "2026-10-05" }),
    row({
      amountCents: 7000,
      category: "gas",
      individualId: "ind-ellis",
      entryDate: "2026-10-06",
      voidedBy: "u1",
      voidedAt: "2026-10-06T20:00:00.000Z",
      voidReason: "Duplicate.",
    }),
    row({ kind: "refund", category: null, amountCents: 500, entryDate: "2026-10-07" }),
  ];
  const summary = summarizeHouseCardMonth(entries, "2026-10", NAMES);
  assert.equal(summary.totalDepositedCents, 60500);
  assert.equal(summary.totalSpentCents, 22200);
  assert.equal(summary.closingBalanceCents, 38300);
  assert.equal(summary.voidedCount, 1);
  const byCategory = new Map(
    summary.categoryTotals.map((total) => [total.category, total.totalCents]),
  );
  assert.equal(byCategory.get("groceries_household"), 8000);
  assert.equal(byCategory.get("gas"), 4000);
  assert.equal(byCategory.get("health_card"), 1200);
  assert.equal(byCategory.get("food_stamps"), 9000);
  const labels = new Map(
    summary.categoryTotals.map((total) => [total.category, total.label]),
  );
  assert.equal(labels.get("groceries_household"), "Groceries & household");
  assert.equal(labels.get("gas"), "Gas");
  assert.equal(labels.get("health_card"), "Health card");
  assert.equal(labels.get("food_stamps"), "Food stamps");
  const ellis = summary.individualTotals.find((t) => t.individualId === "ind-ellis")!;
  assert.equal(ellis.name, "Ellis Hart");
  assert.equal(ellis.totalCents, 13000);
  const morgan = summary.individualTotals.find((t) => t.individualId === "ind-morgan")!;
  assert.equal(morgan.totalCents, 1200);
});

test("ledger: running balance steps over voided rows without moving", () => {
  const entries = [
    row({ kind: "credit", category: null, amountCents: 10000, entryDate: "2026-10-01", createdAt: "2026-10-01T10:00:00.000Z" }),
    row({ amountCents: 3000, entryDate: "2026-10-02", createdAt: "2026-10-02T10:00:00.000Z" }),
    row({
      amountCents: 2000,
      entryDate: "2026-10-03",
      createdAt: "2026-10-03T10:00:00.000Z",
      voidedBy: "u1",
      voidedAt: "2026-10-03T11:00:00.000Z",
      voidReason: "Wrong store.",
    }),
    row({ amountCents: 1000, entryDate: "2026-10-04", createdAt: "2026-10-04T10:00:00.000Z" }),
  ];
  const ledger = buildHouseCardLedger(entries);
  assert.deepEqual(
    ledger.map((item) => item.runningBalanceCents),
    [10000, 7000, 7000, 6000],
  );
  assert.ok(ledger[2].entry.voidedAt, "the third row is the voided one");
});

test("validation: future dates, bad amounts, and the $250 note rule", () => {
  const today = "2026-10-29";
  assert.throws(
    () =>
      validateHouseCardDraft(
        { entryDate: "2026-10-30", kind: "credit", location: "", amountCents: 100 },
        today,
      ),
    /future/i,
  );
  assert.throws(
    () =>
      validateHouseCardDraft(
        { entryDate: today, kind: "credit", location: "", amountCents: 0 },
        today,
      ),
    /greater than/i,
  );
  // Exactly $250.00 needs no note; $250.01 does.
  const at250 = validateHouseCardDraft(
    {
      entryDate: today,
      kind: "purchase",
      location: "Hy-Vee",
      amountCents: 25000,
      category: "groceries_household",
    },
    today,
  );
  assert.equal(at250.amountCents, 25000);
  assert.throws(
    () =>
      validateHouseCardDraft(
        {
          entryDate: today,
          kind: "purchase",
          location: "Hy-Vee",
          amountCents: 25001,
          category: "groceries_household",
        },
        today,
      ),
    /needs a note/i,
  );
  const noted = validateHouseCardDraft(
    {
      entryDate: today,
      kind: "purchase",
      location: "Hy-Vee",
      amountCents: 25001,
      category: "groceries_household",
      note: "Monthly bulk shop.",
    },
    today,
  );
  assert.equal(noted.note, "Monthly bulk shop.");
});

test("validation: category and Individual shape", () => {
  const today = "2026-10-29";
  assert.throws(
    () =>
      validateHouseCardDraft(
        { entryDate: today, kind: "purchase", location: "Shell", amountCents: 4000, category: "gas" },
        today,
      ),
    /Individual/,
  );
  assert.throws(
    () =>
      validateHouseCardDraft(
        {
          entryDate: today,
          kind: "purchase",
          location: "Hy-Vee",
          amountCents: 4000,
          category: "groceries_household",
          individualId: "ind-ellis",
        },
        today,
      ),
    /Individual/,
  );
  assert.throws(
    () =>
      validateHouseCardDraft(
        {
          entryDate: today,
          kind: "credit",
          location: "",
          amountCents: 4000,
          category: "gas",
          individualId: "ind-ellis",
        },
        today,
      ),
    /categor/i,
  );
});

test("low balance flag trips strictly below $100", () => {
  assert.equal(HOUSE_CARD_LOW_BALANCE_CENTS, 10000);
  assert.equal(isLowBalance(9999), true);
  assert.equal(isLowBalance(10000), false);
  assert.equal(isLowBalance(0), true);
});

test("post-close correction: entries and voids after the signing are flagged", () => {
  const close: HouseCardMonthClose = {
    id: "close-1",
    agencyId: "agency",
    siteId: "site",
    month: "2026-10",
    closingBalanceCents: 12345,
    printedName: "James Wilson",
    signatureText: "James Wilson",
    signedBy: "u-hm",
    signedByName: "James Wilson",
    signedAt: "2026-10-31T15:00:00.000Z",
    createdAt: "2026-10-31T15:00:00.000Z",
  };
  const before = row({ entryDate: "2026-10-10", createdAt: "2026-10-10T10:00:00.000Z" });
  assert.equal(isPostCloseCorrection(before, close), false);
  const createdAfter = row({ entryDate: "2026-10-10", createdAt: "2026-11-01T09:00:00.000Z" });
  assert.equal(isPostCloseCorrection(createdAfter, close), true);
  const voidedAfter = row({
    entryDate: "2026-10-10",
    createdAt: "2026-10-10T10:00:00.000Z",
    voidedBy: "u1",
    voidedAt: "2026-11-02T09:00:00.000Z",
    voidReason: "Late fix.",
  });
  assert.equal(isPostCloseCorrection(voidedAfter, close), true);
  const otherMonth = row({ entryDate: "2026-11-01", createdAt: "2026-11-01T09:00:00.000Z" });
  assert.equal(isPostCloseCorrection(otherMonth, close), false);
  assert.equal(isPostCloseCorrection(createdAfter, null), false);
});

test("recent locations: newest first, deduped, credits and voided skipped", () => {
  const entries = [
    row({ location: "Hy-Vee", createdAt: "2026-10-01T10:00:00.000Z" }),
    row({ location: "hy-vee", createdAt: "2026-10-03T10:00:00.000Z" }),
    row({ location: "Casey's", createdAt: "2026-10-02T10:00:00.000Z" }),
    row({ kind: "credit", category: null, location: "Agency transfer", createdAt: "2026-10-04T10:00:00.000Z" }),
    row({
      location: "Closed Store",
      createdAt: "2026-10-05T10:00:00.000Z",
      voidedBy: "u1",
      voidedAt: "2026-10-05T11:00:00.000Z",
      voidReason: "Wrong.",
    }),
  ];
  assert.deepEqual(recentHouseCardLocations(entries), ["hy-vee", "Casey's"]);
});

test("formatCents renders dollars and cents", () => {
  assert.equal(formatCents(15368), "$153.68");
  assert.equal(formatCents(60000), "$600.00");
  assert.equal(formatCents(-500), "-$5.00");
  assert.equal(formatCents(0), "$0.00");
});

test("Evergreen demo ledgers reconcile exactly for the current month", () => {
  const db = createEvergreenSeed();
  const month = centralTodayIso().slice(0, 7);
  const names = new Map(db.individuals.map((person) => [person.id, person.fullName]));
  const entries = db.houseCardEntries ?? [];
  assert.ok(entries.length >= 20, "both homes are seeded");

  const cedarSite = db.sites.find((site) => site.name === "Cedar House")!;
  const cedar = summarizeHouseCardMonth(
    entries.filter((entry) => entry.siteId === cedarSite.id),
    month,
    names,
  );
  assert.equal(cedar.totalDepositedCents, 61500);
  assert.equal(cedar.totalSpentCents, 46132);
  assert.equal(cedar.closingBalanceCents, 15368);
  assert.equal(cedar.voidedCount, 1);
  const cedarByCategory = new Map(
    cedar.categoryTotals.map((total) => [total.category, total.totalCents]),
  );
  assert.equal(cedarByCategory.get("groceries_household"), 24782);
  assert.equal(cedarByCategory.get("gas"), 10425);
  assert.equal(cedarByCategory.get("health_card"), 1275);
  assert.equal(cedarByCategory.get("food_stamps"), 9650);

  const willowSite = db.sites.find((site) => site.name === "Willow House")!;
  const willow = summarizeHouseCardMonth(
    entries.filter((entry) => entry.siteId === willowSite.id),
    month,
    names,
  );
  assert.equal(willow.totalDepositedCents, 60825);
  assert.equal(willow.totalSpentCents, 51333);
  assert.equal(willow.closingBalanceCents, 9492);
  assert.equal(isLowBalance(willow.closingBalanceCents), true);
  assert.equal(willow.voidedCount, 1);

  // The voided-and-replaced pairs link both ways in both homes.
  for (const entry of entries) {
    if (entry.replacedByEntryId) {
      const replacement = entries.find((e) => e.id === entry.replacedByEntryId)!;
      assert.equal(replacement.replacesEntryId, entry.id);
      assert.ok(entry.voidedAt, "the replaced entry is voided");
    }
  }
});
