import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";
import { centralTodayIso } from "../../data/menuRecords";

/**
 * Fix wave 3, item 1(c) (simulation batch 7): the mobile Personal
 * Spending close form shared the desktop form's pre-checked sign-off.
 * It now starts unchosen too — see PersonalSpendingCard.test.tsx for
 * the desktop half.
 */

describe("MobilePersonalSpending close sign-off", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let MobilePersonalSpending: typeof import("./MobilePersonalSpending").default;

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
    MobilePersonalSpending = (await import("./MobilePersonalSpending")).default;
  });

  after(() => {
    dom.window.close();
  });

  it("starts with no sign-off chosen", async () => {
    const act = React.act;
    const api = new LocalApi(
      new MemoryStore(structuredClone(createEvergreenSeed())),
    );
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_HM_USERNAME,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const harper = workspace.individuals.find((i) => i.name === "Harper Soto")!;
    const james = workspace.staff.find((s) => s.name === "James Wilson")!;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(MobilePersonalSpending, {
          api,
          session,
          person: harper,
          siteName: "Willow House",
          staffOptions: [{ id: james.id, name: "James Wilson" }],
          onBack: () => undefined,
          onOpenChart: () => undefined,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const radios = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="mq-ps-signoff"]',
      ),
    ];
    assert.equal(radios.length, 2, "both sign-off options render");
    assert.ok(
      radios.every((radio) => !radio.checked),
      "no sign-off option is pre-checked",
    );
    await act(async () => root.unmount());
  });

  describe("entry form on a signed month (wave 3 retest)", () => {
    async function renderFor(username: string, closeFirst: boolean) {
      const api = new LocalApi(
        new MemoryStore(structuredClone(createEvergreenSeed())),
      );
      const creds = (name: string) => ({
        agencyCode: DEMO_AGENCY_CODE,
        username: name,
        password: DEMO_PASSWORD,
      });
      const admin = await api.signIn(creds(DEMO_ADMIN_USERNAME));
      const ellis = (await api.loadWorkspace(admin)).individuals.find(
        (i) => i.name === "Ellis Hart",
      )!;
      // The DSP's own entry predates the close, for the Void counts below.
      await api.signOut();
      await api.signIn(creds(DEMO_DSP_USERNAME));
      await api.createPersonalSpendingEntry({
        individualId: ellis.id,
        entryDate: centralTodayIso(),
        kind: "deposit",
        location: "Family",
        amountCents: 1000,
      });
      await api.signOut();
      await api.signIn(creds(DEMO_ADMIN_USERNAME));
      if (closeFirst) {
        await api.closePersonalSpendingMonth({
          individualId: ellis.id,
          month: centralTodayIso().slice(0, 7),
          signatureText: "Sarah Mitchell",
          individualSignoff: "individual_signed",
        });
      }
      await api.signOut();
      const session = await api.signIn(creds(username));
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(MobilePersonalSpending, {
            api,
            session,
            person: ellis,
            siteName: "Cedar House",
            staffOptions: [],
            onBack: () => undefined,
            onOpenChart: () => undefined,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      const buttons = [...container.querySelectorAll("button")].map(
        (button) => button.textContent ?? "",
      );
      const text = container.textContent ?? "";
      await React.act(async () => root.unmount());
      container.remove();
      return { buttons, text };
    }

    it("offers a DSP no entry form or Repeat on a closed month", async () => {
      const view = await renderFor(DEMO_DSP_USERNAME, true);
      assert.ok(!view.buttons.includes("Record an entry"));
      assert.ok(!view.buttons.includes("Repeat"));
      assert.ok(!view.buttons.includes("Void"), "no Void, even on their own entry");
      assert.match(view.text, /closed and signed/);
    });

    it("offers a DSP the entry form on an open month", async () => {
      const view = await renderFor(DEMO_DSP_USERNAME, false);
      assert.ok(view.buttons.includes("Record an entry"));
      assert.ok(view.buttons.includes("Void"), "their own entry on an open month");
    });

    it("keeps the entry form for a closer on a closed month", async () => {
      const view = await renderFor(DEMO_ADMIN_USERNAME, true);
      assert.ok(view.buttons.includes("Record an entry"));
      assert.ok(view.buttons.includes("Void"));
    });
  });
});
