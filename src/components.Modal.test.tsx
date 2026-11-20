import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK slice 1 — the shared Modal on @ui-sdk/react Dialog parts.
 *
 * Modal's props are unchanged (title / onClose / wide), so every call
 * site rides along; what these tests pin is the behavior contract the
 * swap must keep or gain: the dialog renders its title and children
 * with the house classes, carries role/aria-modal and a title-wired
 * accessible name, takes focus when it opens, and every dismissal
 * (Escape, the close button) routes to onClose with focus returned to
 * the element that had it before the modal opened.
 *
 * The jsdom setup mirrors uiSdkFoundation.test.tsx: the stubs stand in
 * for the top-layer/popover and animation APIs jsdom lacks, so real
 * placement and focus timing in a browser stay browser-QA territory.
 */

describe("shared Modal on ui-sdk Dialog (slice 1)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Modal: typeof import("./components").Modal;

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
    ({ Modal } = await import("./components"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const settleLong = () => new Promise((resolve) => setTimeout(resolve, 350));

  // Mirrors a real call site: the opener keeps focus before opening,
  // Modal is mounted only while open, and onClose unmounts it.
  function Harness({
    wide = false,
    onClose,
  }: {
    wide?: boolean;
    onClose: () => void;
  }) {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open modal
        </button>
        {open ? (
          <Modal
            title="Assign training"
            wide={wide}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            <p>Pick a staff member to assign.</p>
            <button type="button">Inside action</button>
          </Modal>
        ) : null}
      </>
    );
  }

  async function mountHarness(wide = false) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let closes = 0;
    await React.act(async () => {
      root.render(
        <Harness
          wide={wide}
          onClose={() => {
            closes += 1;
          }}
        />,
      );
      await settle();
    });
    const opener = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Open modal",
    );
    assert.ok(opener, "opener renders");
    return { container, root, opener, closes: () => closes };
  }

  async function openModal(opener: HTMLButtonElement) {
    opener.focus();
    assert.equal(document.activeElement, opener, "opener focused first");
    await React.act(async () => {
      opener.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, "dialog renders after the opener click");
    return dialog;
  }

  async function unmount(root: { unmount: () => void }, container: Element) {
    await React.act(async () => root.unmount());
    container.remove();
  }

  it("renders title and children with house classes and title-wired ARIA", async () => {
    const { container, root, opener } = await mountHarness();
    const dialog = await openModal(opener);

    assert.equal(dialog.getAttribute("aria-modal"), "true");
    const titleId = dialog.getAttribute("aria-labelledby");
    assert.ok(titleId, "dialog is labelled by its title part");
    const title = document.getElementById(titleId);
    assert.equal(title?.textContent, "Assign training");
    assert.equal(title?.tagName, "H2");
    assert.ok(
      dialog.classList.contains("modal"),
      "content keeps the .modal class",
    );
    assert.ok(
      !dialog.classList.contains("wide"),
      "wide class absent by default",
    );
    assert.ok(
      dialog.querySelector(".modal-head"),
      "head keeps the .modal-head class",
    );
    const body = dialog.querySelector(".modal-body");
    assert.ok(body, "body keeps the .modal-body class");
    assert.match(body.textContent ?? "", /Pick a staff member to assign\./);
    const backdrop = document.querySelector(".modal-backdrop");
    assert.ok(backdrop, "backdrop renders with the .modal-backdrop class");
    assert.ok(
      dialog.contains(document.activeElement),
      "focus moves inside the dialog when it opens",
    );

    await unmount(root, container);
  });

  it("Escape routes to onClose and focus returns to the opener", async () => {
    const { container, root, opener, closes } = await mountHarness();
    const dialog = await openModal(opener);
    assert.ok(dialog.contains(document.activeElement));

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
    await settleLong();

    assert.equal(closes(), 1, "onClose fired exactly once");
    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      "dialog is gone after Escape",
    );
    assert.equal(
      document.activeElement,
      opener,
      "focus returns to the opener after Escape",
    );

    await unmount(root, container);
  });

  it("the close button routes to onClose and focus returns to the opener", async () => {
    const { container, root, opener, closes } = await mountHarness();
    const dialog = await openModal(opener);
    const closeButton = dialog.querySelector(
      'button[aria-label="Close dialog"]',
    );
    assert.ok(closeButton, "close button renders with its accessible name");

    await React.act(async () => {
      closeButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    await settleLong();

    assert.equal(closes(), 1, "onClose fired exactly once");
    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      "dialog is gone after the close button",
    );
    assert.equal(
      document.activeElement,
      opener,
      "focus returns to the opener after the close button",
    );

    await unmount(root, container);
  });

  it("wide adds the .wide class to the dialog", async () => {
    const { container, root, opener } = await mountHarness(true);
    const dialog = await openModal(opener);
    assert.ok(dialog.classList.contains("modal"));
    assert.ok(dialog.classList.contains("wide"), "wide class present");

    await unmount(root, container);
  });
});
