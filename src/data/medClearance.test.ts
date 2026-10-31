import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LocalApi, MemoryStore } from "./localApi";
import { HostedApi } from "./hostedApi";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";
import { todayIso } from "./chart";
import {
  MED_ADMIN_CLEARANCE_MESSAGE,
  medAdminLocked,
  roleRequiresMedClearance,
} from "./medClearance";

/**
 * Medication-administration clearance gate (simulation batches 40 + 50):
 * a DSP whose training is not cleared — including a hire with no training
 * record at all — cannot record doses in either API; cleared DSPs and
 * oversight roles are unaffected; the UI lock hook and the surface
 * wiring are pinned too. The DB layer is pinned by
 * supabase/tests/med_admin_clearance.sql.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");
const CLEARANCE = new RegExp(
  MED_ADMIN_CLEARANCE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

interface P2Collections {
  trainingRequirements: { id: string; userId: string }[];
  trainingSignoffs: { requirementId: string }[];
  trainingCountersignatures: { userId: string }[];
}

function p2(st: MemoryStore): P2Collections {
  return st.db as unknown as P2Collections;
}

/** Remove just the countersignatures: hours complete, sheet unsigned. */
function stripCountersignatures(st: MemoryStore, userId: string) {
  const coll = p2(st);
  coll.trainingCountersignatures = coll.trainingCountersignatures.filter(
    (row) => row.userId !== userId,
  );
}

/** Remove the whole training record: the not-started hire. */
function stripTrainingRecord(st: MemoryStore, userId: string) {
  const coll = p2(st);
  const reqIds = new Set(
    coll.trainingRequirements
      .filter((row) => row.userId === userId)
      .map((row) => row.id),
  );
  coll.trainingRequirements = coll.trainingRequirements.filter(
    (row) => row.userId !== userId,
  );
  coll.trainingSignoffs = coll.trainingSignoffs.filter(
    (row) => !reqIds.has(row.requirementId),
  );
  stripCountersignatures(st, userId);
}

async function dspFixture(st: MemoryStore) {
  const api = new LocalApi(st);
  const session = await api.signIn(login(DEMO_DSP_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  const keppra = `${ellis.id}-med-keppra`;
  const views = await api.getMedInventory(ellis.id);
  const lorazepam = views.find((v) => v.medicationName === "Lorazepam")!;
  return { api, session, ellis, keppra, lorazepam };
}

function nowCentralHhmm(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

async function assertAllFourRefused(
  api: LocalApi,
  fx: Awaited<ReturnType<typeof dspFixture>>,
) {
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: fx.keppra,
        doseDate: todayIso(),
        doseTime: nowCentralHhmm(),
        status: "given",
      }),
    CLEARANCE,
    "markMedDose refused",
  );
  await assert.rejects(
    () =>
      api.logPrnDose(fx.lorazepam.medicationId, {
        pills: 1,
        reason: "Agitation",
      }),
    CLEARANCE,
    "logPrnDose refused",
  );
  await assert.rejects(
    () =>
      api.recordPrnFollowup(fx.lorazepam.medicationId, {
        indication: "Anxiety",
        result: "Calmer after 20 minutes",
      }),
    CLEARANCE,
    "recordPrnFollowup refused",
  );
  await assert.rejects(
    () =>
      api.addMedDoseException({
        medicationId: fx.keppra,
        kind: "wasted",
        pillsAffected: 1,
        reason: "Bottle tipped over",
      }),
    CLEARANCE,
    "addMedDoseException refused",
  );
}

// ---------- Pure rule ----------

test("only the dsp role requires medication clearance", () => {
  assert.equal(roleRequiresMedClearance("dsp"), true);
  for (const role of [
    "administrator",
    "house_manager",
    "program_manager",
    "nurse",
    "compliance_admin",
    "hr",
    "auditor",
  ]) {
    assert.equal(roleRequiresMedClearance(role), false, role);
  }
});

