import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditBinderTemplates,
  canOfferPersonalSpendingEntryForm,
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

test("binder templates are administrator and program manager configuration", () => {
  assert.equal(canEditBinderTemplates("administrator"), true);
  assert.equal(canEditBinderTemplates("program_manager"), true);
  for (const role of ["hr", "house_manager", "nurse", "dsp", "auditor", undefined]) {
    assert.equal(canEditBinderTemplates(role), false, String(role));
  }
});
