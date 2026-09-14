/**
 * ComplyRer platform brand — hexagonal C-check mark + two-tone wordmark.
 * The mark is pure vector (no fonts), so it renders identically anywhere.
 * The wordmark uses the app's Manrope stack via CSS.
 */

export function ComplyRerMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="ComplyRer mark"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M103.3 35 60 10 16.7 35 16.7 85 60 110 103.3 85"
          stroke="#3f5c3b"
          strokeWidth="16"
        />
        <path d="M60 10 103.3 35" stroke="#6f815c" strokeWidth="16" />
        <path d="M60 110 103.3 85" stroke="#2f4630" strokeWidth="16" />
        <path
          d="M42 58l10 11 22-26"
          stroke="#8b5e3c"
          strokeWidth="11"
        />
      </g>
    </svg>
  );
}

export function ComplyRerWordmark({ size = 40 }: { size?: number }) {
  return (
    <span className="complyrer-lockup">
      <ComplyRerMark size={size} />
      <span className="complyrer-word">
        Comply<span className="complyrer-rer">Rer</span>
      </span>
    </span>
  );
}
