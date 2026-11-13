/**
 * Training sign-off: a rejected signature leaves the record untouched, and the
 * edge function's check order keeps the hosted readiness check write-free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "../../data/hostedApi";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
} from "../../data/seed";
import { DEMO_PASSWORD, type SessionUser } from "../../data/types";
import {
  ESIGN_CONSENT_VERSION,
  ReauthRequiredError,
} from "../signatures/signatureUtils";
import { siteChecklistTopics } from "./topics";
import { saveAndInitialTrainingLine } from "./trainingLineSigning";
import { trainingLineSealState } from "./lineSeal";
import type { ComplyraApi } from "../../data/localApi";
import type { TrainingRequirementView } from "../../data/types";

const TRAINEE = "taylor.reed";
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PASSWORD,
});

async function fixture() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const trainee = ws.staff.find((person) => person.username === TRAINEE)!;
  const hm = ws.staff.find((person) => person.roleKey === "house_manager")!;
  const [created] = await api.assignTraining({
    userId: trainee.id,
    siteId: ws.sites[0].id,
    source: "checklist",
    topicIds: siteChecklistTopics()
      .slice(0, 1)
      .map((topic) => topic.id),
  });
  await api.signOut();
  const session = await api.signIn(login(TRAINEE));
  await api.adoptSignature({
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  });
  const lineFor = async (asUserId: string) =>
    (await api.getStaffTrainingProfile(asUserId)).requirements.find(
      (row) => row.id === created.id,
    )!;
  const sign = (sessionUserId: string, reinit = false) =>
    lineFor(trainee.id).then((requirement) =>
      saveAndInitialTrainingLine(api, {
        sessionUserId,
        staffUserId: trainee.id,
        requirement,
        reinit,
        // What the pre-fix page passed (ignored now: the stamp seals the
        // stored trainer name). Kept so this file also runs on old trees.
        trainerName: hm.name,
        input: {
          initials: "TR",
          signedOn: "2026-10-10",
          trainerUserId: hm.id,
          method: "shadowing",
          hoursTotal: 2,
          hoursWithHm: 1,
        },
      } as Parameters<typeof saveAndInitialTrainingLine>[1]),
    );
  const events = (line: TrainingRequirementView) =>
    api.getSignatureEvents("training_checklist", `staff:${trainee.id}:${line.siteId}`);
  /** The seal verdict the Training page would render for the line now. */
  const seal = async () => {
    const line = await lineFor(trainee.id);
    return trainingLineSealState(line, await events(line));
  };
  return { api, store, session, trainee, hm, lineFor, sign, events, seal, created };
}

/**
 * The hosted save, as the DSP actually experiences it: the sign-off row is
 * written, but the follow-up training_requirements status UPDATE is filtered
 * by RLS (manager-only update policy) and silently matches zero rows.
 */
function withHostedRlsStatusDrop(api: LocalApi, store: MemoryStore): ComplyraApi {
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop === "initialRequirementLine") {
        return async (requirementId: string, input: unknown) => {
          const coll = (store.db as unknown as {
            trainingRequirements?: Array<{ id: string; status: string }>;
          }).trainingRequirements;
          const row = coll?.find((r) => r.id === requirementId);
          const statusBefore = row?.status;
          await (target.initialRequirementLine as (a: string, b: unknown) => Promise<void>).call(
            target,
            requirementId,
            input,
          );
          if (row && statusBefore) row.status = statusBefore;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ComplyraApi;
}

test("signing with no fresh password prompts for one and writes nothing", async () => {
  const fx = await fixture();
  await assert.rejects(
    () => fx.sign(fx.trainee.id),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.signoff, null, "no sign-off was saved");
  assert.notEqual(line.resolvedStatus, "complete");
});

test("the same attempt succeeds once the password is re-entered", async () => {
  const fx = await fixture();
  await assert.rejects(() => fx.sign(fx.trainee.id));
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  assert.equal(await fx.sign(fx.trainee.id), "initialed");
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.signoff?.signoffVersion, 1);
  const events = await fx.api.getSignatureEvents(
    "training_checklist",
    `staff:${fx.trainee.id}:${line.siteId}`,
  );
  assert.ok(events.some((event) => event.fieldName === `line:${line.id}:v1`));
});

test("a rejected re-initial keeps the record's version and Recorded by", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  await fx.sign(fx.trainee.id);
  const before = await fx.lineFor(fx.trainee.id);

  fx.store.signingReauthAt.clear();
  await assert.rejects(
    () => fx.sign(fx.trainee.id, true),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
  assert.deepEqual(await fx.lineFor(fx.trainee.id), before);
});

