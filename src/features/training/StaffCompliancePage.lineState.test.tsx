import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
} from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";
import { ESIGN_CONSENT_VERSION } from "../signatures/signatureUtils";
import { siteChecklistTopics } from "./topics";

/**
 * Wave-5 item 2: one training line, one state — for every viewer.
 *
 * The line's initials state is derived from the sheet's signature
 * events. On the hosted app those events were RLS-visible only to the
 * signer and administrators, so an HM viewing a DSP's sheet derived
 * "Needs re-initialing" from an empty set while the owner derived the
 * true state (fixed by migration 20261117090000, which lets every
 * profile viewer read the same events — LocalApi already returns the
 * full set, so these tests pin the PAGE behaviour that consumes it):
 * both viewers must render the identical state, only the owner may be
 * offered Re-initial, and while the events are still in flight no
 * verdict may render at all (the pre-load flash).
 */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PASSWORD,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("training line state is viewer-identical", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Page: typeof import("./StaffCompliancePage").default;
  let DataContext: typeof import("../../data/DataProvider").DataContext;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost",
      pretendToBeVisual: true,
    });
    const setGlobal = (name: string, value: unknown) =>
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = await import("react");
    createRoot = (await import("react-dom/client")).createRoot;
    Page = (await import("./StaffCompliancePage")).default;
    DataContext = (await import("../../data/DataProvider")).DataContext;
  });

  after(() => dom.window.close());

  async function renderPage(
    api: LocalApi,
    session: Awaited<ReturnType<LocalApi["signIn"]>>,
  ) {
    const workspace = await api.loadWorkspace(session);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          {
            value: {
              api,
              session,
              workspace,
              loading: false,
              error: "",
              usingHostedBackend: false,
              loadStalled: false,
              signIn: async () => {},
              changePassword: async () => {},
              signOut: async () => {},
              refresh: async () => {},
            } as never,
          },
          React.createElement(Page, { onSaved: () => undefined }),
        ),
      );
      await settle();
    });
    await React.act(settle);
    await React.act(settle);
    return {
      container,
      async unmount() {
        await React.act(async () => root.unmount());
        container.remove();
      },
    };
  }

  const buttonsNamed = (root: ParentNode, text: string) =>
    [...root.querySelectorAll("button")].filter((b) => b.textContent === text);

  function profilePanel(container: HTMLElement, fullName: string) {
    const panel = container.querySelector(
      `[aria-label="${fullName} training profile"]`,
    );
    assert.ok(panel, `${fullName}'s profile panel is rendered`);
    return panel as HTMLElement;
  }

  async function openProfile(view: { container: HTMLElement }, name: string) {
    const open = [...view.container.querySelectorAll("button")].find(
      (b) =>
        b.textContent === "Open profile" &&
        b.closest("tr, li")?.textContent?.includes(name),
    );
    assert.ok(open, `the roster offers ${name}'s profile`);
    await React.act(async () => {
      open!.click();
      await settle();
    });
    await React.act(settle);
    await React.act(settle);
  }

  /** An HM and a DSP at the HM's own house, with one checklist line assigned. */
  async function pairFixture() {
    const store = new MemoryStore(structuredClone(createEvergreenSeed()));
    const api = new LocalApi(store);
    const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
    const adminView = await api.loadWorkspace(admin);
    const hm = adminView.staff.find((p) => p.roleKey === "house_manager")!;
    const trainee = adminView.staff.find(
      (p) => p.roleKey === "dsp" && p.siteId === hm.siteId,
    )!;
    assert.ok(trainee, "a DSP shares the house manager's site");
    const [line] = await api.assignTraining({
      userId: trainee.id,
      siteId: hm.siteId!,
      source: "checklist",
      topicIds: siteChecklistTopics()
        .slice(0, 1)
        .map((topic) => topic.id),
    });
    return { store, api, trainee, hm, line };
  }

  /** The line is saved by a manager: a sign-off exists, no stamp ever lands. */
  async function managerSavedFixture() {
    const fx = await pairFixture();
    await fx.api.initialRequirementLine(fx.line.id, {
      initials: "XX",
      signedOn: "2026-10-10",
      trainerUserId: fx.hm.id,
      hoursTotal: 2,
      hoursWithHm: 1,
    });
    await fx.api.signOut();
    return fx;
  }

  /** The owner initials the line herself: a valid stamp at v1. */
  async function stampedFixture() {
    const fx = await pairFixture();
    await fx.api.signOut();
    const session = await fx.api.signIn(login(fx.trainee.username));
    await fx.api.adoptSignature({
      signatureDataUrl: PNG_1X1,
      initialsDataUrl: PNG_1X1,
      consentTextVersion: ESIGN_CONSENT_VERSION,
      consentGiven: true,
    });
    await fx.api.verifySigningPassword(DEMO_PASSWORD);
    const { saveAndInitialTrainingLine } = await import("./trainingLineSigning");
    const requirement = (
      await fx.api.getStaffTrainingProfile(fx.trainee.id)
    ).requirements.find((row) => row.id === fx.line.id)!;
    await saveAndInitialTrainingLine(fx.api, {
      sessionUserId: fx.trainee.id,
      staffUserId: fx.trainee.id,
      requirement,
      input: {
        initials: "XX",
        signedOn: "2026-10-10",
        trainerUserId: fx.hm.id,
        hoursTotal: 2,
        hoursWithHm: 1,
      },
    } as never);
    return { ...fx, session };
  }

  it("a manager-saved line reads Needs re-initialing for owner AND HM; only the owner gets Re-initial", async () => {
    const fx = await managerSavedFixture();

    const ownerSession = await fx.api.signIn(login(fx.trainee.username));
    const owner = await renderPage(fx.api, ownerSession);
    const ownerPanel = profilePanel(owner.container, fx.trainee.name);
    assert.match(ownerPanel.textContent ?? "", /Needs re-initialing/);
    assert.equal(
      buttonsNamed(ownerPanel, "Re-initial").length,
      1,
      "the owner is offered Re-initial for an unstamped line",
    );
    await owner.unmount();
    await fx.api.signOut();

    const hmSession = await fx.api.signIn(login(fx.hm.username));
    const hmView = await renderPage(fx.api, hmSession);
    await openProfile(hmView, fx.trainee.name);
    const hmPanel = profilePanel(hmView.container, fx.trainee.name);
    assert.match(
      hmPanel.textContent ?? "",
      /Needs re-initialing/,
      "the HM derives the same state from the same events",
    );
    assert.equal(
      buttonsNamed(hmView.container, "Re-initial").length,
      0,
      "a non-owner is never offered Re-initial",
    );
    await hmView.unmount();
  });

  it("a validly stamped line reads Verified for the HM exactly as for the owner", async () => {
    const fx = await stampedFixture();

    const owner = await renderPage(fx.api, fx.session);
    const ownerPanel = profilePanel(owner.container, fx.trainee.name);
    assert.match(
      ownerPanel.textContent ?? "",
      /Verified — unchanged since signing/,
    );
    assert.doesNotMatch(ownerPanel.textContent ?? "", /Needs re-initialing/);
    await owner.unmount();
    await fx.api.signOut();

    const hmSession = await fx.api.signIn(login(fx.hm.username));
    const hmView = await renderPage(fx.api, hmSession);
    await openProfile(hmView, fx.trainee.name);
    const hmPanel = profilePanel(hmView.container, fx.trainee.name);
    assert.match(
      hmPanel.textContent ?? "",
      /Verified — unchanged since signing/,
      "the HM sees the stamp, not a false Needs re-initialing",
    );
    assert.doesNotMatch(hmPanel.textContent ?? "", /Needs re-initialing/);
    assert.equal(buttonsNamed(hmView.container, "Re-initial").length, 0);
    await hmView.unmount();
  });

  it("while the sheet's events are in flight, no verdict and no Re-initial button render", async () => {
    const fx = await managerSavedFixture();
    const real = fx.api.getSignatureEvents.bind(fx.api);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fx.api.getSignatureEvents = async (
      ...args: Parameters<LocalApi["getSignatureEvents"]>
    ) => {
      await gate;
      return real(...args);
    };

    const ownerSession = await fx.api.signIn(login(fx.trainee.username));
    const view = await renderPage(fx.api, ownerSession);
    const panel = profilePanel(view.container, fx.trainee.name);
    assert.doesNotMatch(
      panel.textContent ?? "",
      /Needs re-initialing/,
      "an unloaded event set is not a verdict",
    );
    assert.equal(
      buttonsNamed(panel, "Re-initial").length,
      0,
      "no Re-initial button flashes before the events land",
    );
    assert.match(panel.textContent ?? "", /Checking initials…/);

    await React.act(async () => {
      release();
      await settle();
    });
    await React.act(settle);
    assert.match(panel.textContent ?? "", /Needs re-initialing/);
    assert.equal(buttonsNamed(panel, "Re-initial").length, 1);
    await view.unmount();
  });
});
