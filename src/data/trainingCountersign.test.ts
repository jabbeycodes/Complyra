/**
 * trainingCountersign.test.ts — simulation batch 24: a house manager
 * countersigned her OWN training checklist. A countersignature is a
 * second person's attestation, so the owner must be refused in both
 * APIs (staff-sheet flow + legacy checklist flow, plus the hosted
 * mirrors), while a different manager's countersign still succeeds.
 *
 * Run: node --import tsx --test src/data/trainingCountersign.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

const SELF_MESSAGE = /You can't countersign your own checklist\./;

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

test("local: an HM cannot countersign her own staff sheet; another manager can", async () => {
  const api = new LocalApi(store());
  const adminSession = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(adminSession);
  const hm = workspace.staff.find((person) => person.username === DEMO_HM_USERNAME);
  assert.ok(hm, "demo HM exists");
  const siteId = workspace.sites[0].id;

  await api.assignTraining({ userId: hm.id, siteId, source: "checklist" });
  const profile = await api.getStaffTrainingProfile(hm.id);
  assert.ok(profile.requirements.length > 0);

  // The HM initials her own lines (trainer: the admin) and signs her sheet.
  const hmSession = await api.signIn(login(DEMO_HM_USERNAME));
  for (const line of profile.requirements) {
    await api.initialRequirementLine(line.id, {
      initials: "HM",
      trainerUserId: adminSession.userId,
      method: "shadowing",
      hoursTotal: 1,
      hoursWithHm: 0.2,
    });
  }
  await api.signStaffChecklist({
    userId: hm.id,
    siteId,
    role: "staff",
    signatureName: hmSession.fullName,
  });

  // Self-countersign: refused with the plain message, nothing recorded.
  await assert.rejects(
    () =>
      api.signStaffChecklist({
        userId: hm.id,
        siteId,
        role: "hm",
        signatureName: hmSession.fullName,
      }),
    SELF_MESSAGE,
  );
  const afterRefusal = await api.getStaffTrainingProfile(hm.id);
  assert.equal(afterRefusal.countersignatures[0]?.hmSignedAt, null);

  // A different manager (the administrator) countersigns successfully.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.signStaffChecklist({
    userId: hm.id,
    siteId,
    role: "hm",
    signatureName: adminSession.fullName,
  });
  const after = await api.getStaffTrainingProfile(hm.id);
  assert.ok(after.countersignatures[0]?.hmSignedAt);
  assert.equal(after.countersignatures[0]?.hmSignatureName, adminSession.fullName);
});

test("local: an HM cannot countersign her own legacy checklist; another manager can", async () => {
  const api = new LocalApi(store());
  const hmSession = await api.signIn(login(DEMO_HM_USERNAME));
  const st = (api as unknown as { store: MemoryStore }).store;
  const checklistId = crypto.randomUUID();
  st.db.trainingChecklists.push({
    id: checklistId,
    agencyId: hmSession.agencyId,
    individualId: "individual-1",
    staffUserId: hmSession.userId,
    staffName: hmSession.fullName,
    documentVersionId: null,
    items: [{ id: "l1", title: "Test line 1", initialedAt: null }],
    staffSignedAt: null,
    staffSignatureName: null,
    hmSignedAt: null,
    hmSignatureName: null,
  });
  const checklist = st.db.trainingChecklists.find((row) => row.id === checklistId)!;
  await api.initialTrainingLine(checklistId, "l1");
  await api.signTrainingChecklist(checklistId, "staff", hmSession.fullName);

  await assert.rejects(
    () => api.signTrainingChecklist(checklistId, "hm", hmSession.fullName),
    SELF_MESSAGE,
  );
  assert.equal(checklist.hmSignedAt, null);

  const adminSession = await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.signTrainingChecklist(checklistId, "hm", adminSession.fullName);
  assert.ok(checklist.hmSignedAt);
  assert.equal(checklist.hmSignatureName, adminSession.fullName);
});

/* ------------------------------ HostedApi ------------------------------ */

const AGENCY_ID = "agency-1";
const HM_ID = "hm-1";
const SITE_ID = "site-1";

type StubResult = { data: unknown; error: unknown };