test("the lock decision: uncleared DSP locked, everyone else untouched", () => {
  assert.equal(medAdminLocked("dsp", false), true);
  assert.equal(medAdminLocked("dsp", true), false);
  // Clearance not loaded yet: not locked (the API gate enforces).
  assert.equal(medAdminLocked("dsp", null), false);
  assert.equal(medAdminLocked("nurse", false), false);
  assert.equal(medAdminLocked("house_manager", false), false);
});

// ---------- LocalApi ----------

test("LocalApi: the cleared demo DSP records doses normally", async () => {
  const st = store();
  const fx = await dspFixture(st);
  // The Evergreen seed clears Alex Morgan (SHOWCASE_REVISION 13) exactly
  // so this walkthrough keeps working.
  const profile = await fx.api.getStaffTrainingProfile(fx.session.userId);
  assert.equal(profile.clearedForInRatio, true, "demo DSP seed is cleared");

  await fx.api.markMedDose({
    medicationId: fx.keppra,
    doseDate: todayIso(),
    doseTime: nowCentralHhmm(),
    status: "given",
  });
  await fx.api.logPrnDose(fx.lorazepam.medicationId, {
    pills: 1,
    reason: "Agitation at bedtime",
  });
  await fx.api.recordPrnFollowup(fx.lorazepam.medicationId, {
    indication: "Anxiety",
    result: "Calmer after 20 minutes",
  });
  await fx.api.addMedDoseException({
    medicationId: fx.keppra,
    kind: "wasted",
    pillsAffected: 1,
    reason: "Bottle tipped over",
  });
});

test("LocalApi: a DSP whose sheet is unsigned (not cleared) is refused everywhere", async () => {
  const st = store();
  const fx = await dspFixture(st);
  stripCountersignatures(st, fx.session.userId);
  const profile = await fx.api.getStaffTrainingProfile(fx.session.userId);
  assert.equal(profile.clearedForInRatio, false);
  await assertAllFourRefused(fx.api, fx);
});

test("LocalApi: a DSP with no training record at all is refused everywhere", async () => {
  const st = store();
  const fx = await dspFixture(st);
  stripTrainingRecord(st, fx.session.userId);
  const profile = await fx.api.getStaffTrainingProfile(fx.session.userId);
  assert.equal(profile.clearedForInRatio, false);
  assert.ok(profile.gateReasons.includes("No training assigned yet"));
  await assertAllFourRefused(fx.api, fx);
});

test("LocalApi: nurse and house manager record with no training record", async () => {
  const st = store();
  const nurseApi = new LocalApi(st);
  const nurse = await nurseApi.signIn(login(DEMO_NURSE_USERNAME));
  const nurseProfile = await nurseApi.getStaffTrainingProfile(nurse.userId);
  assert.equal(
    nurseProfile.clearedForInRatio,
    false,
    "the nurse has no training record — and must not need one",
  );
  const ws = await nurseApi.loadWorkspace(nurse);
  const ellis = ws.individuals.find((p) => p.name.includes("Ellis"))!;
  const views = await nurseApi.getMedInventory(ellis.id);
  const lorazepam = views.find((v) => v.medicationName === "Lorazepam")!;
  await nurseApi.logPrnDose(lorazepam.medicationId, {
    pills: 1,
    reason: "Agitation at bedtime",
  });
  await nurseApi.markMedDose({
    medicationId: `${ellis.id}-med-keppra`,
    doseDate: todayIso(),
    doseTime: nowCentralHhmm(),
    status: "given",
  });

  // The demo HM's home is Willow; point his membership at Ellis's home
  // (Cedar) so the Individual is inside his access, as medCluster does.
  const hm = st.db.profiles.find((p) => p.username === DEMO_HM_USERNAME)!;
  st.db.memberships.find((m) => m.userId === hm.id)!.siteId =
    st.db.individuals.find((p) => p.id === ellis.id)!.siteId;
  const hmApi = new LocalApi(st);
  await hmApi.signIn(login(DEMO_HM_USERNAME));
  await hmApi.logPrnDose(lorazepam.medicationId, {
    pills: 1,
    reason: "Breakthrough anxiety",
  });
  await hmApi.addMedDoseException({
    medicationId: `${ellis.id}-med-keppra`,
    kind: "held",
    pillsAffected: 1,
    reason: "Held per RN instruction",
  });
});

