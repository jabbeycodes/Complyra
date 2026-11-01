import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalApi, MemoryStore } from "./localApi";
import { HostedApi } from "./hostedApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { canSeeMeds, todayIso } from "./chart";
import { centralTodayIso } from "./menuRecords";
import { alreadyMarkedDoseMessage } from "./dueItems";
import { medUnrecordedRowRetired } from "./operatingReminders";

/**
 * Wave 7M — MAR cross-session truth (simulation batches 66–70).
 *
 * Root causes pinned here:
 *  1. The desktop MAR card read marks by the UTC calendar day while the
 *     phone MAR writes and reads by the agency (Central) day — every
 *     evening from 7 p.m. Central the desktop chart showed "Not marked"
 *     for doses the phone had recorded. Both surfaces now key on the
 *     Central day (centralTodayIso), and getMedDoseMarks reads the store
 *     fresh on every call.
 *  2. A second mark attempt on an already-marked dose silently
 *     overwrote the original giver/time for anyone allowed to correct.
 *     A plain attempt now refuses with "Already given by …"; only a
 *     deliberate correction (baseMarkedAt = the mark the caller saw)
 *     proceeds, under the unchanged canCorrectDoseMark rules.
 *  3. The bell's "Unmarked medication" rows never retired. A row now
 *     retires for every viewer once a sweep verifies the site has no
 *     overdue unmarked dose left.
 */

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

/** HM reassigned to Ellis Hart's home (Cedar), per the medCluster idiom. */
async function hmOnEllis(api: LocalApi, st: MemoryStore) {
  const hm = st.db.profiles.find((p) => p.username === DEMO_HM_USERNAME)!;
  st.db.memberships.find((m) => m.userId === hm.id)!.siteId =
    st.db.individuals.find((p) => p.fullName.includes("Ellis"))!.siteId;
  const session = await api.signIn(login(DEMO_HM_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  return { session, workspace, ellis };
}

function centralYesterdayIso(): string {
  const today = centralTodayIso();
  const [y, m, d] = today.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d));
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

function centralNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (read("hour") % 24) * 60 + read("minute");
}

// ─── Pure pins ─────────────────────────────────────────────────────────────

test("the MAR day split: 10:40 p.m. Central is already tomorrow in UTC", () => {
  // Avery's mark: 2026-10-31 22:40 CDT = 2026-11-01T03:40:43Z.
  const instant = new Date("2026-11-01T03:40:43.000Z");
  assert.equal(todayIso(instant), "2026-11-01", "the old desktop selector");
  assert.equal(centralTodayIso(instant), "2026-10-31", "the agency day both surfaces now use");
});

test("alreadyMarkedDoseMessage names status, giver, and agency-clock time", () => {
  assert.equal(
    alreadyMarkedDoseMessage({
      status: "given",
      markedByName: "Avery Cole",
      markedAt: "2026-11-01T03:40:43.000Z",
    }),
    "Already given by Avery Cole · 10:40 p.m.",
  );
  assert.equal(
    alreadyMarkedDoseMessage({
      status: "on_hold",
      markedByName: "Avery Cole",
      markedAt: "2026-11-01T03:40:43.000Z",
    }),
    "Already on hold by Avery Cole · 10:40 p.m.",
  );
});

test("medUnrecordedRowRetired only retires verified-clear med rows", () => {
  const clear = new Set(["site-cedar"]);
  assert.equal(medUnrecordedRowRetired({ type: "med.unrecorded", entityId: "site-cedar" }, clear), true);
  assert.equal(medUnrecordedRowRetired({ type: "med.unrecorded", entityId: "site-willow" }, clear), false);
  assert.equal(medUnrecordedRowRetired({ type: "med.unrecorded", entityId: null }, clear), false);
  assert.equal(medUnrecordedRowRetired({ type: "documentation.missing_note", entityId: "site-cedar" }, clear), false);
});

test("the desktop MAR gate is med visibility: DSPs see it, HR does not", () => {
  // IndividualChart renders MarCard under canSeeMeds (Wave 7M): the DSP
  // who administers the doses can check them on desktop too; MarCard's
  // own canMark decides who may press buttons (auditor read-only).
  assert.equal(canSeeMeds("dsp"), true);
  assert.equal(canSeeMeds("house_manager"), true);
  assert.equal(canSeeMeds("auditor"), true);
  assert.equal(canSeeMeds("hr"), false);
});

