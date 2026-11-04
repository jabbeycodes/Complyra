import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import type { SessionUser } from "./types";

/**
 * Founder decision 2026-11-04: on a signed Personal Spending month, managers
 * record and void; a DSP does neither, their own entries included. The stub
 * records writes so a refusal is proven to happen before anything is sent.
 */

const INDIVIDUAL = "individual-1";
const MONTH_DATE = "2026-09-15";

const entryRow = {
  id: "entry-1",
  agency_id: "agency-1",
  site_id: "site-1",
  individual_id: INDIVIDUAL,
  entry_date: MONTH_DATE,
  kind: "deposit",
  location: "Family",
  purpose: "",
  amount_cents: 1000,
  note: "",
  receipt_photo: null,
  recorded_by: "user-1",
  recorded_by_name: "Staff",
  recorded_by_role: "dsp",
  created_at: "2026-09-15T12:00:00Z",
  voided_by: null,
  voided_at: null,
  void_reason: null,
  replaces_entry_id: null,
  replaced_by_entry_id: null,
};

function stubClient(closed: boolean) {
  const writes: string[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in", "limit"]) {
      builder[method] = () => builder;
    }
    const rows =
      table === "personal_spending_entries"
        ? [entryRow]
        : table === "personal_spending_month_closes" && closed
          ? [{ id: "close-1" }]
          : [];
    builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    builder.single = async () => ({ data: entryRow, error: null });
    builder.then = (resolve: (value: unknown) => void) =>
      resolve({ data: rows, error: null });
    builder.insert = () => {
      writes.push(`insert ${table}`);
      return builder;
    };
    builder.update = () => {
      writes.push(`update ${table}`);
      return builder;
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, writes };
}

function hostedApi(roleKey: string, closed: boolean) {
  const { client, writes } = stubClient(closed);
  const api = new HostedApi(client);
  const internals = api as unknown as {
    requireSession(): Promise<SessionUser>;
    assertPersonalSpendingReadable(): Promise<unknown>;
    personalSpendingViewsFor(): Promise<unknown[]>;
  };
  internals.requireSession = async () =>
    ({ userId: "user-1", agencyId: "agency-1", roleKey, fullName: "Staff" }) as SessionUser;
  internals.assertPersonalSpendingReadable = async () => ({
    id: INDIVIDUAL,
    siteId: "site-1",
    agencyId: "agency-1",
  });
  internals.personalSpendingViewsFor = async () => [
    { id: "entry-1", kind: "deposit", amountCents: 1000, voided: false },
  ];
  return { api, writes };
}

const draft = {
  individualId: INDIVIDUAL,
  entryDate: MONTH_DATE,
  kind: "deposit" as const,
  location: "Family",
  amountCents: 500,
};

test("hosted: a DSP cannot record on a closed month, and nothing is sent", async () => {
  const { api, writes } = hostedApi("dsp", true);
  await assert.rejects(
    () => api.createPersonalSpendingEntry(draft),
    /can record an entry in a closed month/,
  );
  assert.deepEqual(writes, []);
});

test("hosted: a DSP cannot void their own entry on a closed month, and nothing is sent", async () => {
  const { api, writes } = hostedApi("dsp", true);
  await assert.rejects(
    () => api.voidPersonalSpendingEntry("entry-1", "My own typo.", null),
    /can void an entry in a closed month/,
  );
  await assert.rejects(
    () => api.voidPersonalSpendingEntry("entry-1", "My own typo.", draft),
    /can void an entry in a closed month/,
  );
  assert.deepEqual(writes, []);
});

for (const role of ["administrator", "program_manager", "house_manager"]) {
  test(`hosted: ${role} records and voids on a closed month`, async () => {
    const { api, writes } = hostedApi(role, true);
    await api.createPersonalSpendingEntry(draft);
    assert.deepEqual(writes, ["insert personal_spending_entries"]);
    writes.length = 0;
    await api.voidPersonalSpendingEntry("entry-1", "Post-close correction.", null);
    assert.deepEqual(writes, ["update personal_spending_entries"]);
  });
}

test("hosted: a DSP on an open month records and voids their own entry as before", async () => {
  const { api, writes } = hostedApi("dsp", false);
  await api.createPersonalSpendingEntry(draft);
  await api.voidPersonalSpendingEntry("entry-1", "My own typo.", null);
  assert.deepEqual(writes, [
    "insert personal_spending_entries",
    "update personal_spending_entries",
  ]);
});
