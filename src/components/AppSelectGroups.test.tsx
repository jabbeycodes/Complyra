import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { AppSelect, type AppSelectEntry } from "./AppSelect";

/**
 * Slice 11c: AppSelect grouped options — the SDK rendering of a native
 * <optgroup>, added for MobileMar's Record type select (the app's only
 * optgroup). Pins: the trigger resolves a grouped item's label before
 * the list opens; the open list renders the groups in order with their
 * labels as non-option heading rows; picking an item in any group
 * commits its value exactly once and closes — including inside a
 * wrapping <label> (the mobile .msh-field pattern, under the slice-11b
 * label-forwarding fix); keyboard traversal crosses group boundaries;
 * flat and grouped entries interleave in order; the form contract
 * (name submits through the hidden input) holds for grouped values.
 */

const GROUPS: AppSelectEntry[] = [
  {
    label: "Dose marks",
    options: [
      { value: "given", label: "Given" },
      { value: "missed", label: "Missed" },
      { value: "loa", label: "LOA" },
      { value: "on_hold", label: "On hold" },
    ],
  },
  {
    label: "Exceptions",
    options: [
      { value: "refused", label: "Refused" },
      { value: "held", label: "Held" },
      { value: "wasted", label: "Wasted" },
    ],
  },
];

function GroupHarness({
  changes,
  initial = "given",
  options = GROUPS,
  name,
  inLabel,
  inForm,
}: {
  changes?: string[];
  initial?: string;
  options?: AppSelectEntry[];
  name?: string;
  inLabel?: boolean;
  inForm?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  const control = (
    <AppSelect
      value={value}
      onChange={(next) => {
        changes?.push(next);
        setValue(next);
      }}
      options={options}
      name={name}
    />
  );
  return (
    <>
      {inLabel ? (
        <label className="msh-field">
          <span>Record type</span>
          {control}
        </label>
      ) : inForm ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {control}
          <button type="submit">Save</button>
        </form>
      ) : (
        control
      )}
      <output>{value}</output>
    </>
  );
}

describe("AppSelect grouped options (slice 11c)", () => {
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
    const triggerEl = container.querySelector('[data-slot="select-trigger"]');
    if (triggerEl?.getAttribute("aria-expanded") === "true") {
      await React.act(async () => {
        triggerEl.dispatchEvent(
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

  async function click(el: Element) {
    await React.act(async () => {
      (el as HTMLElement).click();
      await settle();
    });
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

  const trigger = (c: HTMLElement) =>
    c.querySelector('[data-slot="select-trigger"]')!;
  const items = (c: HTMLElement) => [
    ...c.querySelectorAll('[data-slot="select-item"]'),
  ];
  // The popup's visible rows in DOM order: group headings + options.
  const rows = (c: HTMLElement) =>
    [
      ...c.querySelectorAll(
        '[data-slot="select-group-label"], [data-slot="select-item"]',
      ),
    ].map((el) => el.textContent);

  it("trigger resolves a grouped value's label before opening; no native select/optgroup", async () => {
    const { container, root } = await mount(
      <GroupHarness initial="refused" />,
    );
    const t = trigger(container);
    assert.equal(t.getAttribute("role"), "combobox");
    assert.ok(
      t.textContent?.includes("Refused"),
      "closed trigger shows the grouped item's label",
    );
    assert.equal(container.querySelector("select"), null);
    assert.equal(container.querySelector("optgroup"), null);
    await unmount(root, container);
  });

  it("open list renders both groups in order, headings are not options", async () => {
    const { container, root } = await mount(<GroupHarness />);
    await click(trigger(container));
    assert.equal(trigger(container).getAttribute("aria-expanded"), "true");
    assert.deepEqual(rows(container), [
      "Dose marks",
      "Given",
      "Missed",
      "LOA",
      "On hold",
      "Exceptions",
      "Refused",
      "Held",
      "Wasted",
    ]);
    assert.equal(items(container).length, 7, "only real items are options");
    for (const el of items(container)) {
      assert.equal(el.getAttribute("role"), "option");
    }
    const heading = container.querySelector(".app-select-group-label")!;
    assert.notEqual(heading.getAttribute("role"), "option");
    await unmount(root, container);
  });

  it("picking an item in the second group commits once and closes, inside a wrapping label", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(
      <GroupHarness changes={changes} inLabel />,
    );
    await click(trigger(container));
    await click(items(container).find((el) => el.textContent === "Refused")!);
    assert.deepEqual(changes, ["refused"], "exactly one commit");
    assert.equal(container.querySelector("output")!.textContent, "refused");
    assert.equal(
      trigger(container).getAttribute("aria-expanded"),
      "false",
      "the label must not forward the pick into a reopen",
    );
    assert.ok(trigger(container).textContent?.includes("Refused"));
    await unmount(root, container);
  });

  it("keyboard: arrows cross the group boundary, Enter commits", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<GroupHarness changes={changes} />);
    const t = trigger(container) as HTMLElement;
    const activeKey = async (key: string) => {
      await React.act(async () => {
        const target = document.activeElement as Element;
        keydown(target, key);
        target.dispatchEvent(
          new dom.window.KeyboardEvent("keyup", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
        await settle();
      });
    };
    await React.act(async () => {
      t.focus();
      keydown(t, "ArrowDown");
      await settle();
    });
    assert.equal(t.getAttribute("aria-expanded"), "true");
    // From "Given" (selected): four steps cross "Dose marks" into
    // "Exceptions" and land on "Refused".
    await activeKey("ArrowDown");
    await activeKey("ArrowDown");
    await activeKey("ArrowDown");
    await activeKey("ArrowDown");
    const highlighted = container.querySelector("[data-highlighted]");
    assert.equal(highlighted?.textContent, "Refused");
    await activeKey("Enter");
    assert.deepEqual(changes, ["refused"]);
    assert.equal(t.getAttribute("aria-expanded"), "false");
    await unmount(root, container);
  });

  it("flat and grouped entries interleave in order", async () => {
    const mixed: AppSelectEntry[] = [
      { value: "none", label: "No mark" },
      GROUPS[0],
      { value: "other", label: "Other" },
    ];
    const { container, root } = await mount(
      <GroupHarness initial="none" options={mixed} />,
    );
    await click(trigger(container));
    assert.deepEqual(rows(container), [
      "No mark",
      "Dose marks",
      "Given",
      "Missed",
      "LOA",
      "On hold",
      "Other",
    ]);
    await unmount(root, container);
  });

  it("form contract: a grouped value submits through the hidden input", async () => {
    const { container, root } = await mount(
      <GroupHarness name="recordType" inForm />,
    );
    const form = container.querySelector("form")!;
    await click(trigger(container));
    await click(items(container).find((el) => el.textContent === "Wasted")!);
    assert.equal(new dom.window.FormData(form).get("recordType"), "wasted");
    await unmount(root, container);
  });
});
