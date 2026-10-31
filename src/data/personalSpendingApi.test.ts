import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { centralTodayIso } from "./menuRecords";
import {
  computePersonalBalanceCents,
  personalSpendingNeedsAttention,
} from "./personalSpending";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function people(api: LocalApi) {
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((i) => i.name === "Ellis Hart")!;
  const harper = workspace.individuals.find((i) => i.name === "Harper Soto")!;
  const casey = (workspace.staff ?? []).find((s) => s.name === "Casey Adams")!;
  const james = (workspace.staff ?? []).find((s) => s.name === "James Wilson")!;
  await api.signOut();
  return { ellis, harper, casey, james };
}

const today = () => centralTodayIso();
const thisMonth = () => centralTodayIso().slice(0, 7);
function prevMonth() {
  const [y, m] = today().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

test("demo seed reconciles: Ellis carries a closed month forward, Harper shows the guardrail", async () => {
  const api = new LocalApi(store());
  const { ellis, harper } = await people(api);
  await api.signIn(login(DEMO_ADMIN_USERNAME));

  const ellisEntries = await api.listPersonalSpendingEntries(ellis.id);
  assert.equal(computePersonalBalanceCents(ellisEntries), 18084);
  const ellisCloses = await api.listPersonalSpendingMonthCloses(ellis.id);
  assert.equal(ellisCloses.length, 1);
  assert.equal(ellisCloses[0].month, prevMonth());
  assert.equal(ellisCloses[0].closingBalanceCents, 9388);
  assert.equal(ellisCloses[0].individualSignoff, "individual_signed");
  assert.equal(ellisCloses[0].secondStaffId, null);
  assert.equal(personalSpendingNeedsAttention(ellisEntries, ellisCloses), false);

  const harperEntries = await api.listPersonalSpendingEntries(harper.id);
  assert.equal(computePersonalBalanceCents(harperEntries), 1020);
  const over = harperEntries.filter((entry) => entry.overBalance);
  assert.equal(over.length, 1);
  assert.equal(over[0].amountCents, 9640);
  assert.equal(over[0].runningBalanceCents, -3355);
  const harperCloses = await api.listPersonalSpendingMonthCloses(harper.id);
  assert.equal(personalSpendingNeedsAttention(harperEntries, harperCloses), true);
});

test("DSP records for their own Individual and is refused at the other home", async () => {
  const api = new LocalApi(store());
  const { ellis, harper } = await people(api);
  await api.signIn(login(DEMO_DSP_USERNAME)); // Alex Morgan, Cedar DSP

  const created = await api.createPersonalSpendingEntry({
    individualId: ellis.id,
    entryDate: today(),
    kind: "spend",
    location: "Shell",
    purpose: "Gas for an outing",
    amountCents: 1200,
  });
  assert.equal(created.recordedByName, "Alex Morgan");
  assert.equal(created.purpose, "Gas for an outing");

  const ellisEntries = await api.listPersonalSpendingEntries(ellis.id);
  assert.ok(ellisEntries.some((entry) => entry.id === created.id));

  await assert.rejects(() => api.listPersonalSpendingEntries(harper.id));
  await assert.rejects(() =>
    api.createPersonalSpendingEntry({
      individualId: harper.id,
      entryDate: today(),
      kind: "spend",
      location: "Shell",
      purpose: "Gas",
      amountCents: 500,
    }),
  );
  // A DSP is not a closer.
  await assert.rejects(() =>
    api.closePersonalSpendingMonth({
      individualId: ellis.id,
      month: thisMonth(),
      signatureText: "Alex Morgan",
      individualSignoff: "individual_signed",
    }),
  );
});

test("a spend without a purpose is refused; a deposit takes a source, not a purpose", async () => {
  const api = new LocalApi(store());
  const { ellis } = await people(api);
  await api.signIn(login(DEMO_DSP_USERNAME));

  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: today(),
        kind: "spend",
        location: "Target",
        purpose: "",
        amountCents: 500,
      }),
    /what this spend was for/i,
  );
  const deposit = await api.createPersonalSpendingEntry({
    individualId: ellis.id,
    entryDate: today(),
    kind: "deposit",
    location: "Family",
    amountCents: 1000,
  });
  assert.equal(deposit.purpose, "");
});

test("nurse cannot see personal spending at all", async () => {
  const api = new LocalApi(store());
  const { ellis } = await people(api);
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(
    () => api.listPersonalSpendingEntries(ellis.id),
    /permission/i,
  );
  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: today(),
        kind: "deposit",
        location: "Family",
        amountCents: 1000,
      }),
    /permission/i,
  );
});

