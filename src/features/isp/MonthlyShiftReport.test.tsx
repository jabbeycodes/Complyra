/**
 * Issue #96 — UI regression test for the monthly summary sign/re-open flow.
 *
 * The "Sign summary" button used to call native window.confirm(), which is
 * auto-dismissed in headless browsers, so clicking it silently did nothing:
 * no locked state, no "Signed by" indicator, no Re-open button. Signing now
 * uses an inline two-step confirmation instead of any native dialog.
 *
 * These tests render MonthlyShiftReport with a stubbed API and assert the
 * full lifecycle: sign -> locked -> re-open -> editable, plus the PM/admin
 * role gate. runIsp is passed through directly (no error swallowing).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error jsdom ships without bundled types
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

// DOM globals must exist before @testing-library/react is required.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.IS_REACT_ACT_ENVIRONMENT = true;
// Fail loudly if any native dialog sneaks back in.
(dom.window as unknown as Record<string, unknown>).confirm = () => {
  throw new Error("native window.confirm() must not be used");
};

const require = createRequire(import.meta.url);
const {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} = require("@testing-library/react") as typeof import("@testing-library/react");

import type { ComplyraApi } from "../../data/localApi";
import type {
  IspProgramView,
  ShiftNoteMonthlyReport,
} from "../../data/shiftNotes";
import type { IspChartData } from "./useIspData";
import MonthlyShiftReport from "./MonthlyShiftReport";

const INDIVIDUAL_ID = "ind-1";

function monthKeyNow(): string {
  return new Date().toISOString().slice(0, 7);
}

function programFixture(monthKey: string): IspProgramView {
  const year = monthKey.slice(0, 4);
  return {
    id: "prog-1",
    agencyId: "agency-1",
    individualId: INDIVIDUAL_ID,
    planYear: year,
    name: `${year} ISP — Daily living supports`,
    effectiveOn: `${year}-01-01`,
    expiresOn: `${year}-12-31`,
    schedule: "per_shift",
    maxEntriesPerDay: 3,
    scoringMethodId: "method-1",
    status: "approved",
    approvedBy: "u-admin",
    approvedByName: "Sarah Mitchell",
    approvedAt: `${year}-01-06T10:00:00.000Z`,
    createdBy: "u-admin",
    createdByName: "Sarah Mitchell",
    createdAt: `${year}-01-05T15:30:00.000Z`,
    updatedAt: `${year}-01-06T10:00:00.000Z`,
    tasks: [
      {
        id: "task-1",
        programId: "prog-1",
        title: "Complete morning hygiene routine",
        instructions: "Prompt only as needed.",
        sortOrder: 0,
      },
    ],
    scoringMethod: {
      id: "method-1",
      agencyId: "agency-1",
      name: "Yes/No",
      levels: [
        { id: "lvl-yes", caption: "Yes", shortLabel: "Y", reportable: true, sortOrder: 0 },
        { id: "lvl-no", caption: "No", shortLabel: "N", reportable: true, sortOrder: 1 },
      ],
      createdBy: "u-admin",
      createdByName: "Sarah Mitchell",
      createdAt: `${year}-01-05T14:00:00.000Z`,
    },
  };
}

function draftReport(monthKey: string): ShiftNoteMonthlyReport {
  return {
    id: "report-1",
    agencyId: "agency-1",
    individualId: INDIVIDUAL_ID,
    programId: "prog-1",
    month: monthKey,
    narrative: "Manager draft narrative.",
    signedBy: "",
    signedByName: "",
    signedByTitle: "",
    signedAt: "",
    createdBy: "u-admin",
    createdByName: "Sarah Mitchell",
    createdAt: `${monthKey}-02T09:00:00.000Z`,
    updatedAt: `${monthKey}-02T09:00:00.000Z`,
    deletedAt: null,
  };
}

describe("MonthlyShiftReport sign / re-open", () => {
  const monthKey = monthKeyNow();
  let currentReport: ShiftNoteMonthlyReport | null;
  let calls: string[];
  let api: ComplyraApi;

  beforeEach(() => {
    currentReport = draftReport(monthKey);
    calls = [];
    api = {
      getShiftNotesForMonth: async () => [],
      getShiftNoteMonthlyReport: async () => currentReport,
      saveShiftNoteMonthlyReport: async (input: {
        narrative: string;
      }) => {
        assert.ok(currentReport);
        currentReport = { ...currentReport, narrative: input.narrative };
        return currentReport;
      },
      signShiftNoteMonthlyReport: async (id: string) => {
        calls.push(`sign:${id}`);
        assert.ok(currentReport);
        currentReport = {
          ...currentReport,
          signedBy: "u-admin",
          signedByName: "Sarah Mitchell",
          signedByTitle: "Agency administrator",
          signedAt: "2026-09-17T20:00:00.000Z",
        };
        return currentReport;
      },
      reopenShiftNoteMonthlyReport: async (id: string) => {
        calls.push(`reopen:${id}`);
        assert.ok(currentReport);
        currentReport = {
          ...currentReport,
          signedBy: "",
          signedByName: "",
          signedByTitle: "",
          signedAt: "",
        };
        return currentReport;
      },
    } as unknown as ComplyraApi;
  });

  afterEach(() => {
    cleanup();
  });

  function renderReport(roleKey = "administrator", canWriteSummary = true) {
    const data: IspChartData = {
      programs: [programFixture(monthKey)],
      scoringMethods: [],
      notes: [],
    };
    render(
      <MonthlyShiftReport
        individualId={INDIVIDUAL_ID}
        individualName="Ellis Harper"
        individualIdLabel="ID-123"
        siteName="Cedar House"
        agencyName="Evergreen Care"
        data={data}
        api={api}
        runIsp={(action) => action().then(() => undefined)}
        sessionName="Sarah Mitchell"
        roleKey={roleKey}
        canWriteSummary={canWriteSummary}
        staffTitleByUserId={new Map()}
      />,
    );
  }

  it("signs through the inline two-step confirmation without any native dialog", async () => {
    renderReport();
    const signButton = await screen.findByRole("button", { name: "Sign summary" });
    assert.equal((signButton as HTMLButtonElement).disabled, false);

    // First click arms the confirmation; nothing is signed yet.
    fireEvent.click(signButton);
    const confirmButton = await screen.findByRole("button", { name: "Confirm sign" });
    assert.ok(
      document.body.textContent?.includes("It will be locked"),
      "lock warning shown",
    );
    assert.deepEqual(calls, [], "sign API not called before confirmation");

    // Confirming locks the report and shows the signed state.
    fireEvent.click(confirmButton);
    await waitFor(() => {
      assert.deepEqual(calls, ["sign:report-1"]);
    });
    await screen.findByRole("button", { name: "Re-open summary" });
    assert.ok(
      document.body.textContent?.includes("Signed by Sarah Mitchell"),
      "signed-by indicator",
    );
    assert.ok(
      document.body.textContent?.includes("Agency administrator"),
      "signer title",
    );
    assert.equal(
      screen.queryByRole("button", { name: "Sign summary" }),
      null,
      "sign button gone once locked",
    );
  });

  it("cancel backs out of signing without touching the report", async () => {
    renderReport();
    fireEvent.click(await screen.findByRole("button", { name: "Sign summary" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    assert.deepEqual(calls, [], "no API call after cancel");
    assert.ok(
      await screen.findByRole("button", { name: "Sign summary" }),
      "back to the plain sign button",
    );
  });

  it("re-opens a signed summary for editing", async () => {
    assert.ok(currentReport);
    currentReport = {
      ...currentReport,
      signedBy: "u-admin",
      signedByName: "Sarah Mitchell",
      signedByTitle: "Agency administrator",
      signedAt: "2026-09-17T20:00:00.000Z",
    };
    renderReport();

    await screen.findByRole("button", { name: "Re-open summary" });
    fireEvent.click(screen.getByRole("button", { name: "Re-open summary" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm re-open" });
    assert.deepEqual(calls, [], "re-open API not called before confirmation");

    fireEvent.click(confirmButton);
    await waitFor(() => {
      assert.deepEqual(calls, ["reopen:report-1"]);
    });
    // Editable again: the narrative textarea and sign button return.
    const textarea = (await screen.findByPlaceholderText(
      "Monthly narrative for the case manager…",
    )) as HTMLTextAreaElement;
    assert.equal(textarea.value, "Manager draft narrative.");
    assert.ok(await screen.findByRole("button", { name: "Sign summary" }));
  });

  it("hides sign controls from roles outside the PM/administrator gate", async () => {
    renderReport("dsp", false);
    await screen.findByText("Data collection monthly summary note");
    assert.equal(screen.queryByRole("button", { name: "Sign summary" }), null);
    assert.equal(screen.queryByRole("button", { name: "Save summary" }), null);
    assert.ok(
      document.body.textContent?.includes("Manager draft narrative."),
      "DSPs can still read the summary",
    );
  });

  it("keeps the sign button disabled until the summary is saved", async () => {
    currentReport = null;
    renderReport();
    const signButton = (await screen.findByRole("button", {
      name: "Sign summary",
    })) as HTMLButtonElement;
    assert.equal(signButton.disabled, true, "disabled with no saved report");
  });
});

describe("MonthlyShiftReport monthly score summary", () => {
  const monthKey = monthKeyNow();
  const year = monthKey.slice(0, 4);
  const weekOne = `${monthKey}-03`; // day 3 -> week 1

  function renderWithNotes() {
    const apiWithNotes = {
      getShiftNotesForMonth: async () => [
        {
          id: "note-1",
          agencyId: "agency-1",
          individualId: INDIVIDUAL_ID,
          programId: "prog-1",
          noteDate: weekOne,
          shift: "7a–3p",
          summary: "Calm shift.",
          timeSpentMinutes: 120,
          staffUserId: "u1",
          staffName: "Jean Masumbuko",
          createdAt: `${weekOne}T15:00:00.000Z`,
          updatedAt: `${weekOne}T15:00:00.000Z`,
          deletedAt: null,
          programName: `${year} ISP — Daily living supports`,
          scoringMethodName: "Yes/No",
          scores: [
            { id: "s1", noteId: "note-1", taskId: "task-1", taskTitle: "Complete morning hygiene routine", levelId: "lvl-yes", comment: "" },
            { id: "s2", noteId: "note-1", taskId: "task-1", taskTitle: "Complete morning hygiene routine", levelId: "lvl-no", comment: "" },
          ],
        },
      ],
      getShiftNoteMonthlyReport: async () => null,
    } as unknown as ComplyraApi;
    const data: IspChartData = {
      programs: [programFixture(monthKey)],
      scoringMethods: [],
      notes: [],
    };
    render(
      <MonthlyShiftReport
        individualId={INDIVIDUAL_ID}
        individualName="Ellis Harper"
        individualIdLabel="ID-123"
        siteName="Cedar House"
        agencyName="Evergreen Care"
        data={data}
        api={apiWithNotes}
        runIsp={(action) => action().then(() => undefined)}
        sessionName="Sarah Mitchell"
        roleKey="administrator"
        canWriteSummary={true}
        staffTitleByUserId={new Map()}
      />,
    );
  }

  afterEach(() => {
    cleanup();
  });

  it("renders the score summary between the program block and the day grid", async () => {
    renderWithNotes();
    const heading = await screen.findByRole("heading", { name: "Monthly score summary" });
    assert.ok(heading, "score summary heading renders");
    // Month totals table: objective row plus plain-figure counts.
    const body = document.body.textContent ?? "";
    assert.ok(body.includes("Yes %"));
    assert.ok(body.includes("Days unscored"));
    assert.ok(body.includes("Week 1"));
    assert.ok(body.includes("Complete morning hygiene routine — weekly breakdown"));
    // Summary sits above the day grid in DOM order.
    const summaryIdx = document.body.innerHTML.indexOf("Monthly score summary");
    const gridIdx = document.body.innerHTML.indexOf("Daily scores");
    assert.ok(summaryIdx > -1 && gridIdx > -1 && summaryIdx < gridIdx, "summary precedes day grid");
  });

  it("keeps the attestation line on the daily grid", async () => {
    renderWithNotes();
    const attestation = await screen.findByText(
      "STAFF PROVIDING SERVICE/ACTION MUST INITIAL THE DATE THE SERVICE/ACTION WAS PROVIDED.",
    );
    assert.ok(attestation, "attestation line renders");
  });
});
