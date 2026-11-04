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
 * Fix wave 3, item 1(c) (simulation batch 7): the Personal Spending
 * month-close form PRE-CHECKED "the Individual signed the statement" —
 * a legal attestation defaulting to yes. The sign-off now starts
 * unchosen in both close forms, and submitting without a choice is
 * refused with a visible error. This test renders the real desktop
 * section against the demo workspace (Harper Soto, whose month is
 * open) signed in as her house manager.
 */

describe("PersonalSpendingCard close sign-off", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Section: typeof import("./PersonalSpendingCard").PersonalSpendingSection;

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
    Section = (await import("./PersonalSpendingCard")).PersonalSpendingSection;
  });

  after(() => {
    dom.window.close();
  });

  it("starts with no sign-off chosen and refuses to close without one", async () => {
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
        React.createElement(Section, {
          api,
          session,
          individualId: harper.id,
          individualName: "Harper Soto",
          dmhId: "",
          dateOfBirth: "",
          siteName: "Willow House",
          staffOptions: [{ id: james.id, name: "James Wilson" }],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const radios = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"][name="ps-signoff"]',
      ),
    ];
    assert.equal(radios.length, 2, "both sign-off options render");
    assert.ok(
      radios.every((radio) => !radio.checked),
      "no sign-off option is pre-checked",
    );

    const closeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.startsWith("Close "),
    );
    assert.ok(closeButton, "close button rendered");
    await act(async () => {
      closeButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.ok(
      container.textContent?.includes(
        "Record how the Individual's sign-off was handled",
      ),
      "closing without a sign-off choice is refused with a visible error",
    );
    assert.equal(
      (await api.listPersonalSpendingMonthCloses(harper.id)).length,
      0,
      "no close was recorded",
    );
    await act(async () => root.unmount());
  });

  describe("entry form on a signed month (wave 3 retest)", () => {
    const signedIn = (api: LocalApi, username: string) =>
      api.signIn({
        agencyCode: DEMO_AGENCY_CODE,
        username,
        password: DEMO_PASSWORD,
      });

    async function renderFor(username: string, closeFirst: boolean) {
      const api = new LocalApi(
        new MemoryStore(structuredClone(createEvergreenSeed())),
      );
      const admin = await signedIn(api, DEMO_ADMIN_USERNAME);
      const adminView = await api.loadWorkspace(admin);
      const ellis = adminView.individuals.find((i) => i.name === "Ellis Hart")!;
      if (closeFirst) {
        await api.closePersonalSpendingMonth({
          individualId: ellis.id,
          month: centralTodayIso().slice(0, 7),
          signatureText: "Sarah Mitchell",
          individualSignoff: "individual_signed",
        });
      }
      await api.signOut();
      const session = await signedIn(api, username);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(Section, {
            api,
            session,
            individualId: ellis.id,
            individualName: "Ellis Hart",
            dmhId: "",
            dateOfBirth: "",
            siteName: "Cedar House",
            staffOptions: [],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      const form = container.querySelector('section[aria-label="Record an entry"]');
      const ledger = container.querySelector('section[aria-label="Ledger"]');
      const text = container.textContent ?? "";
      await React.act(async () => root.unmount());
      container.remove();
      return { form, ledger, text };
    }

    it("hides the form from a DSP on a closed month, and the ledger stays readable", async () => {
      const view = await renderFor(DEMO_DSP_USERNAME, true);
      assert.equal(view.form, null);
      assert.ok(view.ledger, "the ledger still renders");
      assert.match(view.text, /closed and signed/);
      assert.match(view.text, /Choose an open\s+month to record one/);
    });

    it("keeps the form for a DSP on an open month", async () => {
      assert.ok((await renderFor(DEMO_DSP_USERNAME, false)).form);
    });

    for (const username of [DEMO_ADMIN_USERNAME]) {
      it(`keeps the form for ${username} on a closed month`, async () => {
        const view = await renderFor(username, true);
        assert.ok(view.form);
        assert.doesNotMatch(view.text, /Choose an open\s+month to record one/);
      });
    }
  });
});
