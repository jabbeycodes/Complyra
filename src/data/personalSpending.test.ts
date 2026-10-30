import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalSpendingLedger,
  buildPersonalSpendingViews,
  computePersonalBalanceCents,
  personalSpendingNeedsAttention,
  summarizePersonalSpendingMonth,
  validatePersonalSpendingCloseDraft,
  validatePersonalSpendingDraft,
  type PersonalSpendingEntryRow,
  type PersonalSpendingMonthClose,
} from "./personalSpending";

let seq = 0;
function row(
  partial: Partial<PersonalSpendingEntryRow>,
): PersonalSpendingEntryRow {
  seq += 1;
  return {
    id: `e${seq}`,
    agencyId: "agency",
    siteId: "site",
    individualId: "person-1",
    entryDate: "2026-10-05",
    kind: "spend",
    location: "Target",
    purpose: "Clothing",
    amountCents: 1000,
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

function closeRow(
  partial: Partial<PersonalSpendingMonthClose>,
): PersonalSpendingMonthClose {
  return {
    id: "close-1",
    agencyId: "agency",
    siteId: "site",
    individualId: "person-1",
    month: "2026-10",
    closingBalanceCents: 0,
    printedName: "James Wilson",
    signatureText: "James Wilson",
    signedBy: "hm-1",
    signedByName: "James Wilson",
    signedAt: "2026-11-01T15:00:00.000Z",
    createdAt: "2026-11-01T15:00:00.000Z",
    individualSignoff: "individual_signed",
    secondStaffId: null,
    secondStaffName: null,
    secondStaffSignatureText: null,
    ...partial,
  };
}

const TODAY = "2026-10-29";

test("balance: deposits add, spends subtract, voided never count", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 18500, entryDate: "2026-10-01" }),
    row({ amountCents: 4299, entryDate: "2026-10-03" }),
    row({ amountCents: 850, entryDate: "2026-10-04" }),
    row({
      amountCents: 9999,
      entryDate: "2026-10-05",
      voidedBy: "u1",
      voidedAt: "2026-10-05T20:00:00.000Z",
      voidReason: "Wrong amount.",
    }),
  ];
  assert.equal(computePersonalBalanceCents(entries), 13351);
});

test("ledger: running balance carries across months; voided rows repeat it", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 10000, entryDate: "2026-09-01" }),
    row({ amountCents: 3000, entryDate: "2026-09-10" }),
    row({
      amountCents: 500,
      entryDate: "2026-10-02",
      voidedBy: "u1",
      voidedAt: "2026-10-02T20:00:00.000Z",
      voidReason: "Duplicate.",
    }),
    row({ amountCents: 1200, entryDate: "2026-10-03" }),
  ];
  const ledger = buildPersonalSpendingLedger(entries);
  assert.deepEqual(
    ledger.map((item) => item.runningBalanceCents),
    [10000, 7000, 7000, 5800],
  );
});

test("over-balance: a spend that takes the balance below $0 is marked, deposits never are", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 5000, entryDate: "2026-10-01" }),
    row({ amountCents: 3000, entryDate: "2026-10-02" }),
    row({ amountCents: 4500, entryDate: "2026-10-03" }),
    row({ amountCents: 1000, entryDate: "2026-10-04" }),
    row({ kind: "deposit", purpose: "", amountCents: 6000, entryDate: "2026-10-05" }),
  ];
  const ledger = buildPersonalSpendingLedger(entries);
  assert.deepEqual(
    ledger.map((item) => item.overBalance),
    [false, false, true, true, false],
  );
  assert.equal(ledger[4].runningBalanceCents, 2500);
});

test("over-balance: a voided overspend does not mark anything", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 1000, entryDate: "2026-10-01" }),
    row({
      amountCents: 5000,
      entryDate: "2026-10-02",
      voidedBy: "u1",
      voidedAt: "2026-10-02T20:00:00.000Z",
      voidReason: "Keyed from the wrong receipt.",
    }),
  ];
  const ledger = buildPersonalSpendingLedger(entries);
  assert.deepEqual(
    ledger.map((item) => item.overBalance),
    [false, false],
  );
  assert.equal(computePersonalBalanceCents(entries), 1000);
});

test("month summary: opening carries, totals split, over-balance counted", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 9388, entryDate: "2026-09-02" }),
    row({ kind: "deposit", purpose: "", amountCents: 12000, entryDate: "2026-10-01" }),
    row({ amountCents: 15000, entryDate: "2026-10-10" }),
    row({ amountCents: 9640, entryDate: "2026-10-14" }),
    row({
      amountCents: 700,
      entryDate: "2026-10-20",
      voidedBy: "u1",
      voidedAt: "2026-10-20T20:00:00.000Z",
      voidReason: "Wrong store.",
    }),
  ];
  const october = summarizePersonalSpendingMonth(entries, "2026-10");
  assert.equal(october.openingBalanceCents, 9388);
  assert.equal(october.totalDepositedCents, 12000);
  assert.equal(october.totalSpentCents, 24640);
  assert.equal(october.closingBalanceCents, -3252);
  assert.equal(october.entryCount, 3);
  assert.equal(october.voidedCount, 1);
  // The $150 spend leaves $63.88 (fine); the $96.40 spend goes below $0.
  assert.equal(october.overBalanceCount, 1);
});

