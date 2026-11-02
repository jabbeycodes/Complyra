import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ComplyraApi } from "../../data/localApi";
import type { WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { checklistErrorMessage } from "./HmWeeklyChecklistPage";

/**
 * Simulation pass 16, batch 213: the Weekly checklist page printed the
 * raw database error `new row violates row-level security policy for
 * table "hm_weekly_checklists"` to the house manager when the load
 * failed (the underlying 403 is PR #202's migration territory — out of
 * scope here). The rendering must show the surface's human error state
 * instead, and must not claim "No open checklist for this week" when
 * the load never succeeded. These tests render the real page in jsdom
 * with a rejecting API and assert exactly that.
 */

const RLS_TEXT =
  'new row violates row-level security policy for table "hm_weekly_checklists"';

describe("HmWeeklyChecklistPage load failure rendering", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Page: typeof import("./HmWeeklyChecklistPage").default;
  let DataContext: typeof import("../../data/DataProvider").DataContext;

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
    Page = (await import("./HmWeeklyChecklistPage")).default;
    ({ DataContext } = await import("../../data/DataProvider"));
  });

  after(() => {
    dom.window.close();
  });

  const session = {
    userId: "hm-1",
    fullName: "Jordan Reyes",
    roleKey: "house_manager",
    agencyId: "agency-1",
  } as unknown as SessionUser;

  const workspace = {
    sites: [{ id: "site-1", name: "Juniper House" }],
  } as unknown as WorkspaceView;

  async function renderWithApi(api: Partial<ComplyraApi>): Promise<string> {
    const act = React.act;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const value = {
      api: api as ComplyraApi,
      session,
      workspace,
      loading: false,
      error: "",
      usingHostedBackend: true,
      signIn: async () => {},
      changePassword: async () => {},
      signOut: async () => {},
      refresh: async () => {},
    };
    await act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          { value },
          React.createElement(Page),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const text = container.textContent ?? "";
    await act(async () => root.unmount());
    container.remove();
    return text;
  }

  it("rollover rejected with raw RLS text renders the human error state only", async () => {
    const text = await renderWithApi({
      rolloverWeeklyChecklists: async () => {
        throw new Error(RLS_TEXT);
      },
      listWeeklyChecklists: async () => [],
    });
    assert.match(text, /Could not load your weekly checklist/);
    assert.doesNotMatch(text, /row-level security/);
    assert.doesNotMatch(text, /hm_weekly_checklists/);
    assert.doesNotMatch(text, /No open checklist for this week/);
  });

  it("list rejected with a raw permission error renders the human error state only", async () => {
    const text = await renderWithApi({
      rolloverWeeklyChecklists: async () => ({ created: 0, locked: 0 }),
      listWeeklyChecklists: async () => {
        throw new Error("permission denied for table hm_weekly_checklists");
      },
    });
    assert.match(text, /Could not load your weekly checklist/);
    assert.doesNotMatch(text, /permission denied/);
    assert.doesNotMatch(text, /hm_weekly_checklists/);
    assert.doesNotMatch(text, /No open checklist for this week/);
  });

  it("a genuinely empty load still shows the plain no-checklist state", async () => {
    const text = await renderWithApi({
      rolloverWeeklyChecklists: async () => ({ created: 0, locked: 0 }),
      listWeeklyChecklists: async () => [],
    });
    assert.match(text, /No open checklist for this week/);
    assert.doesNotMatch(text, /Could not load your weekly checklist/);
  });
});

describe("checklistErrorMessage", () => {
  it("replaces raw database text with the fallback", () => {
    assert.equal(
      checklistErrorMessage(new Error(RLS_TEXT), "fallback"),
      "fallback",
    );
    assert.equal(
      checklistErrorMessage(
        new Error("Cannot read properties of undefined (reading 'client')"),
        "fallback",
      ),
      "fallback",
    );
    assert.equal(checklistErrorMessage("not an error", "fallback"), "fallback");
    assert.equal(checklistErrorMessage(null, "fallback"), "fallback");
  });

  it("passes deliberate app messages through untouched", () => {
    const human =
      "Only the assigned house manager can fill in this checklist.";
    assert.equal(checklistErrorMessage(new Error(human), "fallback"), human);
  });
});
