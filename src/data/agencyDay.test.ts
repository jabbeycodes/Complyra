import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENCY_TIME_ZONE, agencyDayOf, agencyToday } from "./agencyDay";
import { todayIso } from "./chart";
import { centralTodayIso } from "./menuRecords";
import { centralTodayIso as marCentralTodayIso } from "../features/mobile/mar";
import { todayStamp } from "./status";
import { AGENCY_TIME_ZONE as REMINDER_TIME_ZONE } from "./operatingReminders";

// 2026-11-03 21:30 CST = 2026-11-04T03:30Z: the UTC date has rolled over,
// the agency's day has not. This is the evening case that broke the MAR.
const EVENING_CST = new Date("2026-11-04T03:30:00.000Z");
// 2026-07-15 19:30 CDT = 2026-07-16T00:30Z (summer, UTC-5).
const EVENING_CDT = new Date("2026-07-16T00:30:00.000Z");

test("agency day: evening in Central is still today, not the UTC tomorrow", () => {
  assert.equal(agencyToday(EVENING_CST), "2026-11-03");
  assert.equal(agencyToday(EVENING_CDT), "2026-07-15");
  // Early morning UTC on the 4th is still the 3rd in Central; just after
  // Central midnight it is the 4th.
  assert.equal(agencyToday(new Date("2026-11-04T05:59:00.000Z")), "2026-11-03");
  assert.equal(agencyToday(new Date("2026-11-04T06:00:00.000Z")), "2026-11-04");
});

test("agency day of a stored instant reads the Central calendar day", () => {
  assert.equal(agencyDayOf("2026-11-04T03:30:00.000Z"), "2026-11-03");
  assert.equal(agencyDayOf("not-a-date"), "");
});

test("every legacy 'today' helper agrees with the agency day", () => {
  for (const now of [EVENING_CST, EVENING_CDT, new Date("2026-11-03T16:00:00.000Z")]) {
    const want = agencyToday(now);
    assert.equal(todayIso(now), want, "chart.todayIso");
    assert.equal(centralTodayIso(now), want, "menuRecords.centralTodayIso");
    assert.equal(marCentralTodayIso(now), want, "mar.centralTodayIso");
    assert.equal(todayStamp(now), want, "status.todayStamp");
  }
});

test("one agency time zone", () => {
  assert.equal(AGENCY_TIME_ZONE, "America/Chicago");
  assert.equal(REMINDER_TIME_ZONE, AGENCY_TIME_ZONE);
});
