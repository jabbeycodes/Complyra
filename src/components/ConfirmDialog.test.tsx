import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK slice 2 — the promise-based confirm helper on Alert Dialog.
 *
 * confirmDialog() replaces window.confirm at the call sites; these tests
 * pin its contract: the question renders in the shared Modal's classes
 * with alertdialog ARIA, the confirm answer resolves true, Cancel and
 * Escape resolve false, focus starts on Cancel (the least destructive
 * answer) and returns to the element that asked, and queued questions
 * are asked one at a time.
 *
 * The jsdom setup mirrors components.Modal.test.tsx (slice 1): the stubs
 * stand in for the top-layer/popover and animation APIs jsdom lacks, so
 * real placement and focus timing in a browser stay browser-QA territory.
 */

describe("confirmDialog on ui-sdk Alert Dialog (slice 2)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let confirmDialog: typeof import("./ConfirmDialog").confirmDialog;
  let ConfirmDialogHost: typeof import("./ConfirmDialog").ConfirmDialogHost;

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
    ({ confirmDialog, ConfirmDialogHost } = await import("./ConfirmDialog"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const settleLong = () => new Promise((resolve) => setTimeout(resolve, 350));

  // Mirrors a migrated call site: a button awaits the answer, and the
  // host is mounted once alongside it.
  function Harness({
    answers,
    title = "Remove this mileage trip?",
    body = "This cannot be undone.",
  }: {
    answers: boolean[];
    title?: string;
    body?: string;
  }) {
    return (
      <>
        <button
          type="button"
          onClick={async () => {
            answers.push(await confirmDialog({ title, body }));
          }}
        >
          Ask
        </button>
        <ConfirmDialogHost />
      </>
    );
  }

  async function mountHarness(props?: { title?: string; body?: string }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const answers: boolean[] = [];
    await React.act(async () => {
      root.render(<Harness answers={answers} {...props} />);
      await settle();
    });
    const opener = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Ask",
    );
    assert.ok(opener, "opener renders");
    return { container, root, opener, answers };
  }

  async function ask(opener: HTMLButtonElement) {
    opener.focus();
    assert.equal(document.activeElement, opener, "opener focused first");
    await React.act(async () => {
      opener.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog, "alert dialog renders after the opener click");
    return dialog;
  }

  function dialogButton(dialog: Element, label: string) {
    const button = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    assert.ok(button, `${label} button renders`);
    return button;
  }

  async function press(button: Element) {
    await React.act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
    await settleLong();
  }

  async function unmount(root: { unmount: () => void }, container: Element) {
    await React.act(async () => root.unmount());
    container.remove();
  }

  it("renders the question with house classes and alertdialog ARIA, focus on Cancel", async () => {
    const { container, root, opener } = await mountHarness();
    const dialog = await ask(opener);

    assert.equal(dialog.getAttribute("aria-modal"), "true");
    const titleId = dialog.getAttribute("aria-labelledby");
    assert.ok(titleId, "dialog is labelled by its title part");
    assert.equal(
      document.getElementById(titleId)?.textContent,
      "Remove this mileage trip?",
    );
    const descId = dialog.getAttribute("aria-describedby");
    assert.ok(descId, "dialog is described by its description part");
    const desc = document.getElementById(descId);
    assert.equal(desc?.textContent, "This cannot be undone.");
    assert.ok(desc?.classList.contains("confirm-body"));
    assert.ok(dialog.classList.contains("modal"), "content keeps .modal");
    assert.ok(dialog.querySelector(".modal-head"), "head keeps .modal-head");
    assert.ok(dialog.querySelector(".modal-body"), "body keeps .modal-body");
    assert.ok(
      document.querySelector(".modal-backdrop"),
      "backdrop keeps .modal-backdrop",
    );
    const cancel = dialogButton(dialog, "Cancel");
    assert.equal(
      document.activeElement,
      cancel,
      "focus starts on Cancel, the least destructive answer",
    );

    await press(cancel);
    await unmount(root, container);
  });

  it("the confirm answer resolves true and focus returns to the opener", async () => {
    const { container, root, opener, answers } = await mountHarness();
    const dialog = await ask(opener);

    await press(dialogButton(dialog, "OK"));

    assert.deepEqual(answers, [true], "confirm resolves true exactly once");
    assert.equal(
      document.querySelector('[role="alertdialog"]'),
      null,
      "dialog is gone after the confirm answer",
    );
    assert.equal(
      document.activeElement,
      opener,
      "focus returns to the element that asked",
    );

    await unmount(root, container);
  });

  it("Cancel resolves false", async () => {
    const { container, root, opener, answers } = await mountHarness();
    const dialog = await ask(opener);

    await press(dialogButton(dialog, "Cancel"));

    assert.deepEqual(answers, [false], "cancel resolves false exactly once");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);

    await unmount(root, container);
  });

  it("Escape resolves false and focus returns to the opener", async () => {
    const { container, root, opener, answers } = await mountHarness();
    const dialog = await ask(opener);
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

    assert.deepEqual(answers, [false], "escape resolves false exactly once");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.activeElement, opener, "focus returns after Escape");

    await unmount(root, container);
  });

  it("queued questions are asked one at a time, each with its own answer", async () => {
    const { container, root, opener, answers } = await mountHarness();

    // Two asks in flight at once: the second must wait for the first.
    let second: Promise<boolean> | undefined;
    opener.focus();
    await React.act(async () => {
      opener.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      second = confirmDialog({ title: "Delete this shift note?" });
      await settle();
    });
    const first = document.querySelector('[role="alertdialog"]');
    assert.ok(first, "first question renders");
    assert.match(
      first.textContent ?? "",
      /Remove this mileage trip\?/,
      "the first question is the one on screen",
    );

    await press(dialogButton(first, "OK"));
    assert.deepEqual(answers, [true], "first answer recorded");

    const next = document.querySelector('[role="alertdialog"]');
    assert.ok(next, "second question renders after the first is answered");
    assert.match(next.textContent ?? "", /Delete this shift note\?/);

    await press(dialogButton(next, "Cancel"));
    assert.equal(await second, false, "second question gets its own answer");

    await unmount(root, container);
  });
});
