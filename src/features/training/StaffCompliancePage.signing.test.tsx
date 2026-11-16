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

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PASSWORD,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("training sign-off password re-entry", () => {
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

  async function setValue(
    element: HTMLInputElement | HTMLSelectElement,
    value: string,
  ) {
    const proto =
      element.tagName === "SELECT"
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    await React.act(async () => {
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  }

  it("asks for the password, and a correct one finishes the sign-off", async () => {
    const api = new LocalApi(
      new MemoryStore(structuredClone(createEvergreenSeed())),
    );
    const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
    const adminView = await api.loadWorkspace(admin);
    const trainee = adminView.staff.find((p) => p.username === "taylor.reed")!;
    const [line] = await api.assignTraining({
      userId: trainee.id,
      siteId: adminView.sites[0].id,
      source: "checklist",
      topicIds: siteChecklistTopics()
        .slice(0, 1)
        .map((topic) => topic.id),
    });
    await api.signOut();
    const session = await api.signIn(login("taylor.reed"));
    await api.adoptSignature({
      signatureDataUrl: PNG_1X1,
      initialsDataUrl: PNG_1X1,
      consentTextVersion: ESIGN_CONSENT_VERSION,
      consentGiven: true,
    });
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

    const initial = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Initial",
    )!;
    assert.ok(initial, "the line offers Initial");
    await React.act(async () => {
      initial.click();
      await settle();
    });
    const trainer = [...document.body.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Trainer"))!
      .querySelector("select")!;
    const trainerId = [...trainer.options].find(
      (option) => option.value && option.value !== trainee.id,
    )!.value;
    await setValue(trainer, trainerId);
    assert.equal(document.body.querySelector('input[type="password"]'), null);

    const submit = [...document.body.querySelectorAll('button[type="submit"]')].find(
      (button) => button.textContent?.startsWith("Initial as"),
    ) as HTMLButtonElement;
    await React.act(async () => {
      submit.click();
      await settle();
    });

    const password = document.body.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null;
    assert.ok(password, "the password field renders");
    let profile = await api.getStaffTrainingProfile(trainee.id);
    assert.equal(
      profile.requirements.find((row) => row.id === line.id)?.signoff,
      null,
      "nothing was saved while the password is outstanding",
    );

    await setValue(password!, DEMO_PASSWORD);
    await React.act(async () => {
      (password!.form as HTMLFormElement).requestSubmit();
      await settle();
      await settle();
    });
    assert.equal(document.body.querySelector('input[type="password"]'), null);
    profile = await api.getStaffTrainingProfile(trainee.id);
    assert.equal(
      profile.requirements.find((row) => row.id === line.id)?.signoff?.signoffVersion,
      1,
    );
    const events = await api.getSignatureEvents(
      "training_checklist",
      `staff:${trainee.id}:${line.siteId}`,
    );
    assert.ok(events.some((event) => event.fieldName === `line:${line.id}:v1`));

    await React.act(async () => root.unmount());
    container.remove();
  });

  async function renderPage(api: LocalApi, session: Awaited<ReturnType<LocalApi["signIn"]>>) {
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

  async function stampedLineFixture() {
    const store = new MemoryStore(structuredClone(createEvergreenSeed()));
    const api = new LocalApi(store);
    const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
    const adminView = await api.loadWorkspace(admin);
    const trainee = adminView.staff.find((p) => p.username === "taylor.reed")!;
    const hm = adminView.staff.find((p) => p.roleKey === "house_manager")!;
    const [line] = await api.assignTraining({
      userId: trainee.id,
      siteId: adminView.sites[0].id,
      source: "checklist",
      topicIds: siteChecklistTopics()
        .slice(0, 1)
        .map((topic) => topic.id),
    });
    await api.signOut();
    const session = await api.signIn(login("taylor.reed"));
    await api.adoptSignature({
      signatureDataUrl: PNG_1X1,
      initialsDataUrl: PNG_1X1,
      consentTextVersion: ESIGN_CONSENT_VERSION,
      consentGiven: true,
    });
    await api.verifySigningPassword(DEMO_PASSWORD);
    const { saveAndInitialTrainingLine } = await import("./trainingLineSigning");
    const requirement = (await api.getStaffTrainingProfile(trainee.id)).requirements.find(
      (row) => row.id === line.id,
    )!;
    await saveAndInitialTrainingLine(api, {
      sessionUserId: trainee.id,
      staffUserId: trainee.id,
      requirement,
      trainerName: hm.name,
      input: {
        initials: "TR",
        signedOn: "2026-10-10",
        trainerUserId: hm.id,
        hoursTotal: 2,
        hoursWithHm: 1,
      },
    } as never);
    return { store, api, session, trainee, line };
  }

  it("a valid stamp shows Verified and offers no Re-initial", async () => {
    const fx = await stampedLineFixture();
    const view = await renderPage(fx.api, fx.session);
    assert.match(view.container.textContent ?? "", /Verified — unchanged since signing/);
    assert.equal(buttonsNamed(view.container, "Re-initial").length, 0);
    await view.unmount();
  });

  it("an INVALID stamp offers its owner Re-initial, and managers still get none", async () => {
    const fx = await stampedLineFixture();
    const signoffs = (fx.store.db as unknown as {
      trainingSignoffs: Array<{ requirementId: string; hoursTotal: number }>;
    }).trainingSignoffs;
    signoffs.find((row) => row.requirementId === fx.line.id)!.hoursTotal = 3;

    const owner = await renderPage(fx.api, fx.session);
    assert.match(owner.container.textContent ?? "", /Signature invalid/);
    assert.equal(
      buttonsNamed(owner.container, "Re-initial").length,
      1,
      "the owner can retry an invalid line",
    );
    await owner.unmount();

    await fx.api.signOut();
    const admin = await fx.api.signIn(login(DEMO_ADMIN_USERNAME));
    const manager = await renderPage(fx.api, admin);
    const open = [...manager.container.querySelectorAll("button")].find(
      (b) =>
        b.textContent === "Open profile" &&
        b.closest("tr, li")?.textContent?.includes(fx.trainee.name),
    );
    assert.ok(open, "the manager can open the trainee's profile");
    await React.act(async () => {
      open!.click();
      await settle();
    });
    await React.act(settle);
    await React.act(settle);
    assert.match(manager.container.textContent ?? "", /Signature invalid/);
    assert.equal(buttonsNamed(manager.container, "Re-initial").length, 0);
    await manager.unmount();
  });

  it("a slow own-profile load says loading, and a failed one offers Try again", async () => {
    const api = new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
    const session = await api.signIn(login("taylor.reed"));
    const real = api.getStaffTrainingProfile.bind(api);
    let release: () => void = () => {};
    let failNext = false;
    api.getStaffTrainingProfile = async (userId: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (failNext) {
        failNext = false;
        throw new Error("Could not load training lines.");
      }
      return real(userId);
    };
    failNext = true;
    const view = await renderPage(api, session);
    const text = () => view.container.textContent ?? "";
    assert.doesNotMatch(text(), /Ask your house manager/, "in flight is not a failure");
    assert.match(text(), /Loading training profile/);

    await React.act(async () => {
      release();
      await settle();
    });
    assert.match(text(), /Training profile couldn't be loaded/);
    assert.match(text(), /Could not load training lines/);
    const retry = buttonsNamed(view.container, "Try again");
    assert.equal(retry.length, 1);

    await React.act(async () => {
      retry[0].click();
      await settle();
      release();
      await settle();
    });
    await React.act(settle);
    assert.doesNotMatch(text(), /couldn't be loaded/);
    assert.match(text(), /training profile|Training hours/i);
    assert.ok(view.container.querySelector('[aria-label$="training profile"]'));
    await view.unmount();
  });
});
