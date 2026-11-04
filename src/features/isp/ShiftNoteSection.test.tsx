import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ComplyraApi } from "../../data/localApi";
import type { IspProgramView } from "../../data/shiftNotes";
import type { IspChartData } from "./useIspData";
import { addDaysIso, centralTodayIso } from "../../data/menuRecords";

/**
 * Finding 1 (simulation batch 9), Fix 3: the shift-note form closed even
 * when the save failed — runIsp swallowed the error into the chart banner
 * and resolved normally, and the form's submit chained onDone off that
 * resolution, so a failed save looked like success and the note was lost.
 * run/runIsp now resolve a success boolean and the form closes only on
 * true. This test renders the real section with a runIsp that honors the
 * new contract (the IndividualChart half of the contract is pinned by
 * the Promise<boolean> prop types) and a save that fails, then succeeds.
 */

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("ShiftNoteSection submit gating", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let ShiftNoteSection: typeof import("./ShiftNoteSection").default;

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
    ShiftNoteSection = (await import("./ShiftNoteSection")).default;
  });

  after(() => {
    dom.window.close();
  });

  function programFixture(): IspProgramView {
    const year = new Date().getFullYear();
    return {
      id: "prog-1",
      agencyId: "agency-1",
      individualId: "ind-1",
      planYear: String(year),
      name: "ISP 2026",
      effectiveOn: `${year}-01-01`,
      expiresOn: `${year}-12-31`,
      schedule: "per_shift",
      maxEntriesPerDay: 3,
      scoringMethodId: "method-1",
      status: "approved",
      approvedBy: "pm-1",
      approvedByName: "Pat PM",
      approvedAt: `${year}-01-02T00:00:00.000Z`,
      createdBy: "pm-1",
      createdByName: "Pat PM",
      createdAt: `${year}-01-01T00:00:00.000Z`,
      updatedAt: `${year}-01-02T00:00:00.000Z`,
      goalService: "Community integration",
      completionCriteria: "",
      scheduleComment: "",
      tasks: [],
      scoringMethod: null,
    };
  }

  /** runIsp with IndividualChart's new semantics: errors resolve false. */
  async function runIsp(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  }

  async function renderSection(saveShiftNote: () => Promise<string>) {
    const act = React.act;
    const api = {
      getMySignature: async () => ({
        signaturePath: "user-1/signature.png",
        initialsPath: "user-1/initials.png",
        adoptedAt: "2026-10-01T00:00:00.000Z",
        consentAt: "2026-10-01T00:00:00.000Z",
        consentTextVersion: "v1",
      }),
      getSignatureImageUrl: async () => PNG_1X1,
      saveShiftNote,
    } as unknown as ComplyraApi;
    const data: IspChartData = {
      programs: [programFixture()],
      scoringMethods: [],
      notes: [],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(ShiftNoteSection, {
          individualId: "ind-1",
          data,
          api,
          runIsp,
          sessionUserId: "user-1",
          roleKey: "dsp",
          canEnter: true,
          canConfigure: false,
          defaultLocation: "Maple House",
          staffTitle: "DSP",
          staffName: "Dee DSP",
          legalName: "Alex Maple-Test",
          dateOfBirth: "1990-01-01",
          defaultWaiverService: "Individualized Supported Living",
        }),
      );
    });
    return { act, container, root };
  }

  async function openFilledForm(container: HTMLElement, act: typeof React.act) {
    const newButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "New shift note",
    );
    assert.ok(newButton, "New shift note button rendered");
    await act(async () => {
      newButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    });
    // Let the adopted-signature effect settle so the form can save.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Progress note"]',
    );
    assert.ok(textarea, "progress note field rendered");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Supported practice of the community goal.");
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    // Pin the begin time to midnight: a note dated today cannot begin in
    // the future (wave 7F), and the seeded 6:00 a.m. begin would block
    // the save on an early-morning test run.
    const beginInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Begin time"]',
    );
    assert.ok(beginInput, "begin time field rendered");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(beginInput, "00:00");
      beginInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save note",
    ) as HTMLButtonElement | undefined;
    assert.ok(saveButton, "Save note button rendered");
    assert.equal(saveButton.disabled, false, "form is ready to save");
    return container.querySelector("form");
  }

  async function submitForm(
    container: HTMLElement,
    act: typeof React.act,
  ): Promise<void> {
    const form = container.querySelector("form");
    assert.ok(form, "form is open before submit");
    await act(async () => {
      form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  it("keeps the form open when saveShiftNote fails", async () => {
    const { act, container, root } = await renderSection(async () => {
      throw new Error("Signature must be a PNG image.");
    });
    await openFilledForm(container, act);
    await submitForm(container, act);
    const heading = [...container.querySelectorAll("h3")].find((h) =>
      h.textContent?.startsWith("New shift note"),
    );
    assert.ok(heading, "the form stayed open after the failed save");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Progress note"]',
    );
    assert.equal(
      textarea?.value,
      "Supported practice of the community goal.",
      "the note text is still there to retry",
    );
    await act(async () => root.unmount());
    container.remove();
  });

  it("blocks saving and explains when the note date is in the future (wave 7F)", async () => {
    const { act, container, root } = await renderSection(async () => "note-1");
    await openFilledForm(container, act);
    const dateInput = container.querySelector<HTMLInputElement>(
      'input[type="date"]',
    );
    assert.ok(dateInput, "date field rendered");
    const tomorrow = addDaysIso(centralTodayIso(), 1);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(dateInput, tomorrow);
      dateInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const form = container.querySelector("form");
    assert.ok(
      form?.textContent?.includes("A shift note cannot be dated in the future."),
      "the future-date message shows at the point of entry",
    );
    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save note",
    ) as HTMLButtonElement | undefined;
    assert.ok(saveButton, "Save note button rendered");
    assert.equal(saveButton.disabled, true, "save is blocked for a future date");
    await act(async () => root.unmount());
    container.remove();
  });

  it("closes the form when saveShiftNote succeeds", async () => {
    const { act, container, root } = await renderSection(async () => "note-1");
    await openFilledForm(container, act);
    await submitForm(container, act);
    const heading = [...container.querySelectorAll("h3")].find((h) =>
      h.textContent?.startsWith("New shift note"),
    );
    assert.equal(heading, undefined, "the form closed after the save");
    const newButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "New shift note",
    );
    assert.ok(newButton, "back at the section with the New button");
    await act(async () => root.unmount());
    container.remove();
  });
});
