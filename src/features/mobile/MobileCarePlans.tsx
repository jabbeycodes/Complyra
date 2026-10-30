import { useCallback, useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canViewCare,
  canViewScreening,
  overdueCare,
  screeningStatus,
  type CareScreeningData,
} from "../../data/careScreening";
import { roleLabel } from "../../data/status";
import { PersonHeader } from "./MobileMar";
import {
  chartPlans,
  planAckCount,
  planAwaitingMyAck,
} from "./chartSections";
import type { WorkspaceIndividual } from "./types";

/**
 * Mobile Care Plans — the chart's Care plans and health screenings
 * section as a phone view over the same records (getCareScreeningData)
 * and the same action the chart offers staff day to day: acknowledging
 * the active plan (mutateCareScreening "acknowledge"). Plan authoring,
 * approval, and retirement stay on the desktop chart, as does screening
 * scheduling; screenings render read-only here. Gates mirror the chart
 * exactly: canViewCare to see the section at all (auditors read-only),
 * canViewScreening for the screenings list (DSPs never see it).
 */
export default function MobileCarePlans({
  api,
  session,
  person,
  staffNames,
  onOpenChart,
  onBack,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  /** Staff id → display name, for approver / acknowledgement lines. */
  staffNames: Map<string, string>;
  onOpenChart: (name: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<CareScreeningData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = canViewCare(session.roleKey);
  const showScreenings = canViewScreening(session.roleKey);

  const load = useCallback(async () => {
    if (!visible) return;
    try {
      setData(await api.getCareScreeningData(person.id));
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load care plans.",
      );
    }
  }, [api, person.id, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!visible) {
    return <p className="msh-empty">Care plans are not part of your role.</p>;
  }

  const nameOf = (id: string | null) =>
    id === session.userId
      ? session.fullName
      : (staffNames.get(id ?? "") ?? "Staff member");

  const acknowledge = async (planId: string) => {
    setBusy(true);
    setError("");
    try {
      await api.mutateCareScreening({ action: "acknowledge", id: planId });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the acknowledgment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const { current, history } = data ? chartPlans(data) : { current: [], history: [] };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Back
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />

      <h3 className="msh-pass-title">Care plans</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="msh-empty">Loading care plans…</p>}
      {data && current.length === 0 && (
        <p className="msh-empty">No active care plan.</p>
      )}
      {data &&
        current.map((plan) => (
          <article key={plan.id} className="msh-record-card">
            <strong>
              {plan.title} — {plan.status}
            </strong>
            {overdueCare(plan) && (
              <p className="msh-status-text">Review overdue</p>
            )}
            {plan.items.map((item, index) => (
              <div key={index} className="msh-record-item">
                <p>
                  <strong>{item.need}</strong>
                </p>
                <p>Goal: {item.goal}</p>
                <p>Interventions: {item.interventions}</p>
                <p>
                  Responsible roles:{" "}
                  {item.roles.map((role) => roleLabel(role)).join(", ")}
                </p>
                <p>Review date: {item.review_on}</p>
              </div>
            ))}
            {plan.approved_at && (
              <p className="msh-status-text">
                Approved {plan.approved_at.slice(0, 10)} by{" "}
                {nameOf(plan.approved_by)}.
              </p>
            )}
            <p className="msh-status-text">
              Staff acknowledgements ({planAckCount(data, plan.id)})
              {data.acknowledgements
                .filter((ack) => ack.plan_id === plan.id)
                .map(
                  (ack) =>
                    ` · ${nameOf(ack.user_id)} — ${ack.acknowledged_at.slice(0, 10)}`,
                )
                .join("")}
            </p>
            {planAwaitingMyAck(data, plan, session.userId, session.roleKey) && (
              <button
                type="button"
                className="msh-button primary block"
                disabled={busy}
                onClick={() => void acknowledge(plan.id)}
              >
                I have read and acknowledge this active plan
              </button>
            )}
          </article>
        ))}

      {data && showScreenings && (
        <>
          <h3 className="msh-pass-title">Health screenings</h3>
          <p className="msh-section-note">
            Schedules and results for {person.name}. Screening scheduling
            stays on the desktop chart.
          </p>
          {data.screenings.length === 0 && (
            <p className="msh-empty">No screenings scheduled.</p>
          )}
          <div className="msh-list">
            {data.screenings.map((screening) => {
              const type = data.types.find((row) => row.id === screening.type_id);
              return (
                <div key={screening.id} className="msh-row static">
                  <span className="msh-row-main">
                    <strong>
                      {type?.name ?? "Screening"} —{" "}
                      {type ? screeningStatus(screening, type) : "scheduled"}
                    </strong>
                    <small>
                      Last completed: {screening.last_completed_on ?? "Not recorded"} ·
                      Due: {screening.due_on} · Completed:{" "}
                      {screening.completed_on ?? "Not completed"}
                    </small>
                    <small>Result: {screening.result_note || "Not recorded"}</small>
                    <small>Follow-up: {screening.follow_up || "None recorded"}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {data && session.roleKey !== "dsp" && history.length > 0 && (
        <>
          <h3 className="msh-pass-title">Care plan history</h3>
          <div className="msh-list">
            {history.map((plan) => (
              <div key={plan.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>
                    {plan.title} — {plan.status}
                  </strong>
                  <small>
                    Created {plan.created_at.slice(0, 10)} · Approved{" "}
                    {plan.approved_at?.slice(0, 10) ?? "Never"} · Closed{" "}
                    {plan.retired_at?.slice(0, 10) ?? "—"}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="msh-section-note">Digital record generated by Complyrer.</p>
    </div>
  );
}
