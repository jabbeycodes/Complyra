import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import OneTimeSecret from "./OneTimeSecret";

/**
 * Slice 9 (choice chips / radio / rating) migration tests.
 *
 * Part A pins the composition patterns the migrated sites use, one per
 * selection shape in the estate:
 *  - standalone Toggle (OneTimeSecret, NotificationsPanel)
 *  - single + deselectable (Appointments status chips, MobileIsp levels,
 *    Dashboard site cards)
 *  - single + deselectable={false} (the filter rows: GerTab,
 *    PunchExceptions, MobileToday, binder pickers, MoneyEntrySheet,
 *    MobileMar, QaAuditDetail)
 *  - multiple (OpenShiftsTab + StaffingBoard day chips, MobileMessages
 *    contact rows)
 *  - derived-value single (OpenShiftsTab usual-shift presets)
 *  - RadioGroup (HmWeeklyChecklist answers, MobileScheduling picker,
 *    RecognitionPage rating — Radio chosen over the experimental Rating)
 *
 * Keyboard note: jsdom does not synthesize a click from Space/Enter key
 * events (native activation behavior), for SDK buttons exactly as for
 * the plain buttons they replaced — so presses are driven with click()
 * (what a browser fires for Space/Enter/click alike), while arrow-key
 * behavior is dispatched as real keydown events. Real-browser Space /
 * Enter presses are covered by the slice's browser QA.
 *
 * Part B renders the real OneTimeSecret (standalone Toggle in production).
 */
