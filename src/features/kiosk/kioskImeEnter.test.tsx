/**
 * kioskImeEnter.test.tsx — IME-safe Enter regression for the kiosk ID
 * step, in the repo's node:test component harness.
 *
 * The regression originally lived in KioskClockPage.spec.tsx, but that
 * file is vitest-only: scripts/run-unit-tests.mjs (CI's unit runner)
 * globs *.test.ts/*.test.tsx under node:test and never discovers
 * *.spec.* files. The test therefore moved here so CI actually runs it;
 * the vitest file keeps its remaining tests. Harness pattern follows
 * src/features/MarCard.test.tsx (JSDOM globals + createRoot + React.act),
 * and the client mock / IndexedDB fake are adapted from the spec file's
 * scaffolding, trimmed to what the ID step needs.
 *
 * The regression: an Enter that confirms an IME composition candidate
 * must not submit the ID step (modern-web-guidance:
 * ime-safe-enter-submit). The component reads e.nativeEvent.isComposing
 * and e.keyCode (229 = Safari's out-of-order variant). jsdom's
 * KeyboardEvent init ignores both, so the events below set them on the
 * constructed event via defineProperty — the same construction the
 * vitest version used.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { KioskPunchInput } from "./kioskClient";

/* --------------------- in-memory IndexedDB fake ---------------------- */
/* Copied from KioskClockPage.spec.tsx: jsdom ships without IndexedDB,
 * and useKioskSync reads the offline queue on mount. */

function installFakeIndexedDB() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const clone = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;
  class FakeRequest {
    result: unknown = undefined;
    error: unknown = null;
    onsuccess: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onupgradeneeded: ((e: unknown) => void) | null = null;
  }
  class FakeObjectStore {
    constructor(private map: Map<string, Record<string, unknown>>) {}
    private asyncOp(run: (req: FakeRequest) => void) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        try {
          run(req);
          req.onsuccess?.({ target: req });
        } catch (err) {
          req.error = err;
          req.onerror?.({ target: req });
        }
      });
      return req;
    }
    put(value: Record<string, unknown>) {
      return this.asyncOp((req) => {
        this.map.set(value.id as string, clone(value) as Record<string, unknown>);
        req.result = value.id;
      });
    }
    get(key: string) {
      return this.asyncOp((req) => {
        const found = this.map.get(key);
        req.result = found === undefined ? undefined : clone(found);
      });
    }
    getAll() {
      return this.asyncOp((req) => {
        req.result = [...this.map.values()].map(clone);
      });
    }
    delete(key: string) {
      return this.asyncOp((req) => {
        this.map.delete(key);
        req.result = undefined;
      });
    }
  }
  class FakeDB {
    objectStoreNames = { contains: (name: string) => stores.has(name) };
    createObjectStore(name: string) {
      stores.set(name, new Map());
    }
    transaction(storeName: string) {
      const tx = {
        oncomplete: null as ((e: unknown) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        error: null,
        objectStore: () => {
          const map = stores.get(storeName);
          if (!map) throw new Error(`no store ${storeName}`);
          return new FakeObjectStore(map);
        },
      };
      return tx;
    }
    close() {}
  }
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = new FakeRequest();
      queueMicrotask(() => {
        const db = new FakeDB();
        (req as { result: unknown }).result = db;
        if (!stores.has("punches")) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

/* --------------------------- client mock ----------------------------- */
/* Adapted from KioskClockPage.spec.tsx's makeClient: the ID step only
 * exercises resolveKioskToken, but the full client shape is provided so
 * the registered client satisfies the component wherever it reads it. */

const SITE = { siteId: "site-1", siteName: "Maple House", agencyId: "agency-1" };

function makeClient() {
  const submitted: Array<{ token: string; input: KioskPunchInput }> = [];
  const client = {
    resolveKioskToken: async () => ({ ...SITE }),
    verifyKioskPin: async () => ({ ok: true, staffId: "staff-1", displayName: "Test Staffer" }),
    suggestKioskShift: async () => ({
      shiftLabel: "Day 7a–3p",
      serviceType: "ISL Support",
      individualId: "ind-1",
      individualName: "Sample Individual",
    }),
    fetchKioskStatus: async () => ({
      clockedIn: false,
      sinceIso: null,
      scheduledShiftLabel: "Day 7a–3p",
      onBreak: false,
      breakSinceIso: null,
    }),
    fetchKioskIndividuals: async () => [{ id: "ind-1", name: "Sample Individual" }],
    submitKioskPunch: async (token: string, input: KioskPunchInput) => {
      submitted.push({ token, input });
      return { ok: true };
    },
  };
  return { client, submitted };
}

/* ------------------------------ harness ------------------------------ */

describe("kiosk ID step IME-safe Enter (rendered)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let KioskClockPage: typeof import("./KioskClockPage").default;
  let setKioskClient: typeof import("./kioskClient").setKioskClient;

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
    installFakeIndexedDB();
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    KioskClockPage = (await import("./KioskClockPage")).default;
    ({ setKioskClient } = await import("./kioskClient"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  async function mount() {
    const { client } = makeClient();
    setKioskClient(client as never);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(React.createElement(KioskClockPage, { token: "good-token" }));
      await settle();
    });
    return { container, root };
  }

  function buttonByText(container: HTMLElement, text: string): HTMLElement {
    const el = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    );
    assert.ok(el, `expected button: ${text}`);
    return el as HTMLElement;
  }

  async function pressDigits(container: HTMLElement, digits: string) {
    for (const d of digits) {
      const el = buttonByText(container, d);
      await React.act(async () => {
        el.click();
        await settle();
      });
    }
  }

  async function keyDownEnter(
    input: HTMLElement,
    props: { isComposing?: boolean; keyCode?: number },
  ) {
    const ev = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    if (props.isComposing !== undefined)
      Object.defineProperty(ev, "isComposing", { value: props.isComposing });
    if (props.keyCode !== undefined)
      Object.defineProperty(ev, "keyCode", { value: props.keyCode });
    await React.act(async () => {
      input.dispatchEvent(ev);
      await settle();
    });
  }

  it("does not continue on an IME-composition Enter, but does on a plain Enter", async () => {
    const { container, root } = await mount();
    const text = () => container.textContent ?? "";
    const idInput = () =>
      container.querySelector("#kiosk-employee-id") as HTMLInputElement | null;

    // Token resolved: the ID step is showing.
    assert.ok(idInput(), "expected the Employee ID input on the ID step");
    await pressDigits(container, "4321");
    assert.equal(idInput()?.value, "4321");

    // An Enter that confirms an IME composition candidate must not submit
    // (ime-safe-enter-submit); keyCode 229 is Safari's out-of-order variant.
    await keyDownEnter(idInput()!, { isComposing: true });
    assert.ok(!text().includes("Enter your PIN"), text());
    assert.ok(idInput(), "expected to still be on the ID step");

    await keyDownEnter(idInput()!, { keyCode: 229 });
    assert.ok(!text().includes("Enter your PIN"), text());
    assert.ok(idInput(), "expected to still be on the ID step");

    // A plain Enter continues to the PIN step.
    await keyDownEnter(idInput()!, {});
    assert.ok(text().includes("Enter your PIN"), text());

    await React.act(async () => root.unmount());
    container.remove();
  });
});
