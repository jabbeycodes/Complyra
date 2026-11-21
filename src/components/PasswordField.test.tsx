import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import PasswordField from "./PasswordField";

describe("PasswordField", () => {
  it("renders a masked password input by default, never a text input", () => {
    const html = renderToStaticMarkup(
      <PasswordField
        id="temp-pw"
        label="Temporary password"
        value="typed-value"
        onChange={() => {}}
        minLength={8}
        required
      />,
    );
    assert.ok(html.includes('type="password"'), "input is masked by default");
    assert.ok(!html.includes('type="text"'), "no plain-text input renders");
  });

  it("keeps the label programmatically associated and offers the reveal toggle", () => {
    const html = renderToStaticMarkup(
      <PasswordField
        id="temp-pw"
        label="Temporary password"
        value=""
        onChange={() => {}}
      />,
    );
    assert.ok(html.includes('<label for="temp-pw">Temporary password</label>'));
    assert.ok(html.includes('id="temp-pw"'));
    assert.ok(html.includes('aria-label="Show password"'));
    assert.ok(html.includes('aria-pressed="false"'));
    assert.ok(html.includes('autoComplete="new-password"'));
  });
});

/**
 * Slice 4 interaction tests — the same field mounted in jsdom: typing
 * flows through the controlled value, the toggle shows/hides while
 * preserving it, and the native attributes land on the input. The
 * jsdom setup mirrors AppToast.test.tsx (slice 3).
 */
describe("PasswordField interactions (slice 4)", () => {
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

    ({ createRoot } = await import("react-dom/client"));
  });

  after(() => {
    dom.window.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

  async function mountField(props: {
    autoComplete?: string;
    minLength?: number;
    required?: boolean;
  }) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [value, setValue] = React.useState("");
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <PasswordField
            id="pw-field"
            label="Password"
            value={value}
            onChange={setValue}
            autoComplete={props.autoComplete}
            minLength={props.minLength}
            required={props.required}
          />
        </form>
      );
    }
    await React.act(async () => {
      root.render(<Harness />);
      await settle();
    });
    const input = container.querySelector("input") as HTMLInputElement;
    const toggle = container.querySelector(
      "button.password-toggle",
    ) as HTMLButtonElement;
    return { container, root, input, toggle };
  }

  async function unmount(root: { unmount: () => void }) {
    await React.act(async () => {
      root.unmount();
      await settle();
    });
  }

  async function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await React.act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle();
    });
  }

  it("renders masked with the house structure and toggle contract", async () => {
    const { container, root, input, toggle } = await mountField({});
    assert.equal(input.type, "password");
    assert.equal(input.id, "pw-field");
    const label = container.querySelector("label");
    assert.equal(label?.getAttribute("for"), "pw-field");
    assert.equal(label?.textContent, "Password");
    assert.ok(container.querySelector(".password-field"));
    assert.ok(container.querySelector('[data-slot="password-input"]'));
    assert.equal(toggle.type, "button");
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    assert.equal(toggle.getAttribute("aria-label"), "Show password");
    await unmount(root);
  });

  it("toggle shows and hides, preserving the typed value", async () => {
    const { root, input, toggle } = await mountField({});
    await type(input, "correct horse");
    assert.equal(input.value, "correct horse");
    await React.act(async () => {
      toggle.click();
      await settle();
    });
    assert.equal(input.type, "text");
    assert.equal(input.value, "correct horse");
    assert.equal(toggle.getAttribute("aria-pressed"), "true");
    assert.equal(toggle.getAttribute("aria-label"), "Hide password");
    await React.act(async () => {
      toggle.click();
      await settle();
    });
    assert.equal(input.type, "password");
    assert.equal(input.value, "correct horse");
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    await unmount(root);
  });

  it("carries autocomplete, required and minLength to the native input", async () => {
    const signIn = await mountField({ autoComplete: "current-password" });
    assert.equal(
      signIn.input.getAttribute("autocomplete"),
      "current-password",
    );
    await unmount(signIn.root);

    const setup = await mountField({ minLength: 8, required: true });
    assert.equal(setup.input.getAttribute("autocomplete"), "new-password");
    assert.equal(setup.input.required, true);
    assert.equal(setup.input.minLength, 8);
    await unmount(setup.root);
  });
});
