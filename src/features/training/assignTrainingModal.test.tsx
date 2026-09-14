/**
 * Regression tests for the Assign training modal (P1 QA):
 * - "Generate checklist" is enabled exactly when a staff member AND a site
 *   are selected and no submission is in flight.
 * - The single-flight guard lets one click start exactly one submission and
 *   blocks a second submit while the first is in flight.
 * - The rendered modal starts with the button disabled and exposes explicit
 *   "Select…" placeholders (no prefilled first-option that could submit a
 *   stale id).
 *
 * Run: node --import tsx --import ./src/testSupport/cssStub.mts --test src/features/training/assignTrainingModal.test.tsx
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AssignTrainingModal, {
  canGenerateChecklist,
  createSubmitGuard,
} from "./AssignTrainingModal";

const STAFF = [
  { id: "staff-1", name: "Ama Serwaa" },
  { id: "staff-2", name: "Kofi Mensah" },
];
const SITES = [
  { id: "site-1", name: "Maple House" },
  { id: "site-2", name: "Oak House" },
];
const INDIVIDUALS = [{ id: "ind-1", name: "Jordan Lee" }];

describe("canGenerateChecklist — button enablement rule", () => {
  it("is disabled when nothing is selected", () => {
    assert.equal(
      canGenerateChecklist({ userId: "", siteId: "", busy: false }),
      false,
    );
  });

  it("is disabled when only a staff member is selected", () => {
    assert.equal(
      canGenerateChecklist({ userId: "staff-1", siteId: "", busy: false }),
      false,
    );
  });

  it("is disabled when only a site is selected", () => {
    assert.equal(
      canGenerateChecklist({ userId: "", siteId: "site-1", busy: false }),
      false,
    );
  });

  it("is enabled exactly when staff + site are selected and not busy", () => {
    assert.equal(
      canGenerateChecklist({ userId: "staff-1", siteId: "site-1", busy: false }),
      true,
    );
  });

  it("is disabled while a submission is in flight, even with a valid combo", () => {
    assert.equal(
      canGenerateChecklist({ userId: "staff-1", siteId: "site-1", busy: true }),
      false,
    );
  });

  it("treats whitespace-only selections as unselected", () => {
    assert.equal(
      canGenerateChecklist({ userId: "  ", siteId: "site-1", busy: false }),
      false,
    );
    assert.equal(
      canGenerateChecklist({ userId: "staff-1", siteId: "\t", busy: false }),
      false,
    );
  });
});

describe("createSubmitGuard — exactly one assignment per click", () => {
  it("lets the first submit through and blocks a second while in flight", () => {
    const guard = createSubmitGuard();
    assert.equal(guard.tryStart(), true);
    assert.equal(guard.tryStart(), false, "double-click must not start again");
    assert.equal(guard.tryStart(), false, "triple submit must not start again");
  });

  it("re-arms after reset so a failed attempt can be retried once", () => {
    const guard = createSubmitGuard();
    assert.equal(guard.tryStart(), true);
    assert.equal(guard.tryStart(), false);
    guard.reset();
    assert.equal(guard.tryStart(), true, "retry allowed after settle");
    assert.equal(guard.tryStart(), false, "still single-flight after retry");
  });

  it("guards are independent per modal instance", () => {
    const first = createSubmitGuard();
    const second = createSubmitGuard();
    assert.equal(first.tryStart(), true);
    assert.equal(
      second.tryStart(),
      true,
      "a second modal is not blocked by the first",
    );
  });
});

describe("AssignTrainingModal — rendered enablement", () => {
  function renderModal(props?: {
    busy?: boolean;
    staff?: typeof STAFF;
    sites?: typeof SITES;
  }) {
    return renderToStaticMarkup(
      <AssignTrainingModal
        staff={props?.staff ?? STAFF}
        sites={props?.sites ?? SITES}
        individuals={INDIVIDUALS}
        busy={props?.busy ?? false}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
  }

  function generateButtonDisabled(html: string): boolean {
    const match = html.match(/<button[^>]*>Generate checklist<\/button>/);
    assert.ok(match, "expected a Generate checklist button in the markup");
    return /\bdisabled\b/.test(match[0]);
  }

  it("renders the button disabled before anything is selected", () => {
    assert.equal(
      generateButtonDisabled(renderModal()),
      true,
      "no selection yet → disabled",
    );
  });

  it("renders the button disabled while busy", () => {
    assert.equal(
      generateButtonDisabled(renderModal({ busy: true })),
      true,
      "busy → disabled",
    );
  });

  it("offers explicit Select placeholders instead of prefilling the first option", () => {
    const html = renderModal();
    assert.ok(
      html.includes("Select a staff member…"),
      "staff placeholder option",
    );
    assert.ok(html.includes("Select a site…"), "site placeholder option");
  });

  it("explains empty rosters instead of showing a dead form", () => {
    const html = renderModal({ staff: [] });
    assert.ok(
      /no staff members/i.test(html),
      "empty staff message",
    );
    assert.ok(
      !html.includes("Generate checklist"),
      "no Generate button at all when there is nothing to assign",
    );
  });
});
