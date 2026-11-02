import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResetTempPasswordNotice } from "./ResetPasswordControl";

const SENTINEL = "Reset!Sentinel42";

describe("ResetTempPasswordNotice (staff-table reset handover)", () => {
  it("never renders the generated temporary password in plain text", () => {
    const html = renderToStaticMarkup(
      <ResetTempPasswordNotice
        name="Avery Cole"
        tempPassword={SENTINEL}
        onDone={() => {}}
      />,
    );
    assert.ok(!html.includes(SENTINEL), "password must not be echoed");
    assert.ok(html.includes("Avery Cole"));
    assert.ok(html.includes("Show"), "one-time reveal is offered instead");
    assert.ok(html.includes("Done"), "the notice can be cleared from the table");
  });
});
