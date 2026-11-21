import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * UI SDK slice 6 — the mobile shell's account menu on
 * @ui-sdk/react Menu.
 *
 * The hand-rolled menu was a trigger with manual aria wiring, a
 * backdrop button for outside-press dismissal, and plain buttons in
 * a role="menu" div: no Escape, no arrow keys, no focus movement.
 * These tests pin the migrated contract: the trigger keeps its
 * house class and label with the SDK wiring aria-haspopup /
 * aria-expanded, the content keeps .msh-menu with the head
 * paragraph and button items in the old order, "Switch home" still
 * shows only when there is another home, items close-then-act,
 * and the keyboard model (arrows, Enter, Escape with focus return)
 * works. The jsdom setup mirrors MobileSheet.test.tsx (slice 5);
 * real placement and outside-press physics stay browser-QA
 * territory.
 */

describe("MobileAccountMenu on ui-sdk Menu (slice 6)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let MobileAccountMenu: typeof import("./MobileAccountMenu").default;

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
      // The menu's popup positioning registers listeners with an
      // AbortSignal; it must be jsdom's, not Node's, or jsdom's
      // addEventListener rejects it.
      "AbortController",
      "AbortSignal",
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
    MobileAccountMenu = (await import("./MobileAccountMenu")).default;
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

  // Mirrors MobileShell: open state lives in the shell, the bell can
  // force-close, and item callbacks act after the menu closes.
  function Harness({
    canSwitchHome = true,
    calls,
  }: {
    canSwitchHome?: boolean;
    calls: string[];
  }) {
    const [open, setOpen] = React.useState(false);
    return (
      <div className="msh-avatar-wrap">
        <MobileAccountMenu
          open={open}
          onOpenChange={setOpen}
          fullName="Sarah Mitchell"
          initials="SM"
          roleLine="Administrator · Evergreen Care"
          canSwitchHome={canSwitchHome}
          onSwitchHome={() => calls.push("switch")}
          onDesktopView={() => calls.push("desktop")}
          onSignOut={() => calls.push("signout")}
        />
      </div>
    );
  }

  async function mountHarness(canSwitchHome = true) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const calls: string[] = [];
    await React.act(async () => {
      root.render(<Harness canSwitchHome={canSwitchHome} calls={calls} />);
      await settle();
    });
    const trigger = container.querySelector(".msh-avatar-button");
    assert.ok(trigger, "trigger renders");
    return { container, root, trigger: trigger as HTMLButtonElement, calls };
  }

  async function unmount(
    root: { unmount: () => void },
    container: Element,
  ) {
    await React.act(async () => root.unmount());
    container.remove();
  }

  function menuEl() {
    return document.querySelector('[role="menu"]');
  }

  function itemEls() {
    return [...document.querySelectorAll('[role="menuitem"]')];
  }

  async function click(el: Element) {
    await React.act(async () => {
      el.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await settle();
    });
  }

  async function key(el: Element, keyName: string) {
    await React.act(async () => {
      el.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: keyName,
          bubbles: true,
        }),
      );
      await settle();
    });
  }

  it("renders the trigger with house class, label, and SDK aria wiring; closed shows no menu", async () => {
    const { container, root, trigger } = await mountHarness();
    assert.equal(trigger.tagName, "BUTTON");
    assert.equal(trigger.getAttribute("aria-label"), "Account menu for Sarah Mitchell");
    assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.textContent, "SM");
    assert.equal(menuEl(), null, "no menu while closed");
    await unmount(root, container);
  });

  it("opens on trigger click with the house content: head, item buttons in order, roles wired", async () => {
    const { container, root, trigger } = await mountHarness();
    await click(trigger);
    const menu = menuEl();
    assert.ok(menu, "menu renders after the trigger click");
    assert.ok(menu.classList.contains("msh-menu"), "content keeps .msh-menu");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const head = menu.querySelector(".msh-menu-head");
    assert.ok(head, "head paragraph renders");
    assert.equal(
      head.textContent,
      "Sarah MitchellAdministrator · Evergreen Care",
    );
    const items = itemEls();
    assert.deepEqual(
      items.map((i) => i.textContent?.trim()),
      ["Switch home", "Desktop view", "Sign out"],
    );
    for (const item of items) {
      assert.equal(item.tagName, "BUTTON", "items render as buttons");
    }
    await unmount(root, container);
  });

  it("hides Switch home when there is only one home", async () => {
    const { container, root, trigger } = await mountHarness(false);
    await click(trigger);
    assert.deepEqual(
      itemEls().map((i) => i.textContent?.trim()),
      ["Desktop view", "Sign out"],
    );
    await unmount(root, container);
  });

  it("an item press closes the menu, then runs its action", async () => {
    const { container, root, trigger, calls } = await mountHarness();
    await click(trigger);
    const signOut = itemEls().find((i) => i.textContent?.includes("Sign out"));
    assert.ok(signOut);
    await click(signOut);
    assert.deepEqual(calls, ["signout"]);
    assert.equal(menuEl(), null, "menu closed after the item press");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await unmount(root, container);
  });

  it("ArrowDown opens and focuses the first item; arrows move; Enter runs the item and returns focus", async () => {
    const { container, root, trigger, calls } = await mountHarness();
    trigger.focus();
    await key(trigger, "ArrowDown");
    const items = itemEls();
    assert.equal(items.length, 3, "menu opened from the keyboard");
    assert.equal(document.activeElement, items[0], "first item focused");
    await key(items[0], "ArrowDown");
    assert.equal(document.activeElement, items[1], "arrow moved to the second item");
    await key(items[1], "Enter");
    assert.deepEqual(calls, ["desktop"]);
    assert.equal(menuEl(), null, "menu closed after Enter");
    assert.equal(
      document.activeElement,
      trigger,
      "focus returned to the trigger",
    );
    await unmount(root, container);
  });

  it("Escape closes the menu and returns focus to the trigger", async () => {
    const { container, root, trigger } = await mountHarness();
    await click(trigger);
    assert.ok(menuEl(), "menu open");
    const focused = document.activeElement as Element;
    await key(focused, "Escape");
    assert.equal(menuEl(), null, "menu closed after Escape");
    assert.equal(document.activeElement, trigger, "focus back on the trigger");
    await unmount(root, container);
  });
});
