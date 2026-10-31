import { useEffect, useState } from "react";
import { Badge, Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import { canSeeGerDashboardRows } from "../../data/dashboard";
import {
  deriveGerResolutionDisplay,
  gerNeedsFollowUp,
  type GerReport,
} from "../../data/ger";

/**
 * Overview dashboard sections for event reports: what is waiting for a
 * reviewer's decision, and what follow-up is still open (unaddressed or
 * overdue first). Data comes from listAgencyGerReports, which is already
 * site-scoped per session; rows open the Individual's chart.
 */
export default function GerDashboardSections({
  onOpenPerson,
  siteId = null,
}: {
  onOpenPerson: (name: string) => void;
  siteId?: string | null;
}) {
  const { api, session, workspace } = useData();
  const [error, setError] = useState("");
  const [reports, setReports] = useState<GerReport[] | null>(null);

  const visible = canSeeGerDashboardRows(session);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setReports(null);
    setError("");
    api
      .listAgencyGerReports()
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Event reports unavailable. This is not an all-clear result.");
      });
    return () => {
      cancelled = true;
    };
  }, [api, visible, session?.agencyId, session?.userId, workspace]);

  if (!visible) return null;
  if (error) return <section className="panel" role="alert">{error}</section>;
  if (reports === null) return <p role="status">Loading event reports…</p>;
  const scopedReports = reports.filter(row => !siteId || row.siteId === siteId);

  const nameOf = (id: string) =>
    workspace?.individuals.find((p) => p.id === id)?.name ?? "An Individual";
  const siteNameOf = (siteId: string) =>
    workspace?.sites.find((s) => s.id === siteId)?.name ?? "";

  const awaitingReview = scopedReports.filter((r) => r.status === "submitted");
  const followUp = scopedReports.filter((r) => gerNeedsFollowUp(r));

  if (awaitingReview.length === 0 && followUp.length === 0) return null;

  return (
    <>
      {awaitingReview.length > 0 && (
        <section className="panel ger-dashboard-panel">
          <div className="panel-heading">
            <h2>Event reports awaiting review</h2>
            <span className="muted">{awaitingReview.length} waiting</span>
          </div>
          <ul className="record-list">
            {awaitingReview.map((report) => (
              <li key={report.id} className="record-row">
                <button
                  type="button"
                  className="record-row-main"
                  onClick={() => onOpenPerson(nameOf(report.individualId))}
                >
                  <strong>
                    {report.eventType} — {nameOf(report.individualId)}
                  </strong>
                  <span className="muted">
                    {" "}
                    · {siteNameOf(report.siteId)} · {report.eventDate}
                  </span>
                </button>
                <Badge status={`Severity: ${report.severity}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {followUp.length > 0 && (
        <section className="panel ger-dashboard-panel">
          <div className="panel-heading">
            <h2>Event follow-up</h2>
            <span className="muted">{followUp.length} open</span>
          </div>
          <ul className="record-list">
            {followUp.map((report) => {
              const display = deriveGerResolutionDisplay(report);
              return (
                <li key={report.id} className="record-row">
                  <button
                    type="button"
                    className="record-row-main"
                    onClick={() => onOpenPerson(nameOf(report.individualId))}
                  >
                    <strong>
                      {report.eventType} — {nameOf(report.individualId)}
                    </strong>
                    <span className="muted">
                      {" "}
                      · {siteNameOf(report.siteId)} · {report.eventDate}
                      {report.resolutionDueOn
                        ? ` · due ${report.resolutionDueOn}`
                        : ""}
                    </span>
                  </button>
                  <Badge
                    status={
                      display === "overdue"
                        ? "Follow-up overdue"
                        : display === "unaddressed"
                          ? "Unaddressed"
                          : "In progress"
                    }
                  />
                </li>
              );
            })}
          </ul>
          {followUp.length === 0 && <Empty title="Nothing needs follow-up." mark="quiet" />}
        </section>
      )}
    </>
  );
}
