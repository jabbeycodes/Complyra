import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portraitDataUrl, portraitSrc } from "./personPortrait";

describe("personPortrait", () => {
  it("keeps an uploaded photo when present", () => {
    assert.equal(portraitSrc("Jodie Williams", "/photos/jodie.jpg"), "/photos/jodie.jpg");
  });

  it("builds a deterministic illustrated portrait when no upload exists", () => {
    const a = portraitDataUrl("Jodie Williams");
    const b = portraitDataUrl("Jodie Williams");
    const other = portraitDataUrl("QA Person One");
    assert.ok(a.startsWith("data:image/svg+xml"));
    assert.equal(a, b);
    assert.notEqual(a, other);
    assert.equal(portraitSrc("Jodie Williams"), a);
  });
});
