import { useState } from "react";
import { FlaskConical, LogOut, RotateCcw, X } from "lucide-react";

const DISMISS_KEY = "complyrer.demo-banner";

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "hidden";
  } catch {
    return false;
  }
}

export default function DemoBanner({
  onRestartTour,
  onSignOut,
}: {
  onRestartTour: () => void;
  onSignOut: () => void;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  function hide() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "hidden");
    } catch {
      /* private mode — still hide for this visit */
    }
    setDismissed(true);
  }

  return (
    <div className="demo-banner" role="note" aria-label="Demo workspace">
      <span className="demo-banner-text">
        <FlaskConical size={16} aria-hidden="true" />
        <span>
          <strong>Demo</strong>
          <span className="demo-banner-sub">
            {" "}
            · Fictional Evergreen Care data
          </span>
        </span>
      </span>
      <span className="demo-banner-actions">
        <button
          type="button"
          className="demo-banner-button"
          aria-label="Restart tour"
          onClick={onRestartTour}
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span className="demo-banner-button-label">Restart tour</span>
        </button>
        <button
          type="button"
          className="demo-banner-button"
          aria-label="Sign out"
          onClick={onSignOut}
        >
          <LogOut size={15} aria-hidden="true" />
          <span className="demo-banner-button-label">Sign out</span>
        </button>
        <button
          type="button"
          className="demo-banner-button demo-banner-dismiss"
          aria-label="Hide demo banner"
          onClick={hide}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
