import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgencyCreatedView } from "./SetupAgencyScreen";

const SENTINEL = "Sentinel!Pass42";

describe("AgencyCreatedView (signup confirmation)", () => {
  for (const status of ["active", "pending"] as const) {
    it(`never renders the temporary password in plain text (status: ${status})`, () => {
      const html = renderToStaticMarkup(
        <AgencyCreatedView
          created={{
            agencyCode: "NORTHSTAR-MO",
            username: "sim.admin",
            fullName: "Sim Admin",
            status,
            tempPassword: SENTINEL,
          }}
          onContinue={() => {}}
        />,
      );
      assert.ok(!html.includes(SENTINEL), "password must not be echoed");
      // Provider code and username are not secrets and stay visible.
      assert.ok(html.includes("NORTHSTAR-MO"));
      assert.ok(html.includes("sim.admin"));
      assert.ok(html.includes("Temporary password"));
      assert.ok(html.includes("Show"), "one-time reveal is offered instead");
    });
  }
});
