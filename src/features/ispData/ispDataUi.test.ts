/**
 * Light UI-adjacent tests for the ISP data feature (contract §7, stream C).
 * Heavy logic (validation, expectations, escalations, tallies) is covered by
 * streams A/B — these tests pin the UI contract: tab order, validation
 * surfacing, escalation wording, and the monthly section shape.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SITE_DETAIL_TAB_IDS } from "../siteDetail/siteTabs";
import { validateIspNote } from "../../data/ispData";
import { blankMonthlySections } from "../../data/ispData";
import { escalationMessageFor } from "./ispEscalationMessage";
import type {
  IspExpectationView,
  SubmitIspNoteInput,
} from "../../data/types";

function baseInput(overrides: Partial<SubmitIspNoteInput> = {}): SubmitIspNoteInput {
  return {
    individualId: "ind-1",
    siteId: "site-1",
    workDate: "2026-09-14",
    serviceTitle: "Morning routine support",
    setting: "Home",
    timeIn: "07:00",
    timeOut: "15:00",
    servicesProvided:
      "Assisted with the full morning routine: hygiene, dressing, and breakfast preparation.",
    individualResponse:
      "Chose their own shirt and ate breakfast at the table, asking for seconds.",
    objectiveIds: ["obj-1"],
    scores: [{ trackableId: "trk-1", yesNo: true }],
    signatureMark: "adopted-signature",
    ...overrides,
  };
}

const ctx = {
  individualName: "Jane Doe",
  individualDob: "1990-01-01",
  requiredTrackables: [
    {
      id: "trk-1",
      name: "Morning routine prompts",
      measurementMethod: "yes_no" as const,
      ratingMin: null,
      ratingMax: null,
    },
  ],
};

describe("ISP data UI contract", () => {
  it("keeps staff last in the site-detail tab order", () => {
    assert.deepEqual([...SITE_DETAIL_TAB_IDS], [
      "overview",
      "individuals",
      "isp_data",
      "audits",
      "checklists",
      "training",
      "medications",
      "mileage",
      "drills",
      "documents",
      "staff",
    ]);
  });

  it("surfaces a P.8.4 issue for a one-word individual response", () => {
    const issues = validateIspNote(
      baseInput({ individualResponse: "ok" }),
      ctx,
    );
    assert.ok(
      issues.some((i) => i.checkId === "P.8.4"),
      `expected a P.8.4 issue, got ${JSON.stringify(issues)}`,
    );
  });

  it("surfaces a P.8.2 issue when the individual name is missing", () => {
    const issues = validateIspNote(baseInput(), {
      ...ctx,
      individualName: "",
    });
    assert.ok(issues.some((i) => i.checkId === "P.8.2"));
  });

  it("surfaces a P.10.1 issue when no objective is linked", () => {
    const issues = validateIspNote(baseInput({ objectiveIds: [] }), ctx);
    assert.ok(issues.some((i) => i.checkId === "P.10.1"));
  });

  it("passes a complete, well-formed note", () => {
    const issues = validateIspNote(baseInput(), ctx);
    assert.deepEqual(issues, []);
  });

  it("writes escalation messages in Complyrer's own wording", () => {
    const exp: IspExpectationView = {
      id: "exp-1",
      agencyId: "agency-1",
      siteId: "site-1",
      individualId: "ind-1",
      assignmentId: "asg-1",
      workDate: "2026-09-14",
      shiftPatternId: "pat-1",
      userId: "user-9",
      dueAt: "2026-09-14T15:00:00.000Z",
      noteId: null,
      excused: false,
      excusedReason: null,
      status: "overdue",
      staffName: "Sam Staffer",
      individualName: "Jane Doe",
      siteName: "Maple House",
      shiftName: "Day",
      shiftStart: "07:00",
      shiftEnd: "15:00",
      noteSubmittedAt: null,
      hoursOverdue: 5,
    };
    const message = escalationMessageFor(exp);
    assert.ok(message.includes("Jane Doe"), "names the individual");
    assert.ok(message.includes("Day"), "names the shift");
    assert.ok(message.includes("Complyrer"), "points to Complyrer");
    assert.ok(
      !/therap/i.test(message),
      "never mentions Therap",
    );
    assert.ok(
      !/lifepath/i.test(message),
      "never mentions LifePath",
    );
  });

  it("blankMonthlySections carries the nine Missouri sections", () => {
    const sections = blankMonthlySections("Community support");
    assert.equal(sections.serviceTitle, "Community support");
    const keys = Object.keys(sections);
    assert.ok(keys.includes("selfDetermination"));
    assert.ok(keys.includes("healthMedical"));
    assert.ok(keys.includes("rights"));
    assert.ok(keys.includes("communityActivities"));
    assert.ok(keys.includes("supportCoordinator"));
    assert.ok(keys.includes("personVisitedDates"));
    assert.ok(keys.includes("overallConcerns"));
    assert.ok(keys.includes("changesNeeded"));
    assert.ok(keys.includes("rnFollowUp"));
    assert.ok(Array.isArray(sections.programProgress));
  });
});
