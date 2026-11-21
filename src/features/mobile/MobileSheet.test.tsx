import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK slice 5 — the shared mobile sheet on @ui-sdk/react Drawer.
 *
 * MobileSheet replaces the hand-rolled backdrop button + `msh-sheet`
 * div every mobile surface used to re-implement; these tests pin its
 * contract: the sheet renders with the house classes and the visible
 * h3 as its accessible name, the backdrop stays a labelled button,
 * focus moves into the sheet on open, and Escape and a backdrop
 * press route to the caller's onClose with focus returned to the
 * element that opened the sheet.
 *
 * The jsdom setup mirrors components.Modal.test.tsx (slice 1), plus a
 * matchMedia stub (the drawer's driver choice reads it; jsdom has
 * none). Real placement, drag physics, and focus timing in a browser
 * stay browser-QA territory.
 */

describe("MobileSheet on ui-sdk Drawer (slice 5)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let MobileSheet: typeof import("./MobileSheet").default;

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
      "PointerEvent",
      "NodeFilter",
    ]) {
      const value = (dom.window as unknown as Record<string, unknown>)[name];
      if (value !== undefined) setGlobal(name, value);
    }
    setGlobal(
      "getComputedStyle",
      dom.window.getComputedStyle.bind(dom.window),
    );
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    });
    setGlobal("matchMedia", matchMedia);
    (dom.window as unknown as { matchMedia: typeof matchMedia }).matchMedia =
      matchMedia;

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
    MobileSheet = (await import("./MobileSheet")).default;
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const settleLong = () => new Promise((resolve) => setTimeout(resolve, 350));

  // Mirrors a migrated call site: an opener button flips local state,
  // the sheet mounts only while open, onClose unmounts it.
  function Harness({
    onClose,
    extraClass,
    initialFocus,
  }: {
    onClose: () => void;
    extraClass?: string;
    initialFocus?: string;
  }) {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open sheet
        </button>
        {open && (
          <MobileSheet
            title="Record an entry"
            backdropLabel="Close entry form"
            className={extraClass}
            initialFocus={initialFocus}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          >
            <button type="button">First action</button>
            <button type="button" className="sheet-cancel">
              Cancel
            </button>
          </MobileSheet>
        )}
      </>
    );
  }

  async function mountHarness(extraClass?: string, initialFocus?: string) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let closes = 0;
    await React.act(async () => {
      root.render(
        <Harness
          extraClass={extraClass}
          initialFocus={initialFocus}
          onClose={() => {
            closes += 1;
          }}
        />,
      );
      await settle();
    });
    const opener = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Open sheet",
    );
    assert.ok(opener, "opener renders");
    return { container, root, opener, closes: () => closes };
  }

  async function openSheet(opener: HTMLButtonElement) {
    opener.focus();
    assert.equal(document.activeElement, opener, "opener focused first");
    await React.act(async () => {
      opener.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, "sheet renders after the opener click");
    return dialog;
  }

  async function unmount(root: { unmount: () => void }, container: Element) {
    await React.act(async () => root.unmount());
    container.remove();
  }

  it("renders with house classes, a labelled button backdrop, and the visible h3 as its name", async () => {
    const { container, root, opener } = await mountHarness("mq-sheet");
    const dialog = await openSheet(opener);

    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(dialog.getAttribute("data-slot"), "drawer-content");
    assert.ok(
      dialog.classList.contains("msh-sheet"),
      "content keeps the .msh-sheet class",
    );
    assert.ok(
      dialog.classList.contains("mq-sheet"),
      "content keeps the surface's extra class",
    );
    const titleId = dialog.getAttribute("aria-labelledby");
    assert.ok(titleId, "dialog is labelled by its title part");
    const title = document.getElementById(titleId);
    assert.equal(title?.tagName, "H3");
    assert.equal(title?.textContent, "Record an entry");
    assert.ok(
      title?.classList.contains("msh-sheet-title"),
      "title keeps the .msh-sheet-title class",
    );
    const backdrop = document.querySelector(".msh-sheet-backdrop");
    assert.ok(backdrop, "backdrop renders with the .msh-sheet-backdrop class");
    assert.equal(backdrop.tagName, "BUTTON", "backdrop stays a button");
    assert.equal(
      backdrop.getAttribute("aria-label"),
      "Close entry form",
      "backdrop keeps its close label",
    );
    assert.ok(
      dialog.contains(document.activeElement),
      "focus moves inside the sheet when it opens",
    );

    await unmount(root, container);
  });

  it("Escape routes to onClose and focus returns to the opener", async () => {
    const { container, root, opener, closes } = await mountHarness();
    const dialog = await openSheet(opener);
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
      "sheet is gone after Escape",
    );
    assert.equal(
      document.activeElement,
      opener,
      "focus returns to the opener after Escape",
    );

    await unmount(root, container);
  });

  it("initialFocus selects the field a surface asks for", async () => {
    const { container, root, opener } = await mountHarness(
      undefined,
      ".sheet-cancel",
    );
    const dialog = await openSheet(opener);
    const cancel = dialog.querySelector(".sheet-cancel");
    assert.ok(cancel, "target element renders");
    assert.equal(
      document.activeElement,
      cancel,
      "focus lands on the initialFocus target, not the first focusable",
    );

    await unmount(root, container);
  });

  it("a backdrop press routes to onClose", async () => {
    const { container, root, opener, closes } = await mountHarness();
    await openSheet(opener);
    const backdrop = document.querySelector(".msh-sheet-backdrop");
    assert.ok(backdrop, "backdrop renders");

    await React.act(async () => {
      backdrop.dispatchEvent(
        new dom.window.MouseEvent("pointerdown", { bubbles: true }),
      );
      backdrop.dispatchEvent(
        new dom.window.MouseEvent("pointerup", { bubbles: true }),
      );
      backdrop.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    await settleLong();

    assert.equal(closes(), 1, "onClose fired exactly once");
    assert.equal(
      document.querySelector('[role="dialog"]'),
      null,
      "sheet is gone after the backdrop press",
    );

    await unmount(root, container);
  });
});
