import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { HrStore } from "../../data/hrStore";
import { defaultBinderTemplateLibrary } from "../../data/newHireBinder";
import { BinderTemplateViewer } from "./BinderTemplateViewer";

/**
 * Wave 4D (retest batches 299–302): HR could not view binder templates
 * at all — the Binder Board only offered Templates to the roles that
 * may EDIT them. The viewer gives HR (and any non-editor the board
 * routes here) the full template contents with no edit affordances:
 * no inputs, no selects, no save/remove/reorder controls.
 */

let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;

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
  setGlobal("Element", dom.window.Element);
  setGlobal("Node", dom.window.Node);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});

after(() => {
  dom.window.close();
});

async function renderViewer(): Promise<HTMLElement> {
  const store = {
    listBinderTemplates: async () => defaultBinderTemplateLibrary(),
  } as unknown as HrStore;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(BinderTemplateViewer, { store }));
  });
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

describe("BinderTemplateViewer (Wave 4D)", () => {
  it("shows the full default template contents, read-only", async () => {
    const container = await renderViewer();
    const text = container.textContent ?? "";
    assert.match(text, /Read-only/);
    assert.match(text, /Agency default/);
    assert.match(text, /Direct Support Professional/);
    // Sections and items from the seeded default template.
    assert.match(text, /Background & screening/);
    assert.match(text, /FCSR record/);
    assert.match(text, /Certifications/);
    assert.match(text, /Required/);
    // No edit affordances anywhere in the rendered viewer.
    assert.equal(container.querySelectorAll("input, select, textarea").length, 0);
    assert.doesNotMatch(text, /Save|Add section|Add item|Remove item/);
  });
});