test("a manager's Re-initial on someone else's line is refused before any write", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  await fx.sign(fx.trainee.id);
  await fx.api.signOut();
  const admin = await fx.api.signIn(login(DEMO_ADMIN_USERNAME));
  const before = await fx.lineFor(fx.trainee.id);
  await assert.rejects(
    () => fx.sign(admin.userId, true),
    /Only the assigned staff member can initial/,
  );
  assert.deepEqual(await fx.lineFor(fx.trainee.id), before);
});

test("a manager's edit saves without attempting a stamp, then needs the staff member", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  await fx.sign(fx.trainee.id);
  await fx.api.signOut();
  const admin = await fx.api.signIn(login(DEMO_ADMIN_USERNAME));
  assert.equal(await fx.sign(admin.userId), "saved_for_staff");
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.signoff?.signoffVersion, 2);
  const events = await fx.api.getSignatureEvents(
    "training_checklist",
    `staff:${fx.trainee.id}:${line.siteId}`,
  );
  assert.ok(!events.some((event) => event.fieldName === `line:${line.id}:v2`));
});

function hostedWithEdgeAnswer(answer: { data?: unknown; error?: unknown }) {
  const bodies: Record<string, unknown>[] = [];
  const client = {
    functions: {
      invoke: async (_name: string, opts: { body: Record<string, unknown> }) => {
        bodies.push(opts.body);
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    },
  } as unknown as SupabaseClient;
  const api = new HostedApi(client);
  (api as unknown as { requireSession(): Promise<SessionUser> }).requireSession =
    async () => ({ userId: "u1", agencyId: "a1" }) as SessionUser;
  return { api, bodies };
}

const check = { staffUserId: "u1", siteId: "s1", requirementId: "r1" };

for (const code of ["no_signoff", "stale_version"]) {
  test(`hosted readiness check: ${code} means every identity check passed`, async () => {
    const { api, bodies } = hostedWithEdgeAnswer({
      data: { error: "stopped", code },
    });
    await api.checkTrainingLineSignable(check);
    assert.equal(bodies[0].field_name, "line:r1:v0", "version 0 never exists");
  });
}

test("hosted readiness check: reauth_required opens the password sheet", async () => {
  const { api } = hostedWithEdgeAnswer({
    data: { error: "re-enter", code: "reauth_required" },
  });
  await assert.rejects(
    () => api.checkTrainingLineSignable(check),
    (err: unknown) => err instanceof ReauthRequiredError,
  );
});

test("hosted readiness check: other refusals stop the save", async () => {
  const { api } = hostedWithEdgeAnswer({
    data: { error: "Only the assigned staff member", code: "not_line_owner" },
  });
  await assert.rejects(
    () => api.checkTrainingLineSignable(check),
    /Only the assigned staff member/,
  );
});

test("edge function: identity checks run before the version check, which runs before any write", () => {
  const source = readFileSync(
    "supabase/functions/apply-signature/index.ts",
    "utf8",
  );
  const order = [
    '"no_adopted_signature"',
    '"reauth_required"',
    "const domainError = await checkDomainRules();",
    "const transitionError = await applyDomainTransition();",
  ].map((marker) => source.indexOf(marker));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const training = source.slice(
    source.indexOf("async function checkTrainingChecklist()"),
  );
  const owner = training.indexOf('"not_line_owner"');
  const noSignoff = training.indexOf('"no_signoff"');
  const stale = training.indexOf('"stale_version"');
  assert.ok(owner > 0 && owner < noSignoff && noSignoff < stale);
  assert.match(training, /!signoff \|\| \(signoff as \{ na: boolean \}\)\.na/);
  assert.match(
    training,
    /signoff_version !== version/,
    "a version that does not exist is always refused",
  );
});

// ---------------------------------------------------------------------------
// Wave 4B (batches 307-310): a correct-password initialing invalidated itself.
// ---------------------------------------------------------------------------

test("save -> stamp -> verify: a correct initialing seals VALID, reads complete and counts", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  assert.equal(await fx.sign(fx.trainee.id), "initialed");
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.resolvedStatus, "complete");
  assert.equal(await fx.seal(), "valid");
  const profile = await fx.api.getStaffTrainingProfile(fx.trainee.id);
  assert.equal(profile.counts.complete, 1);
  assert.equal(profile.counts.pending, 0);
  assert.equal(profile.hoursTotal, 2);
  assert.equal(profile.hoursWithHm, 1);
});

