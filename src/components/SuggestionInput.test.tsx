import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { SuggestionInput } from "./SuggestionInput";

/**
 * Slice 10: the four native <datalist> fields (Appointments individual
 * filter, Behavior entry, House Card location, Personal Spending location)
 * now render through SuggestionInput on the SDK Autocomplete. The typed
 * text is the value at every site; these tests pin the wrapper's contract:
 * the label keeps its shape, the input keeps its attributes, suggestions
 * open on focus, filtering hides non-matches, Enter/click fill without
 * submitting, Escape closes and keeps the text.
 */

const NAMES = ["Ellis Hart", "Morgan Pruitt", "Harper Soto", "Reese Lang"];

function Harness({
  suggestions = NAMES,
  required,
  inForm,
  onSubmitForm,
  changes,
}: {
  suggestions?: string[];
  required?: boolean;
  inForm?: boolean;
  onSubmitForm?: () => void;
  changes?: string[];
}) {
  const [value, setValue] = React.useState("");
  const field = (
    <label>
      <span>Location</span>
      <SuggestionInput
        value={value}
        onChange={(next) => {
          changes?.push(next);
          setValue(next);
        }}
        suggestions={suggestions}
        type="search"
        placeholder="All Individuals"
        ariaLabel="Filter by individual"
        autoComplete="off"
        required={required}
      />
    </label>
  );
  if (!inForm) return field;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitForm?.();
      }}
    >
      {field}
      <button type="submit">Save</button>
    </form>
  );
}

