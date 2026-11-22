import { useId, type ReactNode } from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
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
 *
 * UI SDK slice 8: the internals ride @ui-sdk/react's Collapsible. The panel
 * uses `keepMounted` so it stays mounted and `hidden` while closed, exactly
 * as the hand-rolled version behaved (panel content — e.g. the Appointments
 * secondary filter controls — never unmounts). The panel id and the
 * trigger's `aria-controls` are passed explicitly so the wiring is present
 * in the rendered markup exactly as before; the root's `is-open` class is
 * derived from the Collapsible state so the caret rotation rule in
 * styles.css keeps working unchanged.
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
  const panelId = useId();
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={(state) =>
        `disclosure${state.open ? " is-open" : ""}${className ? ` ${className}` : ""}`
      }
    >
      <CollapsibleTrigger
        className="disclosure-trigger"
        aria-controls={panelId}
      >
        <ChevronDown size={16} className="disclosure-caret" aria-hidden="true" />
        <span className="disclosure-label">{label}</span>
        {summary ? <span className="disclosure-summary">{summary}</span> : null}
      </CollapsibleTrigger>
      <CollapsiblePanel
        id={panelId}
        keepMounted
        className="disclosure-panel"
      >
        {children}
      </CollapsiblePanel>
    </Collapsible>
  );
}
