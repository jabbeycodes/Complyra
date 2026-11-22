import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { AppSelect } from "../../components/AppSelect";
import { EmployeeHubShell, type HubSite, type HubStaffEntry } from "./EmployeeHubPage";
import { PunchExceptions } from "./PunchExceptions";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import type { HrPayPeriod, HrPunch } from "../../data/hr";
import type { PunchException } from "./punchInsights";

/**
 * Slice 11b (Employee Hub selects) migration tests.
 *
 * Part A pins the wrapper contract the hub depends on most: the
 * empty-string sentinel value (29 of the hub's 39 selects use "" as
 * "All / none / open"). The pilot wrapper had only proved label-as-value
 * and non-empty enum values; "" is a first-class value here — the trigger
 * renders the "" option's label (never the placeholder), aria-selected
 * lands on it, commits fire exactly once in both directions, and a named
 * instance submits "" through FormData.
 *
 * Part B drives the PunchExceptions flag editor's "Correct punch type"
 * select end to end (the demo data has no punch exceptions, so this
 * editor is unreachable in browser QA): open the flag form, pick the
 * other kind, submit, and the store receives requestedKind "in".
 *
 * Part C mounts the real Employee Hub shell on the My Timecard tab with
 * a stub store (one pay period, one punch) and drives the correction
 * editor's identical "Correct punch type" select: pick "Clock out",
 * submit, and the store receives requestedKind "out" for that punch.
 * The pay-period select's trigger label is asserted on the way.
 */
