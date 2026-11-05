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
        trainerName: hm.name,
        input: {
          initials: "TR",
          signedOn: "2026-10-10",
          trainerUserId: hm.id,
          method: "shadowing",
          hoursTotal: 2,
          hoursWithHm: 1,
        },
      }),
    );
  return { api, store, session, trainee, hm, lineFor, sign };
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
