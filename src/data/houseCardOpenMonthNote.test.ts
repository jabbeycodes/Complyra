import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { houseCardOpenMonthNote } from "./houseCard";

/**
 * Wave 7R (simulation batch 105): the House Card open-month note is the
 * one piece of write-inviting copy a read-only viewer was shown — the
 * auditor read "New entries can be recorded for this month…" on a
 * ledger they can never write to. The note now follows the same
 * canRecordHouseCard gate as the entry form itself: recorders keep the
 * working copy verbatim, everyone else gets the neutral statement.
 */
describe("houseCardOpenMonthNote (wave 7R)", () => {
  it("recorders keep the original working copy", () => {
    assert.equal(
      houseCardOpenMonthNote(true, "September 2026"),
      "September 2026 is still open. New entries can be recorded for this month until a manager signs it closed.",
    );
  });

  it("read-only viewers get the neutral statement, with no recording invitation", () => {
    const note = houseCardOpenMonthNote(false, "September 2026");
    assert.equal(
      note,
      "September 2026 is still open. It has not been signed closed yet.",
    );
    assert.ok(!/can be recorded/i.test(note));
  });
});
