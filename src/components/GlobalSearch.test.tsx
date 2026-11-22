import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import GlobalSearch from "./GlobalSearch";
import type { DirectoryHit } from "../data/search";
import type { Requirement } from "../domain";

/**
 * Slice 10b: the topbar global search now renders through GlobalSearch
 * on the SDK Command. App still owns the query, the open flag, the
 * input ref and the (pre-scoped, pre-ranked) hit lists; these tests pin
 * the wrapper's contract: the container/input keep their shape, typing
 * opens the panel, groups render in the old order with the old row
 * text, the first hit is highlighted for the keyboard, Enter and click
 * run a hit's action, Escape closes the panel and KEEPS the query
 * (the SDK would clear it — the wrapper vetoes that), and the empty
 * state keeps its sentence.
 */

const DIRECTORY: DirectoryHit[] = [
  { kind: "individual", id: "p1", name: "Ellis Hart", site: "Cedar House" },
  { kind: "individual", id: "p2", name: "Morgan Pruitt", site: "Cedar House" },
  { kind: "staff", id: "s1", name: "Alex Morgan", role: "DSP", site: "Cedar House" },
  { kind: "site", id: "h1", name: "Cedar House" },
];

const REQUIREMENTS: Requirement[] = [
  {
    id: "r1",
    title: "PCSP annual review",
    person: "Ellis Hart",
    site: "Cedar House",
    category: "Required forms",
    owner: "Sarah Mitchell",
    role: "House manager",
    due: "2026-12-01",
    status: "Overdue",
    source: "PCSP",
    page: 3,
    frequency: "Annual",
    evidence: "Signed copy",
  },
];

