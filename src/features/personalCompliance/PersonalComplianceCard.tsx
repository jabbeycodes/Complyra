/**
 * Personal compliance on the desktop Overview (founder design, 2026-10-29:
 * personal accountability is visible everywhere, in the same grammar as
 * house compliance).
 *
 * Two placements, one data source (usePersonalCompliance — the same
 * readiness roll-up behind Employee Hub → My Compliance):
 *  - Overview strip: roles that see the house compliance donuts get this
 *    slim strip pinned directly above the House compliance section. It is
 *    site-independent — the site filter never changes whose compliance it
 *    shows; it is always the signed-in user's own.
 *  - Overview card: roles without house donuts get the full card as the
 *    lead element of their Overview: donut, headline, and the first three
 *    attention items.
 *
 * Both end at the same door: "View my compliance" opens the Employee Hub
 * with the My Compliance tab selected.
 */
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useData } from "../../data/DataProvider";
import ReadinessDonut from "./ReadinessDonut";
import {
  HOUSE_DONUT_ROLES,
  formatDueDate,
  personalComplianceSegments,
  readinessStatusLabel,
} from "./personalCompliance";
import {
  usePersonalCompliance,
  type PersonalComplianceState,
} from "./usePersonalCompliance";

const ATTENTION_PREVIEW = 3;

/* ------------------------------ full card -------------------------------- */

export function PersonalComplianceCardView({
  state,
  onView,
}: {
  state: PersonalComplianceState;
  onView: () => void;
}) {
  const { loading, error, summary } = state;
  return (
    <section className="panel personal-compliance" aria-label="My compliance">
      <div className="panel-heading">
        <div>
          <h2>
            <ShieldCheck size={16} /> My compliance
          </h2>
          <p>
            Your certifications, trainings, and document acknowledgments —
            what you need to complete and what is coming up.
          </p>
        </div>
        <button type="button" className="text-button" onClick={onView}>
          View my compliance <ArrowRight size={14} />
        </button>
      </div>
      {error ? (
        <div className="personal-compliance-error" role="alert">
          {error}
        </div>
      ) : loading ? (
        <p className="personal-compliance-note">Loading your compliance…</p>
      ) : summary.total === 0 ? (
        <p className="personal-compliance-note">
          No requirements assigned — nothing is tracking against your role
          right now.
        </p>
      ) : (
        <>
          <p className="personal-compliance-score">
            <strong>{summary.percentCurrent}%</strong> current ·{" "}
            {summary.current} of {summary.total} complete
            {summary.attentionCount > 0
              ? ` · ${summary.attentionCount} need${summary.attentionCount === 1 ? "s" : ""} your attention`
              : " · nothing needs your attention"}
          </p>
          <ReadinessDonut
            segments={personalComplianceSegments(summary)}
            total={summary.total}
          />
          {summary.attention.length > 0 && (
            <ul className="personal-compliance-attention">
              {summary.attention.slice(0, ATTENTION_PREVIEW).map((item) => (
                <li key={item.requirement.id}>
                  <span className="personal-compliance-item-main">
                    <strong>{item.requirement.label}</strong>
                    <small>
                      {item.requirement.kind}
                      {item.dueOn ? ` · due ${formatDueDate(item.dueOn)}` : ""}
                    </small>
                  </span>
                  <span className="personal-compliance-item-status">
                    {readinessStatusLabel(item.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Overview lead card — renders for roles that do NOT get house donuts. */
export default function PersonalComplianceOverviewCard({
  onView,
}: {
  onView: () => void;
}) {
  const { session } = useData();
  const state = usePersonalCompliance(
    session && !HOUSE_DONUT_ROLES.has(session.roleKey) ? session : null,
  );
  if (!session || HOUSE_DONUT_ROLES.has(session.roleKey)) return null;
  return <PersonalComplianceCardView state={state} onView={onView} />;
}

/* ------------------------------- strip ----------------------------------- */

export function PersonalComplianceStripView({
  state,
  onView,
}: {
  state: PersonalComplianceState;
  onView: () => void;
}) {
  const { loading, error, summary }: PersonalComplianceState = state;
  return (
    <section className="panel personal-strip" aria-label="My compliance">
      {summary.total > 0 ? (
        <ReadinessDonut
          segments={personalComplianceSegments(summary)}
          total={summary.total}
          variant="mini"
        />
      ) : (
        <span className="personal-strip-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
      )}
      <div className="personal-strip-copy">
        <strong>My compliance</strong>
        {error ? (
          <span role="alert">{error}</span>
        ) : loading ? (
          <span>Loading your compliance…</span>
        ) : summary.total === 0 ? (
          <span>No requirements assigned to your role right now.</span>
        ) : (
          <span>
            <strong>{summary.percentCurrent}%</strong> current ·{" "}
            {summary.current} of {summary.total} complete
            {summary.attentionCount > 0
              ? ` · ${summary.attentionCount} item${summary.attentionCount === 1 ? "" : "s"} need${summary.attentionCount === 1 ? "s" : ""} your attention`
              : " · nothing needs your attention"}
          </span>
        )}
      </div>
      <button type="button" className="text-button" onClick={onView}>
        View my compliance <ArrowRight size={14} />
      </button>
    </section>
  );
}

/** Overview strip — renders for the roles that see the house donuts. */
export function PersonalComplianceStrip({
  onView,
}: {
  onView: () => void;
}) {
  const { session } = useData();
  const state = usePersonalCompliance(
    session && HOUSE_DONUT_ROLES.has(session.roleKey) ? session : null,
  );
  if (!session || !HOUSE_DONUT_ROLES.has(session.roleKey)) return null;
  return <PersonalComplianceStripView state={state} onView={onView} />;
}
