/**
 * Rollover feedback copy tests (P2 QA — visible rollover confirmation).
 *
 * The data-layer rollover itself is covered in src/data/hmChecklist.test.ts
 * ("rollover locks prior open weeks as overdue and is idempotent"); these
 * tests cover the new success summary the HM page shows when the rollover
 * actually changes something.
 *
 * Run: node --import tsx --import ./src/testSupport/cssStub.mts --test src/features/hmChecklist/rolloverNotice.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRolloverNotice } from "./rolloverNotice";

describe("formatRolloverNotice", () => {
  it("returns null when the rollover changed nothing (no banner)", () => {
    assert.equal(formatRolloverNotice({ created: 0, locked: 0 }), null);
  });

  it("summarizes a fresh week with no overdue lock", () => {
    assert.equal(
      formatRolloverNotice({ created: 2, locked: 0 }),
      "New week started — 2 new checklists opened for this week.",
    );
  });

  it("uses singular wording for one checklist", () => {
    assert.equal(
      formatRolloverNotice({ created: 1, locked: 0 }),
      "New week started — 1 new checklist opened for this week.",
    );
  });

  it("summarizes opened checklists plus overdue weeks", () => {
    assert.equal(
      formatRolloverNotice({ created: 3, locked: 2 }),
      "New week started — 3 new checklists opened for this week; 2 prior weeks marked overdue.",
    );
  });

  it("uses singular wording for one overdue week", () => {
    assert.equal(
      formatRolloverNotice({ created: 1, locked: 1 }),
      "New week started — 1 new checklist opened for this week; 1 prior week marked overdue.",
    );
  });

  it("never claims items were carried over — each week starts blank", () => {
    const notice = formatRolloverNotice({ created: 2, locked: 1 });
    assert.ok(notice);
    assert.ok(
      !/carried over/i.test(notice),
      "rollover opens fresh blank checklists; nothing carries over",
    );
  });
});