describe("Hub selects migration (slice 11b)", () => {
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
    // jsdom has no CSS.escape; the SDK's label resolution calls it.
    const cssGlobal = (globalThis as unknown as { CSS?: { escape?: (v: string) => string } }).CSS;
    if (!cssGlobal || typeof cssGlobal.escape !== "function") {
      setGlobal("CSS", {
        escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
      });
    }
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

  async function setFieldValue(el: Element, value: string) {
    await React.act(async () => {
      const proto =
        el instanceof dom.window.HTMLTextAreaElement
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
  }

  const triggerIn = (container: HTMLElement, labelText: string) =>
    [...container.querySelectorAll('[data-slot="select-trigger"]')].find((el) =>
      el.closest("label")?.textContent?.includes(labelText),
    ) as HTMLElement | undefined;

  const openItems = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-slot="select-item"]')];

  /* ------------------------------ Part A ------------------------------ */

  function EmptyValueHarness({
    changes,
    disabled,
  }: {
    changes: string[];
    disabled?: boolean;
  }) {
    const [value, setValue] = React.useState("");
    return (
      <form>
        <label>
          Site
          <AppSelect
            name="site"
            disabled={disabled}
            value={value}
            onChange={(next) => {
              changes.push(next);
              setValue(next);
            }}
            options={[
              { value: "", label: "All sites" },
              { value: "site-1", label: "Maple House" },
            ]}
          />
        </label>
        <output>{value === "" ? "(empty)" : value}</output>
      </form>
    );
  }

  it("A: empty-string value is a real value — label shown, selected, commits both ways, submits ''", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(<EmptyValueHarness changes={changes} />);
    const form = container.querySelector("form")!;
    const trigger = triggerIn(container, "Site")!;
    assert.ok(trigger, "trigger renders inside the label");
    assert.ok(
      trigger.textContent?.includes("All sites"),
      "closed trigger shows the '' option's label",
    );
    const valueSlot = trigger.querySelector('[data-slot="select-value"]');
    assert.ok(
      !(valueSlot as HTMLElement).dataset.placeholder,
      "no data-placeholder for the '' value",
    );
    assert.equal(
      new dom.window.FormData(form).get("site"),
      "",
      "named wrapper submits '' before any interaction",
    );

    await click(trigger);
    const items = openItems(container);
    assert.deepEqual(
      items.map((el) => el.textContent),
      ["All sites", "Maple House"],
    );
    assert.equal(
      items[0].getAttribute("aria-selected"),
      "true",
      "aria-selected lands on the '' option",
    );
    await click(items[1]);
    assert.deepEqual(changes, ["site-1"], "one commit to the non-empty value");
    assert.equal(
      trigger.getAttribute("aria-expanded"),
      "false",
      "the list closes on pick — a label-wrapped select must not let the " +
        "label's forwarded click reopen it (slice 11b browser QA finding)",
    );
    assert.equal(new dom.window.FormData(form).get("site"), "site-1");

    await click(trigger);
    const items2 = openItems(container);
    assert.equal(items2[1].getAttribute("aria-selected"), "true");
    await click(items2[0]);
    assert.deepEqual(changes, ["site-1", ""], "committing '' fires exactly once");
    assert.equal(container.querySelector("output")!.textContent, "(empty)");
    assert.equal(
      new dom.window.FormData(form).get("site"),
      "",
      "named wrapper submits '' after committing it",
    );
    await unmount(root, container);
  });

  it("A: disabled wrapper does not open (hub's one disabled select)", async () => {
    const changes: string[] = [];
    const { container, root } = await mount(
      <EmptyValueHarness changes={changes} disabled />,
    );
    const trigger = triggerIn(container, "Site")!;
    assert.equal(
      (trigger as HTMLButtonElement).disabled,
      true,
      "disabled lands on the trigger button",
    );
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.deepEqual(openItems(container), []);
    assert.deepEqual(changes, []);
    await unmount(root, container);
  });

  it("A: id prop lands on the trigger (OpenShiftsTab's labelled fields)", async () => {
    const { container, root } = await mount(
      <AppSelect
        id="open-shift-mode"
        value="approval"
        onChange={() => {}}
        options={[
          { value: "approval", label: "Bids: I choose who gets it" },
          { value: "first_come", label: "First come, first served" },
        ]}
      />,
    );
    const trigger = container.querySelector('[data-slot="select-trigger"]')!;
    assert.equal(trigger.id, "open-shift-mode");
    await unmount(root, container);
  });

  /* ------------------------------ Part B ------------------------------ */

  const staffList: HubStaffEntry[] = [
    { userId: "user-pat", fullName: "Pat Morgan", email: "pat@example.com", roleKey: "program_manager", siteId: "site-1" },
    { userId: "user-alex", fullName: "Alex Rivera", email: "alex.rivera@example.com", roleKey: "dsp", siteId: "site-1" },
  ];
  const sites: HubSite[] = [
    { id: "site-1", name: "Maple House" },
    { id: "site-2", name: "Oak House" },
  ];

  function makeSession(overrides: Partial<SessionUser>): SessionUser {
    return {
      userId: "user-pat",
      email: "pat@example.com",
      username: "pat",
      fullName: "Pat Morgan",
      jobTitle: "Program Manager",
      role: "manager",
      roleKey: "program_manager",
      agencyId: "agency-1",
      agencyName: "Evergreen Care",
      agencyCode: "EVERGREEN-MO",
      siteId: "site-1",
      mustChangePassword: false,
      expiresOn: null,
      permissions: { "hub.access": true },
      platformAdmin: false,
      agencyStatus: "active",
      ...overrides,
    } as SessionUser;
  }

  it("B: PunchExceptions flag editor — migrated select commits the picked kind to the store", async () => {
    const calls: { punchId: string; req: { requestedKind: string | null } }[] = [];
    const store = {
      listPunches: async () => [] as HrPunch[],
      listShifts: async () => [],
      requestPunchCorrection: async (punchId: string, req: { requestedKind: string | null }) => {
        calls.push({ punchId, req });
        return { id: "corr-1" };
      },
      decidePunchCorrection: async () => ({}),
    } as unknown as HrStore;
    const exceptions: PunchException[] = [
      {
        kind: "missed_punch",
        staffId: "user-alex",
        detail: "Missed clock-out",
        at: new Date().toISOString(),
        punchId: "punch-1",
      },
    ];
    const { container, root } = await mount(
      <PunchExceptions
        session={makeSession({})}
        store={store}
        staffList={staffList}
        sites={sites}
        initialExceptions={exceptions}
      />,
    );
    const flagButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Flag"),
    );
    assert.ok(flagButton, "Flag button renders for the exception");
    await click(flagButton!);

    const trigger = triggerIn(container, "Correct punch type");
    assert.ok(trigger, "flag editor's select renders as an AppSelect trigger");
    assert.ok(
      trigger!.textContent?.includes("Clock out"),
      "default flag kind is Clock out, as pre-migration",
    );
    await click(trigger!);
    const items = openItems(container);
    assert.deepEqual(
      items.map((el) => el.textContent),
      ["Clock in", "Clock out"],
    );
    await click(items[0]); // Clock in

    const reason = container.querySelector(".hub-inline-form textarea")!;
    await setFieldValue(reason, "Kiosk missed the clock-in");
    const send = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Send correction request"),
    );
    assert.ok(send, "send button renders");
    await click(send!);
    assert.equal(calls.length, 1, "exactly one correction requested");
    assert.equal(calls[0].punchId, "punch-1");
    assert.equal(
      calls[0].req.requestedKind,
      "in",
      "the picked kind reaches the store",
    );
    await unmount(root, container);
  });

  /* ------------------------------ Part C ------------------------------ */

  it("C: My Timecard correction editor — migrated select commits the picked kind to the store", async () => {
    const dayStamp = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    const end = new Date(now);
    end.setDate(end.getDate() + 6);
    const period: HrPayPeriod = {
      id: "per-1",
      agencyId: "agency-1",
      startsOn: dayStamp(start),
      endsOn: dayStamp(end),
      status: "open",
      lockedBy: null,
      lockedAt: null,
    } as HrPayPeriod;
    const punchAt = new Date(now);
    punchAt.setHours(8, 0, 0, 0);
    const punch: HrPunch = {
      id: "punch-9",
      agencyId: "agency-1",
      siteId: "site-1",
      staffId: "user-alex",
      shiftId: null,
      kind: "in",
      punchedAt: punchAt.toISOString(),
      source: "web",
      note: null,
    } as HrPunch;
    const calls: { punchId: string; req: { requestedKind: string | null } }[] = [];
    const impl: Record<string, unknown> = {
      listPayPeriods: async () => [period],
      listPunches: async () => [punch],
      listPunchCorrections: async () => [],
      getTimecardApproval: async () => null,
      requestPunchCorrection: async (punchId: string, req: { requestedKind: string | null }) => {
        calls.push({ punchId, req });
        return { id: "corr-9" };
      },
    };
    // Any other HrStore method the shell chrome calls resolves empty.
    const store = new Proxy(impl, {
      get: (target, prop) =>
        typeof prop === "string" && prop in target
          ? target[prop]
          : typeof prop === "string"
            ? async () => []
            : undefined,
    }) as unknown as HrStore;

    const { container, root } = await mount(
      <EmployeeHubShell
        session={makeSession({
          userId: "user-alex",
          fullName: "Alex Rivera",
          role: "dsp",
          roleKey: "dsp",
          permissions: { "hub.access": true },
        })}
        store={store}
        staffList={staffList}
        sites={sites}
        initialTab="timecard"
      />,
    );
    // Let the period + punches load settle.
    await React.act(async () => {
      await settle();
    });
    await React.act(async () => {
      await settle();
    });

    const periodTrigger = triggerIn(container, "Pay period");
    assert.ok(periodTrigger, "pay-period select renders as an AppSelect trigger");
    assert.ok(
      periodTrigger!.textContent?.includes("(open)"),
      "period trigger shows the period label incl. status",
    );

    const requestButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Request correction"),
    );
    assert.ok(requestButton, "Request correction renders for the punch");
    await click(requestButton!);

    const trigger = triggerIn(container, "Correct punch type");
    assert.ok(trigger, "correction editor's select renders as an AppSelect trigger");
    assert.ok(trigger!.textContent?.includes("Clock in"), "default kind is Clock in");
    await click(trigger!);
    const items = openItems(container);
    assert.deepEqual(
      items.map((el) => el.textContent),
      ["Clock in", "Clock out"],
    );
    await click(items[1]); // Clock out

    const reason = container.querySelector(".hub-inline-form textarea")!;
    await setFieldValue(reason, "Forgot to clock out");
    const send = [...container.querySelectorAll(".hub-form-actions button")].find(
      (b) => b.textContent?.includes("Send request"),
    );
    assert.ok(send, "Send request renders");
    await click(send!);
    assert.equal(calls.length, 1, "exactly one correction requested");
    assert.equal(calls[0].punchId, "punch-9");
    assert.equal(
      calls[0].req.requestedKind,
      "out",
      "the picked kind reaches the store",
    );
    await unmount(root, container);
  });
});
