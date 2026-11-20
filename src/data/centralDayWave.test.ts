import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementStatus, todayStamp } from "./status";
import { delegationReviewState, type DelegationForm } from "./types";
import { delegationStatusForObligation } from "./delegationStatus";
import { isObligationActive, renewalStatus, type ObligationItem } from "./planStack";
import { activeIspProgram } from "./shiftNotes";
import { resolveRequirementStatus, validateTrainingLineInput } from "../features/training/gate";
import { validateOpenShiftInput } from "./openShifts";
import { findMissing, type MissingInput } from "./missingRequirements";
import { currentPlanYear } from "../features/isp/useIspData";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";
import type { ComplianceScore } from "./complianceScore";

/**
 * Central-day defaults wave — the remaining "today" derivations. Every
 * default below used to read the UTC day (`toISOString().slice(0, 10)`)
 * or the device-local day; each now reads the agency's America/Chicago
 * day. The pins run at the evening split —
 *   A: 2026-11-02T01:30Z = Sun Nov 1, 19:30 CST (Central Nov 1, UTC Nov 2)
 * when the old derivations already called it Nov 2.
 */
const EVENING_A = "2026-11-02T01:30:00.000Z";

function withMockedNow(iso: string, fn: () => void) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    fn();
  } finally {
    mock.timers.reset();
  }
}

test("wave: todayStamp is the Central day, not the device-local day", () => {
  assert.equal(todayStamp(new Date(EVENING_A)), "2026-11-01");
  withMockedNow(EVENING_A, () => {
    assert.equal(todayStamp(), "2026-11-01");
  });
});

test("wave: requirement status judges due dates on the Central day", () => {
  const evening = new Date(EVENING_A);
  assert.equal(computeRequirementStatus("2026-11-01", "Training", evening), "Due soon");
  assert.equal(computeRequirementStatus("2026-10-31", "Training", evening), "Overdue");
});

test("wave: delegation review + obligation expiry use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    const form = { reviewDate: "2026-11-01" } as unknown as DelegationForm;
    assert.deepEqual(delegationReviewState(form), {
      label: "Review due today",
      overdue: false,
      dueSoon: true,
    });
    const item = {
      delegationForm: null,
      expiresOn: "2026-11-01",
      discontinuedAt: null,
      enabled: true,
      rnSignedAt: "2026-10-01",
    } as unknown as Parameters<typeof delegationStatusForObligation>[0];
    assert.equal(
      delegationStatusForObligation(item, { delegationsExpire: true }),
      "active",
      "expiring today Central is still in effect (the UTC day called it expired)",
    );
    const obligation = {
      enabled: true,
      kind: "protocol",
      expiresOn: "2026-11-01",
    } as unknown as ObligationItem;
    assert.equal(isObligationActive(obligation), true);
    assert.equal(
      isObligationActive({ ...obligation, expiresOn: "2026-10-31" }),
      false,
      "a genuinely past expiry still deactivates",
    );
  });
});

test("wave: renewal status and ISP program coverage use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    assert.equal(renewalStatus("2026-11-01"), "due_soon");
    assert.equal(renewalStatus("2026-10-31"), "overdue");
    const program = {
      individualId: "p1",
      planYear: "2026",
      status: "approved",
      effectiveOn: "2026-10-01",
      expiresOn: "2026-11-01",
    };
    assert.equal(
      activeIspProgram(
        [program] as unknown as Parameters<typeof activeIspProgram>[0],
        "p1",
        "2026",
      )?.expiresOn,
      "2026-11-01",
      "a program expiring today Central still covers today",
    );
  });
});

test("wave: training sign-off validation and line status use the Central day", () => {
  withMockedNow(EVENING_A, () => {
    const ok = validateTrainingLineInput({
      initials: "AB",
      trainerUserId: "u1",
      signedOn: "2026-11-01",
    });
    assert.equal(ok.signedOn, "2026-11-01", "signed today Central is not 'in the future'");
    assert.throws(
      () =>
        validateTrainingLineInput({
          initials: "AB",
          trainerUserId: "u1",
          signedOn: "2026-11-02",
        }),
      /cannot be in the future/,
      "Nov 2 is still the future at 19:30 CST on Nov 1",
    );
    assert.equal(resolveRequirementStatus("pending", "2026-11-01"), "pending");
    assert.equal(resolveRequirementStatus("pending", "2026-10-31"), "overdue");
  });
});

test("wave: permanent-shift start-date validation uses the Central day", () => {
  const problems = validateOpenShiftInput(
    {
      siteId: "s1",
      title: "Evening",
      kind: "permanent",
      days: [1],
      windowStart: "08:00",
      windowEnd: "16:00",
      effectiveFrom: "2026-11-01",
    } as Parameters<typeof validateOpenShiftInput>[0],
    new Date(EVENING_A),
  );
  assert.deepEqual(problems, [], "starting today Central is allowed");
});