test("a spend that would take the balance below $0 is refused (batch 7)", async () => {
  const api = new LocalApi(store());
  const { harper } = await people(api);
  await api.signIn(login(DEMO_HM_USERNAME)); // James Wilson, Willow HM

  // Harper's balance is $10.20; a $50 spend used to record at -$39.80.
  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: harper.id,
        entryDate: today(),
        kind: "spend",
        location: "Walmart",
        purpose: "Extra personal items",
        amountCents: 5000,
      }),
    /below \$0/,
  );
  const entries = await api.listPersonalSpendingEntries(harper.id);
  assert.equal(computePersonalBalanceCents(entries), 1020);

  // The seeded history still carries its over-balance label + flag:
  // history is documented reality; only NEW over-balance spends stop.
  const over = entries.filter((entry) => entry.overBalance);
  assert.equal(over.length, 1);
  const closes = await api.listPersonalSpendingMonthCloses(harper.id);
  assert.equal(personalSpendingNeedsAttention(entries, closes), true);

  // A spend within the balance still records.
  const ok = await api.createPersonalSpendingEntry({
    individualId: harper.id,
    entryDate: today(),
    kind: "spend",
    location: "Dollar General",
    purpose: "Snacks",
    amountCents: 1000,
  });
  assert.equal(ok.overBalance, false);
});

test("a month cannot close on a negative balance; the close figure is the ledger's (batch 7)", async () => {
  const api = new LocalApi(store());
  const { harper } = await people(api);
  await api.signIn(login(DEMO_HM_USERNAME)); // James Wilson, Willow HM

  // Voiding Harper's $50 family deposit (a correction, not a spend)
  // takes the balance to -$39.80 — the state batch 7 closed at -$15.
  const entries = await api.listPersonalSpendingEntries(harper.id);
  const familyDeposit = entries.find(
    (entry) => entry.kind === "deposit" && entry.amountCents === 5000,
  )!;
  await api.voidPersonalSpendingEntry(
    familyDeposit.id,
    "The deposit was recorded twice.",
  );
  assert.equal(
    computePersonalBalanceCents(await api.listPersonalSpendingEntries(harper.id)),
    1020 - 5000,
  );

  await assert.rejects(
    () =>
      api.closePersonalSpendingMonth({
        individualId: harper.id,
        month: thisMonth(),
        signatureText: "James Wilson",
        individualSignoff: "individual_signed",
      }),
    /below \$0/,
  );

  // Record the funds and the close lands on the ledger's own figure.
  await api.createPersonalSpendingEntry({
    individualId: harper.id,
    entryDate: today(),
    kind: "deposit",
    location: "Family",
    amountCents: 5000,
  });
  const close = await api.closePersonalSpendingMonth({
    individualId: harper.id,
    month: thisMonth(),
    signatureText: "James Wilson",
    individualSignoff: "individual_signed",
  });
  assert.equal(close.closingBalanceCents, 1020);
});

test("a replacement spend that would over-draw is refused and the original stays live", async () => {
  const api = new LocalApi(store());
  const { ellis } = await people(api);
  await api.signIn(login(DEMO_DSP_USERNAME));

  const created = await api.createPersonalSpendingEntry({
    individualId: ellis.id,
    entryDate: today(),
    kind: "spend",
    location: "ALDI",
    purpose: "Favorite foods",
    amountCents: 1244,
  });
  await assert.rejects(
    () =>
      api.voidPersonalSpendingEntry(created.id, "Keyed the wrong total.", {
        individualId: ellis.id,
        entryDate: today(),
        kind: "spend",
        location: "ALDI",
        purpose: "Favorite foods",
        amountCents: 999999,
      }),
    /below \$0/,
  );
  const entries = await api.listPersonalSpendingEntries(ellis.id);
  const original = entries.find((entry) => entry.id === created.id)!;
  assert.equal(original.voided, false);
});

test("void and replace: the original stops counting and the pair stays linked", async () => {
  const api = new LocalApi(store());
  const { ellis } = await people(api);
  await api.signIn(login(DEMO_DSP_USERNAME));

  const created = await api.createPersonalSpendingEntry({
    individualId: ellis.id,
    entryDate: today(),
    kind: "spend",
    location: "ALDI",
    purpose: "Favorite foods",
    amountCents: 1244,
  });
  const before = computePersonalBalanceCents(
    await api.listPersonalSpendingEntries(ellis.id),
  );
  const { voided, replacement } = await api.voidPersonalSpendingEntry(
    created.id,
    "Keyed the wrong total.",
    {
      individualId: ellis.id,
      entryDate: today(),
      kind: "spend",
      location: "ALDI",
      purpose: "Favorite foods",
      amountCents: 1424,
    },
  );
  assert.equal(voided.voided, true);
  assert.equal(voided.voidReason, "Keyed the wrong total.");
  assert.ok(replacement);
  assert.equal(replacement!.replacesEntryId, created.id);
  assert.equal(voided.replacedByEntryId, replacement!.id);
  const after = computePersonalBalanceCents(
    await api.listPersonalSpendingEntries(ellis.id),
  );
  assert.equal(after, before + 1244 - 1424);
  await assert.rejects(
    () => api.voidPersonalSpendingEntry(created.id, "Again."),
    /already voided/i,
  );
});

