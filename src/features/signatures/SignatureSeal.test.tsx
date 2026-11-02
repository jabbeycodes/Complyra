import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { SignatureEvent } from "../../data/types";
import SignatureSeal, { signatureInvalidMessage } from "./SignatureSeal";

/**
 * Simulation expired-consent check (2026-11-02): an Individual chart
 * showed "Signature invalid — document changed after signing" without
 * naming the document, so the alert could not be acted on. The seal now
 * names the document when the caller threads its title through. These
 * tests pin the wording and render the real seal in jsdom with a stale
 * hash (the document changed after signing) to see the alert itself.
 */

describe("signatureInvalidMessage", () => {
  it("names the document when a title is given", () => {
    assert.equal(
      signatureInvalidMessage("Fall prevention delegation"),
      "Signature invalid — Fall prevention delegation changed after signing",
    );
  });

  it("falls back to the generic wording without a title", () => {
    assert.equal(
      signatureInvalidMessage(undefined),
      "Signature invalid — document changed after signing",
    );
    assert.equal(
      signatureInvalidMessage("  "),
      "Signature invalid — document changed after signing",
    );
  });
});

describe("SignatureSeal invalid alert", () => {
  let dom: JSDOM;
  let React: typeof import("react");
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
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // signatureUtils hashes with WebCrypto; Node provides it, jsdom's
    // window does not shadow the global the module resolves at runtime.
    if (!globalThis.crypto?.subtle) {
      setGlobal("crypto", (await import("node:crypto")).webcrypto);
    }

    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
  });

  after(() => {
    dom.window.close();
  });

  const event: SignatureEvent = {
    id: "evt-1",
    agencyId: "agency-1",
    userId: "nurse-1",
    signerName: "Nurse Morgan",
    documentType: "delegation_form",
    documentId: "doc-1",
    fieldName: "rn_signature",
    kind: "signature",
    // Deliberately not the hash of the payload below: the document
    // changed after signing, so the seal must fall to "invalid".
    documentHash: "0".repeat(64),
    signedAt: "2026-10-30T14:00:00.000Z",
  };

  async function renderSeal(documentTitle?: string): Promise<string> {
    const act = React.act;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(SignatureSeal, {
          event,
          documentType: "delegation_form",
          documentId: "doc-1",
          fieldName: "rn_signature",
          getDocumentPayload: () => ({ task: "Fall prevention", version: 2 }),
          documentTitle,
        }),
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

  it("the invalid alert names the document", async () => {
    const text = await renderSeal("Fall prevention delegation");
    assert.match(
      text,
      /Signature invalid — Fall prevention delegation changed after signing/,
    );
  });

  it("without a title the alert keeps the generic wording", async () => {
    const text = await renderSeal(undefined);
    assert.match(text, /Signature invalid — document changed after signing/);
  });
});
