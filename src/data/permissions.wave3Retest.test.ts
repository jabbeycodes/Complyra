import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditBinderTemplates,
  canOfferPersonalSpendingEntryForm,
  canVoidPersonalSpendingEntry,
} from "./permissions";

test("the Personal Spending entry form on a closed month is a closer's control", () => {
  for (const role of ["administrator", "program_manager", "house_manager"]) {
    assert.equal(canOfferPersonalSpendingEntryForm(role, true), true, role);
    assert.equal(canOfferPersonalSpendingEntryForm(role, false), true, role);
  }
  assert.equal(canOfferPersonalSpendingEntryForm("dsp", true), false);
  assert.equal(canOfferPersonalSpendingEntryForm("dsp", false), true);
  for (const role of ["auditor", "hr", "nurse"]) {
    assert.equal(canOfferPersonalSpendingEntryForm(role, false), false, role);
  }
});

test("a signed month: managers void any entry, everyone else voids none", () => {
  const own = { recordedBy: "user-1" };
  const others = { recordedBy: "user-2" };
  for (const roleKey of ["administrator", "program_manager", "house_manager"]) {
    const session = { roleKey, userId: "user-1" };
    assert.equal(canVoidPersonalSpendingEntry(session, own, true), true, roleKey);
    assert.equal(canVoidPersonalSpendingEntry(session, others, true), true, roleKey);
  }
  for (const roleKey of ["dsp", "auditor", "hr", "nurse"]) {
    const session = { roleKey, userId: "user-1" };
    assert.equal(canVoidPersonalSpendingEntry(session, own, true), false, roleKey);
    assert.equal(canVoidPersonalSpendingEntry(session, others, true), false, roleKey);
  }
  const dsp = { roleKey: "dsp", userId: "user-1" };
  assert.equal(canVoidPersonalSpendingEntry(dsp, own, false), true);
  assert.equal(canVoidPersonalSpendingEntry(dsp, others, false), false);
});

test("binder templates are administrator and program manager configuration", () => {
  assert.equal(canEditBinderTemplates("administrator"), true);
  assert.equal(canEditBinderTemplates("program_manager"), true);
  for (const role of ["hr", "house_manager", "nurse", "dsp", "auditor", undefined]) {
    assert.equal(canEditBinderTemplates(role), false, String(role));
  }
});
