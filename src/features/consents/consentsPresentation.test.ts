/**
 * Wave 6 item 7 pins: the consents list must present human values —
 * numbered versions (never raw record UUIDs), human dates and
 * timestamps — via the shared presentation helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentVersionNumbers,
  formatConsentTimestamp,
} from "./Consents";
import type { ConsentRegister } from "../../data/consents";

function record(id: string, createdAt: string, typeId = "photo") {
  return {
    id,
    individualId: "person-1",
    typeId,
    covers: "Photos for the agency newsletter",
    giver: "individual",
    giverName: "Ellis Hart",
    relationship: "Self",
    signedOn: "2026-10-01",
    effectiveOn: "2026-10-01",
    reviewOn: "2027-10-01",
    supersedesId: null,
    outcome: "yes",
    createdBy: "user-1",
    createdAt,
    activatedAt: createdAt,
    activatedBy: "user-1",
  };
}

test("versions are numbered per Individual + type, oldest first — never the raw id", () => {
  const register = {
    records: [
      record("9f8e7d6c-uuid-c", "2026-10-03T10:00:00.000Z"),
      record("9f8e7d6c-uuid-a", "2026-10-01T10:00:00.000Z"),
      record("9f8e7d6c-uuid-b", "2026-10-02T10:00:00.000Z"),
      record("9f8e7d6c-uuid-x", "2026-10-01T09:00:00.000Z", "medication"),
    ],
  } as unknown as ConsentRegister;
  const numbers = consentVersionNumbers(register);
  assert.equal(numbers.get("9f8e7d6c-uuid-a"), 1);
  assert.equal(numbers.get("9f8e7d6c-uuid-b"), 2);
  assert.equal(numbers.get("9f8e7d6c-uuid-c"), 3);
  assert.equal(numbers.get("9f8e7d6c-uuid-x"), 1, "numbering restarts per consent type");
});

test("timestamps render as human date + time, not ISO strings", () => {
  const label = formatConsentTimestamp("2026-10-31T14:05:00.000Z");
  assert.match(label, /Oct 31, 2026/);
  assert.match(label, /\d{1,2}:05\s?(AM|PM)/);
  assert.ok(!label.includes("T14:05"), "no raw ISO in the label");
});
