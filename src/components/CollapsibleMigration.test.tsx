import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import Disclosure from "./Disclosure";
import { DrillRow } from "../features/siteDetail/DrillScheduleVisual";
import HelpPage from "../features/help/HelpPage";

/**
 * Slice 8 (Collapsible) migration tests.
 *
 * Part A pins the composition patterns the migrated sites use:
 *  - keepMounted (Disclosure / ex-<details>): the panel stays in the DOM,
 *    `hidden` while closed, and a typed field inside it survives a
 *    close/open cycle on the same DOM node — the pre-migration behavior.
 *  - unmount (the hand-rolled conditional renders): the panel leaves the
 *    DOM when closed and returns when open.
 *  - shared controlled state (MenuSection history, MobileConsents,
 *    BinderBoard): one `expandedId`-style state drives several controlled
 *    Collapsibles; opening one closes the other, exactly like the shared
 *    useState did.
 *  - explicit panel id + trigger aria-controls (Disclosure, Dashboard,
 *    DrillRow): the wiring is present in the markup closed and open, as
 *    the hand-rolled versions had it.
 *
 * Part B renders the real Disclosure: default closed with the panel
 * mounted + hidden, summary hint, is-open class on the root when open.
 *
 * Part C renders the real DrillRow (custom panel id + aria-controls
 * parity) and the real HelpPage FAQ (ex-<details>: answer stays mounted,
 * hidden until opened).
 */
