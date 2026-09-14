import { FlaskConical, LogOut, RotateCcw } from "lucide-react";

export default function DemoBanner({
  onRestartTour,
  onSignOut,
}: {
  onRestartTour: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-text">
        <FlaskConical size={16} aria-hidden="true" />
        <span>
          <strong>Interactive demo</strong>
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
          onClick={onRestartTour}
        >
          <RotateCcw size={15} aria-hidden="true" /> Restart tour
        </button>
        <button type="button" className="demo-banner-button" onClick={onSignOut}>
          <LogOut size={15} aria-hidden="true" /> Sign out
        </button>
      </span>
    </div>
  );
}
