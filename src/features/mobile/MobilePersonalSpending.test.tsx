import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_HM_USERNAME,
} from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";

/**
 * Fix wave 3, item 1(c) (simulation batch 7): the mobile Personal
 * Spending close form shared the desktop form's pre-checked sign-off.
 * It now starts unchosen too — see PersonalSpendingCard.test.tsx for
 * the desktop half.
 */

describe("MobilePersonalSpending close sign-off", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let MobilePersonalSpending: typeof import("./MobilePersonalSpending").default;

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
    MobilePersonalSpending = (await import("./MobilePersonalSpending")).default;
  });

  after(() => {
    dom.window.close();
  });

  it("starts with no sign-off chosen", async () => {
    const act = React.act;
    const api = new LocalApi(
      new MemoryStore(structuredClone(createEvergreenSeed())),
    );
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_HM_USERNAME,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const harper = workspace.individuals.find((i) => i.name === "Harper Soto")!;
    const james = workspace.staff.find((s) => s.name === "James Wilson")!;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(MobilePersonalSpending, {
          api,
          session,
          person: harper,
          siteName: "Willow House",
          staffOptions: [{ id: james.id, name: "James Wilson" }],
          onBack: () => undefined,
          onOpenChart: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const radios = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="mq-ps-signoff"]',
      ),
    ];
    assert.equal(radios.length, 2, "both sign-off options render");
    assert.ok(
      radios.every((radio) => !radio.checked),
      "no sign-off option is pre-checked",
    );
    await act(async () => root.unmount());
  });
});
