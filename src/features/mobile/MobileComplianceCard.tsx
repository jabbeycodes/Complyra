/**
 * Mobile home "My compliance" card — the personal clock, kept separate
 * from the "Today's tracking" operations donut above it (founder design,
 * 2026-10-29). Compact by design: percent current, how much needs
 * attention, and the single next item due. Tapping the card opens the
 * Employee Hub with the My Compliance tab selected — the same door the
 * desktop card uses.
 *
 * Data is the same readiness roll-up as everywhere else
 * (usePersonalCompliance over HrStore + rollupCompliance).
 */
import { ShieldCheck } from "lucide-react";
import type { SessionUser } from "../../data/types";
import {
  formatDueDate,
  readinessStatusLabel,
} from "../personalCompliance/personalCompliance";
import {
  usePersonalCompliance,
  type PersonalComplianceState,
} from "../personalCompliance/usePersonalCompliance";

export function MobileComplianceCardView({
  state,
  onOpen,
}: {
  state: PersonalComplianceState;
  onOpen: () => void;
}) {
  const { loading, error, summary } = state;
  const next = summary.attention[0];
  return (
    <button
      type="button"
      className="msh-compliance-card"
      onClick={onOpen}
      aria-label="My compliance. Open my compliance in the Employee Hub"
    >
      <span className="msh-compliance-head">
        <ShieldCheck size={18} aria-hidden="true" />
        <strong>My compliance</strong>
        {summary.total > 0 && !loading && !error && (
          <span className="msh-compliance-percent">
            {summary.percentCurrent}%
          </span>
        )}
        <span className="msh-chevron" aria-hidden="true">
          ›
        </span>
      </span>
      {error ? (
        <small role="alert">{error}</small>
      ) : loading ? (
        <small>Loading your compliance…</small>
      ) : summary.total === 0 ? (
        <small>No requirements assigned to your role right now. Readiness is not assessed; your New Hire Binder is separate.</small>
      ) : (
        <>
          <small>
            {summary.percentCurrent}% current · {summary.current} of{" "}
            {summary.total} complete
            {summary.attentionCount > 0
              ? ` · ${summary.attentionCount} need${summary.attentionCount === 1 ? "s" : ""} attention`
              : " · nothing needs attention"}
          </small>
          {next ? (
            <small className="msh-compliance-next">
              Next: {next.requirement.label} ·{" "}
              {readinessStatusLabel(next.status)}
              {next.dueOn ? ` · due ${formatDueDate(next.dueOn)}` : ""}
            </small>
          ) : (
            <small className="msh-compliance-next">Everything is current.</small>
          )}
        </>
      )}
    </button>
  );
}

export default function MobileComplianceCard({
  session,
  onOpen,
}: {
  session: SessionUser;
  onOpen: () => void;
}) {
  const state = usePersonalCompliance(session);
  return <MobileComplianceCardView state={state} onOpen={onOpen} />;
}
