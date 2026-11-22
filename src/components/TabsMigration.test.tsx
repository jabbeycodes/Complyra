import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import type { IndividualProfile } from "../data/planStack";
import type { SessionUser } from "../data/types";

/**
 * Slice 7 (Tabs) migration tests.
 *
 * Part A pins the composition patterns every migrated site uses:
 * controlled Tabs + className-as-function skins (the `selected`/`active`
 * classes the platform CSS keys off), custom ids, panel unmount
 * semantics, panel-less (filter/chooser) composition, external
 * controlled activation (the Employee Hub deep-link / jump pattern),
 * and the form-state contract: state held OUTSIDE the panels survives a
 * tab switch; state held INSIDE a panel resets because the panel
 * unmounts — exactly what the pre-migration conditional renders did.
 *
 * Part B renders the real HealthCard (plain props): tab/panel id and
 * aria wiring, and the allergy-draft parity proof — the editing flag
 * lives in HealthCard (survives a tab round trip) while the AllergyForm
 * draft rows live inside the panel (reset on return), identical to the
 * pre-migration behavior.
 *
 * Part C renders the real HealthTrackSection: 12 tracker tabs sharing
 * ONE panel id (`health-track-panel`, asserted by
 * tests/chart-tabs.spec.ts), the panel's aria-labelledby tracking the
 * active tab, and the form-reset contract — switching trackers clears
 * the entry form's details/note (the reset moved from the click handler
 * into onValueChange, so keyboard selection resets too) while the
 * occurred-on date, which the old click handler never reset, persists.
 */
