import { useEffect, useRef } from "react";
import { isBlankCanvas } from "./signatureUtils";

/**
 * Touch-first signature canvas: touch-action:none, pointer capture,
 * devicePixelRatio scaling. Emits the PNG data URL on stroke end only when
 * the canvas is non-blank, and null when cleared/blank.
 */
export default function SignaturePad({
  onChange,
  label = "Draw your signature",
  minHeight = 160,
}: {
  onChange: (dataUrl: string | null) => void;
  label?: string;
  minHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Size the canvas backing store from the wrapper's real width. The pad
  // usually mounts inside a native <dialog> that has not been shown yet, so
  // the mount-time measurement is 0 wide and the buffer ends up ~1px:
  // strokes are clipped and the canvas reads blank (simulation batch 9,
  // Finding 1). A ResizeObserver re-sizes the moment the wrapper gains a
  // real width, and resizing preserves any drawing already made.
  function sizeCanvas() {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const cssWidth = wrap.getBoundingClientRect().width;
    if (!(cssWidth > 1)) return;
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.round(cssWidth * dpr);
    const nextHeight = Math.round(minHeight * dpr);
    if (canvas.width === nextWidth && canvas.height === nextHeight) return;
    let snapshot: HTMLCanvasElement | null = null;
    if (canvas.width > 1 && canvas.height > 1 && !isBlankCanvas(canvas)) {
      snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    }
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvas.style.height = `${minHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#2b2620";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (snapshot) ctx.drawImage(snapshot, 0, 0, cssWidth, minHeight);
  }

  useEffect(() => {
    sizeCanvas();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sizeCanvas());
    observer.observe(wrap);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHeight]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChangeRef.current(
      isBlankCanvas(canvas) ? null : canvas.toDataURL("image/png"),
    );
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    // Re-apply the DPR transform the setup effect installed.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#2b2620";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    onChangeRef.current(null);
  }

  return (
    <div className="sig-pad">
      <div ref={wrapRef} className="sig-pad-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label={label}
          style={{ touchAction: "none", width: "100%", display: "block" }}
          onPointerDown={(e) => {
            e.preventDefault();
            // The dialog may have been shown without a resize reaching us
            // yet; never start a stroke on a degenerate buffer.
            if ((canvasRef.current?.width ?? 0) <= 1) sizeCanvas();
            canvasRef.current?.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            e.preventDefault();
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            const prev = last.current;
            if (!ctx || !prev) return;
            const next = point(e);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
            last.current = next;
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
            emit();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            last.current = null;
          }}
        />
      </div>
      <button type="button" className="text-button sig-pad-clear" onClick={clear}>
        Clear
      </button>
    </div>
  );
}
