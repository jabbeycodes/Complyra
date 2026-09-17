import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMERGENCY_DRILL_SCHEDULE,
  SHIFT_PERIODS,
  shiftPeriodForMonth,
} from "./drillSchedule";

describe("shiftPeriodForMonth", () => {
  it("maps all 12 months to the right shift period", () => {
    const expected = [
      "am", "am", "am",
      "pm", "pm", "pm",
      "overnight", "overnight", "overnight",
      "weekend", "weekend", "weekend",
    ] as const;
    for (const month of EMERGENCY_DRILL_SCHEDULE) {
      const period = shiftPeriodForMonth(month.month);
      assert.equal(period.key, expected[month.month - 1], `month ${month.month}`);
    }
  });

  it("clamps out-of-range months instead of throwing", () => {
    assert.equal(shiftPeriodForMonth(0).key, "am");
    assert.equal(shiftPeriodForMonth(13).key, "weekend");
  });

  it("carries staff labels matching the canonical responsibilities", () => {
    const byKey = new Map(SHIFT_PERIODS.map((p) => [p.key, p]));
    assert.equal(byKey.get("am")?.staffLabel, "AM staff");
    assert.equal(byKey.get("pm")?.staffLabel, "PM staff");
    assert.equal(byKey.get("overnight")?.staffLabel, "Overnight staff");
    assert.equal(byKey.get("weekend")?.staffLabel, "Weekend staff");
  });
});