describe("SuggestionInput (slice 10 datalist migration)", () => {
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
    // Close any open popup first: a popup left open keeps the SDK's
    // positioning loop alive and the test process never exits.
    const input = container.querySelector("input");
    if (input) {
      await React.act(async () => {
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await settle();
      });
    }
    await React.act(async () => {
      root.unmount();
      await settle();
    });
    container.remove();
  }

  function keydown(el: Element, key: string) {
    const event = new dom.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event;
  }

  async function type(input: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    for (const ch of text) {
      await React.act(async () => {
        setter?.call(input, input.value + ch);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        await settle();
      });
    }
  }

  const items = (container: HTMLElement) => [
    ...container.querySelectorAll('[data-slot="autocomplete-item"]'),
  ];
  const visibleItems = (container: HTMLElement) =>
    items(container).filter((el) => !el.hasAttribute("hidden"));
  const open = (container: HTMLElement) =>
    !!container.querySelector('[data-slot="autocomplete-content"]');

  it("label shape + input attributes survive; no datalist remains", async () => {
    const { container, root } = await mount(<Harness required />);
    const label = container.querySelector("label")!;
    assert.deepEqual(
      [...label.children].map((c) => c.tagName),
      ["SPAN", "INPUT"],
      "the Autocomplete root renders no element of its own",
    );
    const input = container.querySelector("input")!;
    assert.equal(input.getAttribute("type"), "search");
    assert.equal(input.getAttribute("placeholder"), "All Individuals");
    assert.equal(input.getAttribute("aria-label"), "Filter by individual");
    assert.equal(input.getAttribute("autocomplete"), "off");
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(input.getAttribute("aria-autocomplete"), "list");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(input.required, true, "required reaches the input");
    assert.equal(input.hasAttribute("list"), false);
    assert.equal(container.querySelector("datalist"), null);
    await unmount(root, container);
  });

  it("focus opens the suggestions; duplicate strings render once", async () => {
    const { container, root } = await mount(
      <Harness suggestions={["Walmart", "Walmart", "CVS"]} />,
    );
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    assert.equal(open(container), true);
    assert.deepEqual(
      visibleItems(container).map((el) => el.textContent),
      ["Walmart", "CVS"],
    );
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(
      input.getAttribute("aria-controls"),
      container.querySelector('[data-slot="autocomplete-list"]')!.id,
    );
    await unmount(root, container);
  });

  it("typing filters by substring and reports every keystroke", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<Harness changes={changes} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "ar");
    assert.deepEqual(changes, ["a", "ar"]);
    assert.deepEqual(
      visibleItems(container).map((el) => el.textContent),
      ["Ellis Hart", "Harper Soto"],
    );
    assert.deepEqual(
      items(container)
        .filter((el) => el.hasAttribute("hidden"))
        .map((el) => el.textContent),
      ["Morgan Pruitt", "Reese Lang"],
    );
    await unmount(root, container);
  });

  it("ArrowDown + Enter fills the highlighted suggestion and closes", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<Harness changes={changes} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "ar");
    await React.act(async () => {
      keydown(input, "ArrowDown");
      await settle();
    });
    const highlighted = container.querySelector("[data-highlighted]");
    assert.equal(highlighted?.textContent, "Ellis Hart");
    assert.equal(
      input.getAttribute("aria-activedescendant"),
      highlighted?.id,
    );
    await React.act(async () => {
      keydown(input, "Enter");
      await settle();
    });
    assert.equal(input.value, "Ellis Hart");
    assert.equal(changes.at(-1), "Ellis Hart");
    assert.equal(open(container), false);
    await unmount(root, container);
  });

  it("Escape closes the list and keeps the typed text", async () => {
    const { container, root } = await mount(<Harness />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "Morgan");
    assert.equal(open(container), true);
    await React.act(async () => {
      keydown(input, "Escape");
      await settle();
    });
    assert.equal(open(container), false);
    assert.equal(input.value, "Morgan");
    await unmount(root, container);
  });

  it("clicking a suggestion fills it, closes, and keeps focus in the input", async () => {
    const { container, root } = await mount(<Harness />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    const item = visibleItems(container).find(
      (el) => el.textContent === "Harper Soto",
    )!;
    await React.act(async () => {
      for (const type of ["mousedown", "mouseup", "click"]) {
        item.dispatchEvent(
          new dom.window.MouseEvent(type, { bubbles: true, cancelable: true }),
        );
      }
      await settle();
    });
    assert.equal(input.value, "Harper Soto");
    assert.equal(open(container), false);
    assert.equal(document.activeElement, input);
    await unmount(root, container);
  });

  it("no matches: every suggestion is hidden (the popup shell shows nothing)", async () => {
    const { container, root } = await mount(<Harness />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "zzzz");
    assert.equal(items(container).length, NAMES.length);
    assert.equal(visibleItems(container).length, 0);
    await unmount(root, container);
  });

  it("in a form: Enter on a highlight fills without submitting; Enter with none is not swallowed", async () => {
    let submits = 0;
    const { container, root } = await mount(
      <Harness inForm onSubmitForm={() => submits++} />,
    );
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "ar");
    await React.act(async () => {
      keydown(input, "ArrowDown");
      await settle();
    });
    let enterEvent: KeyboardEvent;
    await React.act(async () => {
      enterEvent = keydown(input, "Enter");
      await settle();
    });
    assert.equal(input.value, "Ellis Hart", "the highlight filled the field");
    assert.equal(submits, 0, "choosing a suggestion never submits the form");
    assert.equal(
      enterEvent!.defaultPrevented,
      true,
      "the fill consumed the Enter keydown",
    );

    // Clear the field, type text with no highlight, press Enter: the SDK
    // must leave the keydown alone so the browser's implicit submission
    // can run (jsdom performs no implicit submission itself; the real
    // submit is covered by browser QA).
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await React.act(async () => {
      setter?.call(input, "");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
    await type(input, "Free text");
    await React.act(async () => {
      keydown(input, "Escape"); // close the list; nothing is highlighted
      await settle();
    });
    await React.act(async () => {
      enterEvent = keydown(input, "Enter");
      await settle();
    });
    assert.equal(enterEvent!.defaultPrevented, false);
    assert.equal(input.value, "Free text", "free text is never reverted");
    await unmount(root, container);
  });
});
