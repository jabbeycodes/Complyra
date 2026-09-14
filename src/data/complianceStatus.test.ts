import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_STATUSES,
  STATUS_META,
  certificateStatus,
  checklistStatus,
  delegationStatus,
  fromRequirementStatus,
  medSupplyStatus,
  medSupplyStatusFromInventory,
  type ComplianceStatus,
} from "./complianceStatus";

const NOW = new Date("2026-09-13T12:00:00Z");
const iso = (offsetDays: number) =>
  new Date(NOW.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);

describe("STATUS_META", () => {
  it("covers all seven statuses with a label, icon, and description", () => {
    const expected: ComplianceStatus[] = [
      "compliant",
      "expiring",
      "expired",
      "missing",
      "late",
      "pending",
      "attention",
    ];
    assert.deepEqual(ALL_STATUSES.sort(), expected.sort());
    for (const status of expected) {
      const meta = STATUS_META[status];
      assert.ok(meta.label.length > 0, `${status} label`);
      assert.ok(meta.icon.length > 0, `${status} icon`);
      assert.ok(meta.description.length > 0, `${status} description`);
    }
  });

  it("uses a unique icon shape per status (no color-only distinction)", () => {
    const icons = Object.values(STATUS_META).map((m) => m.icon);
    assert.equal(new Set(icons).size, icons.length);
  });

  it("uses the canonical human labels", () => {
    assert.equal(STATUS_META.compliant.label, "Compliant");
    assert.equal(STATUS_META.expiring.label, "Expiring soon");
    assert.equal(STATUS_META.expired.label, "Expired");
    assert.equal(STATUS_META.missing.label, "Missing");
    assert.equal(STATUS_META.late.label, "Late");
    assert.equal(STATUS_META.pending.label, "Pending");
    assert.equal(STATUS_META.attention.label, "Needs attention");
  });
});

describe("fromRequirementStatus", () => {
  const cases: Array<[string, ComplianceStatus]> = [
    ["Compliant", "compliant"],
    ["compliant", "compliant"],
    ["complete", "compliant"],
    ["waived_na", "compliant"],
    ["Upcoming", "compliant"],
    ["upcoming", "compliant"],
    ["Cleared", "compliant"],
    ["Current", "compliant"],
    ["ok", "compliant"],
    ["Due soon", "expiring"],
    ["due_soon", "expiring"],
    ["Overdue", "late"],
    ["overdue", "late"],
    ["Expired", "expired"],
    ["expired", "expired"],
    ["Pending review", "pending"],
    ["pending_review", "pending"],
    ["pending", "pending"],
    ["in_progress", "pending"],
    ["Not cleared", "attention"],
    ["Off", "attention"],
    ["something brand new", "attention"],
    ["", "attention"],
  ];
  for (const [input, expected] of cases) {
    it(`maps "${input}" -> "${expected}"`, () => {
      assert.equal(fromRequirementStatus(input), expected);
    });
  }
});

describe("certificateStatus", () => {
  it("mirrors certExpiryStatus bands: expired / <=30d / <=90d / >90d", () => {
    assert.equal(certificateStatus(iso(-1), NOW), "expired");
    assert.equal(certificateStatus(iso(0), NOW), "expiring");
    assert.equal(certificateStatus(iso(30), NOW), "expiring"); // boundary
    assert.equal(certificateStatus(iso(31), NOW), "attention");
    assert.equal(certificateStatus(iso(90), NOW), "attention"); // boundary
    assert.equal(certificateStatus(iso(91), NOW), "compliant");
    assert.equal(certificateStatus(iso(400), NOW), "compliant");
  });
});

describe("medSupplyStatus", () => {
  it("mirrors computeInventory bands (out / critical / low / ok)", () => {
    assert.equal(medSupplyStatus(0), "expired");
    assert.equal(medSupplyStatus(null), "expired");
    assert.equal(medSupplyStatus(-3), "expired");
    assert.equal(medSupplyStatus(1), "attention");
    assert.equal(medSupplyStatus(2), "attention"); // boundary (<=2d critical)
    assert.equal(medSupplyStatus(3), "expiring");
    assert.equal(medSupplyStatus(7), "expiring"); // default 7d threshold boundary
    assert.equal(medSupplyStatus(8), "compliant");
    assert.equal(medSupplyStatus(60), "compliant");
  });

  it("honours a custom low threshold", () => {
    assert.equal(medSupplyStatus(10, 14), "expiring");
    assert.equal(medSupplyStatus(14, 14), "expiring");
    assert.equal(medSupplyStatus(15, 14), "compliant");
  });

  it("medSupplyStatusFromInventory maps the stored band directly", () => {
    assert.equal(medSupplyStatusFromInventory("ok"), "compliant");
    assert.equal(medSupplyStatusFromInventory("low"), "expiring");
    assert.equal(medSupplyStatusFromInventory("critical"), "attention");
    assert.equal(medSupplyStatusFromInventory("out"), "expired");
  });
});

describe("checklistStatus", () => {
  it("submitted checklists are always compliant", () => {
    assert.equal(checklistStatus(true, null, false, NOW), "compliant");
    assert.equal(checklistStatus(true, iso(-5), true, NOW), "compliant");
  });
  it("unsubmitted late checklists are late", () => {
    assert.equal(checklistStatus(false, iso(-2), true, NOW), "late");
  });
  it("due within 7 days is expiring, further out is pending", () => {
    assert.equal(checklistStatus(false, iso(3), false, NOW), "expiring");
    assert.equal(checklistStatus(false, iso(7), false, NOW), "expiring");
    assert.equal(checklistStatus(false, iso(8), false, NOW), "pending");
    assert.equal(checklistStatus(false, null, false, NOW), "pending");
  });
});

describe("delegationStatus", () => {
  it("rescinded beats signed; signed is compliant; otherwise pending", () => {
    assert.equal(delegationStatus(true, true), "expired");
    assert.equal(delegationStatus(true, false), "expired");
    assert.equal(delegationStatus(false, true), "compliant");
    assert.equal(delegationStatus(false, false), "pending");
  });
});