test("needs attention: over-balance in an open month flags; a signed month settles it", () => {
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 2000, entryDate: "2026-10-01" }),
    row({ amountCents: 5000, entryDate: "2026-10-02" }),
  ];
  assert.equal(personalSpendingNeedsAttention(entries, []), true);
  assert.equal(
    personalSpendingNeedsAttention(entries, [closeRow({ month: "2026-10" })]),
    false,
  );
  const healthy = [
    row({ kind: "deposit", purpose: "", amountCents: 9000, entryDate: "2026-10-01" }),
    row({ amountCents: 5000, entryDate: "2026-10-02" }),
  ];
  assert.equal(personalSpendingNeedsAttention(healthy, []), false);
});

test("views: post-close corrections are marked against the person's closes", () => {
  const close = closeRow({ month: "2026-10" });
  const entries = [
    row({ kind: "deposit", purpose: "", amountCents: 5000, entryDate: "2026-10-01", createdAt: "2026-10-01T10:00:00.000Z" }),
    row({ amountCents: 1000, entryDate: "2026-10-03", createdAt: "2026-11-02T10:00:00.000Z" }),
  ];
  const views = buildPersonalSpendingViews(entries, [close], () => "Staff");
  assert.equal(views[0].postCloseCorrection, false);
  assert.equal(views[1].postCloseCorrection, true);
});

test("draft validation: a spend needs a location and a purpose", () => {
  assert.throws(
    () =>
      validatePersonalSpendingDraft(
        { entryDate: TODAY, kind: "spend", location: "", purpose: "Socks", amountCents: 500 },
        TODAY,
      ),
    /where the money was spent/i,
  );
  assert.throws(
    () =>
      validatePersonalSpendingDraft(
        { entryDate: TODAY, kind: "spend", location: "Target", purpose: "  ", amountCents: 500 },
        TODAY,
      ),
    /what this spend was for/i,
  );
  const spend = validatePersonalSpendingDraft(
    { entryDate: TODAY, kind: "spend", location: " Target ", purpose: " Socks ", amountCents: 500 },
    TODAY,
  );
  assert.equal(spend.location, "Target");
  assert.equal(spend.purpose, "Socks");
});

test("draft validation: a deposit names a source and carries no purpose", () => {
  const deposit = validatePersonalSpendingDraft(
    { entryDate: TODAY, kind: "deposit", location: "Monthly personal funds", amountCents: 18500 },
    TODAY,
  );
  assert.equal(deposit.purpose, "");
  assert.throws(
    () =>
      validatePersonalSpendingDraft(
        { entryDate: TODAY, kind: "deposit", location: "Family", purpose: "Birthday", amountCents: 2500 },
        TODAY,
      ),
    /purpose belongs on a spend/i,
  );
});

test("draft validation: future dates and bad amounts are refused", () => {
  assert.throws(
    () =>
      validatePersonalSpendingDraft(
        { entryDate: "2026-10-30", kind: "deposit", location: "", amountCents: 100 },
        TODAY,
      ),
    /future/i,
  );
  assert.throws(
    () =>
      validatePersonalSpendingDraft(
        { entryDate: TODAY, kind: "spend", location: "Target", purpose: "Socks", amountCents: 0 },
        TODAY,
      ),
    /greater than/i,
  );
});

test("close validation: the Individual's sign-off state is required", () => {
  assert.throws(
    () =>
      validatePersonalSpendingCloseDraft({
        month: "2026-10",
        signatureText: "James Wilson",
        individualSignoff: "" as never,
      }),
    /sign-off/i,
  );
  const signed = validatePersonalSpendingCloseDraft({
    month: "2026-10",
    signatureText: "James Wilson",
    individualSignoff: "individual_signed",
  });
  assert.equal(signed.secondStaffId, null);
  assert.equal(signed.secondStaffSignatureText, null);
});

test("close validation: the unable case requires a second staff member and their signature", () => {
  assert.throws(
    () =>
      validatePersonalSpendingCloseDraft({
        month: "2026-10",
        signatureText: "James Wilson",
        individualSignoff: "unable_second_staff",
      }),
    /second staff member who signed/i,
  );
  assert.throws(
    () =>
      validatePersonalSpendingCloseDraft({
        month: "2026-10",
        signatureText: "James Wilson",
        individualSignoff: "unable_second_staff",
        secondStaffId: "dsp-1",
      }),
    /second staff member's signature/i,
  );
  const unable = validatePersonalSpendingCloseDraft({
    month: "2026-10",
    signatureText: "James Wilson",
    individualSignoff: "unable_second_staff",
    secondStaffId: "dsp-1",
    secondStaffSignatureText: "Alex Morgan",
  });
  assert.equal(unable.secondStaffId, "dsp-1");
  assert.equal(unable.secondStaffSignatureText, "Alex Morgan");
  assert.throws(
    () =>
      validatePersonalSpendingCloseDraft({
        month: "2026-10",
        signatureText: "James Wilson",
        individualSignoff: "individual_signed",
        secondStaffId: "dsp-1",
        secondStaffSignatureText: "Alex Morgan",
      }),
    /only when the Individual was unable/i,
  );
});
