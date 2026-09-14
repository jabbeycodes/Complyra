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

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = minHeight;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#2b2620";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
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