describe("Choice migration (slice 9)", () => {
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

  async function click(el: Element) {
    await React.act(async () => {
      (el as HTMLElement).click();
      await settle();
    });
  }

  async function keydown(el: Element, key: string) {
    await React.act(async () => {
      el.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
    });
  }

  const buttons = (container: HTMLElement) => [
    ...container.querySelectorAll("button"),
  ];

  it("A1 standalone Toggle: type=button, aria-pressed flips, site class kept", async () => {
    function Standalone() {
      const [on, setOn] = React.useState(false);
      return (
        <Toggle
          className="notif-filter-toggle"
          pressed={on}
          onPressedChange={setOn}
        >
          {on ? "Unread only (3)" : "Unread only"}
        </Toggle>
      );
    }
    const { container, root } = await mount(<Standalone />);
    const btn = buttons(container)[0];
    assert.equal(btn.tagName, "BUTTON");
    assert.equal(btn.getAttribute("type"), "button", "never submits a form");
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.equal(btn.className, "notif-filter-toggle");
    assert.equal(btn.textContent, "Unread only");
    await click(btn);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(btn.textContent, "Unread only (3)");
    await click(btn);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    await unmount(root, container);
  });

  it("A2 single deselectable: press sets, re-press clears to the empty value", async () => {
    // AppointmentsPage adapter: group [] ⇔ status "all".
    function StatusChips() {
      const [status, setStatus] = React.useState<string>("all");
      return (
        <>
          <ToggleGroup
            className="appointments-status-chips"
            aria-label="Filter by status"
            value={status === "all" ? [] : [status]}
            onValueChange={(next) => setStatus(next[0] ?? "all")}
          >
            <Toggle className="appointments-status-chip" value="scheduled">
              Scheduled
            </Toggle>
            <Toggle className="appointments-status-chip" value="completed">
              Completed
            </Toggle>
          </ToggleGroup>
          <output>{status}</output>
        </>
      );
    }
    const { container, root } = await mount(<StatusChips />);
    const [sched, done] = buttons(container);
    const out = container.querySelector("output")!;
    assert.equal(
      container.querySelector('[role="group"]')?.getAttribute("aria-label"),
      "Filter by status",
    );
    assert.equal(sched.getAttribute("aria-pressed"), "false");
    await click(sched);
    assert.equal(out.textContent, "scheduled");
    assert.equal(sched.getAttribute("aria-pressed"), "true");
    await click(done);
    assert.equal(out.textContent, "completed");
    assert.equal(sched.getAttribute("aria-pressed"), "false");
    assert.equal(done.getAttribute("aria-pressed"), "true");
    await click(done); // re-press the active chip clears, as today
    assert.equal(out.textContent, "all");
    assert.equal(done.getAttribute("aria-pressed"), "false");
    await unmount(root, container);
  });

  it("A3 single deselectable={false}: re-press is refused silently; state class composes", async () => {
    const calls: string[][] = [];
    function Filters() {
      const [filter, setFilter] = React.useState("all");
      return (
        <ToggleGroup
          className="ger-filters"
          aria-label="Filter reports"
          deselectable={false}
          value={[filter]}
          onValueChange={(next) => {
            calls.push([...next]);
            const v = next[0];
            if (v) setFilter(v);
          }}
        >
          <Toggle
            value="all"
            className={({ pressed }) => (pressed ? "chip selected" : "chip")}
          >
            All
          </Toggle>
          <Toggle
            value="review"
            className={({ pressed }) => (pressed ? "chip selected" : "chip")}
          >
            Awaiting review
          </Toggle>
        </ToggleGroup>
      );
    }
    const { container, root } = await mount(<Filters />);
    const [all, review] = buttons(container);
    assert.equal(all.className, "chip selected");
    assert.equal(review.className, "chip");
    await click(all); // re-press the current filter: nothing fires
    assert.deepEqual(calls, []);
    assert.equal(all.className, "chip selected");
    await click(review);
    assert.deepEqual(calls, [["review"]]);
    assert.equal(review.className, "chip selected");
    assert.equal(all.className, "chip");
    await unmount(root, container);
  });

  it("A3b group keyboard: one tab stop, arrows move focus only", async () => {
    function Filters() {
      const [filter, setFilter] = React.useState("all");
      return (
        <ToggleGroup
          deselectable={false}
          value={[filter]}
          onValueChange={(next) => {
            const v = next[0];
            if (v) setFilter(v);
          }}
        >
          <Toggle value="all">All</Toggle>
          <Toggle value="review">Review</Toggle>
          <Toggle value="resolved">Resolved</Toggle>
        </ToggleGroup>
      );
    }
    const { container, root } = await mount(<Filters />);
    const [all, review, resolved] = buttons(container);
    assert.deepEqual(
      buttons(container).map((b) => b.getAttribute("tabindex")),
      ["0", "-1", "-1"],
      "roving tabindex: only the pressed toggle is a tab stop",
    );
    (all as HTMLElement).focus();
    await keydown(all, "ArrowRight");
    assert.equal(document.activeElement, review, "arrow moves focus");
    assert.equal(
      all.getAttribute("aria-pressed"),
      "true",
      "arrow does not change the value",
    );
    await keydown(review, "ArrowRight");
    assert.equal(document.activeElement, resolved);
    await keydown(resolved, "ArrowRight");
    assert.equal(document.activeElement, all, "arrows wrap");
    await keydown(all, "End");
    assert.equal(document.activeElement, resolved);
    await keydown(resolved, "Home");
    assert.equal(document.activeElement, all);
    await unmount(root, container);
  });

  it("A4 multiple: independent toggles; sorted-number adapter reproduces the old toggleDay arrays", async () => {
    // StaffingBoard/OpenShiftsTab day chips: state is a sorted number[].
    const toggleDayOld = (prev: number[], d: number) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort();
    function Days() {
      const [days, setDays] = React.useState<number[]>([1, 2, 3, 4, 5]);
      return (
        <>
          <ToggleGroup
            className="hub-day-chips interactive"
            aria-label="Days of week"
            multiple
            value={days.map(String)}
            onValueChange={(next) => setDays(next.map(Number).sort())}
          >
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Toggle
                key={d}
                value={String(d)}
                className={({ pressed }) =>
                  pressed ? "hub-day-chip on" : "hub-day-chip"
                }
              >
                D{d}
              </Toggle>
            ))}
          </ToggleGroup>
          <output>{days.join(",")}</output>
        </>
      );
    }
    const { container, root } = await mount(<Days />);
    const out = container.querySelector("output")!;
    const byLabel = (label: string) =>
      buttons(container).find((b) => b.textContent === label)!;
    // Press Sat (0) then Sun (1) off then Wed (3) off, comparing each step
    // against the pre-migration toggleDay semantics on the same presses.
    let expected = [1, 2, 3, 4, 5];
    await click(byLabel("D0"));
    expected = toggleDayOld(expected, 0);
    assert.equal(out.textContent, expected.join(","));
    await click(byLabel("D1"));
    expected = toggleDayOld(expected, 1);
    assert.equal(out.textContent, expected.join(","));
    await click(byLabel("D3"));
    expected = toggleDayOld(expected, 3);
    assert.equal(out.textContent, expected.join(","));
    assert.equal(byLabel("D0").className, "hub-day-chip on");
    assert.equal(byLabel("D1").className, "hub-day-chip");
    assert.equal(byLabel("D0").getAttribute("aria-pressed"), "true");
    await unmount(root, container);
  });

  it("A5 derived value (shift presets): pressed follows the time fields; applying a preset fires once", async () => {
    const PRESETS = [
      { label: "Day", start: "06:30", end: "14:30" },
      { label: "Evening", start: "14:30", end: "22:30" },
    ];
    let applications = 0;
    function Presets() {
      const [start, setStart] = React.useState("14:30");
      const [end, setEnd] = React.useState("22:30");
      const [title, setTitle] = React.useState("");
      const active = PRESETS.find((p) => p.start === start && p.end === end);
      return (
        <>
          <ToggleGroup
            className="hub-chip-row"
            aria-label="Usual shift times"
            deselectable={false}
            value={active ? [active.label] : []}
            onValueChange={(next) => {
              const preset = PRESETS.find((p) => p.label === next[0]);
              if (!preset) return;
              applications += 1;
              setStart(preset.start);
              setEnd(preset.end);
              if (!title.trim()) setTitle(preset.label);
            }}
          >
            {PRESETS.map((p) => (
              <Toggle key={p.label} value={p.label} className="hub-chip">
                {p.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <input
            aria-label="Start time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <output>
            {start}-{end}-{title}
          </output>
        </>
      );
    }
    const { container, root } = await mount(<Presets />);
    const [day, evening] = buttons(container);
    const out = container.querySelector("output")!;
    assert.equal(evening.getAttribute("aria-pressed"), "true");
    assert.equal(day.getAttribute("aria-pressed"), "false");
    await click(evening); // re-press the matching preset: no re-apply
    assert.equal(applications, 0);
    await click(day);
    assert.equal(applications, 1);
    assert.equal(out.textContent, "06:30-14:30-Day", "preset applied + title seeded");
    // Editing the start field away from the preset un-presses it.
    const input = container.querySelector("input")!;
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "07:00");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
    assert.equal(day.getAttribute("aria-pressed"), "false");
    assert.equal(evening.getAttribute("aria-pressed"), "false");
    await unmount(root, container);
  });

  it("A6 form safety: chip + radio interactions never submit; typed input survives", async () => {
    let submits = 0;
    function MoneyForm() {
      const [kind, setKind] = React.useState("spent");
      const [answer, setAnswer] = React.useState<string | null>(null);
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submits += 1;
          }}
        >
          <input aria-label="Amount in dollars" defaultValue="" />
          <ToggleGroup
            className="mq-kinds"
            aria-label="Entry type"
            deselectable={false}
            value={[kind]}
            onValueChange={(next) => {
              const v = next[0];
              if (v) setKind(v);
            }}
          >
            <Toggle value="spent" className="mq-kind">
              Spent
            </Toggle>
            <Toggle value="received" className="mq-kind">
              Received
            </Toggle>
          </ToggleGroup>
          <RadioGroup
            className="answer-segment"
            aria-label="Answer"
            value={answer}
            onValueChange={setAnswer}
          >
            <Radio value="Y" className="answer-option">
              Y
            </Radio>
            <Radio value="N" className="answer-option">
              N
            </Radio>
          </RadioGroup>
          <output>
            {kind}/{answer ?? "-"}
          </output>
        </form>
      );
    }
    const { container, root } = await mount(<MoneyForm />);
    const input = container.querySelector("input[aria-label]") as HTMLInputElement;
    input.value = "42.50";
    const [spent, received, y, n] = buttons(container);
    for (const b of [spent, received, y, n]) {
      assert.equal(b.getAttribute("type"), "button", "chip/radio is type=button");
    }
    await click(received);
    await click(y);
    assert.equal(submits, 0, "form never submitted by chip/radio presses");
    assert.equal(input.value, "42.50", "typed amount survives chip interactions");
    assert.equal(container.querySelector("output")!.textContent, "received/Y");
    // The radios' hidden inputs carry no name, so they cannot submit either.
    const hidden = [...container.querySelectorAll('input[type="radio"]')];
    assert.ok(hidden.length > 0, "radio hidden inputs exist");
    for (const h of hidden) {
      assert.equal(h.getAttribute("name"), null, "no name → no form data");
    }
    await unmount(root, container);
  });

  it("A7 RadioGroup: radiogroup semantics, arrows move AND check, null value = nothing checked", async () => {
    function Answers() {
      const [value, setValue] = React.useState<string | null>(null);
      return (
        <>
          <RadioGroup
            className="answer-segment"
            aria-label="Answer"
            value={value}
            onValueChange={(v) => {
              if (v) setValue(v);
            }}
          >
            {(["Y", "N", "N/A"] as const).map((a) => (
              <Radio
                key={a}
                value={a}
                className={({ checked }) =>
                  checked ? "answer-option selected" : "answer-option"
                }
              >
                {a}
              </Radio>
            ))}
          </RadioGroup>
          <output>{value ?? "none"}</output>
        </>
      );
    }
    const { container, root } = await mount(<Answers />);
    const group = container.querySelector('[role="radiogroup"]')!;
    assert.equal(group.getAttribute("aria-label"), "Answer");
    assert.equal(group.className, "answer-segment");
    const [y, n, na] = buttons(container);
    const out = container.querySelector("output")!;
    for (const b of [y, n, na]) {
      assert.equal(b.getAttribute("role"), "radio");
      assert.equal(b.getAttribute("aria-checked"), "false");
      assert.equal(b.getAttribute("type"), "button");
    }
    await click(n);
    assert.equal(out.textContent, "N");
    assert.equal(n.getAttribute("aria-checked"), "true");
    assert.equal(n.className, "answer-option selected");
    assert.equal(y.className, "answer-option");
    // Arrow from the checked radio moves focus and checks the next one.
    (n as HTMLElement).focus();
    await keydown(n, "ArrowRight");
    assert.equal(document.activeElement, na);
    assert.equal(out.textContent, "N/A");
    assert.equal(na.getAttribute("aria-checked"), "true");
    await keydown(na, "ArrowLeft");
    assert.equal(out.textContent, "N");
    await unmount(root, container);
  });

  it("A7b disabled RadioGroup: radios report aria-disabled/data-disabled and ignore presses", async () => {
    const changes: (string | null)[] = [];
    const { container, root } = await mount(
      <RadioGroup
        className="answer-segment"
        aria-label="Answer"
        value="Y"
        disabled
        onValueChange={(v) => changes.push(v)}
      >
        <Radio value="Y" className="answer-option">
          Y
        </Radio>
        <Radio value="N" className="answer-option">
          N
        </Radio>
      </RadioGroup>,
    );
    const [y, n] = buttons(container);
    for (const b of [y, n]) {
      assert.equal(b.getAttribute("aria-disabled"), "true");
      assert.ok(b.hasAttribute("data-disabled"), "data-disabled present (CSS parity hook)");
      assert.equal(
        b.getAttribute("disabled"),
        null,
        "SDK radios disable via aria-disabled, not the disabled attribute",
      );
    }
    await click(n);
    assert.deepEqual(changes, [], "disabled group ignores presses");
    assert.equal(y.getAttribute("aria-checked"), "true");
    await unmount(root, container);
  });

  it("A8 disabled ToggleGroup (QA score row while busy): presses ignored, aria-disabled reported", async () => {
    const calls: string[][] = [];
    const { container, root } = await mount(
      <ToggleGroup
        className="qa-score-row"
        aria-label="Score this item"
        deselectable={false}
        disabled
        value={["yes"]}
        onValueChange={(next) => calls.push([...next])}
      >
        <Toggle value="yes" className="qa-score-btn active">
          Yes
        </Toggle>
        <Toggle value="no" className="qa-score-btn qa-score-btn--no">
          No
        </Toggle>
      </ToggleGroup>,
    );
    const [yes, no] = buttons(container);
    assert.equal(yes.getAttribute("aria-disabled"), "true");
    assert.equal(no.getAttribute("aria-disabled"), "true");
    await click(no);
    assert.deepEqual(calls, []);
    assert.equal(yes.getAttribute("aria-pressed"), "true");
    await unmount(root, container);
  });

  it("A9 RadioGroup rich rows: site-rendered children (warning + Selected tag) ride along", async () => {
    function Picker() {
      const [picked, setPicked] = React.useState("u1");
      const picks = [
        { id: "u1", label: "Alex Morgan", warn: "" },
        { id: "u2", label: "Casey Adams", warn: "Overlaps another shift" },
      ];
      return (
        <RadioGroup
          className="msh-list"
          aria-label="Who is working"
          value={picked === "" ? null : picked}
          onValueChange={(v) => setPicked(v ?? "")}
        >
          {picks.map((pick) => {
            const selected = picked === pick.id;
            return (
              <Radio
                key={pick.id}
                value={pick.id}
                className={({ checked }) =>
                  `msh-row msh-sched-pick${checked ? " selected" : ""}`
                }
              >
                <span className="msh-row-main">
                  <strong>{pick.label}</strong>
                  {pick.warn && <small className="msh-sched-warn">{pick.warn}</small>}
                </span>
                {selected && <span className="msh-current">Selected</span>}
              </Radio>
            );
          })}
        </RadioGroup>
      );
    }
    const { container, root } = await mount(<Picker />);
    const [u1, u2] = buttons(container);
    assert.equal(u1.className, "msh-row msh-sched-pick selected");
    assert.ok((u1.textContent ?? "").includes("Selected"));
    assert.ok((u2.textContent ?? "").includes("Overlaps another shift"));
    await click(u2);
    assert.equal(u2.className, "msh-row msh-sched-pick selected");
    assert.ok((u2.textContent ?? "").includes("Selected"));
    assert.ok(!(u1.textContent ?? "").includes("Selected"));
    await unmount(root, container);
  });

  it("B1 real OneTimeSecret: masked by default, Toggle reveals and re-masks", async () => {
    const { container, root } = await mount(
      <OneTimeSecret value="temp-pass-123" />,
    );
    const toggle = buttons(container).find((b) =>
      /Show|Hide/.test(b.textContent ?? ""),
    )!;
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    assert.ok((toggle.textContent ?? "").includes("Show"));
    assert.ok(!(container.textContent ?? "").includes("temp-pass-123"), "masked");
    await click(toggle);
    assert.equal(toggle.getAttribute("aria-pressed"), "true");
    assert.ok((toggle.textContent ?? "").includes("Hide"));
    assert.ok((container.textContent ?? "").includes("temp-pass-123"), "revealed");
    await click(toggle);
    assert.ok(!(container.textContent ?? "").includes("temp-pass-123"), "re-masked");
    await unmount(root, container);
  });
});
