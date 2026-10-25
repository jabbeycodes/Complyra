import { test } from "node:test";
import assert from "node:assert/strict";
import { computeShiftNoteDueItems } from "./dueItems";
import { agencyClock, dueItemClock, noticesForAgency, operatingReminderNotices, reminderRecipientIds } from "./operatingReminders";
import type { SiteDueItem } from "./dueItems";

const missing: SiteDueItem = {
  id: "sn:2026-10-14:morgan:day:alex",
  kind: "shift_note",
  severity: "overdue",
  individualName: "Morgan Pruitt",
  individualId: "morgan",
  title: "Missing Shift note",
  line2: "Morgan · Day · 6:00 a.m.–2:00 p.m.",
  line3: "Needed from Alex Morgan",
  shift: {
    blockId: "day",
    blockLabel: "Day",
    serviceDate: "2026-10-14",
    staffUserId: "alex",
    staffName: "Alex Morgan",
  },
};

test("a closed app still names the writer and the house manager once", () => {
  const notices = operatingReminderNotices({
    now: new Date("2026-10-15T18:00:00.000Z"),
    unrecordedReminderMinutes: 60,
    prnReminderRepeatMinutes: 15,
    prnFollowupMinutes: 60,
    sites: [
      {
        id: "cedar",
        name: "Cedar House",
        items: [missing],
        medRecipients: [],
        noteManagers: ["sarah", "alex"],
      },
    ],
    prnFollowups: [],
  });
  assert.equal(notices.length, 2);
  assert.equal(notices[0]?.userId, "alex");
  assert.equal(notices[0]?.deepLink, "/plans/morgan#chart-shift-notes");
  assert.equal(notices[1]?.userId, "sarah");
  assert.match(notices[1]?.body ?? "", /Cedar House/);
  const again = operatingReminderNotices({
    now: new Date("2026-10-15T18:00:00.000Z"),
    unrecordedReminderMinutes: 60,
    prnReminderRepeatMinutes: 15,
    prnFollowupMinutes: 60,
    sites: [
      {
        id: "cedar",
        name: "Cedar House",
        items: [missing],
        medRecipients: [],
        noteManagers: ["sarah"],
      },
    ],
    prnFollowups: [],
  });
  assert.equal(again[0]?.dedupeKey, notices[0]?.dedupeKey);
});

test("an agency-wide administrator is told, and an expired member is not", () => {
  const ids = reminderRecipientIds(
    [
      { userId: "sarah", role: "administrator", siteId: null, expiresOn: null },
      { userId: "gone", role: "house_manager", siteId: "cedar", expiresOn: "2026-01-01" },
      { userId: "james", role: "house_manager", siteId: "willow", expiresOn: null },
    ],
    "cedar",
    ["house_manager", "administrator"],
    "2026-10-15",
  );
  assert.deepEqual(ids, ["sarah"]);
});

test("the unattended job uses the Central day", () => {
  const clock = agencyClock(new Date("2026-10-16T03:30:00.000Z"));
  assert.equal(clock.today, "2026-10-15");
  assert.equal(clock.yesterday, "2026-10-14");
  assert.equal(clock.minutes, 22 * 60 + 30);
});

test("the signed-in bell uses that same Central day", () => {
  const clock = dueItemClock(new Date("2026-10-16T03:30:00.000Z"));
  assert.equal(clock.serviceDate, "2026-10-14");
  assert.equal(clock.doseDate, "2026-10-15");
  assert.equal(clock.noteDay, "2026-10-15");
  assert.equal(clock.nowMinutes, 22 * 60 + 30);
  assert.equal(clock.timeZone, "America/Chicago");
});

test("grace follows Central time when the server clock is UTC", () => {
  const shared = {
    serviceDate: "2026-10-14",
    graceMinutes: 30,
    timeZone: "America/Chicago",
    staffed24h: true,
    individuals: [{ id: "morgan", name: "Morgan Pruitt" }],
    requiredWriters: [{ userId: "alex", name: "Alex Morgan" }],
    notes: [],
    aloneTime: [],
  };
  const during = computeShiftNoteDueItems({
    ...shared,
    now: new Date("2026-10-14T19:00:00.000Z"),
  });
  const after = computeShiftNoteDueItems({
    ...shared,
    now: new Date("2026-10-14T19:31:00.000Z"),
  });
  assert.equal(during.filter((item) => item.blockId === "day").length, 0);
  assert.equal(after.filter((item) => item.blockId === "day").length, 1);
});

test("a closed app names yesterday's missing note on the Central day", () => {
  const rules = {
    noteGraceMinutes: 30,
    medWindowBeforeMinutes: 60,
    medWindowAfterMinutes: 60,
    unrecordedReminderMinutes: 60,
    prnFollowupMinutes: 60,
    prnReminderRepeatMinutes: 15,
  };
  const input = {
    now: new Date("2026-10-16T03:30:00.000Z"),
    rules,
    sites: [{ id: "cedar", name: "Cedar House", facts: { staffed24h: true } }],
    memberships: [
      { userId: "alex", role: "dsp", siteId: "cedar", expiresOn: null },
      { userId: "sarah", role: "administrator", siteId: null, expiresOn: null },
    ],
    profiles: [
      { id: "alex", fullName: "Alex Morgan" },
      { id: "sarah", fullName: "Sarah Mitchell" },
    ],
    individuals: [{ id: "morgan", name: "Morgan Pruitt", siteId: "cedar" }],
    notes: [],
    aloneTime: [],
    medications: [{ id: "lev", name: "levetiracetam", individualId: "morgan", kind: "scheduled", strength: "500 mg" }],
    doseTimes: [{ medicationId: "lev", doseTimes: ["08:00"] }],
    marks: [],
    prnEvents: [],
  };
  const notices = noticesForAgency(input);
  const writer = notices.find((notice) => notice.userId === "alex" && notice.type === "documentation.missing_note");
  assert.equal(writer?.deepLink, "/plans/morgan#chart-shift-notes");
  assert.match(writer?.dedupeKey ?? "", /:2026-10-14:morgan:day:alex:alex:2026-10-15$/);
  assert.ok(notices.some((notice) => notice.userId === "sarah" && notice.type === "med.unrecorded"));
  const again = noticesForAgency(input);
  assert.equal(again[0]?.dedupeKey, notices[0]?.dedupeKey);
});