function Harness({
  directoryHits = DIRECTORY,
  requirementHits = REQUIREMENTS,
  events,
}: {
  directoryHits?: DirectoryHit[];
  requirementHits?: Requirement[];
  events: string[];
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // The select callbacks mirror App's: close, clear, then act.
  const act = (label: string) => {
    setOpen(false);
    setQuery("");
    events.push(label);
  };
  return (
    <div>
      <button
        type="button"
        data-outside
        onClick={() => inputRef.current?.focus()}
      >
        shortcut stand-in
      </button>
      <GlobalSearch
        inputRef={inputRef}
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        directoryHits={directoryHits}
        requirementHits={requirementHits}
        onSelectIndividual={(h) => act(`individual:${h.id}`)}
        onSelectStaff={(h) => act(`staff:${h.id}`)}
        onSelectSite={(h) => act(`site:${h.id}`)}
        onSelectRequirement={(r) => act(`requirement:${r.id}`)}
      />
      <output>{JSON.stringify({ query, open })}</output>
    </div>
  );
}

describe("GlobalSearch (slice 10b Command migration)", () => {
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

  const panel = (container: HTMLElement) =>
    container.querySelector(".search-results");
  const items = (container: HTMLElement) => [
    ...container.querySelectorAll('[data-slot="command-item"]'),
  ];
  const state = (container: HTMLElement) =>
    JSON.parse(container.querySelector("output")!.textContent!) as {
      query: string;
      open: boolean;
    };

  it("container + input keep their shape; no panel while the query is empty", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const searchRoot = container.querySelector(".global-search")!;
    assert.equal(searchRoot.getAttribute("data-slot"), "command");
    const input = container.querySelector("input")!;
    assert.equal(input.getAttribute("placeholder"), "Search anything…");
    assert.equal(
      input.getAttribute("aria-label"),
      "Search people, homes, and requirements",
    );
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(
      searchRoot.querySelector("kbd")?.textContent,
      "⌘ K",
    );
    assert.equal(panel(container), null);
    await unmount(root, container);
  });

  it("the caller's ref reaches the input (the ⌘K focus path)", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    const standIn = container.querySelector("[data-outside]")!;
    await React.act(async () => {
      (standIn as HTMLButtonElement).click();
      await settle();
    });
    assert.equal(document.activeElement, input);
    await unmount(root, container);
  });

  it("typing opens the panel; groups and rows render in the old order with the old text", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "e");
    assert.deepEqual(state(container), { query: "e", open: true });
    const results = panel(container)!;
    assert.ok(results, "panel rendered");
    assert.deepEqual(
      [...results.querySelectorAll(".search-heading")].map(
        (el) => el.textContent,
      ),
      ["Individuals", "Staff", "Homes", "Requirements and records"],
    );
    assert.deepEqual(
      items(container).map((el) => el.textContent),
      [
        "Ellis HartCedar House",
        "Morgan PruittCedar House",
        "Alex MorganDSP, Cedar House",
        "Cedar HouseHome",
        "PCSP annual reviewEllis Hart, Cedar HouseRequired forms, Overdue, due Dec 1, page 3",
      ],
    );
    for (const el of items(container)) {
      assert.equal(el.tagName, "BUTTON");
      assert.equal(el.getAttribute("type"), "button");
    }
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(
      input.getAttribute("aria-controls"),
      container.querySelector('[data-slot="command-list"]')!.id,
    );
    await unmount(root, container);
  });

  it("only the groups with hits render; the panel shows exactly the hits it was given", async () => {
    const events: string[] = [];
    const { container, root } = await mount(
      <Harness
        events={events}
        directoryHits={[DIRECTORY[3]]}
        requirementHits={[]}
      />,
    );
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "Cedar");
    assert.deepEqual(
      [...panel(container)!.querySelectorAll(".search-heading")].map(
        (el) => el.textContent,
      ),
      ["Homes"],
    );
    assert.deepEqual(
      items(container).map((el) => el.textContent),
      ["Cedar HouseHome"],
    );
    await unmount(root, container);
  });

  it("arrow keys move the highlight; Enter runs the highlighted hit and the caller closes + clears", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "e");
    const first = items(container)[0];
    assert.equal(first.hasAttribute("data-highlighted"), true);
    assert.equal(input.getAttribute("aria-activedescendant"), first.id);
    await React.act(async () => {
      keydown(input, "ArrowDown");
      await settle();
    });
    const second = items(container)[1];
    assert.equal(second.hasAttribute("data-highlighted"), true);
    assert.equal(input.getAttribute("aria-activedescendant"), second.id);
    await React.act(async () => {
      keydown(input, "Enter");
      await settle();
    });
    assert.deepEqual(events, ["individual:p2"]);
    assert.deepEqual(state(container), { query: "", open: false });
    assert.equal(panel(container), null);
    await unmount(root, container);
  });

  it("clicking a hit runs its action", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "e");
    const siteItem = items(container).find(
      (el) => el.textContent === "Cedar HouseHome",
    )!;
    await React.act(async () => {
      for (const type of ["mousedown", "mouseup", "click"]) {
        siteItem.dispatchEvent(
          new dom.window.MouseEvent(type, { bubbles: true, cancelable: true }),
        );
      }
      await settle();
    });
    assert.deepEqual(events, ["site:h1"]);
    assert.deepEqual(state(container), { query: "", open: false });
    await unmount(root, container);
  });

  it("Escape closes the panel and keeps the query; refocusing reopens with the same hits", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "Ellis");
    assert.equal(panel(container) !== null, true);
    await React.act(async () => {
      keydown(input, "Escape");
      await settle();
    });
    assert.deepEqual(state(container), { query: "Ellis", open: false });
    assert.equal(panel(container), null);
    assert.equal(input.value, "Ellis");
    await React.act(async () => {
      input.blur();
      input.focus();
      await settle();
    });
    assert.deepEqual(state(container), { query: "Ellis", open: true });
    assert.deepEqual(
      items(container).map((el) => el.textContent),
      [
        "Ellis HartCedar House",
        "Morgan PruittCedar House",
        "Alex MorganDSP, Cedar House",
        "Cedar HouseHome",
        "PCSP annual reviewEllis Hart, Cedar HouseRequired forms, Overdue, due Dec 1, page 3",
      ],
    );
    await unmount(root, container);
  });

  it("no hits: the panel carries the old empty sentence and no items", async () => {
    const events: string[] = [];
    const { container, root } = await mount(
      <Harness events={events} directoryHits={[]} requirementHits={[]} />,
    );
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "zzzz");
    const results = panel(container)!;
    assert.ok(results, "panel rendered");
    assert.equal(
      results.querySelector('[data-slot="command-empty"]')?.textContent,
      "No matching records. Try a name or site.",
    );
    assert.equal(items(container).length, 0);
    await unmount(root, container);
  });

  it("focus leaving the container closes the panel; focus inside it does not", async () => {
    const events: string[] = [];
    const { container, root } = await mount(<Harness events={events} />);
    const input = container.querySelector("input")!;
    await React.act(async () => {
      input.focus();
      await settle();
    });
    await type(input, "e");
    assert.equal(state(container).open, true);
    const outside = container.querySelector(
      "[data-outside]",
    )! as HTMLButtonElement;
    await React.act(async () => {
      outside.focus();
      await settle();
    });
    assert.equal(state(container).open, false);
    assert.equal(panel(container), null);
    await unmount(root, container);
  });
});
