import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "../../data/hostedApi";
import { canViewTrainingRoster, defaultPermissions } from "../../data/permissions";
import { trainingRosterEntries } from "../../data/trainingRosterScope";
import type { SessionUser } from "../../data/types";
import { trainingRosterView } from "./rosterState";

/**
 * Simulation batches 195/196/197: the administrator's and HR's Training roster
 * loaded 0 rows while each DSP's own page and per-person profiles worked.
 * HostedApi built the list from training_requirements, so an agency with no
 * lines assigned yet produced an empty roster. The roster now comes from
 * memberships and is scoped per role.
 */

const AGENCY = "agency-1";
const MAPLE = "site-maple";
const JUNIPER = "site-juniper";

const MEMBERSHIPS = [
  { user_id: "admin", site_id: null, role_key: "administrator" },
  { user_id: "pm", site_id: null, role_key: "program_manager" },
  { user_id: "hr", site_id: null, role_key: "hr" },
  { user_id: "hm-maple", site_id: MAPLE, role_key: "house_manager" },
  { user_id: "dsp-maple", site_id: MAPLE, role_key: "dsp" },
  { user_id: "dsp-juniper", site_id: JUNIPER, role_key: "dsp" },
  // Home at Juniper, but currently assigned to a Maple Individual.
  { user_id: "dsp-float", site_id: JUNIPER, role_key: "dsp" },
];

const ASSIGNMENTS = [
  { id: "a1", agency_id: AGENCY, user_id: "dsp-float", individual_id: "person-maple", site_id: null, starts_on: "2020-01-01", ends_on: null },
];

const INDIVIDUALS = [
  { id: "person-maple", site_id: MAPLE },
  { id: "person-juniper", site_id: JUNIPER },
];

const SITES = [
  { id: MAPLE, name: "Maple House" },
  { id: JUNIPER, name: "Juniper House" },
];

function hostedSession(roleKey: string, userId: string, siteId: string | null): SessionUser {
  return {
    userId,
    email: `${userId}@example.invalid`,
    username: userId,
    fullName: userId,
    jobTitle: roleKey,
    role: roleKey,
    roleKey,
    agencyId: AGENCY,
    agencyName: "Sim agency",
    agencyCode: "SIM-MO",
    siteId,
    mustChangePassword: false,
    expiresOn: null,
    permissions: defaultPermissions(roleKey),
    platformAdmin: false,
    agencyStatus: "active",
  } as SessionUser;
}

/** Thenable query stub over fixed table rows: eq/in filter, no RLS. */
function stubClient(tables: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => !(column in row) || row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      order: () => query,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  };
  return { from } as unknown as SupabaseClient;
}

function hostedApi(session: SessionUser, trainingRows: Record<string, unknown>[] = []) {
  const api = new HostedApi(
    stubClient({
      memberships: MEMBERSHIPS.map((row) => ({ agency_id: AGENCY, ...row })),
      staff_assignments: ASSIGNMENTS,
      individuals: INDIVIDUALS.map((row) => ({ agency_id: AGENCY, full_name: row.id, ...row })),
      sites: SITES,
      training_requirements: trainingRows,
      training_signoffs: [],
      training_countersignatures: [],
      profiles: MEMBERSHIPS.map((row) => ({ id: row.user_id, full_name: row.user_id })),
    }),
  );
  (api as unknown as { requireSession(): Promise<SessionUser> }).requireSession = async () => session;
  return api;
}

const rosterIds = async (session: SessionUser, trainingRows: Record<string, unknown>[] = []) =>
  (await hostedApi(session, trainingRows).listStaffNeedingClearance()).map((row) => row.userId).sort();

const EVERYONE = MEMBERSHIPS.map((row) => row.user_id).sort();

test("administrator sees the full roster with zero training lines assigned (the batch 195 failure)", async () => {
  assert.deepEqual(await rosterIds(hostedSession("administrator", "admin", null)), EVERYONE);
});

test("HR sees the full roster with zero training lines assigned (the batch 196 failure)", async () => {
  assert.deepEqual(await rosterIds(hostedSession("hr", "hr", null)), EVERYONE);
});