class StubQuery implements PromiseLike<StubResult> {
  constructor(
    private readonly table: string,
    private readonly ctx: { updates: { table: string }[] },
  ) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert() {
    return this;
  }
  update() {
    this.ctx.updates.push({ table: this.table });
    return this;
  }
  async single(): Promise<StubResult> {
    return singleFor(this.table);
  }
  async maybeSingle(): Promise<StubResult> {
    return singleFor(this.table);
  }
  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(listFor(this.table)).then(onfulfilled, onrejected);
  }
}

function singleFor(table: string): StubResult {
  switch (table) {
    case "agency_roles":
      return { data: { permissions: {} }, error: null };
    case "training_countersignatures":
      return {
        data: {
          id: "counter-1",
          agency_id: AGENCY_ID,
          user_id: HM_ID,
          site_id: SITE_ID,
          staff_signature_name: "Harper Manager",
          staff_signature_mark: null,
          staff_signed_at: "2026-10-30T00:00:00.000Z",
          hm_signature_name: null,
          hm_signature_mark: null,
          hm_signed_at: null,
        },
        error: null,
      };
    case "training_checklists":
      return {
        data: {
          id: "checklist-1",
          agency_id: AGENCY_ID,
          individual_id: "ind-1",
          staff_user_id: HM_ID,
          staff_name: "Harper Manager",
          document_version_id: null,
          items: [
            { id: "l1", title: "Line 1", initialedAt: "2026-10-30T00:00:00.000Z" },
          ],
          staff_signed_at: "2026-10-30T00:00:00.000Z",
          staff_signature_name: "Harper Manager",
          hm_signed_at: null,
          hm_signature_name: null,
        },
        error: null,
      };
    case "profiles":
      return { data: { full_name: "Dee DSP" }, error: null };
    case "sites":
      return { data: { name: "Maple House" }, error: null };
    default:
      return { data: null, error: null };
  }
}

function listFor(table: string): StubResult {
  switch (table) {
    case "training_requirements":
      return { data: [{ id: "req-1", status: "complete", due_on: null }], error: null };
    case "training_signoffs":
      return { data: [{ requirement_id: "req-1" }], error: null };
    default:
      return { data: [], error: null };
  }
}

function stubbedHostedApi() {
  const ctx = { updates: [] as { table: string }[] };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: HM_ID, email: "hm@example.invalid" } },
      }),
    },
    rpc: async (name: string) =>
      name === "login_context"
        ? {
            data: {
              profile: {
                id: HM_ID,
                full_name: "Harper Manager",
                email: "hm@example.invalid",
                job_title: "House Manager",
                username: "sim.hm",
                must_change_password: false,
                platform_admin: false,
              },
              membership: {
                agency_id: AGENCY_ID,
                role: "house_manager",
                role_key: "house_manager",
                site_id: SITE_ID,
                expires_on: null,
              },
              agency: {
                id: AGENCY_ID,
                name: "Northstar Care Simulation",
                agency_code: "NORTHSTAR2-MO",
                status: "active",
              },
            },
            error: null,
          }
        : { data: null, error: null },
    from: (table: string) => new StubQuery(table, ctx),
  };
  return { api: new HostedApi(client as unknown as SupabaseClient), ctx };
}

test("hosted: an HM cannot countersign her own staff sheet", async () => {
  const { api, ctx } = stubbedHostedApi();
  await assert.rejects(
    () =>
      api.signStaffChecklist({
        userId: HM_ID,
        siteId: SITE_ID,
        role: "hm",
        signatureName: "Harper Manager",
      }),
    SELF_MESSAGE,
  );
  assert.equal(
    ctx.updates.filter((row) => row.table === "training_countersignatures").length,
    0,
    "no countersignature write was issued",
  );
});

test("hosted: an HM can still countersign a DSP's staff sheet", async () => {
  const { api, ctx } = stubbedHostedApi();
  await api.signStaffChecklist({
    userId: "dsp-1",
    siteId: SITE_ID,
    role: "hm",
    signatureName: "Harper Manager",
  });
  assert.equal(
    ctx.updates.filter((row) => row.table === "training_countersignatures").length,
    1,
  );
});

test("hosted: an HM cannot countersign her own legacy checklist", async () => {
  const { api, ctx } = stubbedHostedApi();
  await assert.rejects(
    () => api.signTrainingChecklist("checklist-1", "hm", "Harper Manager"),
    SELF_MESSAGE,
  );
  assert.equal(
    ctx.updates.filter((row) => row.table === "training_checklists").length,
    0,
    "no checklist write was issued",
  );
});
