import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Medication } from "../data/chart";
import { DEFAULT_CONSENT_TYPES } from "../data/consents";
import { projectMedInventory } from "../data/medInventory";
import { centralTodayIso } from "../data/menuRecords";
import { marDayHeading, shiftIsoDate } from "./mobile/mar";
import type {
  MedDoseMark,
  MedInventoryView,
  SessionUser,
} from "../data/types";

/**
 * Desktop MAR dated view (Joshua's call, 2026-11-12): the phone MAR has
 * always paged by day; the chart MAR showed only today. The desktop card
 * now mirrors the phone: it opens on Central today, pages to other days
 * loading that day's marks + exceptions, offers a one-tap return to
 * today, and records against the viewed day — so a past day's first mark
 * goes through the same late-entry reason path the API enforces on the
 * phone, never a silent back-date.
 */

const TODAY = centralTodayIso();
const YESTERDAY = shiftIsoDate(TODAY, -1);

const MED: Medication = {
  id: "med-1",
  agencyId: "a",
  individualId: "ind-1",
  name: "Simulamine",
  strength: "10 mg tablet",
  kind: "scheduled",
  controlled: false,
  pillsPerDay: 2,
  remainingPills: 0,
  lastDeliveryOn: null,
  lastCountdownOn: null,
};

function viewFixture(): MedInventoryView {
  const view = projectMedInventory({
    med: MED,
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [
      {
        id: "exc-1",
        agencyId: "a",
        individualId: "ind-1",
        medicationId: "med-1",
        occurredOn: YESTERDAY,
        kind: "refused",
        pillsAffected: 1,
        reason: "Refused the morning dose",
        createdBy: "u-dsp",
        createdAt: `${YESTERDAY}T14:05:00.000Z`,
      },
    ],
    today: TODAY,
  });
  return { ...view, doseTimes: ["08:00", "20:00"] };
}

const YESTERDAY_MARK: MedDoseMark = {
  id: "mark-y1",
  agencyId: "a",
  individualId: "ind-1",
  medicationId: "med-1",
  doseDate: YESTERDAY,
  doseTime: "08:00",
  status: "given",
  markedBy: "u-dsp",
  markedByName: "Dee Staff",
  markedAt: `${YESTERDAY}T14:00:00.000Z`,
};

