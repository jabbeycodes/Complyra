import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import type { SessionUser } from "./types";

/**
 * Wave 7S pins (simulation batch 103 + Pass 7 roll-up), hosted half:
 * HostedApi built the Training page roster from training_requirements
 * user ids, so a staffer with no training rows was invisible — in the
 * simulated agency the roster came back EMPTY under an "Everyone is
 * cleared" verdict while Quinn's own page said NOT CLEARED.
 *
 * The roster now comes from agency memberships (parity with LocalApi).
 * Fixture Quinn has a membership with site_id NULL (no home, no
 * assignments) and zero requirement rows: he must appear exactly once,
 * NOT CLEARED, labelled "No site assigned", and his roster verdict must
 * equal his profile verdict (the self view).
 */
type Row = Record<string, unknown>;

const AGENCY = "agency-1";

const PROFILES: Row[] = [
  { id: "user-quinn", full_name: "Quinn Newhire" },
  { id: "user-avery", full_name: "Avery Cole" },
  { id: "user-other", full_name: "Outside Person" },
];

const SITES: Row[] = [
  { id: "site-maple", name: "Maple House" },
  { id: "site-juniper", name: "Juniper House" },
];

const MEMBERSHIPS: Row[] = [
  // Quinn: agency member with NO home site — the unassigned new hire.
  { user_id: "user-quinn", agency_id: AGENCY, site_id: null },
  { user_id: "user-avery", agency_id: AGENCY, site_id: "site-maple" },
  // Another agency's member — must never leak in.
  { user_id: "user-other", agency_id: "agency-2", site_id: "site-maple" },
];

const AVERY_REQUIREMENT: Row = {
  id: "req-1",
  agency_id: AGENCY,
  user_id: "user-avery",
  topic_id: "chk-1-04",
  individual_id: null,
  site_id: "site-maple",
  source: "checklist",
  plan_version_id: null,
  delegation_id: null,
  status: "pending",
  due_on: "2999-01-01",
  created_at: "2026-10-01T00:00:00Z",
};

interface StubResult {
  data: unknown;
  error: null;
}

/** Chainable supabase-js stand-in that actually applies eq/in filters. */
class StubQuery implements PromiseLike<StubResult> {
  private readonly filters: { column: string; values: unknown[] }[] = [];

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, Row[]>,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, values: [value] });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, values });
    return this;
  }

  order() {
    return this;
  }

  private resolve(): Row[] {
    return (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => filter.values.includes(row[filter.column])),
    );
  }

  async maybeSingle(): Promise<StubResult> {
    return { data: this.resolve()[0] ?? null, error: null };
  }

  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve<StubResult>({
      data: this.resolve(),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

function makeSession(): SessionUser {
  return {
    userId: "user-admin",
    email: "admin@example.invalid",
    username: "sim.admin",
    fullName: "Ada Admin",
    jobTitle: "Administrator",
    role: "DSP",
    roleKey: "administrator",
    agencyId: AGENCY,
    agencyName: "Northstar Care Simulation",
    agencyCode: "NORTHSTAR2-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: { "hr.view_staff": true },
    platformAdmin: false,
    agencyStatus: "active",
  } as unknown as SessionUser;
}

function rosterApi(tables: Record<string, Row[]>) {
  const client = {
    from: (table: string) => new StubQuery(table, tables),
  } as unknown as SupabaseClient;
  const api = new HostedApi(client);
  (api as unknown as { getSession: () => Promise<SessionUser> }).getSession =
    async () => makeSession();
  return api;
}

function baseTables(requirements: Row[]): Record<string, Row[]> {
  return {
    memberships: MEMBERSHIPS,
    profiles: PROFILES,
    sites: SITES,
    individuals: [],
    training_requirements: requirements,
    training_signoffs: [],
    training_countersignatures: [],
  };
}

test("roster comes from memberships: the unassigned member with no training is listed, not cleared", async () => {
  const api = rosterApi(baseTables([AVERY_REQUIREMENT]));
  const rows = await api.listStaffNeedingClearance();

  assert.deepEqual(
    rows.map((row) => row.userId).sort(),
    ["user-avery", "user-quinn"],
    "every agency member appears exactly once; the other agency's member does not leak in",
  );

  const quinn = rows.find((row) => row.userId === "user-quinn");
  assert.ok(quinn, "Quinn (no home, no training rows) is in the roster");
  assert.equal(quinn.fullName, "Quinn Newhire");
  assert.equal(quinn.clearedForInRatio, false);
  assert.equal(quinn.siteName, "No site assigned");
  assert.ok(
    quinn.gateReasons.some((reason) => /No training assigned yet/.test(reason)),
    "the row names why Quinn is not cleared",
  );

  // The roster verdict IS the profile verdict (Quinn's own page).
  const profile = await api.getStaffTrainingProfile("user-quinn");
  assert.equal(profile.clearedForInRatio, false);
  assert.equal(quinn.clearedForInRatio, profile.clearedForInRatio);

  const avery = rows.find((row) => row.userId === "user-avery");
  assert.ok(avery);
  assert.equal(avery.clearedForInRatio, false);
  assert.equal(avery.pendingCount, 1);
  assert.equal(avery.siteName, "Maple House");
});

test("an agency with members but zero training requirement rows still returns the full roster", async () => {
  // The exact batch 103 shape: nobody has training rows, so the old
  // requirements-derived roster returned [] and the page printed
  // "Everyone is cleared" over an empty table.
  const api = rosterApi(baseTables([]));
  const rows = await api.listStaffNeedingClearance();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.clearedForInRatio === false));
});

test("site filter follows memberships: the unassigned member is in no site's roster", async () => {
  const api = rosterApi(baseTables([AVERY_REQUIREMENT]));
  const rows = await api.listStaffNeedingClearance("site-maple");
  assert.deepEqual(
    rows.map((row) => row.userId),
    ["user-avery"],
  );
  assert.equal(rows[0].siteName, "Maple House");
});
