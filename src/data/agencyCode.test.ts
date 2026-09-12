import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgencyCode,
  normalizeAgencyCode,
  suggestAgencySlug,
  validateAgencyCodeParts,
} from "./agencyCode";

test("agency codes are short-name plus state", () => {
  assert.equal(suggestAgencySlug("Evergreen Care"), "evergreen");
  assert.equal(
    suggestAgencySlug("Longhorn Premier Medical Management"),
    "lpmm",
  );
  assert.equal(buildAgencyCode("Evergreen", "MO"), "EVERGREEN-MO");
  assert.equal(buildAgencyCode("LPMM", "ca"), "LPMM-CA");
  assert.equal(normalizeAgencyCode("evergreen-mo"), "EVERGREEN-MO");
  assert.equal(validateAgencyCodeParts("lpmm", "CA"), null);
  assert.match(validateAgencyCodeParts("x", "MO") ?? "", /2–20/);
});
