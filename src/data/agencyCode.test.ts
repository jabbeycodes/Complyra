import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgencyCode,
  suggestAgencySlug,
  validateAgencyCodeParts,
} from "./agencyCode";

test("agency codes are short-name plus state", () => {
  assert.equal(suggestAgencySlug("Evergreen Care"), "evergreen");
  assert.equal(
    suggestAgencySlug("Longhorn Premier Medical Management"),
    "lpmm",
  );
  assert.equal(buildAgencyCode("Evergreen", "MO"), "evergreen-mo");
  assert.equal(buildAgencyCode("LPMM", "ca"), "lpmm-ca");
  assert.equal(validateAgencyCodeParts("lpmm", "CA"), null);
  assert.match(validateAgencyCodeParts("x", "MO") ?? "", /2–20/);
});
