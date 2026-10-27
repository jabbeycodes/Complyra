import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chicagoShiftInstants,
  coverageQueryWindow,
  currentWeekStart,
  shiftTouchesDate,
  sundayOnOrBefore,
  weekDates,
} from "./coverageWeek";

describe("house coverage week", () => {
  it("starts the week on Sunday", () => {
    assert.equal(sundayOnOrBefore("2026-10-21"), "2026-10-18");
    assert.equal(weekDates("2026-10-18")[6], "2026-10-24");
  });

  it("keeps an overnight shift on the day it starts", () => {
    const times = chicagoShiftInstants("2026-10-21", "22:00", "06:00");
    assert.equal(shiftTouchesDate(times.startsAt, times.endsAt, "2026-10-21"), true);
    assert.equal(shiftTouchesDate(times.startsAt, times.endsAt, "2026-10-22"), true);
    const range = coverageQueryWindow("2026-10-18");
    assert.ok(times.startsAt >= range.fromIso);
    assert.ok(times.endsAt <= range.toIso);
  });

  it("uses the Chicago week that is open now", () => {
    assert.equal(currentWeekStart(new Date("2026-10-21T18:00:00.000Z")), "2026-10-18");
  });
});
