import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OneTimeSecret from "./OneTimeSecret";

const SENTINEL = "Sentinel!Pass42";

describe("OneTimeSecret", () => {
  it("masks by default: the value appears nowhere in the rendered output", () => {
    const html = renderToStaticMarkup(<OneTimeSecret value={SENTINEL} />);
    assert.ok(!html.includes(SENTINEL), "password value must not render");
    assert.ok(
      !html.includes(SENTINEL.slice(0, 8)),
      "no partial password may render either",
    );
    assert.ok(html.includes("••••••••••"), "fixed-length mask renders");
    assert.ok(html.includes("Password hidden"), "screen-reader note renders");
  });

  it("offers an explicit Show reveal and a Copy action", () => {
    const html = renderToStaticMarkup(<OneTimeSecret value={SENTINEL} />);
    assert.ok(html.includes("Show"), "Show action present");
    assert.ok(html.includes('aria-pressed="false"'), "reveal starts off");
    assert.ok(html.includes("Copy"), "Copy action present");
  });

  it("renders Done only when the parent can clear the value", () => {
    const withDone = renderToStaticMarkup(
      <OneTimeSecret value={SENTINEL} onDone={() => {}} />,
    );
    assert.ok(withDone.includes("Done"));
    const withoutDone = renderToStaticMarkup(<OneTimeSecret value={SENTINEL} />);
    assert.ok(!withoutDone.includes("Done"));
  });
});