// ─── (a) Cross-session visibility at the data layer ────────────────────────

test("a mark written by another session is visible on the chart-open read", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const medId = `${ellis.id}-med-keppra`;
  const today = centralTodayIso();

  // The HM's chart-open read before anyone marks: the dose is unmarked.
  const before = await api.getMedDoseMarks(ellis.id, today);
  assert.equal(before.some((m) => m.medicationId === medId && m.doseTime === "00:05"), false);

  // Another session (the DSP's phone pass) records the dose.
  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.markMedDose({
    medicationId: medId,
    doseDate: today,
    doseTime: "00:05",
    status: "given",
    lateReason: "Recorded on the phone pass",
  });

  // The HM's next chart-open read (MarCard mounts -> getMedDoseMarks)
  // shows the mark with the phone giver's name.
  await api.signIn(login(DEMO_HM_USERNAME));
  const after = await api.getMedDoseMarks(ellis.id, today);
  const mark = after.find((m) => m.medicationId === medId && m.doseTime === "00:05")!;
  assert.ok(mark, "the phone mark must be visible to the desktop session");
  assert.equal(mark.status, "given");
  assert.equal(mark.markedByName, dspSession.fullName);
});

// ─── (b) Second-mark refusal + deliberate correction (LocalApi) ────────────

test("a stale second attempt refuses and never overwrites the original mark", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const medId = `${ellis.id}-med-keppra`;
  const day = centralYesterdayIso();

  const dspSession = await api.signIn(login(DEMO_DSP_USERNAME));
  await api.markMedDose({
    medicationId: medId,
    doseDate: day,
    doseTime: "08:00",
    status: "given",
    lateReason: "Entered from the paper MAR",
  });
  const first = (await api.getMedDoseMarks(ellis.id, day)).find((m) => m.doseTime === "08:00")!;
  assert.equal(first.markedByName, dspSession.fullName);

  // The HM's stale screen says "Not marked": a plain attempt must refuse
  // naming the original giver — and leave the stored mark untouched.
  const hmSession = await api.signIn(login(DEMO_HM_USERNAME));
  await assert.rejects(
    () => api.markMedDose({ medicationId: medId, doseDate: day, doseTime: "08:00", status: "missed" }),
    { message: new RegExp(`^Already given by ${dspSession.fullName} · \\d{1,2}:\\d{2} [ap]\\.m\\.$`) },
  );
  // A base from a mark that has since changed is stale too.
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: medId,
        doseDate: day,
        doseTime: "08:00",
        status: "missed",
        baseMarkedAt: "2000-01-01T00:00:00.000Z",
      }),
    { message: /^Already given by / },
  );
  const untouched = (await api.getMedDoseMarks(ellis.id, day)).find((m) => m.doseTime === "08:00")!;
  assert.equal(untouched.status, "given");
  assert.equal(untouched.markedByName, dspSession.fullName);
  assert.equal(untouched.markedAt, first.markedAt);

  // A deliberate correction — the caller passes the exact mark they saw —
  // still works under the existing correction rules.
  await api.markMedDose({
    medicationId: medId,
    doseDate: day,
    doseTime: "08:00",
    status: "missed",
    baseMarkedAt: first.markedAt,
  });
  const corrected = (await api.getMedDoseMarks(ellis.id, day)).find((m) => m.doseTime === "08:00")!;
  assert.equal(corrected.status, "missed");
  assert.equal(corrected.markedByName, hmSession.fullName);

  // The DSP may not correct the HM's mark even with the right base, and a
  // plain DSP attempt now refuses naming the HM.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: medId,
        doseDate: day,
        doseTime: "08:00",
        status: "given",
        baseMarkedAt: corrected.markedAt,
      }),
    /correct only MAR entries you recorded/,
  );
  await assert.rejects(
    () => api.markMedDose({ medicationId: medId, doseDate: day, doseTime: "08:00", status: "given" }),
    { message: new RegExp(`^Already marked missed by ${hmSession.fullName} · `) },
  );
});

// ─── (c) Bell retirement (LocalApi) ────────────────────────────────────────

