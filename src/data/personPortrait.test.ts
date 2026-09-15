import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portraitDataUrl, portraitSrc } from "./personPortrait";

describe("personPortrait", () => {
  it("keeps an uploaded photo when present", () => {
    assert.equal(portraitSrc("Ellis Hart", "/photos/ellis.jpg"), "/photos/ellis.jpg");
  });

  it("builds a deterministic illustrated portrait when no upload exists", () => {
    const a = portraitDataUrl("Ellis Hart");
    const b = portraitDataUrl("Ellis Hart");
    const other = portraitDataUrl("Nia Brooks");
    assert.ok(a.startsWith("data:image/svg+xml"));
    assert.equal(a, b);
    assert.notEqual(a, other);
    assert.equal(portraitSrc("Ellis Hart"), a);
  });
});
