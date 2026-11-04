import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";

/**
 * OneTimeSecret — the ONLY way a credential is ever shown after creation.
 *
 * A temporary password exists on screen for exactly one reason: the
 * person who created the account must hand it to its owner once. This
 * control keeps that handover deliberate:
 * - Masked by default with a fixed-length mask (the real value — and
 *   even its length — is not in the rendered page until revealed).
 * - "Show" is an explicit, reversible reveal; "Copy" hands the value
 *   over without ever displaying it.
 * - When the parent supplies onDone, "Done" clears the value from the
 *   screen entirely. The value also disappears whenever the surface
 *   unmounts (navigation, modal close, refresh) — it is never written
 *   to a list, summary, or read-only view.
 */
const MASK = "••••••••••";

export default function OneTimeSecret({
  value,
  onDone,
}: {
  value: string;
  onDone?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context): the Show
      // action still lets the creator read and hand over the value.
    }
  }

  return (
    <span className="onetime-secret">
      {revealed ? (
        <strong className="onetime-secret-value">{value}</strong>
      ) : (
        <>
          <span className="onetime-secret-mask" aria-hidden="true">
            {MASK}
          </span>
          <span className="sr-only">Password hidden</span>
        </>
      )}
      <span className="onetime-secret-actions">
        <button
          type="button"
          className="text-button"
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? (
            <EyeOff size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
          )}{" "}
          {revealed ? "Hide" : "Show"}
        </button>
        <button type="button" className="text-button" onClick={() => void copy()}>
          {copied ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
        {onDone && (
          <button type="button" className="text-button" onClick={onDone}>
            Done
          </button>
        )}
      </span>
    </span>
  );
}
