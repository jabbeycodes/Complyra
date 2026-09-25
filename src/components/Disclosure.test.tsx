import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Disclosure from "./Disclosure";

describe("Disclosure", () => {
  it("is collapsed by default with an accessible name on the trigger", () => {
    const html = renderToStaticMarkup(
      <Disclosure label="Advanced & data">
        <p>Secret secondary content</p>
      </Disclosure>,
    );
    assert.ok(html.includes("Advanced &amp; data"), "accessible label");
    assert.ok(html.includes('aria-expanded="false"'), "collapsed by default");
    assert.ok(html.includes('aria-controls='), "trigger controls the panel");
    assert.ok(html.includes("hidden"), "panel hidden while collapsed");
  });

  it("renders its panel content when defaultOpen is set", () => {
    const html = renderToStaticMarkup(
      <Disclosure label="Filters" defaultOpen summary="3 active">
        <p>Filter controls</p>
      </Disclosure>,
    );
    assert.ok(html.includes('aria-expanded="true"'), "expanded state");
    assert.ok(html.includes("Filter controls"), "panel content rendered");
    assert.ok(html.includes("3 active"), "summary hint rendered");
    assert.ok(html.includes("is-open"), "open modifier class");
  });

  it("keeps the trigger before the panel so focus order is preserved", () => {
    const html = renderToStaticMarkup(
      <Disclosure label="More details">
        <span>panel-body</span>
      </Disclosure>,
    );
    assert.ok(
      html.indexOf("disclosure-trigger") < html.indexOf("disclosure-panel"),
      "trigger precedes panel in DOM order",
    );
  });
});
