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
});
