import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { TOUR_STEPS } from "./tourSteps";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 10;
const CARD_WIDTH = 360;
const CARD_EST_HEIGHT = 300;

function targetBox(step: (typeof TOUR_STEPS)[number]): Box | null {
  const el = document.querySelector(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function DemoTour({
  onNavigate,
  onExit,
}: {
  onNavigate: (page: string) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [located, setLocated] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    setBox(null);
    setLocated(false);
    onNavigate(step.page);
    const locate = () => {
      if (cancelled) return;
      const found = targetBox(step);
      if (found) {
        const el = document.querySelector(`[data-tour="${step.target}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(() => {
          if (cancelled) return;
          const settled = targetBox(step);
          setBox(settled);
          setLocated(true);
        }, 350);
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        window.setTimeout(locate, 100);
      } else {
        setLocated(true); // fall back to a centered card
      }
    };
    const t = window.setTimeout(locate, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (!located || !box) return;
    const update = () => {
      const next = targetBox(step);
      if (next) setBox(next);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  useEffect(() => {
    if (located) cardRef.current?.focus();
  }, [located, index]);

  const go = (next: number) => {
    if (next >= TOUR_STEPS.length) {
      onExit();
      return;
    }
    setIndex(Math.max(0, next));
  };

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const cardWidth = Math.min(CARD_WIDTH, vw - 32);

  let cardStyle: CSSProperties;
  if (box) {
    const belowTop = box.top + box.height + PAD + 16;
    const fitsBelow = belowTop + CARD_EST_HEIGHT <= vh;
    const left = Math.max(
      16,
      Math.min(box.left, vw - cardWidth - 16),
    );
    cardStyle = fitsBelow
      ? { top: belowTop, left, width: cardWidth }
      : {
          top: Math.max(16, box.top - PAD - 16 - CARD_EST_HEIGHT),
          left,
          width: cardWidth,
        };
  } else {
    cardStyle = {
      top: "50%",
      left: "50%",
      width: cardWidth,
      transform: "translate(-50%, -50%)",
    };
  }

  const dim = "rgba(20, 28, 24, 0.62)";
  return (
    <div className="demo-tour" role="dialog" aria-modal="true" aria-label="Interactive demo tour">
      {box && (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top - PAD), background: dim }} />
          <div className="tour-dim" style={{ top: box.top + box.height + PAD, left: 0, right: 0, bottom: 0, background: dim }} />
          <div className="tour-dim" style={{ top: box.top - PAD, left: 0, width: Math.max(0, box.left - PAD), height: box.height + PAD * 2, background: dim }} />
          <div className="tour-dim" style={{ top: box.top - PAD, left: box.left + box.width + PAD, right: 0, height: box.height + PAD * 2, background: dim }} />
          <div
            className="tour-highlight"
            aria-hidden="true"
            style={{
              top: box.top - PAD,
              left: box.left - PAD,
              width: box.width + PAD * 2,
              height: box.height + PAD * 2,
            }}
          />
        </>
      )}
      {!box && located && <div className="tour-dim tour-dim-full" style={{ background: dim }} />}
      <div ref={cardRef} tabIndex={-1} className="tour-card" style={cardStyle}>
        <div className="tour-card-head">
          <span className="tour-step-count">
            Step {index + 1} of {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            className="tour-skip icon-button"
            onClick={onExit}
            aria-label="End tour"
          >
            <X size={18} />
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.target} className={i === index ? "on" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          <button
            type="button"
            className="button tour-nav"
            onClick={() => go(index - 1)}
            disabled={index === 0}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Back
          </button>
          <button
            type="button"
            className="tour-text-button"
            onClick={onExit}
            aria-label="Skip the guided tour and explore the demo freely"
          >
            Skip tour · Explore freely
          </button>
          <button
            type="button"
            className="button primary tour-nav"
            onClick={() => go(index + 1)}
          >
            {last ? "Finish" : "Next"} {!last && <ChevronRight size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