test("wave: missing-requirements scan judges expiry on the Central day", () => {
  const input: MissingInput = {
    now: new Date(EVENING_A),
    requiredCertificateKinds: ["CPR"],
    certificates: [
      { userId: "u1", staffName: "Sam Staff", kind: "CPR", expiresOn: "2026-11-01" },
    ],
    requiredTrainingTopics: [],
    trainings: [],
    staff: [{ userId: "u1", name: "Sam Staff" }],
    individuals: [],
    requiredIndividualDocuments: [],
    individualDocuments: [],
    checklists: [],
  };
  assert.deepEqual(
    findMissing(input),
    [],
    "a certificate expiring today Central is not yet missing (the UTC day flagged it expired)",
  );
});

test("wave: the ISP plan year follows the Central calendar", () => {
  withMockedNow("2027-01-01T02:00:00.000Z", () => {
    // 20:00 CST on Dec 31, 2026 — UTC has rolled to 2027, Central has not.
    assert.equal(currentPlanYear(), "2026");
  });
  withMockedNow("2027-01-01T07:00:00.000Z", () => {
    // 01:00 CST on Jan 1, 2027.
    assert.equal(currentPlanYear(), "2027");
  });
});

// ---------------------------------------------------------------------------
// PR #276 re-review regressions. The first cut of the wave left two surfaces
// classifying stored UTC instants by their UTC prefix: hosted recognition
// usage grouped `created_at` by `startsWith(month)` while the cap month was
// Central, and snapshot identity compared `computedAt.slice(0, 10)` (UTC)
// against the Central day. Both fixes classify the instant by its Central
// calendar month/day instead. Each test below pins one of the two boundary
// cases the re-review named and fails under the old prefix rule.
// ---------------------------------------------------------------------------

async function withMockedNowAsync(iso: string, fn: () => Promise<void>) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    await fn();
  } finally {
    mock.timers.reset();
  }
}

type WaveRow = Record<string, unknown>;

/**
 * Minimal in-memory Supabase double covering exactly the chains the two
 * hosted surfaces under test use: eq/is/gte/lt filters, insert, update,
 * single/maybeSingle, and the effective_rules rpc (empty result -> the
 * catalog defaults, whose recognition cap is 20).
 */
function fakeSupabaseForWave(tables: Record<string, WaveRow[]>) {
  const from = (table: string) => {
    const filters: Array<{ kind: string; key: string; value: unknown }> = [];
    let op: "select" | "insert" | "update" = "select";
    let patch: WaveRow = {};
    const matches = (row: WaveRow) =>
      filters.every((f) => {
        const value = row[f.key];
        if (f.kind === "eq") return value === f.value;
        if (f.kind === "is") return (value ?? null) === f.value;
        if (f.kind === "gte") return String(value) >= String(f.value);
        if (f.kind === "lt") return String(value) < String(f.value);
        return true;
      });
    const run = () => {
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        rows.push({ ...patch });
        return { data: [{ ...patch }], error: null };
      }
      if (op === "update") {
        const hit = rows.filter(matches);
        hit.forEach((row) => Object.assign(row, patch));
        return { data: hit.map((row) => ({ ...row })), error: null };
      }
      return { data: rows.filter(matches).map((row) => ({ ...row })), error: null };
    };
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq(key: string, value: unknown) {
        filters.push({ kind: "eq", key, value });
        return builder;
      },
      is(key: string, value: unknown) {
        filters.push({ kind: "is", key, value });
        return builder;
      },
      gte(key: string, value: unknown) {
        filters.push({ kind: "gte", key, value });
        return builder;
      },
      lt(key: string, value: unknown) {
        filters.push({ kind: "lt", key, value });
        return builder;
      },
      insert(values: WaveRow) {
        op = "insert";
        patch = values;
        return builder;
      },
      update(values: WaveRow) {
        op = "update";
        patch = values;
        return builder;
      },
      async single() {
        const result = run();
        const row = result.data?.[0] ?? null;
        return { data: row, error: row ? null : { message: "not found" } };
      },
      async maybeSingle() {
        const result = run();
        return { data: result.data?.[0] ?? null, error: null };
      },
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        try {
          resolve(run());
        } catch (err) {
          reject(err);
        }
      },
    };
    return builder;
  };
  const rpc = async (fn: string) =>
    fn === "effective_rules" ? { data: [], error: null } : { data: null, error: null };
  return { from, rpc } as unknown as SupabaseClient;
}

const WAVE_AGENCY = "agency-wave";

