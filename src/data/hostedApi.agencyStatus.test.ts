import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import type { SessionUser } from "./types";

/**
 * F-2: rejected is a terminal agency status in HostedApi too (parity
 * with LocalApi). Re-activating a rejected row whose provider code was
 * re-issued would collide with the code's live holder, so
 * setAgencyStatus reads the row first and refuses any move out of
 * "rejected" with a friendly error.
 */
type Row = Record<string, unknown>;

interface StubResult {
  data: unknown;
  error: null;
}

/** Chainable supabase-js stand-in that applies eq filters and updates. */
class StubQuery implements PromiseLike<StubResult> {
  private readonly filters: { column: string; value: unknown }[] = [];
  private updateValues: Row | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, Row[]>,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  update(values: Row) {
    this.updateValues = values;
    return this;
  }

  private resolve(): Row[] {
    return (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
  }

  async maybeSingle(): Promise<StubResult> {
    return { data: this.resolve()[0] ?? null, error: null };
  }

  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.updateValues) {
      for (const row of this.resolve()) Object.assign(row, this.updateValues);
      return Promise.resolve<StubResult>({ data: null, error: null }).then(onfulfilled, onrejected);
    }
    return Promise.resolve<StubResult>({ data: this.resolve(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

function makeSession(): SessionUser {
  return {
    userId: "user-owner",
    email: "owner@example.invalid",
    username: "platform.owner",
    fullName: "Platform Owner",
    jobTitle: "Complyrer operator",
    role: "DSP",
    roleKey: "administrator",
    agencyId: "agency-platform",
    agencyName: "Complyrer",
    agencyCode: "COMPLYRER-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: true,
    agencyStatus: "active",
  } as unknown as SessionUser;
}

function statusApi(tables: Record<string, Row[]>) {
  const client = {
    from: (table: string) => new StubQuery(table, tables),
  } as unknown as SupabaseClient;
  const api = new HostedApi(client);
  (api as unknown as { getSession: () => Promise<SessionUser> }).getSession =
    async () => makeSession();
  return api;
}

test("a rejected agency cannot be brought back (F-2)", async () => {
  const tables: Record<string, Row[]> = {
    agencies: [{ id: "agency-1", status: "rejected" }],
  };
  const api = statusApi(tables);
  await assert.rejects(() => api.setAgencyStatus("agency-1", "active"), /rejection is final/);
  await assert.rejects(() => api.setAgencyStatus("agency-1", "pending"), /rejection is final/);
  assert.equal(tables.agencies[0].status, "rejected");
});

test("ordinary transitions still work, and a missing agency is named (F-2)", async () => {
  const tables: Record<string, Row[]> = {
    agencies: [{ id: "agency-1", status: "pending" }],
  };
  const api = statusApi(tables);
  await api.setAgencyStatus("agency-1", "rejected");
  assert.equal(tables.agencies[0].status, "rejected");
  await assert.rejects(() => api.setAgencyStatus("agency-missing", "active"), /Agency not found/);
});
