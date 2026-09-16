/**
 * Help page regression test (P1 QA): the Help & resources nav target must
 * render real guidance — never the old "Welcome to Complyrer" onboarding
 * screen.
 *
 * Run: node --import tsx --import ./src/testSupport/cssStub.mts --test src/features/help/helpPage.test.tsx
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HelpPage from "./HelpPage";

describe("HelpPage", () => {
  const html = renderToStaticMarkup(<HelpPage />);

  it("is not the welcome/onboarding screen", () => {
    assert.ok(
      !html.includes("Welcome to Complyrer"),
      "must not render the onboarding welcome",
    );
    assert.ok(html.includes("<h1>Help</h1>"), "help page title");
  });

  it("guides the key features", () => {
    for (const topic of [
      "Training checklists",
      "Signing",
      "Delegations",
      "Weekly checklists",
      "Mileage",
      "Certificates",
    ]) {
      assert.ok(html.includes(topic), `guide section: ${topic}`);
    }
  });

  it("includes FAQ entries and support pointers", () => {
    assert.ok(
      html.includes("Frequently asked questions"),
      "FAQ section",
    );
    assert.ok(html.includes("Where to get support"), "support section");
    assert.ok(
      html.includes("agency administrator"),
      "points at the agency administrator for help",
    );
  });

  it("keeps touch-sized targets on the topic links", () => {
    assert.ok(html.includes("help-toc"), "topic jump list");
  });
});

describe("HelpPage platform tour", () => {
  it("shows the tour entry point in demo mode", () => {
    const html = renderToStaticMarkup(
      <HelpPage demoMode={true} onRestartTour={() => {}} />,
    );
    assert.ok(html.includes("Platform tour"), "tour section heading");
    assert.ok(html.includes("Restart tour"), "tour restart button");
  });

  it("hides the tour entry point outside demo mode", () => {
    const html = renderToStaticMarkup(<HelpPage />);
    assert.ok(!html.includes("Platform tour"), "no tour section");
    assert.ok(!html.includes("Restart tour"), "no tour button");
  });
});
