import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asQaBlockedError } from "./qaApiShim";

describe("asQaBlockedError (QA blocking-rule contract)", () => {
  it("matches an error named QaBlockedError carrying string evidence", () => {
    const err = new Error("blocked") as Error & { evidence: string };
    err.name = "QaBlockedError";
    err.evidence = "Fire extinguisher log signed 2026-09-10";
    assert.deepEqual(asQaBlockedError(err), {
      evidence: "Fire extinguisher log signed 2026-09-10",
    });
  });

  it("rejects other error names", () => {
    const err = new Error("nope") as Error & { evidence: string };
    err.name = "TypeError";
    err.evidence = "something";
    assert.equal(asQaBlockedError(err), null);
  });

  it("rejects missing or non-string evidence", () => {
    const err = new Error("blocked");
    err.name = "QaBlockedError";
    assert.equal(asQaBlockedError(err), null);
    const empty = new Error("blocked") as Error & { evidence: string };
    empty.name = "QaBlockedError";
    empty.evidence = "";
    assert.equal(asQaBlockedError(empty), null);
  });

  it("rejects non-errors", () => {
    assert.equal(asQaBlockedError("QaBlockedError"), null);
    assert.equal(asQaBlockedError(null), null);
  });
});
