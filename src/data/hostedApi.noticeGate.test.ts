import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import type { SessionUser } from "./types";

/**
 * Simulation batches 5–8, 13–19 (console-noise fix): HostedApi must not
 * even ATTEMPT the notice/rules RPC calls the database would refuse for
 * the signed-in session — each attempt was a console 400/403. A recording
 * rpc stub proves the gate: no call when the rule would refuse, the call
 * is made for permitted cases.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function recordingApi() {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: [], error: null };
    },
    from: () => {
      throw new Error("from() is not stubbed in this test");
    },
  } as unknown as SupabaseClient;
  return { api: new HostedApi(client), calls };
}

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "user-dsp",
    email: "dsp@example.invalid",
    username: "sim.dsp",
    fullName: "Dee DSP",
    jobTitle: "DSP",
    role: "DSP",
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

type NoticeInternals = {
  queueOperatingNotice(
    session: SessionUser,
    input: {
      agencyId: string;
      userId: string | null;
      roleKey: string | null;
      type: string;
      title: string;
      body: string;
      deepLink: string;
      entityId: string;
      dedupeKey: string;
    },
  ): Promise<void>;
  loadOperatingRules(session: SessionUser): Promise<unknown>;
};

const noticeInput = {
  agencyId: "agency-1",
  title: "Dose not recorded",
  body: "A scheduled dose has no mark yet.",
  deepLink: "/mar",
  entityId: "med-1",
  dedupeKey: "med.unrecorded:med-1",
};

test("queueOperatingNotice makes NO rpc call when the ACL would refuse", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  await internals.queueOperatingNotice(makeSession(), {
    ...noticeInput,
    userId: "user-other",
    roleKey: null,
    type: "med.unrecorded",
  });
  assert.deepEqual(calls, []);
});

test("queueOperatingNotice makes NO rpc call for a type the RPC does not support", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  await internals.queueOperatingNotice(
    makeSession({ permissions: { "clinical.view": true } }),
    { ...noticeInput, userId: null, roleKey: "nurse", type: "med.order_unknown" },
  );
  assert.deepEqual(calls, []);
});

test("queueOperatingNotice DOES call the rpc for a permitted med order notice (PR #204)", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  // med.order_expired joins the RPC allow-list with migration
  // 20261031210000; a clinical session queueing it for the nursing
  // role is permitted, so the gate must let the call through…
  await internals.queueOperatingNotice(
    makeSession({ permissions: { "clinical.view": true } }),
    { ...noticeInput, userId: null, roleKey: "nurse", type: "med.order_expired" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "queue_operating_notice");
  assert.equal(calls[0].args.p_type, "med.order_expired");
  // …while an unprivileged DSP queueing the same type for someone
  // else is still gated off (allow-listed, not exempt).
  await internals.queueOperatingNotice(makeSession(), {
    ...noticeInput,
    userId: "user-other",
    roleKey: null,
    type: "med.order_expiring",
  });
  assert.equal(calls.length, 1);
});

test("queueOperatingNotice DOES call the rpc for permitted cases", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  // Self notice.
  await internals.queueOperatingNotice(makeSession(), {
    ...noticeInput,
    userId: "user-dsp",
    roleKey: null,
    type: "med.late_recording",
  });
  // Exempt missing-note notice for another user, from a plain DSP.
  await internals.queueOperatingNotice(makeSession(), {
    ...noticeInput,
    userId: "user-writer",
    roleKey: null,
    type: "documentation.missing_note",
  });
  // Other-user notice from a session holding a notify-other permission.
  await internals.queueOperatingNotice(
    makeSession({ permissions: { "hub.view_team": true } }),
    { ...noticeInput, userId: "user-other", roleKey: null, type: "med.unrecorded" },
  );
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.name === "queue_operating_notice"));
  assert.equal(calls[0].args.p_type, "med.late_recording");
  assert.equal(calls[1].args.p_type, "documentation.missing_note");
  assert.equal(calls[2].args.p_user_id, "user-other");
});

test("loadOperatingRules skips effective_rules while the password change is pending", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  const rules = (await internals.loadOperatingRules(
    makeSession({ mustChangePassword: true }),
  )) as { unrecordedReminderMinutes: number };
  assert.deepEqual(calls, []);
  assert.equal(typeof rules.unrecordedReminderMinutes, "number");
});

test("loadOperatingRules calls effective_rules for a settled session", async () => {
  const { api, calls } = recordingApi();
  const internals = api as unknown as NoticeInternals;
  await internals.loadOperatingRules(makeSession());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "effective_rules");
  assert.equal(calls[0].args.p_agency_id, "agency-1");
});
