import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PasswordField from "./PasswordField";

describe("PasswordField", () => {
  it("renders a masked password input by default, never a text input", () => {
    const html = renderToStaticMarkup(
      <PasswordField
        id="temp-pw"
        label="Temporary password"
        value="typed-value"
        onChange={() => {}}
        minLength={8}
        required
      />,
    );
    assert.ok(html.includes('type="password"'), "input is masked by default");
    assert.ok(!html.includes('type="text"'), "no plain-text input renders");
  });

  it("keeps the label programmatically associated and offers the reveal toggle", () => {
    const html = renderToStaticMarkup(
      <PasswordField
        id="temp-pw"
        label="Temporary password"
        value=""
        onChange={() => {}}
      />,
    );
    assert.ok(html.includes('<label for="temp-pw">Temporary password</label>'));
    assert.ok(html.includes('id="temp-pw"'));
    assert.ok(html.includes('aria-label="Show password"'));
    assert.ok(html.includes('aria-pressed="false"'));
    assert.ok(html.includes('autoComplete="new-password"'));
  });
});
