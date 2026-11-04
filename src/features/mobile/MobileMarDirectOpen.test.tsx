import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalApi, MemoryStore } from "../../data/localApi";
import { createEvergreenSeed, DEMO_AGENCY_CODE, DEMO_HM_USERNAME } from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";

/**
 * Wave 1 audit: on the phone, picking a person in Health and tapping
 * Medications opened the MAR on a SECOND person picker — the staffer had
 * to choose the same person again. The MAR now opens on the person it was
 * opened for; opened without one (the Health home entry), it still asks.
 */
describe("MobileMar opens on the person it was opened for", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let MobileMar: typeof import("./MobileMar").default;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    const setGlobal = (name: string, value: unknown) => {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
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
    MobileMar = (await import("./MobileMar")).default;
  });

  after(() => {
    dom.window.close();
  });

  async function render(initialPersonId: string | null) {
    const api = new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_HM_USERNAME,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const people = workspace.individuals.filter((row) => row.siteId === session.siteId);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(MobileMar, {
          api,
          session,
          people,
          initialPersonId: initialPersonId === "first" ? people[0].id : initialPersonId,
          onOpenChart: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    const text = container.textContent ?? "";
    await React.act(async () => root.unmount());
    container.remove();
    return { text, people };
  }

  it("opened for a person: no picker, that person's MAR", async () => {
    const { text, people } = await render("first");
    assert.ok(!text.includes("Pick the person whose medications"), "no second picker");
    assert.ok(text.includes(people[0].name), "the person's MAR is open");
  });

  it("opened without a person: the picker still asks", async () => {
    const { text } = await render(null);
    assert.ok(text.includes("Pick the person whose medications"));
  });
});
