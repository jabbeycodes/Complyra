import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Reusable disclosure for secondary chrome (#110 Cut A).
 *
 * Use for optional settings, secondary details, and long filter sets — anywhere
 * more than a few secondary controls would otherwise crowd a page. Peer primary
 * modes should use tabs instead (see the tablist usage in Employee Hub, Site
 * detail, and Mileage).
 *
 * Accessibility: the trigger is a real <button> that owns the accessible name,
 * toggles `aria-expanded`, and points at the region via `aria-controls`. Focus
 * order is preserved because the panel follows the trigger in the DOM. Secondary
 * groups default to collapsed per the craft brief.
 */
export default function Disclosure({
  label,
  children,
  defaultOpen = false,
  summary,
  className,
}: {
  /** Accessible name for the expandable region. */
  label: string;
  children: ReactNode;
  /** Secondary chrome should stay collapsed until asked for. */
  defaultOpen?: boolean;
  /** Optional muted hint shown next to the label (e.g. a count). */
  summary?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={`disclosure${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronDown size={16} className="disclosure-caret" aria-hidden="true" />
        <span className="disclosure-label">{label}</span>
        {summary ? <span className="disclosure-summary">{summary}</span> : null}
      </button>
      <div id={panelId} className="disclosure-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