test("program manager sees the full roster, without the hr.view_staff write key", async () => {
  const session = hostedSession("program_manager", "pm", null);
  assert.equal(canViewTrainingRoster(session), true);
  assert.equal(session.permissions["hr.view_staff"], false);
  assert.deepEqual(await rosterIds(session), EVERYONE);
});

test("house manager sees their house's staff, an assigned floater and themselves, nobody else", async () => {
  assert.deepEqual(await rosterIds(hostedSession("house_manager", "hm-maple", MAPLE)), [
    "dsp-float",
    "dsp-maple",
    "hm-maple",
  ]);
});

test("DSP cannot load the roster and keeps own-record reads only", async () => {
  const session = hostedSession("dsp", "dsp-maple", MAPLE);
  const api = hostedApi(session);
  assert.equal(canViewTrainingRoster(session), false);
  await assert.rejects(() => api.listStaffNeedingClearance(), /permission/i);
  await assert.rejects(() => api.getStaffTrainingProfile("dsp-juniper"), /permission/i);
  assert.equal((await api.getStaffTrainingProfile("dsp-maple")).clearedForInRatio, false);
});

test("a roster row with no training assigned is not cleared and names the staffer's house", async () => {
  const rows = await hostedApi(hostedSession("hr", "hr", null)).listStaffNeedingClearance();
  const row = rows.find((candidate) => candidate.userId === "dsp-maple");
  assert.equal(row?.clearedForInRatio, false);
  assert.equal(row?.siteName, "Maple House");
  assert.deepEqual(row?.gateReasons.slice(0, 1), ["No training assigned yet"]);
  assert.equal(rows.find((candidate) => candidate.userId === "hr")?.siteName, "No site assigned");
});

test("the site filter never widens a house manager past their houses", () => {
  const entries = (siteId?: string) =>
    trainingRosterEntries({
      session: { userId: "hm-maple", roleKey: "house_manager", siteId: MAPLE, platformAdmin: false },
      memberships: MEMBERSHIPS.map((row) => ({ userId: row.user_id, siteId: row.site_id })),
      assignments: [],
      individualSiteById: new Map(),
      today: "2026-11-02",
      siteId,
    }).map((row) => row.userId);
  assert.deepEqual(entries(JUNIPER), []);
  assert.deepEqual(entries(MAPLE).sort(), ["dsp-maple", "hm-maple"]);
});

test("ended and future assignments do not place a staffer in a house", () => {
  const entries = (startsOn: string, endsOn: string | null) =>
    trainingRosterEntries({
      session: { userId: "hm-maple", roleKey: "house_manager", siteId: MAPLE, platformAdmin: false },
      memberships: [
        { userId: "hm-maple", siteId: MAPLE },
        { userId: "dsp-float", siteId: JUNIPER },
      ],
      assignments: [{ userId: "dsp-float", siteId: MAPLE, individualId: null, startsOn, endsOn }],
      individualSiteById: new Map(),
      today: "2026-11-02",
    }).map((row) => row.userId);
  assert.ok(entries("2026-01-01", null).includes("dsp-float"));
  assert.ok(!entries("2026-01-01", "2026-06-01").includes("dsp-float"));
  assert.ok(!entries("2027-01-01", null).includes("dsp-float"));
});

test("an empty or failed roster load never reads as Everyone is cleared", () => {
  assert.equal(trainingRosterView(null, false).kind, "loading");
  assert.equal(trainingRosterView(null, true).kind, "error");
  assert.equal(trainingRosterView([], false).kind, "empty");
});

test("the migration adds only the program manager to the three training read policies", () => {
  const sql = readFileSync("supabase/migrations/20261031320000_training_roster_pm_read.sql", "utf8");
  for (const table of ["training_requirements", "training_signoffs", "training_countersignatures"]) {
    assert.match(sql, new RegExp(`create policy ${table}_select on public\\.${table}`));
  }
  assert.equal(sql.match(/,program_manager\}/g)?.length, 3);
  assert.doesNotMatch(sql, /_write|_insert|_update|\bdsp\b(?! still)/);
});
