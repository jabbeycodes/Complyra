import "./BrandLoader.css";

// BRAND-LOADER (founder request, 2026-10-31): the branded loading gate that
// replaces the bare "Loading workspace…" text screens. The mark is
// public/favicon.svg INLINED (never an <img>) so its strokes can animate:
// the shield's three green segments draw themselves in sequence, the check
// ticks in, then the whole mark breathes gently for as long as the gate is
// up. Pure CSS/SVG — no video, no Lottie, no dependencies. Timing lives in
// BrandLoader.css; under prefers-reduced-motion the mark renders static.

export interface BrandLoaderProps {
  /**
   * Status line under the mark. Every gate passes the exact text it showed
   * as bare text before this component, verbatim.
   */
  status?: string;
  /**
   * "full" (default): full-viewport, wordmark + status — app-level gates.
   * "compact": smaller mark + status, no wordmark — page-level fallbacks.
   */
  variant?: "full" | "compact";
}

export default function BrandLoader({
  status = "Loading workspace…",
  variant = "full",
}: BrandLoaderProps) {
  const compact = variant === "compact";
  return (
    <div className={`brand-loader brand-loader--${variant}`}>
      <div className="brand-loader-inner">
        <svg
          className="brand-loader-mark"
          viewBox="0 0 64 64"
          aria-hidden="true"
          focusable="false"
        >
          <rect width="64" height="64" rx="14" fill="#e8dcc8" />
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path
              className="brand-loader-seg brand-loader-seg--main"
              d="M55.38 18.5 32 5 8.62 18.5 8.62 45.5 32 59 55.38 45.5"
              stroke="#3f5c3b"
              strokeWidth="9"
              pathLength={100}
            />
            <path
              className="brand-loader-seg brand-loader-seg--top"
              d="M32 5 55.38 18.5"
              stroke="#6f815c"
              strokeWidth="9"
              pathLength={100}
            />
            <path
              className="brand-loader-seg brand-loader-seg--bottom"
              d="M32 59 55.38 45.5"
              stroke="#2f4630"
              strokeWidth="9"
              pathLength={100}
            />
            <path
              className="brand-loader-check"
              d="M22.5 31l5.5 6 12-14"
              stroke="#8b5e3c"
              strokeWidth="6"
              pathLength={100}
            />
          </g>
        </svg>
        {!compact && (
          <span className="complyrer-word brand-loader-word">
            Comply<span className="complyrer-rer">Rer</span>
          </span>
        )}
        <p role="status" className="brand-loader-status">
          {status}
        </p>
      </div>
    </div>
  );
}
