import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlatformCreatedAgencyView } from "./PlatformConsole";

const SENTINEL = "Sentinel!Pass42";

describe("PlatformCreatedAgencyView (platform agency creation)", () => {
  it("never renders the temporary password in plain text and offers dismissal", () => {
    const html = renderToStaticMarkup(
      <PlatformCreatedAgencyView
        created={{
          agencyCode: "NORTHSTAR-MO",
          username: "sim.admin",
          tempPassword: SENTINEL,
        }}
        onDismiss={() => {}}
      />,
    );
    assert.ok(!html.includes(SENTINEL), "password must not be echoed");
    assert.ok(html.includes("NORTHSTAR-MO"));
    assert.ok(html.includes("sim.admin"));
    assert.ok(html.includes("Show"), "one-time reveal is offered instead");
    assert.ok(html.includes("Done"), "the handover can be dismissed/cleared");
  });
});