test("the bell's unmarked-dose row retires once anyone marks the dose", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { session: hmSession, workspace, ellis } = await hmOnEllis(api, st);
  const cedar = workspace.sites.find((s) => s.name === "Cedar House")!;
  const willow = st.db.sites.find((s) => s.name === "Willow House")!;
  const keppraId = `${ellis.id}-med-keppra`;

  // Narrow Cedar to one candidate dose, two hours in the past, so the
  // site's overdue state turns entirely on this one dose. (Between
  // 00:00–01:00 Central no dose today can be past its window yet; the
  // control half below is skipped in that hour only.)
  const nowMin = centralNowMinutes();
  const doseMin = Math.max(0, nowMin - 120);
  const doseTime = `${String(Math.floor(doseMin / 60)).padStart(2, "0")}:${String(doseMin % 60).padStart(2, "0")}`;
  const overdueGuaranteed = nowMin > doseMin + 60;
  const cedarPeople = workspace.individuals.filter((p) => p.siteId === cedar.id);
  for (const person of cedarPeople) {
    const views = await api.getMedInventory(person.id);
    for (const view of views) {
      if (view.kind !== "scheduled") continue;
      await api.setMedDoseTimes({
        medicationId: view.medicationId,
        doseTimes: view.medicationId === keppraId ? [doseTime] : [],
      });
    }
  }

  // The rows the reminder sweep queued for the HM while the dose was
  // unmarked — one for Cedar, one for Willow (a home the HM cannot load,
  // so no sweep can ever verify it clear: it must survive).
  const now = new Date().toISOString();
  st.db.notifications.push(
    {
      id: "wave7m-bell-cedar",
      agencyId: hmSession.agencyId,
      userId: hmSession.userId,
      roleKey: null,
      type: "med.unrecorded",
      title: "Unmarked medication",
      body: "Cedar House has 1 unmarked dose past the window.",
      deepLink: "/meds",
      entityType: "medication",
      entityId: cedar.id,
      dedupeKey: `med.unrecorded:${cedar.id}:${hmSession.userId}:wave7m`,
      createdAt: now,
      readAt: null,
    },
    {
      id: "wave7m-bell-willow",
      agencyId: hmSession.agencyId,
      userId: hmSession.userId,
      roleKey: null,
      type: "med.unrecorded",
      title: "Unmarked medication",
      body: "Willow House has 1 unmarked dose past the window.",
      deepLink: "/meds",
      entityType: "medication",
      entityId: willow.id,
      dedupeKey: `med.unrecorded:${willow.id}:${hmSession.userId}:wave7m`,
      createdAt: now,
      readAt: null,
    },
  );

  const medRowsFor = (rows: Awaited<ReturnType<typeof api.listNotifications>>, siteId: string) =>
    rows.filter((row) => row.type === "med.unrecorded" && row.entity_id === siteId);

  if (overdueGuaranteed) {
    const control = await api.listNotifications();
    assert.ok(medRowsFor(control, cedar.id).length >= 1, "row stays while the dose is unmarked");
  }

  // A different user (the DSP) marks the dose.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.markMedDose({
    medicationId: keppraId,
    doseDate: centralTodayIso(),
    doseTime,
    status: "given",
    lateReason: "Given on the morning pass",
  });

  await api.signIn(login(DEMO_HM_USERNAME));
  const after = await api.listNotifications();
  assert.equal(medRowsFor(after, cedar.id).length, 0, "Cedar's row retired once the dose was marked");
  assert.ok(medRowsFor(after, willow.id).length >= 1, "an unverifiable home's row is never retired on a guess");
});

// ─── (b) Second-mark refusal (HostedApi, stubbed client) ──────────────────

type StubResult = { data: unknown; error: unknown };

interface HostedStubCtx {
  writes: { table: string; op: string; payload: unknown }[];
  markSingles: StubResult[];
  insertError: unknown;
  single(table: string): StubResult;
  list(table: string): StubResult;
}

class StubQuery implements PromiseLike<StubResult> {
  constructor(
    private readonly table: string,
    private readonly ctx: HostedStubCtx,
  ) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  in() { return this; }
  lt() { return this; }
  gt() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload: unknown) {
    this.ctx.writes.push({ table: this.table, op: "insert", payload });
    if (this.table === "med_dose_marks" && this.ctx.insertError) {
      return Promise.resolve({ data: null, error: this.ctx.insertError });
    }
    return this;
  }
  upsert(payload: unknown) {
    this.ctx.writes.push({ table: this.table, op: "upsert", payload });
    return this;
  }
  update() { return this; }
  delete() { return this; }
  async single(): Promise<StubResult> { return this.ctx.single(this.table); }
  async maybeSingle(): Promise<StubResult> { return this.ctx.single(this.table); }
  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.ctx.list(this.table)).then(onfulfilled, onrejected);
  }
}