test("LocalApi: med counts/deliveries are NOT clearance-gated (role rule only)", async () => {
  const st = store();
  const fx = await dspFixture(st);
  stripTrainingRecord(st, fx.session.userId);
  // A DSP is refused a delivery by the pre-existing role rule — its
  // message, not the clearance message — because counting is a
  // supervised inventory task the gate deliberately leaves alone.
  await assert.rejects(
    () =>
      fx.api.recordMedDelivery({
        medicationId: fx.keppra,
        remainingPills: 10,
        pillsPerDay: 2,
        countedOn: todayIso(),
      }),
    /House manager, RN, or PM records a medication delivery/,
  );
});

// ---------- HostedApi (private gate via internals, noticeGate pattern) ----------

type GateInternals = {
  assertMedAdministrationCleared(session: SessionUser): Promise<void>;
};

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "user-dsp",
    email: "dsp@example.invalid",
    username: "sim.dsp",
    fullName: "Dee DSP",
    jobTitle: "DSP",
    role: "dsp",
    roleKey: "dsp",
    agencyId: "agency-1",
    agencyName: "Northstar Care Simulation",
    agencyCode: "NORTHSTAR2-MO",
    siteId: "site-1",
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

/** Chainable PostgREST stub answering from per-table fixture rows. */
function stubbedHostedApi(tables: Record<string, Record<string, unknown>[]>) {
  const builder = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (
        resolve: (value: { data: Record<string, unknown>[]; error: null }) => void,
      ) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  const client = { from: (table: string) => builder(table) };
  return new HostedApi(client as unknown as SupabaseClient);
}

const CLEARED_TABLES: Record<string, Record<string, unknown>[]> = {
  profiles: [{ full_name: "Dee DSP" }],
  training_requirements: [0, 1, 2].map((i) => ({
    id: `req-${i}`,
    agency_id: "agency-1",
    user_id: "user-dsp",
    topic_id: ["chk-2-02", "chk-2-03", "chk-1-01"][i],
    individual_id: null,
    site_id: "site-1",
    source: "checklist",
    plan_version_id: null,
    delegation_id: null,
    status: "complete",
    due_on: null,
    created_at: "2026-09-01T00:00:00.000Z",
  })),
  training_signoffs: [0, 1, 2].map((i) => ({
    id: `signoff-${i}`,
    requirement_id: `req-${i}`,
    initials: "DD",
    signed_on: "2026-09-01",
    na: false,
    na_reason: null,
    trainer_name: "Hana HM",
    hours_total: [8, 8, 6][i],
    hours_with_hm: [8, 0, 2][i],
    created_at: "2026-09-01T00:00:00.000Z",
  })),
  training_countersignatures: [
    {
      id: "counter-1",
      agency_id: "agency-1",
      user_id: "user-dsp",
      site_id: "site-1",
      staff_signature_name: "Dee DSP",
      staff_signature_mark: "Dee DSP",
      staff_signed_at: "2026-09-01T15:30:00.000Z",
      hm_signature_name: "Hana HM",
      hm_signature_mark: "Hana HM",
      hm_signed_at: "2026-09-01T16:00:00.000Z",
    },
  ],
  sites: [{ id: "site-1", name: "Home A" }],
};

test("HostedApi: an uncleared DSP is refused by the gate", async () => {
  const api = stubbedHostedApi({ profiles: [{ full_name: "Dee DSP" }] });
  const internals = api as unknown as GateInternals;
  await assert.rejects(
    () => internals.assertMedAdministrationCleared(makeSession()),
    CLEARANCE,
  );
});

test("HostedApi: a DSP short on signatures is refused by the gate", async () => {
  const api = stubbedHostedApi({
    ...CLEARED_TABLES,
    training_countersignatures: [],
  });
  const internals = api as unknown as GateInternals;
  await assert.rejects(
    () => internals.assertMedAdministrationCleared(makeSession()),
    CLEARANCE,
  );
});

