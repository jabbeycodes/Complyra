import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { HrStore } from "../../data/hrStore";
import type { ComplyraApi, WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type {
  BinderTemplateSection,
  StaffBinder,
} from "../../data/newHireBinder";
import type { HubStaffEntry, HubSite } from "../employeeHub/EmployeeHubPage";

/**
 * Simulation pass 16, batches 212–213 — two Binder Board defects:
 *
 * 1. The headline totals pooled over whichever staff list the current
 *    viewer's hub handed the board, so the board's denominator changed
 *    with the viewer (whole agency for an agency-wide viewer, one
 *    house's slice for a house manager). The totals must pool over ONE
 *    population — every issued binder in the agency — while the card
 *    rows stay scoped to the passed-in list.
 *
 * 2. A colleague's home label fell back to "No home assigned" whenever
 *    their home site was missing from the VIEWER's site list — every
 *    out-of-house colleague read as unassigned, including a sitting
 *    house manager. A person's home is their membership home site; the
 *    label comes from their own staff record.
 */

const SECTIONS: BinderTemplateSection[] = [
  {
    key: "docs",
    title: "Documents",
    items: [
      { key: "id-copy", label: "ID copy", kind: "document", matchKeys: ["id"] },
      { key: "ss-card", label: "SS card", kind: "document", matchKeys: ["ss"] },
    ],
  },
];

function binderFor(staffId: string): StaffBinder {
  return {
    id: `binder-${staffId}`,
    agencyId: "agency-1",
    staffId,
    sections: SECTIONS,
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
  };
}

function makeStore(issued: StaffBinder[]): HrStore {
  return {
    listDocuments: async () => [],
    listDocumentAcks: async () => [],
    getBinder: async (staffId: string) => binderFor(staffId),
    listBinders: async () => issued,
    listBinderDocuments: async () => [],
    getEmergencyContact: async () => null,
    getComplianceEvidence: async () => ({
      certs: [],
      trainings: [],
      delegations: [],
      docAcks: [],
    }),
  } as unknown as HrStore;
}

const HM_SESSION = {
  userId: "hm-maple",
  fullName: "Harper Lane",
  role: "manager",
  roleKey: "house_manager",
  agencyId: "agency-1",
} as unknown as SessionUser;

describe("BinderBoardTab", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Board: typeof import("./BinderBoardPanel").BinderBoardTab;
  let DataContext: typeof import("../../data/DataProvider").DataContext;

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
    Board = (await import("./BinderBoardPanel")).BinderBoardTab;
    ({ DataContext } = await import("../../data/DataProvider"));
  });

  after(() => {
    dom.window.close();
  });

  async function renderBoard(
    staffList: HubStaffEntry[],
    sites: HubSite[],
    issued: StaffBinder[],
  ): Promise<string> {
    const act = React.act;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const value = {
      api: {
        getStaffTrainingProfile: async () => null,
      } as unknown as ComplyraApi,
      session: HM_SESSION,
      workspace: null as WorkspaceView | null,
      loading: false,
      error: "",
      usingHostedBackend: true,
      loadStalled: false,
      signIn: async () => {},
      changePassword: async () => {},
      signOut: async () => {},
      refresh: async () => {},
    };
    await act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          { value },
          React.createElement(Board, {
            session: HM_SESSION,
            store: makeStore(issued),
            staffList,
            sites,
            onOpenBinder: () => {},
          }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    const text = container.textContent ?? "";
    await act(async () => root.unmount());
    container.remove();
    return text;
  }

  it("pools the headline totals over every issued binder, not the viewer's row list", async () => {
    // The viewer's hub handed the board ONE row (their own house's
    // slice); the agency has three issued binders of 2 required items.
    const maple: HubStaffEntry = {
      userId: "hm-maple",
      fullName: "Harper Lane",
      email: "",
      roleKey: "house_manager",
      siteId: "site-maple",
      siteName: "Maple House",
    };
    const issued = [
      binderFor("hm-maple"),
      binderFor("hm-juniper"),
      binderFor("dsp-1"),
    ];
    const text = await renderBoard([maple], [{ id: "site-maple", name: "Maple House" }], issued);
    // One population: 3 staff, 6 required items — not the row list's 1/2.
    assert.match(text, /3 staff · 3 incomplete/);
    assert.match(text, /0 of 6 required items satisfied/);
    assert.match(text, /0 of 3 staff fully complete/);
    // The card grid stays scoped to the passed-in list.
    assert.match(text, /Harper Lane/);
  });

  it("labels homes from the person's membership home, never from the viewer's site list alone", async () => {
    const juniperHm: HubStaffEntry = {
      userId: "hm-juniper",
      fullName: "Jordan Reyes",
      email: "",
      roleKey: "house_manager",
      siteId: "site-juniper",
      siteName: "Juniper House",
    };
    const unnamedHome: HubStaffEntry = {
      userId: "dsp-x",
      fullName: "Drew Ellis",
      email: "",
      roleKey: "dsp",
      siteId: "site-x",
      siteName: null,
    };
    const noHome: HubStaffEntry = {
      userId: "hr-1",
      fullName: "Riley Hart",
      email: "",
      roleKey: "hr",
      siteId: null,
      siteName: null,
    };
    // The viewer's site list holds ONLY Maple — Juniper is not in it.
    const text = await renderBoard(
      [juniperHm, unnamedHome, noHome],
      [{ id: "site-maple", name: "Maple House" }],
      [],
    );
    assert.match(text, /House manager · Juniper House/);
    assert.match(text, /Direct support professional · Another home/);
    assert.match(text, /No home assigned/);
    // Exactly one "No home assigned" — the staffer who truly has none.
    assert.equal(text.split("No home assigned").length - 1, 1);
  });
});