function hostedWaveApi(tables: Record<string, WaveRow[]>) {
  const api = new HostedApi(fakeSupabaseForWave(tables));
  (api as unknown as { requireSession(): Promise<SessionUser> }).requireSession =
    async () =>
      ({
        userId: "user-manager",
        agencyId: WAVE_AGENCY,
        roleKey: "administrator",
        fullName: "Wave Manager",
        permissions: { "recognition.manage": true, "correctiveActions.manage": true },
      }) as unknown as SessionUser;
  return api;
}

test("wave: hosted recognition usage is grouped by the Central month, not the UTC prefix", async () => {
  const tables: Record<string, WaveRow[]> = {
    audit_events: [
      {
        // 2026-11-01T00:30Z is Oct 31, 19:30 CDT — an OCTOBER award on the
        // Central calendar, even though its UTC prefix reads 2026-11.
        agency_id: WAVE_AGENCY,
        actor_id: "user-manager",
        action: "recognition.award",
        detail: "points=12;recipient=user-dsp;reason=Evening save",
        created_at: "2026-11-01T00:30:00.000Z",
      },
      {
        // 2026-11-01T06:30Z is Nov 1, 00:30 CST — a November award.
        agency_id: WAVE_AGENCY,
        actor_id: "user-manager",
        action: "recognition.award",
        detail: "points=5;recipient=user-dsp;reason=Early shift",
        created_at: "2026-11-01T06:30:00.000Z",
      },
      {
        // Mid-October under both calendars — a control that never counts
        // toward November under either rule.
        agency_id: WAVE_AGENCY,
        actor_id: "user-manager",
        action: "recognition.award",
        detail: "points=9;recipient=user-dsp;reason=October work",
        created_at: "2026-10-15T15:00:00.000Z",
      },
    ],
  };
  const api = hostedWaveApi(tables);
  await withMockedNowAsync("2026-11-20T18:00:00.000Z", async () => {
    // Nov 20 Central, catalog-default cap 20. Only the Nov 1 Central award
    // (5 points) counts toward November, so awarding 4 more lands at 9.
    // The UTC-prefix grouping also counted the Oct 31 Central award
    // (12 + 5 = 17 used) and refused this award as over the cap.
    const result = await api.awardRecognitionPoints({
      recipientId: "user-dsp",
      points: 4,
      reason: "Great catch",
    });
    assert.deepEqual(result, { usedThisMonth: 9, cap: 20 });
  });
});

test("wave: hosted snapshot rerun after UTC midnight reuses the Central day's row", async () => {
  const tables: Record<string, WaveRow[]> = {
    compliance_score_snapshots: [
      {
        id: "snap-evening",
        agency_id: WAVE_AGENCY,
        site_id: null,
        score: 80,
        band: "compliant",
        breakdown: {},
        fact_count: 3,
        // Nov 20, 19:00 CST — the evening of the Central day in question;
        // its UTC date is already Nov 21.
        computed_at: "2026-11-21T01:00:00.000Z",
      },
    ],
  };
  const api = hostedWaveApi(tables);
  await withMockedNowAsync("2026-11-21T05:30:00.000Z", async () => {
    // Nov 20, 23:30 CST: UTC has rolled to Nov 21, Central has not. The
    // rerun must replace the evening snapshot, not open a second day —
    // the old UTC-window lookup could not even see the evening row.
    const saved = await api.saveComplianceSnapshot({
      siteId: null,
      result: { score: 91, band: "compliant", breakdown: {}, factCount: 7 },
    });
    assert.equal(saved.id, "snap-evening");
    assert.equal(saved.score, 91);
    assert.equal(
      tables.compliance_score_snapshots.length,
      1,
      "still one snapshot for the Central day",
    );
  });
});

test("wave: local snapshot rerun after UTC midnight reuses the Central day's row", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const result = (score: number): ComplianceScore => ({
    score,
    band: "compliant",
    breakdown: {},
    factCount: 5,
  });
  let firstId = "";
  await withMockedNowAsync("2026-11-21T01:00:00.000Z", async () => {
    // Nov 20, 19:00 CST — the evening snapshot.
    const first = await api.saveComplianceSnapshot({ siteId: null, result: result(80) });
    firstId = first.id ?? "";
    assert.notEqual(firstId, "", "the saved snapshot carries an id");
    assert.equal(first.computedAt, "2026-11-21T01:00:00.000Z");
  });
  await withMockedNowAsync("2026-11-21T05:30:00.000Z", async () => {
    // Nov 20, 23:30 CST — same Central day, after UTC midnight. The old
    // `computedAt.slice(0, 10)` comparison read the first row as Nov 21
    // and opened a second snapshot for "today" (Nov 20).
    const second = await api.saveComplianceSnapshot({ siteId: null, result: result(91) });
    assert.equal(second.id, firstId, "the rerun replaces the evening snapshot");
    assert.equal(second.score, 91);
  });
  assert.equal(
    (await api.listComplianceSnapshots(null)).length,
    1,
    "one snapshot for the Central day, not two",
  );
});
