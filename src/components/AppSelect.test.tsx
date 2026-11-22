import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { AppSelect } from "./AppSelect";
import { FilterBar } from "../components";

/**
 * Slice 11 pilot: the FilterBar status select now renders through
 * AppSelect on the SDK Select. Pins: trigger naming + selected label,
 * the exact option sets (default 7, Review queue 2) in order, one
 * commit per selection with the label as the value, keyboard commit,
 * and the form contract later slices inherit (type="button" trigger,
 * name submits through the SDK's hidden input, no submit on select).
 */

const STATUSES = [
  "All statuses",
  "Compliant",
  "Due soon",
  "Upcoming",
  "Overdue",
  "Expired",
  "Pending review",
];

function SelectHarness({
  changes,
  initial = "All statuses",
  options = STATUSES,
  name,
  inForm,
  onSubmitForm,
}: {
  changes?: string[];
  initial?: string;
  options?: string[];
  name?: string;
  inForm?: boolean;
  onSubmitForm?: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const control = (
    <>
      <AppSelect
        ariaLabel="Filter by status"
        value={value}
        onChange={(next) => {
          changes?.push(next);
          setValue(next);
        }}
        options={options}
        name={name}
      />
      <output>{value}</output>
    </>
  );
  if (!inForm) return control;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitForm?.();
      }}
    >
      {control}
      <button type="submit">Save</button>
    </form>
  );
}

describe("AppSelect (slice 11 pilot)", () => {
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
    const trigger = container.querySelector('[data-slot="select-trigger"]');
    if (trigger?.getAttribute("aria-expanded") === "true") {
      await React.act(async () => {
        trigger.dispatchEvent(
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
  const options = (c: HTMLElement) => [
    ...c.querySelectorAll('[data-slot="select-item"]'),
  ];

  it("trigger is a named combobox button showing the value; no native select", async () => {
    const { container, root } = await mount(<SelectHarness />);
    const t = trigger(container);
    assert.equal(t.tagName, "BUTTON");
    assert.equal(t.getAttribute("type"), "button");
    assert.equal(t.getAttribute("role"), "combobox");
    assert.equal(t.getAttribute("aria-label"), "Filter by status");
    assert.equal(t.getAttribute("aria-expanded"), "false");
    assert.ok(t.textContent?.includes("All statuses"));
    assert.equal(container.querySelector("select"), null);
    await unmount(root, container);
  });

  it("opening lists the exact default option set in order; click commits once", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<SelectHarness changes={changes} />);
    await click(trigger(container));
    assert.equal(trigger(container).getAttribute("aria-expanded"), "true");
    assert.deepEqual(
      options(container).map((el) => el.textContent),
      STATUSES,
    );
    const overdue = options(container).find(
      (el) => el.textContent === "Overdue",
    )!;
    assert.equal(overdue.getAttribute("role"), "option");
    await click(overdue);
    assert.deepEqual(changes, ["Overdue"], "exactly one commit, label value");
    assert.equal(container.querySelector("output")!.textContent, "Overdue");
    assert.equal(trigger(container).getAttribute("aria-expanded"), "false");
    assert.ok(trigger(container).textContent?.includes("Overdue"));
    await unmount(root, container);
  });

  it("keyboard: ArrowDown opens, arrows move, Enter commits the highlight", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<SelectHarness changes={changes} />);
    const t = trigger(container) as HTMLElement;
    // The SDK moves focus into the list when it opens; keys go to the
    // focused item, as a real keyboard delivers them.
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
    await activeKey("ArrowDown");
    const highlighted = container.querySelector("[data-highlighted]");
    assert.equal(highlighted?.textContent, "Compliant");
    await activeKey("Enter");
    assert.deepEqual(changes, ["Compliant"], "Enter commits exactly once");
    assert.equal(
      container.querySelector("output")!.textContent,
      "Compliant",
    );
    assert.equal(t.getAttribute("aria-expanded"), "false");
    await unmount(root, container);
  });

  it("Escape closes without committing", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<SelectHarness changes={changes} />);
    const t = trigger(container) as HTMLElement;
    await click(t);
    assert.equal(t.getAttribute("aria-expanded"), "true");
    await React.act(async () => {
      keydown(t, "Escape");
      await settle();
    });
    assert.equal(t.getAttribute("aria-expanded"), "false");
    assert.deepEqual(changes, []);
    assert.equal(container.querySelector("output")!.textContent, "All statuses");
    await unmount(root, container);
  });

  it("real FilterBar: default and Review-queue option sets, count intact", async () => {
    function Bar({ statuses }: { statuses?: string[] }) {
      const [query, setQuery] = React.useState("");
      const [status, setStatus] = React.useState("All statuses");
      return (
        <>
          <FilterBar
            query={query}
            setQuery={setQuery}
            status={status}
            setStatus={setStatus}
            count={3}
            statuses={statuses}
          />
          <output>{status}</output>
        </>
      );
    }
    const first = await mount(<Bar />);
    assert.ok(first.container.textContent?.includes("3 results"));
    assert.equal(
      first.container.querySelector('input[aria-label="Search this list"]') instanceof
        dom.window.HTMLInputElement,
      true,
    );
    await click(trigger(first.container));
    assert.deepEqual(
      options(first.container).map((el) => el.textContent),
      STATUSES,
    );
    await unmount(first.root, first.container);

    const second = await mount(
      <Bar statuses={["All statuses", "Pending review"]} />,
    );
    await click(trigger(second.container));
    assert.deepEqual(
      options(second.container).map((el) => el.textContent),
      ["All statuses", "Pending review"],
    );
    await click(
      options(second.container).find(
        (el) => el.textContent === "Pending review",
      )!,
    );
    assert.equal(
      second.container.querySelector("output")!.textContent,
      "Pending review",
    );
    await unmount(second.root, second.container);
  });

  it("form contract: name submits the value; selecting never submits", async () => {
    let submits = 0;
    const { container, root } = await mount(
      <SelectHarness name="status" inForm onSubmitForm={() => submits++} />,
    );
    const form = container.querySelector("form")!;
    await click(trigger(container));
    await click(
      options(container).find((el) => el.textContent === "Expired")!,
    );
    assert.equal(submits, 0);
    assert.equal(new dom.window.FormData(form).get("status"), "Expired");
    await unmount(root, container);
  });
});