test("hosted RLS drop: the DSP's line still reads complete with a valid seal after save + stamp", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  const hostedLike = withHostedRlsStatusDrop(fx.api, fx.store);
  const requirement = await fx.lineFor(fx.trainee.id);
  await saveAndInitialTrainingLine(hostedLike, {
    sessionUserId: fx.trainee.id,
    staffUserId: fx.trainee.id,
    requirement,
    trainerName: fx.hm.name,
    input: {
      initials: "TR",
      signedOn: "2026-10-10",
      trainerUserId: fx.hm.id,
      method: "shadowing",
      hoursTotal: 1,
      hoursWithHm: 1,
    },
  } as Parameters<typeof saveAndInitialTrainingLine>[1]);
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.resolvedStatus, "complete", "a saved sign-off completes the line");
  assert.equal(await fx.seal(), "valid", "the seal survives a reload");
  const profile = await fx.api.getStaffTrainingProfile(fx.trainee.id);
  assert.equal(profile.counts.pending, 0, "the line no longer counts as open");
});

test("the stamp seals the STORED sign-off, not the caller's trainer name or a missing date", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  const requirement = await fx.lineFor(fx.trainee.id);
  // A DSP's hosted workspace roster can name the trainer "Unknown" (profiles
  // RLS); the save re-resolves the name server-side. The modal's date may
  // also be absent, which the save turns into today.
  const args = {
    sessionUserId: fx.trainee.id,
    staffUserId: fx.trainee.id,
    requirement,
    trainerName: "Unknown",
    input: {
      initials: "TR",
      trainerUserId: fx.hm.id,
      hoursTotal: 1,
      hoursWithHm: 0,
    },
  } as Parameters<typeof saveAndInitialTrainingLine>[1];
  assert.equal(await saveAndInitialTrainingLine(fx.api, args), "initialed");
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.signoff?.trainerName, fx.hm.name);
  assert.equal(await fx.seal(), "valid");
});

test("an invalid seal on the owner's line is repaired by Re-initial (fresh version, valid seal)", async () => {
  const fx = await fixture();
  await fx.api.verifySigningPassword(DEMO_PASSWORD);
  await fx.sign(fx.trainee.id);
  // The signed content changes underneath the stamp.
  const coll = (fx.store.db as unknown as {
    trainingSignoffs: Array<{ requirementId: string; hoursTotal: number }>;
  }).trainingSignoffs;
  coll.find((row) => row.requirementId === fx.created.id)!.hoursTotal = 3;
  assert.equal(await fx.seal(), "invalid");
  assert.equal(await fx.sign(fx.trainee.id, true), "initialed");
  const line = await fx.lineFor(fx.trainee.id);
  assert.equal(line.signoff?.signoffVersion, 2);
  assert.equal(await fx.seal(), "valid");
});

test("a manager-saved line reads 'missing' until its owner stamps it", async () => {
  const fx = await fixture();
  await fx.api.signOut();
  const admin = await fx.api.signIn(login(DEMO_ADMIN_USERNAME));
  assert.equal(await fx.sign(admin.userId), "saved_for_staff");
  assert.equal(await fx.seal(), "missing");
});

test("hosted view: a saved non-N/A sign-off completes a line whose stored status lagged", async () => {
  const api = new HostedApi({} as SupabaseClient);
  const view = (api as unknown as {
    p2RequirementView(
      requirement: Record<string, unknown>,
      signoffs: Map<string, unknown>,
      individualNames: Map<string, string>,
      today: string,
    ): Promise<TrainingRequirementView>;
  }).p2RequirementView.bind(api);
  const requirement = {
    id: "r1",
    agencyId: "a1",
    userId: "u1",
    topicId: siteChecklistTopics()[0].id,
    individualId: null,
    siteId: "s1",
    source: "checklist",
    status: "pending",
    dueOn: "2026-01-01",
  };
  const signoff = { requirementId: "r1", na: false, signoffVersion: 1 };
  const done = await view(requirement, new Map([["r1", signoff]]), new Map(), "2026-11-05");
  assert.equal(done.resolvedStatus, "complete");
  const open = await view(requirement, new Map(), new Map(), "2026-11-05");
  assert.equal(open.resolvedStatus, "overdue", "no sign-off: the stored status still rules");
  const waived = await view(
    { ...requirement, status: "waived_na" },
    new Map([["r1", { ...signoff, na: true }]]),
    new Map(),
    "2026-11-05",
  );
  assert.equal(waived.resolvedStatus, "waived_na");
});

test("migration 20261105120000 completes lines from sign-offs and backfills stranded ones", () => {
  const sql = readFileSync(
    "supabase/migrations/20261105120000_training_signoff_completes_line.sql",
    "utf8",
  );
  assert.match(sql, /security definer/);
  assert.match(sql, /after insert or update of na, signoff_version on public\.training_signoffs/);
  assert.match(sql, /status not in \('complete', 'waived_na'\)/);
  assert.match(sql, /update public\.training_requirements r\s+set status = 'complete'\s+from public\.training_signoffs s/);
});
