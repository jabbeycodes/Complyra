import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InviteCreatedView } from "./InviteMemberForm";

const SENTINEL = "Sentinel!Pass42";

describe("InviteCreatedView (staff creation / pre-binder handover)", () => {
  it("never renders the temporary password in plain text", () => {
    const html = renderToStaticMarkup(
      <InviteCreatedView
        created={{
          agencyCode: "NORTHSTAR-MO",
          username: "avery.cole",
          fullName: "Avery Cole",
          role: "dsp",
          tempPassword: SENTINEL,
        }}
      />,
    );
    assert.ok(!html.includes(SENTINEL), "password must not be echoed");
    assert.ok(html.includes("Avery Cole"));
    assert.ok(html.includes("NORTHSTAR-MO"));
    assert.ok(html.includes("avery.cole"));
    assert.ok(html.includes("Temporary password"));
    assert.ok(html.includes("Show"), "one-time reveal is offered instead");
    assert.ok(html.includes("Copy"), "copy handover is offered instead");
  });
});