test("HostedApi: a cleared DSP passes the gate", async () => {
  const api = stubbedHostedApi(CLEARED_TABLES);
  const internals = api as unknown as GateInternals;
  await internals.assertMedAdministrationCleared(makeSession());
});

test("HostedApi: oversight roles pass without any training lookup", async () => {
  const throwingClient = {
    from: () => {
      throw new Error("no query may run for an oversight role");
    },
  };
  const api = new HostedApi(throwingClient as unknown as SupabaseClient);
  const internals = api as unknown as GateInternals;
  await internals.assertMedAdministrationCleared(
    makeSession({ roleKey: "nurse", role: "nurse" }),
  );
  await internals.assertMedAdministrationCleared(
    makeSession({ roleKey: "house_manager", role: "manager" }),
  );
  await internals.assertMedAdministrationCleared(
    makeSession({ roleKey: "administrator", role: "administrator" }),
  );
});

// ---------- Wiring pins ----------

test("both APIs gate exactly the four administration writes", () => {
  for (const rel of ["data/localApi.ts", "data/hostedApi.ts"]) {
    const text = src(rel);
    assert.equal(
      text.split("await this.assertMedAdministrationCleared(session)").length - 1,
      4,
      `${rel} gates markMedDose, logPrnDose, recordPrnFollowup, addMedDoseException`,
    );
  }
});

test("every med surface consults the UI lock", () => {
  for (const rel of [
    "features/MarCard.tsx",
    "features/medInventory/MedInventoryCard.tsx",
    "features/IndividualChart.tsx",
    "features/mobile/MobileMar.tsx",
  ]) {
    assert.ok(src(rel).includes("useMedAdminLock"), `${rel} uses useMedAdminLock`);
  }
  // The plain reason renders on the surfaces that hide controls.
  for (const rel of ["features/MarCard.tsx", "features/mobile/MobileMar.tsx"]) {
    assert.ok(
      src(rel).includes("MED_ADMIN_CLEARANCE_MESSAGE"),
      `${rel} shows the plain reason`,
    );
  }
});

// ---------- UI lock hook ----------

describe("useMedAdminLock", () => {
  let dom: import("jsdom").JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let useMedAdminLock: typeof import("../features/medAdminLock").useMedAdminLock;

  before(async () => {
    const { JSDOM } = await import("jsdom");
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });
    const setGlobal = (name: string, value: unknown) => {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    };
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ useMedAdminLock } = await import("../features/medAdminLock"));
  });

  after(() => {
    dom.window.close();
  });

  async function probe(
    cleared: boolean | null,
    roleKey: string,
  ): Promise<{ locked: boolean; calls: number }> {
    let calls = 0;
    const api = {
      getStaffTrainingProfile: async () => {
        calls += 1;
        if (cleared === null) throw new Error("profile unavailable");
        return { clearedForInRatio: cleared };
      },
    } as unknown as Parameters<typeof useMedAdminLock>[0];
    const session = makeSession({ roleKey });
    let locked = false;
    function Probe() {
      locked = useMedAdminLock(api, session);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(React.createElement(Probe));
    });
    // Let the profile promise settle inside act.
    await React.act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    root.unmount();
    container.remove();
    return { locked, calls };
  }

  test("an uncleared DSP is locked once the profile loads", async () => {
    const { locked, calls } = await probe(false, "dsp");
    assert.equal(locked, true);
    assert.equal(calls, 1);
  });

  test("a cleared DSP is not locked", async () => {
    const { locked } = await probe(true, "dsp");
    assert.equal(locked, false);
  });

  test("a failed profile load leaves controls as they were", async () => {
    const { locked } = await probe(null, "dsp");
    assert.equal(locked, false);
  });

  test("oversight roles never trigger a profile load", async () => {
    const { locked, calls } = await probe(false, "nurse");
    assert.equal(locked, false);
    assert.equal(calls, 0);
  });
});
