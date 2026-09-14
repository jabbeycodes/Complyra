import { STATUS_META, type ComplianceStatus } from "../data/complianceStatus";
import "./StatusBadge.css";

// LIFEPATH-PHASE1-WS3 (accessible status system): the ONE shared status
// badge. Every status is distinguishable without color — each gets a unique
// icon SHAPE plus a visible text label plus its color — and every text/
// background pair meets WCAG AA (>= 4.5:1). See StatusBadge.css for the
// documented contrast pairs. Do not invent per-surface status dots/text;
// import this instead:
//   import StatusBadge from "../../components/StatusBadge";

export interface StatusBadgeProps {
  status: ComplianceStatus;
  /** "sm" for dense rows/tables, "md" (default) everywhere else. */
  size?: "sm" | "md";
  /**
   * Optional label override for edge cases where the canonical label would
   * mislead (e.g. a waived training line rendered with status="compliant"
   * must still read "N/A"). The icon shape stays the same.
   */
  label?: string;
}

/**
 * Renders <span role="status"> with the icon (aria-hidden, shapes only) and
 * the text label (also the aria-label, so screen readers announce it).
 * Non-interactive: inline-flex, >= 14px text, no pointer target needed.
 */
export default function StatusBadge({
  status,
  size = "md",
  label,
}: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const text = label ?? meta.label;
  return (
    <span
      className={`status-badge status-badge--${status} status-badge--${size}`}
      role="status"
      aria-label={text}
      title={meta.description}
    >
      <span className="status-badge__icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="status-badge__label">{text}</span>
    </span>
  );
}
