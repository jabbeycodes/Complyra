import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  noticesForAgency,
  prnNoticeKeys,
  prnNoticeRearmDue,
  prnRepeatDedupeKey,
} from "./operatingReminders";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";

/**
 * Simulation batch 199: the Maple house manager's bell flooded with PRN
 * notices while Juniper's stayed clean. The key held a reminder slot, so an
 * open follow-up minted one row per recipient every 15 minutes. A house with
 * no open follow-up never reached this code.
 */

const GIVEN_AT = "2026-11-02T12:00:00.000Z";
const RULES = {
  noteGraceMinutes: 60,
  medWindowBeforeMinutes: 60,
  medWindowAfterMinutes: 60,
  unrecordedReminderMinutes: 60,
  prnFollowupMinutes: 60,
  prnReminderRepeatMinutes: 15,
};

function agencySweep(now: Date, prnEvents: Parameters<typeof noticesForAgency>[0]["prnEvents"]) {
  return noticesForAgency({
    now,
    rules: RULES,
    sites: [{ id: "maple", name: "Maple", facts: {} }],
    memberships: [
      { userId: "hm-maple", role: "house_manager", siteId: "maple", expiresOn: null },
      { userId: "nurse", role: "nurse", siteId: null, expiresOn: null },
    ],
    profiles: [],
    individuals: [{ id: "person", name: "Person", siteId: "maple" }],
    notes: [],
    aloneTime: [],
    medications: [{ id: "med-1", name: "Lorazepam", individualId: "person", kind: "prn", strength: "1mg" }],
    doseTimes: [],
    marks: [],
    prnEvents,
  }).filter((notice) => notice.type === "med.prn_repeat");
}

const DOSE = [
  { action: "medication.prn", targetId: "med-1", actorId: "dsp-a", createdAt: GIVEN_AT },
  { action: "medication.prn_followup", targetId: "med-1", actorId: "dsp-a", createdAt: GIVEN_AT },
];

test("a second sweep in the same slot queues the same keys", () => {
  const now = new Date("2026-11-02T13:01:00.000Z");
  assert.deepEqual(prnNoticeKeys(agencySweep(now, DOSE)), prnNoticeKeys(agencySweep(now, DOSE)));
});

test("a day of sweeps across reminder slots yields one key per recipient for one dose", () => {
  const keys = new Set<string>();
  for (let minutes = 61; minutes < 24 * 60; minutes += 15) {
    const now = new Date(Date.parse(GIVEN_AT) + minutes * 60_000);
    for (const key of prnNoticeKeys(agencySweep(now, DOSE))) keys.add(key);
  }
  // House manager, nurse, and the staff member who gave the dose.
  assert.deepEqual([...keys].sort(), [
    prnRepeatDedupeKey("med-1", "dsp-a", GIVEN_AT),
    prnRepeatDedupeKey("med-1", "hm-maple", GIVEN_AT),
    prnRepeatDedupeKey("med-1", "nurse", GIVEN_AT),
  ].sort());
});

test("the audit timestamp's text format does not change the key", () => {
  assert.equal(
    prnRepeatDedupeKey("med-1", "hm", "2026-11-02T12:00:00+00:00"),
    prnRepeatDedupeKey("med-1", "hm", "2026-11-02T12:00:00.000Z"),
  );
});

test("a new dose is a new event and gets its own notice", () => {
  const later = "2026-11-02T15:00:00.000Z";
  const events = [...DOSE, { action: "medication.prn_followup", targetId: "med-1", actorId: "dsp-b", createdAt: later }];
  const now = new Date("2026-11-02T16:30:00.000Z");
  assert.ok(prnNoticeKeys(agencySweep(now, events)).includes(prnRepeatDedupeKey("med-1", "hm-maple", later)));
  assert.ok(!prnNoticeKeys(agencySweep(now, events)).includes(prnRepeatDedupeKey("med-1", "hm-maple", GIVEN_AT)));
});

test("no notice before the follow-up is due or after it is recorded", () => {
  assert.equal(agencySweep(new Date("2026-11-02T12:30:00.000Z"), DOSE).length, 0);
  const recorded = [...DOSE, { action: "medication.prn_effectiveness", targetId: "med-1", actorId: "dsp-a", createdAt: "2026-11-02T12:40:00.000Z" }];
  assert.equal(agencySweep(new Date("2026-11-02T13:30:00.000Z"), recorded).length, 0);
});

test("the re-arm is due only for a read row, a full interval after it was read", () => {
  const readAt = "2026-11-02T13:00:00.000Z";
  assert.equal(prnNoticeRearmDue(null, new Date("2026-11-02T14:00:00.000Z"), 15), false);
  assert.equal(prnNoticeRearmDue(readAt, new Date("2026-11-02T13:14:59.000Z"), 15), false);
  assert.equal(prnNoticeRearmDue(readAt, new Date("2026-11-02T13:15:00.000Z"), 15), true);
});

test("LocalApi: sweeps across slots keep one row; reading it re-arms that row, not a new one", async () => {
  const clock = mock.timers;
  clock.enable({ apis: ["Date"], now: Date.parse(GIVEN_AT) });
  try {
    const api = new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_ADMIN_USERNAME,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const ellis = workspace.individuals.find((person) => person.name === "Ellis Hart")!;
    const medId = `${ellis.id}-med-lorazepam`;
    await api.logPrnDose(medId, { pills: 1, reason: "Anxiety" });
    const prnRows = async () =>
      (await api.listNotifications()).filter((row) => row.type === "med.prn_repeat" && row.entity_id === medId);

    clock.tick(61 * 60_000);
    const first = await prnRows();
    assert.equal(first.length, 1);
    assert.equal(first[0].read_at, null);

    clock.tick(45 * 60_000);
    assert.equal((await prnRows()).length, 1, "three slots later there is still one row");

    await api.markNotificationsRead([first[0].id]);
    clock.tick(5 * 60_000);
    const stillRead = await prnRows();
    assert.equal(stillRead.length, 1);
    assert.notEqual(stillRead[0].read_at, null, "read inside the interval stays read");

    clock.tick(15 * 60_000);
    const rearmed = await prnRows();
    assert.equal(rearmed.length, 1, "the repeat re-arms the row instead of adding one");
    assert.equal(rearmed[0].id, first[0].id);
    assert.equal(rearmed[0].read_at, null);

    await api.recordPrnFollowup(medId, { indication: "Anxiety", result: "Calmer after 20 minutes" });
    await api.markNotificationsRead([first[0].id]);
    clock.tick(60 * 60_000);
    const closed = await prnRows();
    assert.notEqual(closed[0].read_at, null, "a recorded follow-up stops the repeat");
  } finally {
    clock.reset();
  }
});

test("the migration retires old slot keys only and deletes nothing", () => {
  const sql = readFileSync("supabase/migrations/20261031330000_prn_notice_dedupe.sql", "utf8");
  const pattern = /dedupe_key ~ '(.+)'/.exec(sql)?.[1] ?? "";
  const slotKey = new RegExp(pattern);
  assert.ok(slotKey.test("med.prn_repeat:med-1:hm:1234567"));
  assert.ok(!slotKey.test(prnRepeatDedupeKey("med-1", "hm", GIVEN_AT)));
  assert.doesNotMatch(sql, /delete from/i);
  for (const sweep of ["src/data/hostedApi.ts", "supabase/functions/sweep-operating-reminders/index.ts"]) {
    assert.match(readFileSync(sweep, "utf8"), /rpc\("rearm_prn_repeat_notices"/);
  }
});