describe("Collapsible migration (slice 8)", () => {
  let dom: JSDOM;
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
    setGlobal("HTMLCanvasElement", dom.window.HTMLCanvasElement);
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal(
      "requestAnimationFrame",
      dom.window.requestAnimationFrame.bind(dom.window),
    );
    setGlobal(
      "cancelAnimationFrame",
      dom.window.cancelAnimationFrame.bind(dom.window),
    );
    for (const name of [
      "ShadowRoot",
      "DocumentFragment",
      "HTMLInputElement",
      "HTMLButtonElement",
      "HTMLAnchorElement",
      "HTMLSelectElement",
      "HTMLTextAreaElement",
      "HTMLFieldSetElement",
      "HTMLFormElement",
      "HTMLLabelElement",
      "HTMLOptionElement",
      "HTMLDataListElement",
      "MutationObserver",
      "CustomEvent",
      "Event",
      "MouseEvent",
      "KeyboardEvent",
      "FocusEvent",
      "NodeFilter",
    ]) {
      setGlobal(name, (dom.window as unknown as Record<string, unknown>)[name]);
    }
    setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const win = dom.window as unknown as {
      HTMLElement: { prototype: Record<string, unknown> };
      Element: { prototype: Record<string, unknown> };
    };
    win.HTMLElement.prototype.showPopover = function () {};
    win.HTMLElement.prototype.hidePopover = function () {};
    setGlobal("AbortController", dom.window.AbortController);
    setGlobal("AbortSignal", dom.window.AbortSignal);
    if (typeof dom.window.matchMedia !== "function") {
      setGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }));
    }
    win.Element.prototype.getAnimations = () => [];
    win.Element.prototype.scrollIntoView = function () {};
    win.Element.prototype.checkVisibility = () => true;
    win.Element.prototype.getClientRects = () => [];
    dom.window.document.elementFromPoint = () => null;
    dom.window.document.elementsFromPoint = () => [];
    setGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    ({ createRoot } = await import("react-dom/client"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  async function mount(element: React.ReactElement) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(element);
      await settle();
    });
    return { container, root };
  }

  async function unmount(
    root: { unmount: () => void },
    container: HTMLElement,
  ) {
    await React.act(async () => {
      root.unmount();
      await settle();
    });
    container.remove();
  }

  async function click(el: Element) {
    await React.act(async () => {
      (el as HTMLElement).click();
      await settle();
    });
  }

  it("A1 keepMounted: panel stays mounted + hidden; typed input survives on the same node", async () => {
    const { container, root } = await mount(
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="t">Section</CollapsibleTrigger>
        <CollapsiblePanel keepMounted className="p">
          <input className="field" defaultValue="" />
        </CollapsiblePanel>
      </Collapsible>,
    );
    const trigger = container.querySelector("button.t")!;
    const input = container.querySelector("input.field") as HTMLInputElement;
    input.value = "typed while open";
    await click(trigger); // close
    const panel = container.querySelector(".p");
    assert.ok(panel, "panel stays mounted when closed");
    assert.ok(panel!.hasAttribute("hidden"), "panel hidden when closed");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await click(trigger); // reopen
    const input2 = container.querySelector("input.field") as HTMLInputElement;
    assert.equal(input2, input, "same DOM node after reopen");
    assert.equal(input2.value, "typed while open", "typed value survives");
    await unmount(root, container);
  });

  it("A2 unmount: panel leaves the DOM when closed (conditional-render parity)", async () => {
    const { container, root } = await mount(
      <Collapsible>
        <CollapsibleTrigger className="t">Section</CollapsibleTrigger>
        <CollapsiblePanel className="p">
          <p>Panel body</p>
        </CollapsiblePanel>
      </Collapsible>,
    );
    const trigger = container.querySelector("button.t")!;
    assert.equal(trigger.tagName, "BUTTON");
    assert.equal(trigger.getAttribute("type"), "button", "form-safe trigger");
    assert.equal(container.querySelector(".p"), null, "closed: unmounted");
    await click(trigger);
    assert.ok(container.querySelector(".p"), "open: mounted");
    assert.equal(
      trigger.getAttribute("aria-controls"),
      container.querySelector(".p")!.id,
      "aria-controls wired while mounted",
    );
    await click(trigger);
    assert.equal(container.querySelector(".p"), null, "closed again: unmounted");
    await unmount(root, container);
  });

  it("A3 shared controlled state: opening one instance closes the other", async () => {
    function SharedPair() {
      const [openId, setOpenId] = React.useState<string | null>(null);
      return (
        <>
          {(["a", "b"] as const).map((id) => (
            <Collapsible
              key={id}
              open={openId === id}
              onOpenChange={(open) => setOpenId(open ? id : null)}
            >
              <CollapsibleTrigger className={`t-${id}`}>
                Toggle {id}
              </CollapsibleTrigger>
              <CollapsiblePanel className={`p-${id}`}>
                <p>Body {id}</p>
              </CollapsiblePanel>
            </Collapsible>
          ))}
        </>
      );
    }
    const { container, root } = await mount(<SharedPair />);
    await click(container.querySelector("button.t-a")!);
    assert.ok(container.querySelector(".p-a"), "a open");
    assert.equal(container.querySelector(".p-b"), null, "b closed");
    await click(container.querySelector("button.t-b")!);
    assert.equal(container.querySelector(".p-a"), null, "a closed by b");
    assert.ok(container.querySelector(".p-b"), "b open");
    await click(container.querySelector("button.t-b")!);
    assert.equal(container.querySelector(".p-b"), null, "b toggles shut");
    await unmount(root, container);
  });

  it("A4 explicit id + aria-controls present closed and open (parity sites)", async () => {
    const { container, root } = await mount(
      <Collapsible>
        <CollapsibleTrigger className="t" aria-controls="fixed-panel">
          Section
        </CollapsibleTrigger>
        <CollapsiblePanel keepMounted id="fixed-panel" className="p">
          <p>Body</p>
        </CollapsiblePanel>
      </Collapsible>,
    );
    const trigger = container.querySelector("button.t")!;
    assert.equal(trigger.getAttribute("aria-controls"), "fixed-panel");
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-controls"), "fixed-panel");
    assert.equal(container.querySelector(".p")!.id, "fixed-panel");
    await unmount(root, container);
  });

  it("B real Disclosure: closed by default, panel mounted + hidden, is-open when open", async () => {
    const { container, root } = await mount(
      <Disclosure label="Advanced & data" summary="Data handling">
        <p>Secondary content</p>
      </Disclosure>,
    );
    const trigger = container.querySelector("button.disclosure-trigger")!;
    const panel = container.querySelector(".disclosure-panel")!;
    assert.ok(trigger.textContent!.includes("Advanced & data"));
    assert.ok(trigger.textContent!.includes("Data handling"), "summary hint");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(
      trigger.getAttribute("aria-controls"),
      panel.id,
      "trigger controls the panel",
    );
    assert.ok(panel.hasAttribute("hidden"), "panel hidden while closed");
    assert.ok(
      !container
        .querySelector(".disclosure")!
        .classList.contains("is-open"),
      "no is-open class while closed",
    );
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(!panel.hasAttribute("hidden"), "panel visible when open");
    assert.ok(
      container.querySelector(".disclosure")!.classList.contains("is-open"),
      "is-open class drives the caret rule",
    );
    await unmount(root, container);
  });

  it("C1 real DrillRow: custom panel id + aria-controls, panel mounts on toggle", async () => {
    const { container, root } = await mount(
      <ul>
        <DrillRow
          state={{ type: "fire", record: null, status: "not_logged", late: false }}
        />
      </ul>,
    );
    const trigger = container.querySelector("button.dsv-drill-toggle")!;
    assert.equal(
      trigger.getAttribute("aria-controls"),
      "drill-detail-fire-none",
    );
    assert.equal(
      container.querySelector("#drill-detail-fire-none"),
      null,
      "panel unmounted while closed",
    );
    await click(trigger);
    const panel = container.querySelector("#drill-detail-fire-none");
    assert.ok(panel, "panel mounts with the custom id");
    assert.ok(panel!.textContent!.includes("Not logged for this month yet."));
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    await unmount(root, container);
  });

  it("C2 real HelpPage FAQ: answer stays mounted, hidden until opened", async () => {
    const { container, root } = await mount(<HelpPage />);
    const faq = container.querySelector(".help-faq")!;
    assert.ok(faq, "faq renders");
    const trigger = faq.querySelector(
      '[data-slot="collapsible-trigger"]',
    ) as HTMLElement;
    const panel = faq.querySelector(
      '[data-slot="collapsible-panel"]',
    ) as HTMLElement;
    assert.ok(trigger.textContent!.length > 0, "question is the trigger");
    assert.ok(panel, "answer panel mounted while closed (ex-details)");
    assert.ok(panel.hasAttribute("hidden"), "answer hidden while closed");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(!panel.hasAttribute("hidden"), "answer visible when open");
    await unmount(root, container);
  });
});
