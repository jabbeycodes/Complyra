import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK slice 3 — the shared toast on @ui-sdk/react Toast.
 *
 * showToast() replaces App.tsx's hand-rolled single-string toast; these
 * tests pin its contract: an enqueued message renders in the region with
 * the hand-rolled toast's classes and close button, variants map to the
 * SDK toast types, a toast auto-dismisses after its duration, the queue
 * caps how many show at once (the rest wait), the close button
 * dismisses, and showing a toast never steals focus.
 *
 * The jsdom setup mirrors ConfirmDialog.test.tsx (slice 2).
 */

describe("showToast on ui-sdk Toast (slice 3)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let showToast: typeof import("./AppToast").showToast;
  let dismissToast: typeof import("./AppToast").dismissToast;
  let ToastHost: typeof import("./AppToast").ToastHost;

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
    ({ showToast, dismissToast, ToastHost } = await import("./AppToast"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const settleLong = () => new Promise((resolve) => setTimeout(resolve, 350));

  async function mountHost() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        <>
          <button type="button">Opener</button>
          <ToastHost />
        </>,
      );
      await settle();
    });
    return { container, root };
  }

  async function unmount(
    root: { unmount: () => void },
    container: Element,
  ) {
    await React.act(async () => {
      dismissToast();
      await settle();
      root.unmount();
    });
    container.remove();
  }

  function toasts() {
    return [...document.querySelectorAll('[data-slot="toast"]')];
  }

  it("renders an enqueued message with the house classes and close button", async () => {
    const { container, root } = await mountHost();
    await React.act(async () => {
      showToast("Completion saved. Your compliance overview is up to date.");
      await settle();
    });
    const list = toasts();
    assert.equal(list.length, 1, "one toast renders");
    const toast = list[0];
    assert.ok(toast.classList.contains("toast"), "keeps .toast");
    assert.match(toast.textContent ?? "", /Completion saved/);
    assert.equal(toast.getAttribute("data-type"), "success");
    const region = document.querySelector('[data-slot="toast-region"]');
    assert.ok(region, "region renders");
    assert.equal(region.getAttribute("aria-label"), "Notifications");
    const close = toast.querySelector('button[aria-label="Dismiss notification"]');
    assert.ok(close, "close button keeps its aria-label");
    await unmount(root, container);
  });

  it("does not steal focus when a toast appears", async () => {
    const { container, root } = await mountHost();
    const opener = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Opener",
    );
    assert.ok(opener);
    opener.focus();
    assert.equal(document.activeElement, opener);
    await React.act(async () => {
      showToast("Draft created.");
      await settle();
    });
    assert.equal(toasts().length, 1);
    assert.equal(
      document.activeElement,
      opener,
      "focus stays on the element the user was using",
    );
    await unmount(root, container);
  });

  it("variant rendering: error maps to data-type error", async () => {
    const { container, root } = await mountHost();
    await React.act(async () => {
      showToast("That change could not be saved.", { variant: "error" });
      await settle();
    });
    const list = toasts();
    assert.equal(list.length, 1);
    assert.equal(list[0].getAttribute("data-type"), "error");
    await unmount(root, container);
  });

  it("auto-dismisses after its duration", async () => {
    const { container, root } = await mountHost();
    await React.act(async () => {
      showToast("Short lived.", { duration: 60 });
      await settle();
    });
    assert.equal(toasts().length, 1, "toast shows first");
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await settle();
    });
    await settleLong();
    assert.equal(toasts().length, 0, "toast is gone after its duration");
    await unmount(root, container);
  });

  it("queue cap: at most 3 show at once, the rest wait", async () => {
    const { container, root } = await mountHost();
    await React.act(async () => {
      for (const label of ["One", "Two", "Three", "Four", "Five"]) {
        showToast(label, { duration: 60000 });
      }
      await settle();
    });
    assert.equal(toasts().length, 3, "maxVisible caps the stack at 3");
    await unmount(root, container);
  });

  it("stacks newest first and the close button dismisses its toast", async () => {
    const { container, root } = await mountHost();
    await React.act(async () => {
      showToast("First message.", { duration: 60000 });
      showToast("Second message.", { duration: 60000 });
      await settle();
    });
    const list = toasts();
    assert.equal(list.length, 2, "both toasts show — the second no longer replaces the first");
    assert.match(list[0].textContent ?? "", /Second message/);
    const close = list[0].querySelector(
      'button[aria-label="Dismiss notification"]',
    );
    assert.ok(close);
    await React.act(async () => {
      close.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    await settleLong();
    const remaining = toasts();
    assert.equal(remaining.length, 1, "only the dismissed toast is gone");
    assert.match(remaining[0].textContent ?? "", /First message/);
    await unmount(root, container);
  });
});
