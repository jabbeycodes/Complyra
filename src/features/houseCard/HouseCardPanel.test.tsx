import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";

/**
 * Fix wave 3, item 2 (simulation batch 9): the House Card ledger showed
 * a "Void" button to DSPs on every entry, including the administrator's.
 * Voiding follows the close-month gate (administrator / program
 * manager / house manager). This test renders the real panel against
 * the demo workspace at Cedar House — as the DSP (no Void anywhere)
 * and as a house manager (Void present). The API half of the rule is
 * pinned in houseCardApi.test.ts.
 */

describe("HouseCardPanel void gate", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let HouseCardPanel: typeof import("./HouseCardPanel").default;

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
    HouseCardPanel = (await import("./HouseCardPanel")).default;
  });

  after(() => {
    dom.window.close();
  });

  async function renderAs(username: string, siteName: string) {
    const act = React.act;
    const api = new LocalApi(
      new MemoryStore(structuredClone(createEvergreenSeed())),
    );
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const site = workspace.sites.find((s) => s.name === siteName)!;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(HouseCardPanel, {
          api,
          session,
          siteId: site.id,
          siteName,
          people: [],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    const voidButtons = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "Void",
    );
    return { act, root, voidButtons, text: container.textContent ?? "" };
  }

  it("a DSP sees no Void button on any ledger entry", async () => {
    // Alex Morgan is a Cedar House DSP; Cedar's ledger has entries
    // recorded by other staff, including managers.
    const { act, root, voidButtons, text } = await renderAs(
      DEMO_DSP_USERNAME,
      "Cedar House",
    );
    assert.ok(text.includes("Card balance now"), "the ledger rendered");
    assert.equal(voidButtons.length, 0);
    await act(async () => root.unmount());
  });

  it("a house manager sees the Void button", async () => {
    // James Wilson manages Willow House.
    const { act, root, voidButtons } = await renderAs(
      DEMO_HM_USERNAME,
      "Willow House",
    );
    assert.ok(voidButtons.length > 0, "manager sees Void controls");
    await act(async () => root.unmount());
  });
});
