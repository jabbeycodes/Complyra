import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LoadStallWatchdog,
  WORKSPACE_LOAD_STALL_MS,
  workspaceLoadPending,
  type StallScheduler,
} from "./loadWatchdog";
import type { SessionUser } from "./types";

function session(partial: Partial<SessionUser>): SessionUser {
  return {
    userId: "u1",
    email: "user@example.com",
    username: "user",
    fullName: "Test User",
    jobTitle: "DSP",
    role: "dsp",
    roleKey: "dsp",
    agencyId: "agency",
    agencyName: "Agency",
    agencyCode: "AGENCY-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...partial,
  };
}

test("pending: the initial session restore counts as an unsettled load", () => {
  assert.equal(
    workspaceLoadPending({ loading: true, session: null, workspace: null, error: "" }),
    true,
  );
});

test("pending: an eligible session with no workspace and no error is unsettled", () => {
  assert.equal(
    workspaceLoadPending({ loading: false, session: session({}), workspace: null, error: "" }),
    true,
  );
  assert.equal(
    workspaceLoadPending({
      loading: false,
      session: session({ platformAdmin: true, agencyStatus: "pending" }),
      workspace: null,
      error: "",
    }),
    true,
  );
});

test("pending: a landed workspace settles the load", () => {
  assert.equal(
    workspaceLoadPending({ loading: false, session: session({}), workspace: {}, error: "" }),
    false,
  );
});

test("pending: a recorded error settles the load (the error card owns the screen)", () => {
  assert.equal(
    workspaceLoadPending({
      loading: false,
      session: session({}),
      workspace: null,
      error: "Could not load the workspace.",
    }),
    false,
  );
});

test("pending: signed out settles the load", () => {
  assert.equal(
    workspaceLoadPending({ loading: false, session: null, workspace: null, error: "" }),
    false,
  );
});

test("pending: sessions that intentionally have no workspace never count", () => {
  assert.equal(
    workspaceLoadPending({
      loading: false,
      session: session({ mustChangePassword: true }),
      workspace: null,
      error: "",
    }),
    false,
  );
  assert.equal(
    workspaceLoadPending({
      loading: false,
      session: session({ agencyStatus: "pending" }),
      workspace: null,
      error: "",
    }),
    false,
  );
});

/** Controllable scheduler: timers fire only when the test fires them. */
function fakeScheduler() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const cleared: number[] = [];
  let next = 1;
  const scheduler: StallScheduler = {
    set: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clear: (handle) => {
      cleared.push(handle as number);
      timers.delete(handle as number);
    },
  };
  return {
    scheduler,
    timers,
    cleared,
    fireAll() {
      const pending = [...timers.values()].map((t) => t.fn);
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}

test("watchdog: fires stalled once the threshold elapses on an unsettled load", () => {
  const fake = fakeScheduler();
  const events: boolean[] = [];
  const watchdog = new LoadStallWatchdog((s) => events.push(s), 30_000, fake.scheduler);

  watchdog.update(true);
  assert.equal(fake.timers.size, 1);
  assert.equal([...fake.timers.values()][0].ms, 30_000);
  assert.equal(watchdog.isStalled, false);

  fake.fireAll();
  assert.equal(watchdog.isStalled, true);
  assert.deepEqual(events, [true]);
});

test("watchdog: the default threshold is 30 seconds", () => {
  assert.equal(WORKSPACE_LOAD_STALL_MS, 30_000);
  const fake = fakeScheduler();
  const watchdog = new LoadStallWatchdog(() => {}, undefined, fake.scheduler);
  watchdog.update(true);
  assert.equal([...fake.timers.values()][0].ms, WORKSPACE_LOAD_STALL_MS);
});

test("watchdog: a load that settles before the threshold never stalls", () => {
  const fake = fakeScheduler();
  const events: boolean[] = [];
  const watchdog = new LoadStallWatchdog((s) => events.push(s), 30_000, fake.scheduler);

  watchdog.update(true);
  watchdog.update(false);
  assert.equal(fake.timers.size, 0);
  assert.equal(fake.cleared.length, 1);

  fake.fireAll();
  assert.equal(watchdog.isStalled, false);
  assert.deepEqual(events, []);
});

test("watchdog: the stall clears when the workspace lands late", () => {
  const fake = fakeScheduler();
  const events: boolean[] = [];
  const watchdog = new LoadStallWatchdog((s) => events.push(s), 30_000, fake.scheduler);

  watchdog.update(true);
  fake.fireAll();
  assert.equal(watchdog.isStalled, true);

  // A retry from the stall card keeps the load unsettled: no re-arm, no flap.
  watchdog.update(true);
  assert.equal(fake.timers.size, 0);
  assert.equal(watchdog.isStalled, true);

  // The load finally lands.
  watchdog.update(false);
  assert.equal(watchdog.isStalled, false);
  assert.deepEqual(events, [true, false]);
});

test("watchdog: repeated pending updates arm a single timer, and a fresh load re-arms", () => {
  const fake = fakeScheduler();
  const events: boolean[] = [];
  const watchdog = new LoadStallWatchdog((s) => events.push(s), 30_000, fake.scheduler);

  watchdog.update(true);
  watchdog.update(true);
  watchdog.update(true);
  assert.equal(fake.timers.size, 1);

  fake.fireAll();
  watchdog.update(false);
  watchdog.update(true);
  assert.equal(fake.timers.size, 1);
  fake.fireAll();
  assert.deepEqual(events, [true, false, true]);
});

test("watchdog: dispose cancels a pending timer", () => {
  const fake = fakeScheduler();
  const watchdog = new LoadStallWatchdog(() => {}, 30_000, fake.scheduler);
  watchdog.update(true);
  watchdog.dispose();
  assert.equal(fake.timers.size, 0);
  fake.fireAll();
  assert.equal(watchdog.isStalled, false);
});
