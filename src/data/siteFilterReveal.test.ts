import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { siteFilterForCreatedRecord } from "./siteFilterReveal";

describe("siteFilterForCreatedRecord (create-flow completion)", () => {
  it("moves a house filter to the created record's house so the record shows in its list", () => {
    assert.equal(
      siteFilterForCreatedRecord("Beta House", "Alpha House"),
      "Alpha House",
    );
  });

  it("leaves an unfiltered view unfiltered", () => {
    assert.equal(
      siteFilterForCreatedRecord("All sites", "Alpha House"),
      "All sites",
    );
  });

  it("leaves a same-house filter untouched", () => {
    assert.equal(
      siteFilterForCreatedRecord("Alpha House", "Alpha House"),
      "Alpha House",
    );
  });
});
