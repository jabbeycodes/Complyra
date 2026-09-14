import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StatusBadge from "./StatusBadge";
import { ALL_STATUSES, STATUS_META } from "../data/complianceStatus";

describe("StatusBadge", () => {
  for (const status of ALL_STATUSES) {
    it(`renders the label and icon for "${status}"`, () => {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      const meta = STATUS_META[status];
      assert.ok(html.includes(meta.label), `label "${meta.label}"`);
      assert.ok(html.includes(meta.icon), `icon "${meta.icon}"`);
      assert.ok(html.includes(`status-badge--${status}`), "status class");
    });
  }

  it("is announced as a status with an accessible label", () => {
    const html = renderToStaticMarkup(<StatusBadge status="expired" />);
    assert.ok(html.includes('role="status"'), "role=status");
    assert.ok(html.includes('aria-label="Expired"'), "aria-label");
    assert.ok(html.includes('aria-hidden="true"'), "icon hidden from AT");
  });

  it("supports the sm size for dense rows", () => {
    const html = renderToStaticMarkup(<StatusBadge status="late" size="sm" />);
    assert.ok(html.includes("status-badge--sm"));
  });

  it("honours a label override while keeping the canonical icon", () => {
    const html = renderToStaticMarkup(
      <StatusBadge status="compliant" label="N/A" />,
    );
    assert.ok(html.includes("N/A"));
    assert.ok(html.includes(STATUS_META.compliant.icon));
    assert.ok(html.includes('aria-label="N/A"'));
  });
});
