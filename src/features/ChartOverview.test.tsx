/**
 * ChartOverview.test.tsx — issue #81: UI tests for the Individual chart
 * Overview section (renderToStaticMarkup, no live API).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChartOverview, { type ChartOverviewProps } from "./ChartOverview";
import { emptyProfile } from "../data/planStack";
import type { PlanStackView } from "../data/planStack";

const person = {
  id: "i1",
  agencyId: "a1",
  siteId: "s1",
  fullName: "Ellis James Hart",
  dateOfBirth: "1984-03-12",
};

function profileWith() {
  return {
    ...emptyProfile(person),
    legalName: "Ellis James Hart",
    goesBy: "Ellis",
    dmhId: "110245",
    diagnosis: "Intellectual disability",
    guardians: [
      {
        name: "Dana Hart",
        relationship: "Sibling",
        phone: "573-555-0199",
        email: "",
        preferredContact: "Phone",
      },
    ],
    providerContacts: [
      {
        id: "p1",
        name: "Dr. Maya Chen",
        role: "PCP",
        phone: "573-555-0142",
        email: "",
        address: "",
        notes: "",
      },
    ],
  };
}

function stackWith(profile: ReturnType<typeof profileWith>): PlanStackView {
  return {
    individualId: "i1",
    individualName: "Ellis James Hart",
    profile,
    required: [],
    checked: [],
    renewals: [],
    carePlan: null,
    medications: [
      {
        id: "m1",
        name: "Levetiracetam",
        strength: "500 mg",
        kind: "scheduled",
      } as never,
    ],
    staffTraining: [],
    myTraining: null,
    mySubmissionAt: null,
    canSubmit: false,
    appointments: [],
  };
}

const staff = [
  {
    id: "u-hm",
    name: "Cameron Price",
    role: "House Manager",
    roleKey: "house_manager",
    siteId: "s1",
    expiresOn: null,
  },
  {
    id: "u-admin",
    name: "Robin Admin",
    role: "Administrator",
    roleKey: "administrator",
    siteId: null,
    expiresOn: null,
  },
];

function propsFor(roleKey: string, overrides: Partial<ChartOverviewProps> = {}): ChartOverviewProps {
  const profile = profileWith();
  return {
    person: {
      id: "i1",
      name: "Ellis James Hart",
      site: "Cedar House",
      siteId: "s1",
      dateOfBirth: "1984-03-12",
      photoUrl: null,
    },
    profile,
    stack: stackWith(profile),
    staff,
    sessionRoleKey: roleKey,
    onUpdateContacts: async () => {},
    onUpdateDiagnosis: async () => {},
    onPrintProfile: async () => {},
    run: async (action) => {
      await action();
    },
    ...overrides,
  };
}

describe("ChartOverview", () => {
  it("renders the identity strip, sections, and contacts in issue order", () => {
    const html = renderToStaticMarkup(React.createElement(ChartOverview, propsFor("house_manager")));
    const order = [
      "Overview",
      "Print profile",
      "Ellis James Hart",
      "110245",
      "Cedar House",
      "1984-03-12",
      "PCSP / trackables summary",
      "Diagnoses",
      "Intellectual disability",
      "Medications",
      "Levetiracetam",
      "Contacts",
      "Cameron Price",
      "Robin Admin",
      "Dana Hart",
      "Dr. Maya Chen",
    ];
    let last = -1;
    for (const text of order) {
      const at = html.indexOf(text);
      assert.ok(at > last, `expected "${text}" after position ${last}`);
      last = at;
    }
    // Quiet links: Shift notes stays last.
    const navAt = html.indexOf('aria-label="Chart sections"');
    assert.ok(navAt > -1, "quiet links nav");
    const nav = html.slice(navAt);
    const appointmentsAt = nav.indexOf(">Appointments<");
    const medsAt = nav.indexOf(">Medication board<");
    const notesAt = nav.indexOf(">Shift notes<");
    assert.ok(
      appointmentsAt > -1 && medsAt > appointmentsAt && notesAt > medsAt,
      "quiet links in order, shift notes last",
    );
  });

  it("shows the empty provider state with an Add provider action for managers", () => {
    const profile = { ...profileWith(), providerContacts: [] };
    const html = renderToStaticMarkup(
      React.createElement(
        ChartOverview,
        propsFor("house_manager", { profile, stack: stackWith(profile) }),
      ),
    );
    assert.ok(html.includes("No providers yet"), "empty provider state");
    assert.ok(html.includes("Add provider"), "manager add action");
    assert.ok(!html.includes("Dr. Maya Chen"), "no invented contacts");
  });

  it("hides edit actions from DSPs but keeps the Overview readable", () => {
    const html = renderToStaticMarkup(React.createElement(ChartOverview, propsFor("dsp")));
    assert.ok(html.includes("Overview"), "DSP sees the Overview");
    assert.ok(html.includes("Dana Hart"), "DSP sees contacts");
    assert.ok(!html.includes("Add provider"), "DSP cannot add providers");
    assert.ok(!html.includes("Edit diagnoses"), "DSP cannot edit diagnoses");
    assert.ok(!html.includes("Add contact"), "DSP cannot add personal contacts");
  });

  it("shows contact edit actions to house managers", () => {
    const html = renderToStaticMarkup(React.createElement(ChartOverview, propsFor("house_manager")));
    assert.ok(html.includes("Add provider"), "HM adds providers");
    assert.ok(html.includes("Add contact"), "HM adds personal contacts");
  });

  it("shows the diagnosis editor to nurses but not contact editing", () => {
    const html = renderToStaticMarkup(React.createElement(ChartOverview, propsFor("nurse")));
    assert.ok(html.includes("Edit diagnoses"), "nurse edits diagnoses");
    assert.ok(!html.includes("Add provider"), "nurse cannot add providers");
  });
});
