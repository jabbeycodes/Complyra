import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  DEFAULT_CONSENT_TYPES,
  type ConsentRecord,
  type ConsentRegister,
} from "../../data/consents";
import type { SessionUser } from "../../data/types";

/**
 * The rendered half of the 2026-11-11 medication-consent warning
 * rule: the banner appears (as an alert, with a text label — never
 * color alone) on the surfaces that mount the gate, and renders
 * nothing at all for a current consent or an unloaded register.
 * The MarCard mount also pins the non-blocking half: the MAR's
 * dose rows render unchanged alongside the banner.
 */

const record = (
  patch: Partial<ConsentRecord> & { id: string; typeId: string },
): ConsentRecord => ({
  individualId: "i1",
  agencyId: "a1",
  covers: "Covers text",
  giver: "guardian",
  giverName: "Sam Rivera",
  relationship: "Parent and guardian",
  signedOn: "2026-01-12",
  effectiveOn: "2026-01-12",
  reviewOn: "2027-01-12",
  supersedesId: null,
  createdBy: "hm",
  createdAt: "2026-01-12T15:00:00.000Z",
  activatedBy: "hm",
  activatedAt: "2026-01-12T15:05:00.000Z",
  ...patch,
});
const individuals = [{ id: "i1", agencyId: "a1", siteId: "s1", fullName: "Taylor" }];
const registerWith = (records: ConsentRecord[]): ConsentRegister => ({
  types: DEFAULT_CONSENT_TYPES,
  records,
  revocations: [],
  individuals,
});
const EXPIRED = registerWith([
  record({
    id: "c-med",
    typeId: "medication",
    signedOn: "2025-11-01",
    effectiveOn: "2025-11-01",
    reviewOn: "2020-01-01",
  }),
]);
const CURRENT = registerWith([record({ id: "c-med", typeId: "medication" })]);

describe("MedConsentWarning (rendered)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let DataContext: typeof import("../../data/DataProvider").DataContext;
  let MedConsentWarningGate: typeof import("./MedConsentWarning").default;
  let MarCard: typeof import("../MarCard").default;

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
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ DataContext } = await import("../../data/DataProvider"));
    MedConsentWarningGate = (await import("./MedConsentWarning")).default;
    MarCard = (await import("../MarCard")).default;
  });

  after(() => {
    dom.window.close();
  });

  const session = {
    userId: "u-hm",
    agencyId: "a1",
    roleKey: "house_manager",
    name: "Hollis Manager",
  } as unknown as SessionUser;

  function stubApi(register: ConsentRegister) {
    const known: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      getConsents: async () => register,
      getMedInventory: async () => [],
      getMedDoseMarks: async () => [],
      getMedDoseMarksInRange: async () => [],
      getStaffTrainingProfile: async () => ({ clearedForInRatio: true }),
    };
    return new Proxy(known, {
      get: (target, prop: string) => target[prop] ?? (async () => []),
    }) as unknown as import("../../data/localApi").ComplyraApi;
  }

  async function mount(
    element: import("react").ReactElement,
    register: ConsentRegister,
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          {
            value: {
              api: stubApi(register),
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
            } as never,
          },
          element,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    return { container, root };
  }

  it("the gate renders the alert banner for an expired medication consent", async () => {
    const { container, root } = await mount(
      React.createElement(MedConsentWarningGate, { individualId: "i1" }),
      EXPIRED,
    );
    const banner = container.querySelector('[role="alert"]');
    assert.ok(banner, "banner present");
    assert.ok(banner.textContent?.includes("Medication consent:"), banner.textContent ?? "");
    assert.ok(banner.textContent?.includes("has expired"), banner.textContent ?? "");
    await React.act(async () => root.unmount());
    container.remove();
  });

  it("the gate renders nothing for a current medication consent", async () => {
    const { container, root } = await mount(
      React.createElement(MedConsentWarningGate, { individualId: "i1" }),
      CURRENT,
    );
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.equal(container.textContent, "");
    await React.act(async () => root.unmount());
    container.remove();
  });

  it("the MAR card shows the banner and still renders its dose area (warning, not a block)", async () => {
    const { container, root } = await mount(
      React.createElement(MarCard, { individualId: "i1" }),
      EXPIRED,
    );
    const text = container.textContent ?? "";
    assert.ok(text.includes("Medication consent:"), text.slice(0, 400));
    assert.ok(text.includes("Medication administration — today"), "the MAR itself renders");
    await React.act(async () => root.unmount());
    container.remove();
  });

  it("the MAR card shows no banner for a current medication consent", async () => {
    const { container, root } = await mount(
      React.createElement(MarCard, { individualId: "i1" }),
      CURRENT,
    );
    assert.ok(!(container.textContent ?? "").includes("Medication consent:"));
    await React.act(async () => root.unmount());
    container.remove();
  });
});