const HOSTED_AGENCY = "agency-1";
const AVERY_MARK = {
  marked_by: "user-avery",
  marked_by_name: "Avery Cole",
  marked_at: "2026-11-01T03:40:43.000Z",
  status: "given",
  late: true,
  late_reason: "Recorded after the pass",
};

function stubbedHostedApi() {
  const ctx: HostedStubCtx = {
    writes: [],
    markSingles: [{ data: AVERY_MARK, error: null }],
    insertError: null,
    single(table: string): StubResult {
      switch (table) {
        case "agency_roles":
          return { data: { permissions: {} }, error: null };
        case "medications":
          return {
            data: {
              id: "med-1",
              agency_id: HOSTED_AGENCY,
              individual_id: "ind-1",
              name: "Testoprofen",
              strength: "200 mg",
              kind: "scheduled",
              controlled: false,
              pills_per_day: 2,
              remaining_pills: 20,
              last_delivery_on: "2026-10-31",
              last_countdown_on: "2026-10-31",
              source_order_id: null,
            },
            error: null,
          };
        case "med_dose_marks":
          return ctx.markSingles.shift() ?? { data: null, error: null };
        default:
          return { data: null, error: null };
      }
    },
    list(): StubResult {
      return { data: [], error: null };
    },
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-harper", email: "hm@example.invalid" } },
      }),
    },
    rpc: async (name: string) =>
      name === "login_context"
        ? {
            data: {
              profile: {
                id: "user-harper",
                full_name: "Harper Lane",
                email: "hm@example.invalid",
                job_title: "House Manager",
                username: "sim.hm",
                must_change_password: false,
                platform_admin: false,
              },
              membership: {
                agency_id: HOSTED_AGENCY,
                role: "house_manager",
                role_key: "house_manager",
                site_id: "site-1",
                expires_on: null,
              },
              agency: {
                id: HOSTED_AGENCY,
                name: "Northstar Care Simulation",
                agency_code: "NORTHSTAR2-MO",
                status: "active",
              },
            },
            error: null,
          }
        : { data: [], error: null },
    from: (table: string) => new StubQuery(table, ctx),
  };
  return { api: new HostedApi(client as unknown as SupabaseClient), ctx };
}

test("hosted: a plain second attempt refuses naming the giver and writes nothing", async () => {
  const { api, ctx } = stubbedHostedApi();
  const day = centralYesterdayIso();
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: "med-1",
        doseDate: day,
        doseTime: "20:00",
        status: "given",
        lateReason: "Second attempt",
      }),
    { message: "Already given by Avery Cole · 10:40 p.m." },
  );
  assert.deepEqual(
    ctx.writes.filter((w) => w.table === "med_dose_marks"),
    [],
    "the refusal must happen before any write — no upsert overwrite",
  );
});

test("hosted: a deliberate correction with the seen markedAt still lands", async () => {
  const { api, ctx } = stubbedHostedApi();
  const day = centralYesterdayIso();
  await api.markMedDose({
    medicationId: "med-1",
    doseDate: day,
    doseTime: "20:00",
    status: "missed",
    baseMarkedAt: AVERY_MARK.marked_at,
  });
  const writes = ctx.writes.filter((w) => w.table === "med_dose_marks");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, "upsert");
  const payload = writes[0].payload as Record<string, unknown>;
  assert.equal(payload.status, "missed");
  assert.equal(payload.marked_by_name, "Harper Lane");
});

test("hosted: a first mark inserts, and a lost race refuses with the winner's name", async () => {
  const { api, ctx } = stubbedHostedApi();
  const day = centralYesterdayIso();
  // Pre-check finds nothing; the insert hits the unique index because
  // another session marked first; the re-read finds the winner's mark.
  ctx.markSingles = [
    { data: null, error: null },
    { data: AVERY_MARK, error: null },
  ];
  ctx.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: "med-1",
        doseDate: day,
        doseTime: "08:00",
        status: "given",
        lateReason: "Entered from the paper MAR",
      }),
    { message: "Already given by Avery Cole · 10:40 p.m." },
  );
  const writes = ctx.writes.filter((w) => w.table === "med_dose_marks");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, "insert", "first marks insert — they never upsert over a race winner");
});
