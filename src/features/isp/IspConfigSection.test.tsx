import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ComplyraApi } from "../../data/localApi";
import type {
  IspProgramView,
  IspScoringMethod,
} from "../../data/shiftNotes";
import type { IspChartData } from "./useIspData";

/**
 * Fix wave 3, item 3 (flagged by PR #197 and PR #200): IspConfigSection's
 * ProgramForm and ScoringMethodForm onDone handlers closed the form
 * unconditionally after `await runIsp(...)`, and the task editor closed
 * the same way — a failed save looked like success and the typed work
 * was lost. run/runIsp resolve a success boolean since PR #197; these
 * forms now close only on true. Each test drives the real section with
 * an api that fails, then succeeds.
 */

describe("IspConfigSection close-on-failure gating", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let IspConfigSection: typeof import("./IspConfigSection").default;

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
    IspConfigSection = (await import("./IspConfigSection")).default;
  });

  after(() => {
    dom.window.close();
  });

  const methodFixture: IspScoringMethod = {
    id: "method-1",
    agencyId: "agency-1",
    name: "Yes / No / Refused",
    levels: [
      { id: "l1", caption: "Yes", shortLabel: "Y", reportable: true, sortOrder: 0 },
      { id: "l2", caption: "No", shortLabel: "N", reportable: true, sortOrder: 1 },
    ],
    createdBy: "pm-1",
    createdByName: "Pat PM",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

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
      tasks: [
        {
          id: "task-1",
          programId: "prog-1",
          title: "Morning routine",
          instructions: "",
          sortOrder: 0,
        },
      ],
      scoringMethod: null,
    };
  }

  /** runIsp with IndividualChart's semantics: errors resolve false. */
  async function runIsp(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  }

  async function renderSection(
    api: Partial<ComplyraApi>,
    data: IspChartData,
  ) {
    const act = React.act;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(IspConfigSection, {
          individualId: "ind-1",
          data,
          api: api as ComplyraApi,
          runIsp,
          pcspSeedTitles: [],
        }),
      );
    });
    return { act, container, root };
  }

  async function click(
    container: HTMLElement,
    act: typeof React.act,
    text: string,
  ) {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    assert.ok(button, `button "${text}" rendered`);
    await act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  async function setInput(
    container: HTMLElement,
    act: typeof React.act,
    selector: string,
    value: string,
  ) {
    const input = container.querySelector<HTMLInputElement>(selector);
    assert.ok(input, `input ${selector} rendered`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }

  async function submitFormWithHeading(
    container: HTMLElement,
    act: typeof React.act,
    heading: string,
  ) {
    // Find the form by its own <h3> — other forms on the page can carry
    // the same words in button labels.
    const headingEl = [...container.querySelectorAll("h3")].find(
      (candidate) => candidate.textContent === heading,
    );
    const form = headingEl?.closest("form");
    assert.ok(form, `form "${heading}" is open`);
    await act(async () => {
      form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  const hasHeading = (container: HTMLElement, heading: string) =>
    [...container.querySelectorAll("h3")].some(
      (candidate) => candidate.textContent === heading,
    );

  it("ProgramForm stays open when the create fails, closes on success", async () => {
    let fail = true;
    const api: Partial<ComplyraApi> = {
      createIspProgram: async () => {
        if (fail) throw new Error("Could not save the ISP program.");
        return "prog-1";
      },
    };
    const { act, container, root } = await renderSection(api, {
      programs: [],
      scoringMethods: [methodFixture],
      notes: [],
    });
    await click(container, act, "New ISP program");
    assert.ok(hasHeading(container, "New ISP program"));
    await setInput(container, act, 'input[placeholder^="e.g. 2026 ISP"]', "ISP 2026");
    await submitFormWithHeading(container, act, "New ISP program");
    assert.ok(
      hasHeading(container, "New ISP program"),
      "form stays open after a failed save",
    );
    fail = false;
    await submitFormWithHeading(container, act, "New ISP program");
    assert.ok(
      !hasHeading(container, "New ISP program"),
      "form closes after a successful save",
    );
    await act(async () => root.unmount());
  });

  it("ScoringMethodForm stays open when the create fails, closes on success", async () => {
    let fail = true;
    const api: Partial<ComplyraApi> = {
      createIspScoringMethod: async () => {
        if (fail) throw new Error("Could not save the scoring method.");
        return "method-1";
      },
    };
    const { act, container, root } = await renderSection(api, {
      programs: [],
      scoringMethods: [methodFixture],
      notes: [],
    });
    await click(container, act, "New ISP program");
    await click(container, act, "New scoring method");
    assert.ok(hasHeading(container, "New scoring method"));
    await setInput(container, act, 'input[placeholder^="e.g. Prompt-level"]', "Prompt levels");
    await submitFormWithHeading(container, act, "New scoring method");
    assert.ok(
      hasHeading(container, "New scoring method"),
      "form stays open after a failed save",
    );
    fail = false;
    await submitFormWithHeading(container, act, "New scoring method");
    assert.ok(
      !hasHeading(container, "New scoring method"),
      "form closes after a successful save",
    );
    await act(async () => root.unmount());
  });

  it("TaskEditor stays open when the task save fails, closes on success", async () => {
    let fail = true;
    const api: Partial<ComplyraApi> = {
      saveIspProgramTasks: async () => {
        if (fail) throw new Error("Could not save the tasks.");
      },
    };
    const { act, container, root } = await renderSection(api, {
      programs: [programFixture()],
      scoringMethods: [methodFixture],
      notes: [],
    });
    // The card starts collapsed for an approved program with a goal.
    await click(container, act, "Configure");
    await click(container, act, "Edit tasks (1)");
    assert.ok(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Save tasks",
      ),
      "task editor is open",
    );
    await click(container, act, "Save tasks");
    assert.ok(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Save tasks",
      ),
      "task editor stays open after a failed save",
    );
    fail = false;
    await click(container, act, "Save tasks");
    assert.ok(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Edit tasks (1)",
      ),
      "task editor closes after a successful save",
    );
    await act(async () => root.unmount());
  });
});