describe("Tabs migration (slice 7)", () => {
  let dom: JSDOM;
  let createRoot: typeof import("react-dom/client").createRoot;
  let DataContext: typeof import("../data/DataProvider").DataContext;
  let HealthCard: typeof import("../features/HealthCard").default;
  let HealthTrackSection: typeof import("../features/healthTrack/HealthTrackSection").default;

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
    // The SDK's positioning watcher constructs jsdom's AbortController /
    // AbortSignal internally; expose them as globals like slice 6 did.
    setGlobal("AbortController", dom.window.AbortController);
    setGlobal("AbortSignal", dom.window.AbortSignal);
    if (typeof dom.window.matchMedia !== "function") {
      setGlobal(
        "matchMedia",
        (query: string) => ({
          matches: false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }),
      );
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
    ({ DataContext } = await import("../data/DataProvider"));
    HealthCard = (await import("../features/HealthCard")).default;
    HealthTrackSection = (
      await import("../features/healthTrack/HealthTrackSection")
    ).default;
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

  async function unmount(root: { unmount: () => void }, container: HTMLElement) {
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

  async function key(el: Element, keyName: string) {
    await React.act(async () => {
      el.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: keyName,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
    });
  }

  async function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await React.act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
  }

  /* ------------------------------ Part A ------------------------------ */

  function PanelInput() {
    const [value, setValue] = React.useState("");
    return (
      <input
        data-panel-input
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }

  function PanelHarness({ initial = "a" }: { initial?: string }) {
    const [tab, setTab] = React.useState(initial);
    return (
      <div>
        <button type="button" data-jump onClick={() => setTab("c")}>
          jump to c
        </button>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value !== null) setTab(value);
          }}
        >
          <TabsList className="tabs skin" aria-label="Harness sections">
            {["a", "b", "c"].map((v) => (
              <TabsTab
                key={v}
                id={`h-tab-${v}`}
                value={v}
                className={({ selected }) => (selected ? "selected" : "")}
              >
                Tab {v}
              </TabsTab>
            ))}
          </TabsList>
          {["a", "b", "c"].map((v) => (
            <TabsPanel key={v} id={`h-panel-${v}`} value={v}>
              {v === "a" ? <PanelInput /> : <p>Panel {v}</p>}
            </TabsPanel>
          ))}
        </Tabs>
        <label>
          Shared
          <input data-shared />
        </label>
      </div>
    );
  }

  it("panel composition: ids, aria wiring, selected class, roving tabindex", async () => {
    const { container, root } = await mount(<PanelHarness />);
    const tabA = container.querySelector("#h-tab-a") as HTMLButtonElement;
    const tabB = container.querySelector("#h-tab-b") as HTMLButtonElement;
    assert.equal(tabA.getAttribute("aria-selected"), "true");
    assert.equal(tabA.className, "selected");
    assert.equal(tabA.tabIndex, 0);
    assert.equal(tabB.getAttribute("aria-selected"), "false");
    assert.equal(tabB.className, "");
    assert.equal(tabB.tabIndex, -1);
    assert.equal(tabA.getAttribute("aria-controls"), "h-panel-a");
    // The SDK wires aria-controls only to the panel that is actually
    // mounted; an unselected tab's panel is not in the DOM, so the
    // attribute is omitted rather than pointing at a nonexistent id.
    assert.equal(tabB.getAttribute("aria-controls"), null);
    const panelA = container.querySelector("#h-panel-a");
    assert.ok(panelA, "selected panel mounted");
    assert.equal(panelA?.getAttribute("aria-labelledby"), "h-tab-a");
    assert.equal(container.querySelector("#h-panel-b"), null, "unselected panel unmounted");
    await unmount(root, container);
  });

  it("panel composition: click switches and unmounts the previous panel", async () => {
    const { container, root } = await mount(<PanelHarness />);
    await click(container.querySelector("#h-tab-b")!);
    assert.equal(
      (container.querySelector("#h-tab-b") as HTMLElement).getAttribute("aria-selected"),
      "true",
    );
    assert.equal(container.querySelector("#h-panel-a"), null);
    assert.ok(container.querySelector("#h-panel-b"));
    assert.equal(
      (container.querySelector("#h-tab-b") as HTMLElement).getAttribute("aria-controls"),
      "h-panel-b",
      "aria-controls follows the mounted panel",
    );
    assert.equal(
      (container.querySelector("#h-tab-a") as HTMLElement).getAttribute("aria-controls"),
      null,
    );
    await unmount(root, container);
  });

  it("panel composition: APG keyboard — arrows wrap, Home/End, focus follows", async () => {
    const { container, root } = await mount(<PanelHarness />);
    const tabA = container.querySelector("#h-tab-a") as HTMLButtonElement;
    tabA.focus();
    await key(tabA, "ArrowRight");
    const tabB = container.querySelector("#h-tab-b") as HTMLButtonElement;
    assert.equal(tabB.getAttribute("aria-selected"), "true");
    assert.equal(document.activeElement, tabB);
    await key(tabB, "ArrowRight");
    const tabC = container.querySelector("#h-tab-c") as HTMLButtonElement;
    assert.equal(tabC.getAttribute("aria-selected"), "true");
    await key(tabC, "ArrowRight");
    assert.equal(tabA.getAttribute("aria-selected"), "true", "ArrowRight wraps to first");
    await key(tabA, "ArrowLeft");
    assert.equal(tabC.getAttribute("aria-selected"), "true", "ArrowLeft wraps to last");
    await key(tabC, "Home");
    assert.equal(tabA.getAttribute("aria-selected"), "true");
    await key(tabA, "End");
    assert.equal(tabC.getAttribute("aria-selected"), "true");
    await unmount(root, container);
  });

  it("controlled activation from outside (hub deep-link / jump pattern)", async () => {
    const { container, root } = await mount(<PanelHarness initial="b" />);
    assert.equal(
      (container.querySelector("#h-tab-b") as HTMLElement).getAttribute("aria-selected"),
      "true",
      "initial value from props selects on mount",
    );
    await click(container.querySelector("[data-jump]")!);
    assert.equal(
      (container.querySelector("#h-tab-c") as HTMLElement).getAttribute("aria-selected"),
      "true",
      "external setState switches the tab",
    );
    assert.ok(container.querySelector("#h-panel-c"));
    await unmount(root, container);
  });

  it("form-state contract: outside state survives, panel state resets on unmount", async () => {
    const { container, root } = await mount(<PanelHarness />);
    const shared = container.querySelector("[data-shared]") as HTMLInputElement;
    await type(shared, "keep me");
    const panelInput = container.querySelector(
      "[data-panel-input]",
    ) as HTMLInputElement;
    await type(panelInput, "draft");
    assert.equal(panelInput.value, "draft");
    await click(container.querySelector("#h-tab-b")!);
    await click(container.querySelector("#h-tab-a")!);
    assert.equal(shared.value, "keep me", "state outside panels survives");
    const remounted = container.querySelector(
      "[data-panel-input]",
    ) as HTMLInputElement;
    assert.equal(remounted.value, "", "panel remounted fresh — draft gone, as before");
    await unmount(root, container);
  });

  function ListOnlyHarness() {
    const [mode, setMode] = React.useState("upload");
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (value !== null) setMode(value);
          }}
        >
          <TabsList className="choice-row" aria-label="Modes">
            <TabsTab
              value="upload"
              className={({ selected }) =>
                `choice-card${selected ? " active" : ""}`
              }
            >
              Upload
            </TabsTab>
            <TabsTab
              value="manual"
              className={({ selected }) =>
                `choice-card${selected ? " active" : ""}`
              }
            >
              Manual
            </TabsTab>
          </TabsList>
        </Tabs>
        <p data-mode>{mode}</p>
      </form>
    );
  }

  it("panel-less composition: no aria-controls, no panels, form-safe buttons", async () => {
    const { container, root } = await mount(<ListOnlyHarness />);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    assert.equal(tabs.length, 2);
    for (const tab of tabs) {
      assert.equal(tab.getAttribute("aria-controls"), null);
      assert.equal((tab as HTMLButtonElement).type, "button");
    }
    assert.equal(container.querySelector('[role="tabpanel"]'), null);
    assert.equal(tabs[0].className, "choice-card active");
    assert.equal(tabs[1].className, "choice-card");
    await key(tabs[0], "ArrowRight");
    assert.equal(container.querySelector("[data-mode]")?.textContent, "manual");
    assert.equal(tabs[1].className, "choice-card active");
    await unmount(root, container);
  });

  /* ------------------------------ Part B ------------------------------ */

  const profile = {
    legalName: "Test Person",
    allergies: [],
    allergiesStamp: null,
  } as unknown as IndividualProfile;

  function healthCardElement() {
    return (
      <HealthCard
        individualName="Test Person"
        defaultVisitAddress="1 Main St"
        appointments={[]}
        profile={profile}
        canManage
        canComplete={false}
        onCreate={async () => {}}
        onUpdate={async () => {}}
        onDelete={async () => {}}
        onGenerate={async () => {}}
        onComplete={async () => {}}
        onOpenConsultation={async () => {}}
        onSaveAllergies={async () => {}}
      />
    );
  }

  it("HealthCard: tab/panel ids and aria wiring survive the migration", async () => {
    const { container, root } = await mount(healthCardElement());
    const list = container.querySelector('[role="tablist"]');
    assert.equal(list?.getAttribute("aria-label"), "Health sections");
    assert.ok(list?.classList.contains("health-tabs"));
    const overview = container.querySelector("#health-tab-overview");
    const appointments = container.querySelector("#health-tab-appointments");
    assert.equal(overview?.getAttribute("aria-controls"), "health-panel-overview");
    assert.equal(
      appointments?.getAttribute("aria-controls"),
      null,
      "unselected tab: panel not mounted, aria-controls omitted by the SDK",
    );
    assert.equal(overview?.className, "selected");
    const panel = container.querySelector("#health-panel-overview");
    assert.equal(panel?.getAttribute("aria-labelledby"), "health-tab-overview");
    assert.equal(container.querySelector("#health-panel-appointments"), null);
    await click(appointments!);
    assert.equal(container.querySelector("#health-panel-overview"), null);
    assert.ok(container.querySelector("#health-panel-appointments"));
    assert.equal(
      appointments?.getAttribute("aria-controls"),
      "health-panel-appointments",
      "aria-controls lands once the panel mounts",
    );
    assert.equal(appointments?.className, "selected");
    await unmount(root, container);
  });

  it("HealthCard: allergy draft parity — editing flag survives, draft rows reset", async () => {
    const { container, root } = await mount(healthCardElement());
    const editButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Edit allergies"),
    );
    assert.ok(editButton, "edit button present");
    await click(editButton!);
    const allergen = container.querySelector(
      ".allergy-row input",
    ) as HTMLInputElement;
    assert.ok(allergen, "allergy form mounted");
    await type(allergen, "Peanuts");
    assert.equal(allergen.value, "Peanuts");
    await click(container.querySelector("#health-tab-appointments")!);
    await click(container.querySelector("#health-tab-overview")!);
    const remounted = container.querySelector(
      ".allergy-row input",
    ) as HTMLInputElement;
    assert.ok(remounted, "still in editing mode — HealthCard state survived");
    assert.equal(remounted.value, "", "draft rows reset on remount — as before");
    await unmount(root, container);
  });

  /* ------------------------------ Part C ------------------------------ */

  const session = {
    userId: "u-hm",
    agencyId: "a1",
    roleKey: "house_manager",
    name: "Hollis Manager",
    permissions: { "individuals.view": true, "health.record": true },
  } as unknown as SessionUser;

  function stubApi() {
    const known: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      listHealthTrackEntries: async () => [],
    };
    return new Proxy(known, {
      get: (target, prop: string) =>
        target[prop] ?? (async () => []),
    }) as unknown as import("../data/localApi").ComplyraApi;
  }

  async function mountHealthTrack() {
    const element = (
      <DataContext.Provider
        value={
          {
            api: stubApi(),
            session,
            workspace: null,
            loading: false,
            loadStalled: false,
            error: "",
            usingHostedBackend: false,
            signIn: async () => {},
            changePassword: async () => {},
            signOut: async () => {},
            refresh: async () => {},
          } as never
        }
      >
        <HealthTrackSection individualId="i1" individualName="Test Person" />
      </DataContext.Provider>
    );
    return mount(element);
  }

  it("HealthTrack: 12 tabs share one panel id; labelledby tracks the active tab", async () => {
    const { container, root } = await mountHealthTrack();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    assert.equal(tabs.length, 12);
    // Every tab's panel uses the one shared id; the SDK puts
    // aria-controls on the tab whose panel is mounted (the selected
    // one) — the panel itself always carries the shared id, which is
    // what tests/chart-tabs.spec.ts asserts.
    for (const tab of tabs) {
      const expected =
        tab.getAttribute("aria-selected") === "true"
          ? "health-track-panel"
          : null;
      assert.equal(tab.getAttribute("aria-controls"), expected);
    }
    const panels = container.querySelectorAll('[role="tabpanel"]');
    assert.equal(panels.length, 1, "exactly one panel in the DOM");
    assert.equal(panels[0].id, "health-track-panel");
    assert.equal(
      panels[0].getAttribute("aria-labelledby"),
      "health-track-tab-immunization",
    );
    await click(container.querySelector("#health-track-tab-sleep")!);
    const after = container.querySelectorAll('[role="tabpanel"]');
    assert.equal(after.length, 1);
    assert.equal(after[0].id, "health-track-panel");
    assert.equal(
      after[0].getAttribute("aria-labelledby"),
      "health-track-tab-sleep",
    );
    assert.equal(
      container
        .querySelector("#health-track-tab-sleep")
        ?.getAttribute("aria-controls"),
      "health-track-panel",
    );
    await unmount(root, container);
  });

  it("HealthTrack: switching trackers resets the entry form (note), keeps the date", async () => {
    const { container, root } = await mountHealthTrack();
    const form = container.querySelector(".health-track-form");
    assert.ok(form, "record form present");
    const noteLabel = Array.from(form!.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === "Note",
    );
    const note = noteLabel?.querySelector("input") as HTMLInputElement;
    assert.ok(note, "note input present");
    await type(note, "draft note");
    assert.equal(note.value, "draft note");
    const date = form!.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    await type(date, "2026-01-15");
    await click(container.querySelector("#health-track-tab-sleep")!);
    await click(container.querySelector("#health-track-tab-immunization")!);
    const formAfter = container.querySelector(".health-track-form");
    const noteAfter = Array.from(formAfter!.querySelectorAll("label"))
      .find((l) => l.textContent?.trim() === "Note")
      ?.querySelector("input") as HTMLInputElement;
    assert.equal(noteAfter.value, "", "note reset by the tab switch — as before");
    const dateAfter = formAfter!.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    assert.equal(dateAfter.value, "2026-01-15", "occurred-on date was never reset");
    await unmount(root, container);
  });

  it("HealthTrack: keyboard selection also resets the form (reset lives in onValueChange)", async () => {
    const { container, root } = await mountHealthTrack();
    const form = container.querySelector(".health-track-form");
    const note = Array.from(form!.querySelectorAll("label"))
      .find((l) => l.textContent?.trim() === "Note")
      ?.querySelector("input") as HTMLInputElement;
    await type(note, "keyboard draft");
    const first = container.querySelector(
      "#health-track-tab-immunization",
    ) as HTMLButtonElement;
    first.focus();
    await key(first, "ArrowRight");
    const second = container.querySelector(
      "#health-track-tab-lab",
    ) as HTMLButtonElement;
    assert.equal(second.getAttribute("aria-selected"), "true");
    await key(second, "ArrowLeft");
    assert.equal(first.getAttribute("aria-selected"), "true");
    const noteAfter = Array.from(
      container.querySelectorAll(".health-track-form label"),
    )
      .find((l) => l.textContent?.trim() === "Note")
      ?.querySelector("input") as HTMLInputElement;
    assert.equal(noteAfter.value, "", "keyboard-driven switch reset the note too");
    await unmount(root, container);
  });
});
