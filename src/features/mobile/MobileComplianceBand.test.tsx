/**
 * Static-markup regression tests for the mobile band's house card
 * (MobileComplianceBandHouse). The reviewer caught PR #179 rendering a
 * score for an untracked house: metrics([]) yields score 100 / 0 of 0,
 * and the card claimed "100% current, 0 of 0 complete" — visibly and in
 * its aria-label — next to the "No requirements are tracked" message.
 * An untracked house must never present as compliant (the founder's
 * honest-empty-state rule), so the no-donut branch now renders only the
 * empty state, here and in the label.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Requirement } from "../../domain";
import { houseComplianceRows } from "../overview/houseCompliance";
import { MobileComplianceBandHouse } from "./MobileComplianceBand";

function req(id: string, site: string, status: Requirement["status"]): Requirement {
  return {
    id,
    title: id,
    category: "Required forms",
    person: "—",
    site,
    owner: "—",
    role: "—",
    due: "2026-09-12",
    status,
    source: "test",
    page: 1,
    frequency: "Once",
    evidence: "",
  };
}

const noop = () => {};

function rowFor(site: { id: string; name: string }, items: Requirement[]) {
  return houseComplianceRows([site], items, "All sites")[0];
}

test("house card: untracked house renders only the empty state — no score anywhere", () => {
  const row = rowFor({ id: "site-maple", name: "Maple House" }, []);
  // The raw row really does carry the misleading figures; the card
  // must not surface them.
  assert.equal(row.score, 100);
  assert.equal(row.total, 0);
  const html = renderToStaticMarkup(
    <MobileComplianceBandHouse row={row} onOpen={noop} />,
  );
  assert.match(html, /No requirements are tracked for this house yet\./);
  assert.match(
    html,
    /aria-label="Maple House: no requirements tracked yet\. Switch the mobile view to this home"/,
  );
  assert.ok(!html.includes("100%"), "no 100% score claim");
  assert.ok(!html.includes("% current"), "no percent-current line");
  assert.ok(!html.includes("0 of 0"), "no 0-of-0 completion claim");
  assert.ok(!html.includes("complete"), "no completion text at all");
  assert.ok(!html.includes("attention"), "no attention text");
  assert.ok(!html.includes("Nothing overdue"), "no overdue text");
});

test("house card: tracked house still renders its score, counts, and label", () => {
  const row = rowFor({ id: "site-willow", name: "Willow House" }, [
    req("w1", "Willow House", "Compliant"),
    req("w2", "Willow House", "Compliant"),
    req("w3", "Willow House", "Overdue"),
  ]);
  const html = renderToStaticMarkup(
    <MobileComplianceBandHouse row={row} onOpen={noop} />,
  );
  assert.match(html, /<strong>67%<\/strong> current/);
  assert.match(html, /2 of 3 complete/);
  assert.match(html, /1 needs attention/);
  assert.match(
    html,
    /aria-label="Willow House: 67% current, 2 of 3 complete\. Switch the mobile view to this home"/,
  );
});