describe("desktop MAR dated view (rendered)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let DataContext: typeof import("../data/DataProvider").DataContext;
  let MarCard: typeof import("./MarCard").default;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });
    const setGlobal = (name: string, value: unknown) => {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    };
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("HTMLCanvasElement", dom.window.HTMLCanvasElement);
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ DataContext } = await import("../data/DataProvider"));
    MarCard = (await import("./MarCard")).default;
  });

  after(() => {
    dom.window.close();
  });

  const session = {
    userId: "u-hm",
    agencyId: "a",
    roleKey: "house_manager",
    name: "Hollis Manager",
  } as unknown as SessionUser;

  interface MarkCall {
    medicationId: string;
    doseDate: string;
    doseTime: string;
    status: string;
    lateReason?: string;
  }

  /** A stub API whose mark store behaves like the real MAR API: a first
   * mark for a past day without a late reason is refused as past its
   * recording window. */
  function stubApi(view: MedInventoryView) {
    const marks: MedDoseMark[] = [YESTERDAY_MARK];
    const markCalls: MarkCall[] = [];
    const known: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      getMedInventory: async () => [view],
      getMedDoseMarks: async (_id: unknown, day: unknown) =>
        marks.filter((m) => m.doseDate === day),
      getMedDoseMarksInRange: async () => marks,
      markMedDose: async (input: unknown) => {
        const call = input as MarkCall & { baseMarkedAt?: string };
        markCalls.push(call);
        if (call.doseDate < TODAY && !call.lateReason) {
          throw new Error(
            "This dose is past its recording window. Add a brief reason for the late entry.",
          );
        }
        marks.push({
          id: `mark-new-${marks.length}`,
          agencyId: "a",
          individualId: "ind-1",
          medicationId: call.medicationId,
          doseDate: call.doseDate,
          doseTime: call.doseTime,
          status: call.status as MedDoseMark["status"],
          markedBy: "u-hm",
          markedByName: "Hollis Manager",
          markedAt: new Date().toISOString(),
          late: Boolean(call.lateReason),
          lateReason: call.lateReason ?? null,
        });
      },
      getStaffTrainingProfile: async () => ({ clearedForInRatio: true }),
      // The card also loads the consent register (the 2026-11-11
      // medication-consent warning); this Individual holds a current
      // medication consent, so no banner renders.
      getConsents: async () => ({
        types: DEFAULT_CONSENT_TYPES,
        records: [
          {
            id: "c-med-fixture",
            individualId: "ind-1",
            agencyId: "a",
            typeId: "medication",
            covers: "Medication administration",
            giver: "guardian",
            giverName: "Sam Rivera",
            relationship: "Parent and guardian",
            signedOn: "2026-01-12",
            effectiveOn: "2026-01-12",
            reviewOn: "2027-01-12",
            supersedesId: null,
            createdBy: "hm",
            createdAt: "2026-01-12T15:00:00.000Z",
            activatedBy: "hm",
            activatedAt: "2026-01-12T15:05:00.000Z",
          },
        ],
        revocations: [],
        individuals: [
          { id: "ind-1", agencyId: "a", siteId: "s1", fullName: "Fixture Person" },
        ],
      }),
    };
    const api = new Proxy(known, {
      get: (target, prop: string) => target[prop] ?? (async () => []),
    }) as unknown as import("../data/localApi").ComplyraApi;
    return { api, markCalls };
  }

  async function mount(api: unknown) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          {
            value: {
              api,
              session,
              workspace: null,
              loading: false,
              loadStalled: false,
              error: "",
              usingHostedBackend: false,
              signIn: async () => {},
              changePassword: async () => {},
              signOut: async () => {},
              refresh: async () => {},
            } as never,
          },
          React.createElement(MarCard, { individualId: "ind-1" }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    return { container, root };
  }

  async function click(container: HTMLElement, selector: string) {
    const el = container.querySelector(selector) as HTMLElement | null;
    assert.ok(el, `expected element: ${selector}`);
    await React.act(async () => {
      el!.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  function buttonByText(container: HTMLElement, text: string): HTMLElement {
    const el = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    );
    assert.ok(el, `expected button: ${text}`);
    return el as HTMLElement;
  }

  it("opens on today, pages to yesterday's marks + exceptions, and returns to today", async () => {
    const { api } = stubApi(viewFixture());
    const { container, root } = await mount(api);
    const text = () => container.textContent ?? "";

    // Default view is today: today's heading, no return button, today's
    // (unmarked) doses, and none of yesterday's records.
    assert.ok(text().includes("Medication administration — today"), text());
    assert.ok(!text().includes("Back to today"), text());
    assert.ok(text().includes("Not marked"), text());
    assert.ok(!text().includes("Dee Staff"), text());
    assert.ok(!text().includes("Refused the morning dose"), text());

    // Page back: yesterday's mark and exception load under yesterday's
    // heading, and the return-to-today affordance appears.
    await click(container, 'button[aria-label="Previous day"]');
    assert.ok(
      text().includes(`Medication administration — ${marDayHeading(YESTERDAY, TODAY)}`),
      text(),
    );
    assert.ok(text().includes("Given · Dee Staff"), text());
    assert.ok(text().includes("Exceptions"), text());
    assert.ok(text().includes("Refused"), text());
    assert.ok(text().includes("Refused the morning dose"), text());
    assert.ok(text().includes("Back to today"), text());

    // Back to today restores today's view exactly.
    await React.act(async () => {
      buttonByText(container, "Back to today").click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    assert.ok(text().includes("Medication administration — today"), text());
    assert.ok(!text().includes("Back to today"), text());
    assert.ok(text().includes("Not marked"), text());
    assert.ok(!text().includes("Dee Staff"), text());

    await React.act(async () => root.unmount());
    container.remove();
  });

  it("recording on a past day goes through the late-entry reason path with the viewed date", async () => {
    const { api, markCalls } = stubApi(viewFixture());
    const { container, root } = await mount(api);
    const text = () => container.textContent ?? "";

    await click(container, 'button[aria-label="Previous day"]');

    // The unmarked 20:00 row is the second dose row; its Missed button is
    // the row's second status button.
    const rows = [...container.querySelectorAll(".mar-row")];
    assert.equal(rows.length, 2, text());
    const eveningRow = rows.find((row) =>
      (row.textContent ?? "").includes("8:00 p.m."),
    );
    assert.ok(eveningRow, text());
    const missed = [...eveningRow!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Missed",
    );
    assert.ok(missed, "evening row offers Missed");
    await React.act(async () => {
      missed!.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // First attempt hit the API with yesterday's date and no reason, was
    // refused as past its window, and the card opened the late prompt —
    // the dose was NOT silently recorded.
    assert.equal(markCalls.length, 1);
    assert.equal(markCalls[0].doseDate, YESTERDAY);
    assert.equal(markCalls[0].lateReason, undefined);
    assert.ok(text().includes("past its recording window"), text());

    const input = container.querySelector(
      ".mar-row form input",
    ) as HTMLInputElement;
    assert.ok(input, "late-reason input rendered");
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await React.act(async () => {
      setter.call(input, "Evening pass was charted the next morning");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await React.act(async () => {
      buttonByText(container, "Save late entry").click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // The retry carried the same viewed date plus the reason, and the row
    // now shows the landed mark as Late.
    assert.equal(markCalls.length, 2);
    assert.equal(markCalls[1].doseDate, YESTERDAY);
    assert.equal(markCalls[1].status, "missed");
    assert.equal(
      markCalls[1].lateReason,
      "Evening pass was charted the next morning",
    );
    assert.ok(text().includes("Missed · Hollis Manager"), text());
    assert.ok(text().includes("Late"), text());

    await React.act(async () => root.unmount());
    container.remove();
  });
});