test("closed months refuse new entries — including the seeded signed month", async () => {
  const api = new LocalApi(store());
  const { ellis } = await people(api);
  await api.signIn(login(DEMO_ADMIN_USERNAME)); // Sarah Mitchell, administrator

  // Ellis's previous month was signed closed in the seed.
  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: `${prevMonth()}-15`,
        kind: "deposit",
        location: "Family",
        amountCents: 1000,
      }),
    /closed and signed/i,
  );

  const close = await api.closePersonalSpendingMonth({
    individualId: ellis.id,
    month: thisMonth(),
    signatureText: "Sarah Mitchell",
    individualSignoff: "individual_signed",
  });
  assert.equal(close.printedName, "Sarah Mitchell");
  assert.equal(close.closingBalanceCents, 18084);
  await assert.rejects(
    () =>
      api.closePersonalSpendingMonth({
        individualId: ellis.id,
        month: thisMonth(),
        signatureText: "Sarah Mitchell",
        individualSignoff: "individual_signed",
      }),
    /already closed/i,
  );
  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: today(),
        kind: "deposit",
        location: "Family",
        amountCents: 1000,
      }),
    /closed and signed/i,
  );
});

test("dual sign-off: the unable case names a second staff member, never the closer", async () => {
  const api = new LocalApi(store());
  const { harper, casey, james } = await people(api);
  await api.signIn(login(DEMO_HM_USERNAME)); // James Wilson closes Harper's month

  // Missing the second signature: refused by validation.
  await assert.rejects(
    () =>
      api.closePersonalSpendingMonth({
        individualId: harper.id,
        month: thisMonth(),
        signatureText: "James Wilson",
        individualSignoff: "unable_second_staff",
        secondStaffId: casey.id,
      }),
    /second staff member's signature/i,
  );
  // The closer cannot be their own second staff member.
  await assert.rejects(
    () =>
      api.closePersonalSpendingMonth({
        individualId: harper.id,
        month: thisMonth(),
        signatureText: "James Wilson",
        individualSignoff: "unable_second_staff",
        secondStaffId: james.id,
        secondStaffSignatureText: "James Wilson",
      }),
    /someone other than/i,
  );

  const close = await api.closePersonalSpendingMonth({
    individualId: harper.id,
    month: thisMonth(),
    signatureText: "James Wilson",
    individualSignoff: "unable_second_staff",
    secondStaffId: casey.id,
    secondStaffSignatureText: "Casey Adams",
  });
  assert.equal(close.individualSignoff, "unable_second_staff");
  assert.equal(close.secondStaffId, casey.id);
  assert.equal(close.secondStaffName, "Casey Adams");
  assert.equal(close.secondStaffSignatureText, "Casey Adams");
  assert.equal(close.closingBalanceCents, 1020);
});

test("auditor reads and prints but cannot record, void, or close", async () => {
  const db = store();
  const api = new LocalApi(db);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const { ellis } = await people(api);

  const auditorId = "00000000-0000-4000-8000-0000000000au";
  db.db.profiles.push({
    id: auditorId,
    fullName: "Uma Auditor",
    email: "uma.auditor@demo.complyrer.user",
    jobTitle: "Auditor",
    username: "uma.auditor",
    homeAgencyId: admin.agencyId,
    mustChangePassword: false,
  });
  db.db.memberships.push({
    id: "00000000-0000-4000-8000-000000000aum",
    agencyId: admin.agencyId,
    userId: auditorId,
    role: "auditor",
    roleKey: "auditor",
    siteId: null,
    expiresOn: null,
  });
  db.db.credentials.push({
    userId: auditorId,
    email: "uma.auditor@demo.complyrer.user",
    password: DEMO_PASSWORD,
  });
  await api.signOut();
  await api.signIn(login("uma.auditor"));

  const entries = await api.listPersonalSpendingEntries(ellis.id);
  assert.ok(entries.length > 0);
  await assert.rejects(
    () =>
      api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: today(),
        kind: "deposit",
        location: "Family",
        amountCents: 100,
      }),
    /permission/i,
  );
  await assert.rejects(
    () => api.voidPersonalSpendingEntry(entries[0].id, "Nope."),
    /permission/i,
  );
  await assert.rejects(
    () =>
      api.closePersonalSpendingMonth({
        individualId: ellis.id,
        month: thisMonth(),
        signatureText: "Uma Auditor",
        individualSignoff: "individual_signed",
      }),
    /permission/i,
  );
});
