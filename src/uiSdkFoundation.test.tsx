import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK foundation smoke test — slice 0 of the @ui-sdk adoption.
 *
 * Proves the pinned @ui-sdk/react + @ui-sdk/core packages actually work
 * in this app (not just that they install): a Dialog composed from the
 * shipped parts renders in the app's jsdom test environment, carries
 * the dialog ARIA wiring (role, aria-modal, title/description
 * references), moves focus inside when opened from its trigger, and
 * closes on Escape with focus returned to the trigger.
 *
 * jsdom limits, per the ui-sdk skill's testing reference: the stubs in
 * before() stand in for the top-layer/popover and animation APIs jsdom
 * lacks, so placement and real-browser focus timing stay browser-QA
 * territory. What is asserted here is the render + ARIA + focus
 * contract the parts promise.
 */

describe("ui-sdk foundation — Dialog smoke test", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let dialogParts: typeof import("@ui-sdk/react/dialog");

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
    // ui-sdk's modal machinery (inert/focus work on timers after open)
    // references DOM constructors as bare globals; copy the set it can
    // touch from the jsdom window.
    for (const name of [
      "ShadowRoot",
      "DocumentFragment",
      "HTMLInputElement",
      "HTMLButtonElement",
      "HTMLAnchorElement",
      "HTMLSelectElement",
      "HTMLTextAreaElement",
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
    setGlobal(
      "getComputedStyle",
      dom.window.getComputedStyle.bind(dom.window),
    );
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    // jsdom stubs prescribed by the ui-sdk skill's testing reference:
    // ui-sdk's overlay parts use the top layer, and jsdom's popover and
    // animation implementations are missing or incomplete.
    const win = dom.window as unknown as {
      HTMLElement: { prototype: Record<string, unknown> };
      Element: { prototype: Record<string, unknown> };
    };
    win.HTMLElement.prototype.showPopover = function () {};
    win.HTMLElement.prototype.hidePopover = function () {};
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
    dom.window.document.head.append(
      Object.assign(dom.window.document.createElement("style"), {
        textContent: "[popover] { display: block !important }",
      }),
    );

    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    dialogParts = await import("@ui-sdk/react/dialog");
  });

  after(() => {
    dom.window.close();
  });

  function FoundationDialog() {
    const {
      Dialog,
      DialogTrigger,
      DialogBackdrop,
      DialogContent,
      DialogTitle,
      DialogDescription,
      DialogClose,
    } = dialogParts;
    return (
      <Dialog>
        <DialogTrigger>Open foundation dialog</DialogTrigger>
        <DialogBackdrop />
        <DialogContent>
          <DialogTitle>Foundation check</DialogTitle>
          <DialogDescription>
            Proves the pinned ui-sdk packages render in this app.
          </DialogDescription>
          <DialogClose>Done</DialogClose>
        </DialogContent>
      </Dialog>
    );
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("renders closed, opens from the trigger with ARIA wiring and focus inside, and Escape closes it and returns focus", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(<FoundationDialog />);
      await settle();
    });

    const trigger = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Open foundation dialog",
    );
    assert.ok(trigger, "trigger button renders");
    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      "no dialog is rendered while closed",
    );

    await React.act(async () => {
      trigger.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });

    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, "dialog renders after the trigger click");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    const titleId = dialog.getAttribute("aria-labelledby");
    assert.ok(titleId, "dialog is labelled by its title part");
    assert.equal(
      document.getElementById(titleId)?.textContent,
      "Foundation check",
    );
    const descriptionId = dialog.getAttribute("aria-describedby");
    assert.ok(descriptionId, "dialog is described by its description part");
    assert.match(
      document.getElementById(descriptionId)?.textContent ?? "",
      /Proves the pinned ui-sdk packages render in this app\./,
    );
    assert.ok(
      dialog.contains(document.activeElement),
      "focus moves inside the dialog when it opens",
    );

    await React.act(async () => {
      document.activeElement?.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
    });

    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      "Escape closes the dialog",
    );
    assert.equal(
      document.activeElement,
      trigger,
      "focus returns to the trigger after Escape",
    );

    await React.act(async () => root.unmount());
    container.remove();
  });
});
