import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * Finding 1 (simulation batch 9), Fix 2: the signature pad measured its
 * wrapper in a mount effect that runs before the parent native <dialog>
 * is shown — width 0, canvas buffer ~1px, strokes clipped, canvas reads
 * blank. The fix re-sizes via ResizeObserver when the wrapper gains a
 * real width.
 *
 * The repo has no DOM-canvas test harness, so this file builds the
 * smallest one: jsdom for the DOM, a recording fake 2D context (jsdom
 * has no canvas rasterizer), and a controllable fake ResizeObserver.
 * The wrapper's getBoundingClientRect is stubbed to play the dialog:
 * width 0 while "closed", 320 once "shown" — exactly the browser
 * sequence the fix targets.
 */

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

class FakeContext {
  painted = new Set<string>();
  private scaleFactor = 1;
  private path: { x: number; y: number }[] = [];
  private pen: { x: number; y: number } | null = null;
  strokeStyle = "";
  lineWidth = 1;
  lineCap = "";
  lineJoin = "";
  constructor(private readonly canvas: unknown) {
    void this.canvas;
  }
  setTransform(a: number) {
    this.scaleFactor = a;
  }
  scale(a: number) {
    this.scaleFactor *= a;
  }
  save() {}
  restore() {}
  clearRect() {
    this.painted.clear();
  }
  beginPath() {
    this.path = [];
    this.pen = null;
  }
  moveTo(x: number, y: number) {
    this.pen = { x, y };
  }
  lineTo(x: number, y: number) {
    if (this.pen) this.path.push(this.pen, { x, y });
    this.pen = { x, y };
  }
  stroke() {
    const s = this.scaleFactor;
    const r = Math.max(1, (this.lineWidth * s) / 2);
    for (let i = 0; i + 1 < this.path.length; i += 2) {
      const p = this.path[i];
      const q = this.path[i + 1];
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * s),
      );
      for (let step = 0; step <= steps; step++) {
        const cx = (p.x + ((q.x - p.x) * step) / steps) * s;
        const cy = (p.y + ((q.y - p.y) * step) / steps) * s;
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            this.painted.add(`${Math.round(cx + dx)},${Math.round(cy + dy)}`);
          }
        }
      }
    }
  }
  drawImage() {}
  getImageData(x: number, y: number, w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const key of this.painted) {
      const [px, py] = key.split(",").map(Number);
      if (px >= x && px < x + w && py >= y && py < y + h) {
        data[((py - y) * w + (px - x)) * 4 + 3] = 255;
      }
    }
    return { data, width: w, height: h, colorSpace: "srgb" };
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly cb: (entries: unknown[], observer: FakeResizeObserver) => void;
  constructor(cb: FakeResizeObserver["cb"]) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.cb([], this);
  }
}

describe("SignaturePad zero-width mount (dialog not yet shown)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let SignaturePad: typeof import("./SignaturePad").default;
  let isBlankCanvas: typeof import("./signatureUtils").isBlankCanvas;
  let wrapWidth = 0;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });
    const g = globalThis as Record<string, unknown>;
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
    setGlobal("ResizeObserver", FakeResizeObserver);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    void g;

    const contexts = new WeakMap<object, FakeContext>();
    dom.window.HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind !== "2d") return null;
      if (!contexts.has(this)) contexts.set(this, new FakeContext(this));
      return contexts.get(this);
    } as typeof HTMLCanvasElement.prototype.getContext;
    dom.window.HTMLCanvasElement.prototype.toDataURL = function () {
      return PNG_1X1;
    };
    dom.window.Element.prototype.setPointerCapture = () => {};

    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    SignaturePad = (await import("./SignaturePad")).default;
    ({ isBlankCanvas } = await import("./signatureUtils"));
  });

  after(() => {
    dom.window.close();
  });

  it("re-sizes when the wrapper gains width and emits a non-blank signature after a stroke", async () => {
    const act = React.act;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const emitted: (string | null)[] = [];
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(SignaturePad, {
          onChange: (value: string | null) => emitted.push(value),
        }),
      );
    });

    const wrap = container.querySelector(".sig-pad-canvas-wrap") as HTMLElement;
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    assert.ok(wrap && canvas, "pad rendered");
    // The dialog is still closed: any measurement is 0 wide.
    wrap.getBoundingClientRect = () =>
      ({
        width: wrapWidth,
        height: 160,
        top: 0,
        left: 0,
        right: wrapWidth,
        bottom: 160,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // The dialog opens: the wrapper gains a real width and the observer
    // fires, as a browser's ResizeObserver would.
    wrapWidth = 320;
    const observer = FakeResizeObserver.instances.at(-1);
    assert.ok(observer, "the pad registered a ResizeObserver");
    await act(async () => {
      observer.fire();
    });
    assert.equal(canvas.width, 320, "canvas buffer resized to the real width");
    assert.equal(isBlankCanvas(canvas), true, "still blank before drawing");

    const pointer = (type: string, x: number, y: number) => {
      const event = new dom.window.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
      }) as MouseEvent & { pointerId: number };
      event.pointerId = 1;
      canvas.dispatchEvent(event);
    };
    await act(async () => {
      pointer("pointerdown", 10, 20);
      pointer("pointermove", 60, 45);
      pointer("pointermove", 120, 30);
      pointer("pointerup", 120, 30);
    });

    assert.equal(isBlankCanvas(canvas), false, "the stroke painted pixels");
    assert.equal(emitted.length, 1, "one emit on stroke end");
    assert.equal(
      emitted[0],
      PNG_1X1,
      "a non-blank stroke emits the PNG data URL, not null",
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
