import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HouseCardLogScreen } from "./MobileQuickLog";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type { HouseCardEntryView } from "../../data/houseCard";

/**
 * Load-honesty pins for the Quick log's house-card screen (wave 7L).
 *
 * The screen's pin header states a balance as fact, so "not loaded
 * yet" must never render as one: while the chooser's ledger is still
 * loading (or its load failed behind the chooser's guard), the
 * screen receives null and must say "Loading…" — no $0.00 pin, no
 * "Nothing recorded today yet". A loaded EMPTY ledger is a different
 * state and keeps those factual claims. renderToStaticMarkup runs no
 * effects, so the null render below is exactly the pre-load frame a
 * hosted user sees while listHouseCardEntries is in flight.
 */

const TODAY = "2026-10-31";

const session: SessionUser = {
  userId: "user-1",
  email: "avery@example.com",
  username: "avery",
  fullName: "Avery Lane",
  jobTitle: "Direct Support Professional",
  role: "dsp",
  roleKey: "dsp",
  agencyId: "agency-1",
  agencyName: "Test Agency",
  agencyCode: "TEST01",
  siteId: "site-1",
  mustChangePassword: false,
  expiresOn: null,
  permissions: {},
  platformAdmin: false,
  agencyStatus: "active",
};

// Never invoked by a static render (effects do not run); present so
// the screen's self-load has its API if that ever changes.
const api = {
  listHouseCardEntries: async () => [],
  createHouseCardEntry: async () => {
    throw new Error("not used in a static render");
  },
} as unknown as ComplyraApi;

function entry(overrides: Partial<HouseCardEntryView>): HouseCardEntryView {
  return {
    id: "entry-1",
    agencyId: "agency-1",
    siteId: "site-1",
    entryDate: TODAY,
    kind: "credit",
    location: "Monthly house funds",
    amountCents: 25000,
    category: null,
    individualId: null,
    note: "",
    receiptPhoto: null,
    recordedBy: "user-1",
    recordedByName: "Avery Lane",
    recordedByRole: "dsp",
    createdAt: "2026-10-31T14:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    individualName: null,
    voidedByName: null,
    voided: false,
    postCloseCorrection: false,
    ...overrides,
  };
}

function render(entries: HouseCardEntryView[] | null): string {
  return renderToStaticMarkup(
    <HouseCardLogScreen
      api={api}
      session={session}
      siteId="site-1"
      siteName="Maple House"
      people={[]}
      entries={entries}
      todayIso={TODAY}
      onOpenHouseCard={() => {}}
      onBack={() => {}}
      onLogged={() => {}}
    />,
  );
}

describe("HouseCardLogScreen load honesty", () => {
  it("not loaded (null) states Loading and no figure", () => {
    const html = render(null);
    assert.ok(
      html.includes("Loading the house card ledger…"),
      "loading line shown",
    );
    assert.ok(!html.includes("House card balance"), "no balance pin");
    assert.ok(!html.includes("$0.00"), "no fabricated $0.00");
    assert.ok(
      !html.includes("Nothing recorded today yet"),
      "no empty-ledger claim",
    );
    assert.ok(!html.includes("Record an entry"), "no entry action yet");
  });

  it("a loaded empty ledger keeps its factual $0.00 claims", () => {
    const html = render([]);
    assert.ok(html.includes("House card balance"), "balance pin shown");
    assert.ok(html.includes("$0.00"), "true zero balance stated");
    assert.ok(
      html.includes("Nothing recorded today yet."),
      "true empty-today claim stated",
    );
    assert.ok(!html.includes("Loading the house card ledger…"));
  });

  it("a loaded ledger shows its real balance, not $0.00-as-loaded", () => {
    const html = render([entry({})]);
    assert.ok(html.includes("$250.00"), "real balance in the pin");
    assert.ok(
      html.includes("Today: $0.00 spent · $250.00 received"),
      "today line from the loaded entries",
    );
    assert.ok(!html.includes("Nothing recorded today yet"));
    assert.ok(!html.includes("Loading the house card ledger…"));
  });
});
