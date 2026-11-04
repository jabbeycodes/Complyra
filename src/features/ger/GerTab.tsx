import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Plus } from "lucide-react";
import { Badge, Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { centralTodayIso } from "../../data/menuRecords";
import { openPrintable } from "../../data/openFile";
import { DIGITAL_RECORD_MARK } from "../../delegation/delegation";
import {
  GER_EVENT_TYPES,
  GER_SEVERITIES,
  canEditGerReportBody,
  deriveGerResolutionDisplay,
  type GerReport,
  type GerReportDraft,
  type GerSeverity,
} from "../../data/ger";

/**
 * Reporting tab (program site): event reports for the people at this home.
 * List + filters, the report form, reviewer decisions, and the follow-up
 * lifecycle (assign a manager, set a due date, investigate, resolve with a
 * closure note). Approved reports lock; drafts can be deleted by their
 * author. Auditors read everything here and change nothing.
 */

type SitePerson = { id: string; name: string };
type SiteStaffMember = { id: string; name: string; role: string; roleKey?: string };

const RESOLUTION_LABELS: Record<string, string> = {
  unaddressed: "Unaddressed",
  in_progress: "In progress",
  overdue: "Overdue",
  resolved: "Resolved",
};

function emptyDraft(siteId: string, individualId: string): GerReportDraft {
  const today = centralTodayIso();
  return {
    siteId,
    individualId,
    linkedIndividualIds: [],
    eventDate: today,
    eventTime: "",
    location: "",
    eventType: "Other",
    severity: "Moderate",
    description: "",
    immediateActions: "",
    notificationsMade: [],
    witnesses: "",
    reporterName: "",
    reporterSignature: "",
    reporterDate: today,
  };
}

function reportToDraft(report: GerReport): GerReportDraft {
  return {
    siteId: report.siteId,
    individualId: report.individualId,
    linkedIndividualIds: report.linkedIndividualIds,
    eventDate: report.eventDate,
    eventTime: report.eventTime,
    location: report.location,
    eventType: report.eventType,
    severity: report.severity,
    description: report.description,
    immediateActions: report.immediateActions,
    notificationsMade: report.notificationsMade,
    witnesses: report.witnesses,
    reporterName: report.reporterName,
    reporterSignature: report.reporterSignature,
    reporterDate: report.reporterDate,
  };
}

function gerPrintHtml(report: GerReport, individualName: string): string {
  const esc = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const notifications = report.notificationsMade.length
    ? report.notificationsMade
        .map((n) => `${esc(n.party)} — ${esc(n.name)} (${esc(n.atTime)})`)
        .join("<br>")
    : "None recorded";
  return `<!doctype html><html><head><title>Event report — ${esc(individualName)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;line-height:1.45}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:6px 8px;text-align:left;vertical-align:top}th{width:200px;background:#eee}</style>
</head><body>
<h1>Event report</h1>
<p><strong>${esc(individualName)}</strong> · ${esc(report.eventType)} · Severity: ${esc(report.severity)}</p>
<table>
<tr><th>Event date / time</th><td>${esc(report.eventDate)} ${esc(report.eventTime)}</td></tr>
<tr><th>Location</th><td>${esc(report.location)}</td></tr>
<tr><th>What happened</th><td>${esc(report.description)}</td></tr>
<tr><th>Immediate actions</th><td>${esc(report.immediateActions)}</td></tr>
<tr><th>Notifications made</th><td>${notifications}</td></tr>
<tr><th>Witnesses</th><td>${esc(report.witnesses)}</td></tr>
<tr><th>Reported by</th><td>${esc(report.reporterName)} — signed ${esc(report.reporterSignature)} on ${esc(report.reporterDate)}</td></tr>
<tr><th>Status</th><td>${esc(report.status)}</td></tr>
<tr><th>Follow-up</th><td>${esc(RESOLUTION_LABELS[deriveGerResolutionDisplay(report)] ?? report.resolutionStatus)}${report.closureNote ? ` — ${esc(report.closureNote)}` : ""}</td></tr>
</table>
<p><em>${DIGITAL_RECORD_MARK}</em></p>
</body></html>`;
}

export default function GerTab({
  siteId,
  siteName,
  individuals,
  staff,
}: {
  siteId: string;
  siteName: string;
  individuals: SitePerson[];
  staff: SiteStaffMember[];
}) {
  const { api, session } = useData();
  const [reports, setReports] = useState<GerReport[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "review" | "followup" | "resolved">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GerReportDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [resolution, setResolution] = useState({
    resolutionStatus: "unaddressed" as "unaddressed" | "in_progress" | "resolved",
    assignedManagerUserId: "",
    resolutionDueOn: "",
    investigationRequired: false,
    investigationNotes: "",
    closureNote: "",
  });

  const canCreate = session?.permissions["ger.create"] === true;
  const canReview = session?.permissions["ger.review"] === true;
  const canResolve = session?.permissions["ger.resolve"] === true;

  const load = useCallback(async () => {
    try {
      setReports(await api.listGerReports({ siteId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load event reports.");
    }
  }, [api, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useCallback(
    (id: string) => individuals.find((p) => p.id === id)?.name ?? "An Individual",
    [individuals],
  );

  const selected = useMemo(
    () => reports?.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  useEffect(() => {
    if (selected) {
      setResolution({
        resolutionStatus:
          selected.resolutionStatus === "resolved" ? "resolved" : selected.resolutionStatus === "in_progress" ? "in_progress" : "unaddressed",
        assignedManagerUserId: selected.assignedManagerUserId ?? "",
        resolutionDueOn: selected.resolutionDueOn ?? "",
        investigationRequired: selected.investigationRequired,
        investigationNotes: selected.investigationNotes,
        closureNote: selected.closureNote,
      });
    }
  }, [selected]);

  const visible = useMemo(() => {
    if (!reports) return [];
    switch (filter) {
      case "review":
        return reports.filter((r) => r.status === "submitted");
      case "followup":
        return reports.filter(
          (r) =>
            (r.status === "submitted" || r.status === "approved") &&
            r.resolutionStatus !== "resolved",
        );
      case "resolved":
        return reports.filter((r) => r.resolutionStatus === "resolved");
      default:
        return reports;
    }
  }, [reports, filter]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (submitAfter: boolean) => {
    if (!draft) return;
    await run(async () => {
      const saved = editingId
        ? await api.updateGerReport(editingId, draft)
        : await api.createGerReport(draft);
      if (submitAfter) await api.submitGerReport(saved.id);
      setDraft(null);
      setEditingId(null);
      setSelectedId(saved.id);
    });
  };

  if (!session) return null;

  return (
    <div className="ger-tab">
      <div className="panel">
        <div className="panel-heading">
          <h2>Event reports — {siteName}</h2>
          {canCreate && !draft && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setDraft(emptyDraft(siteId, individuals[0]?.id ?? ""));
                setEditingId(null);
              }}
            >
              <Plus size={15} aria-hidden /> New report
            </button>
          )}
        </div>
        <p className="muted">
          Significant events for the people at this home — what happened, who was
          told, and the follow-up until it is resolved.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {!draft && (
          <>
            <div className="ger-filters" role="group" aria-label="Filter reports">
              {(
                [
                  ["all", "All"],
                  ["review", "Awaiting review"],
                  ["followup", "Follow-up open"],
                  ["resolved", "Resolved"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${filter === id ? "selected" : ""}`}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {reports === null ? (
              <p className="muted">Loading…</p>
            ) : visible.length === 0 ? (
              <Empty title="No event reports match this view." mark="quiet" />
            ) : (
              <ul className="record-list">
                {visible.map((report) => {
                  const display = deriveGerResolutionDisplay(report);
                  return (
                    <li key={report.id} className="record-row">
                      <button
                        type="button"
                        className="record-row-main"
                        onClick={() => setSelectedId(report.id)}
                      >
                        <strong>
                          {report.eventType} — {nameOf(report.individualId)}
                        </strong>
                        <span className="muted">
                          {" "}
                          · {formatDate(report.eventDate)}
                          {report.eventTime ? ` ${report.eventTime}` : ""}
                        </span>
                        <span className="muted">
                          {" "}
                          · Follow-up: {RESOLUTION_LABELS[display]}
                        </span>
                      </button>
                      <Badge status={`Severity: ${report.severity}`} />
                      <Badge status={report.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {draft && (
          <form
            className="ger-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft(false);
            }}
          >
            <h3>{editingId ? "Edit event report" : "New event report"}</h3>
            <label>
              Individual
              <select
                value={draft.individualId}
                onChange={(e) => setDraft({ ...draft, individualId: e.target.value })}
                required
              >
                {individuals.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Other Individuals involved (optional)
              <select
                multiple
                value={draft.linkedIndividualIds ?? []}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    linkedIndividualIds: [...e.target.selectedOptions].map((o) => o.value),
                  })
                }
              >
                {individuals
                  .filter((p) => p.id !== draft.individualId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Event date
                <input
                  type="date"
                  value={draft.eventDate}
                  onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}
                  required
                />
              </label>
              <label>
                Event time
                <input
                  type="time"
                  value={draft.eventTime}
                  onChange={(e) => setDraft({ ...draft, eventTime: e.target.value })}
                />
              </label>
              <label>
                Event type
                <select
                  value={draft.eventType}
                  onChange={(e) =>
                    setDraft({ ...draft, eventType: e.target.value as GerReportDraft["eventType"] })
                  }
                >
                  {GER_EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Severity
                <select
                  value={draft.severity}
                  onChange={(e) =>
                    setDraft({ ...draft, severity: e.target.value as GerSeverity })
                  }
                >
                  {GER_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Location
              <input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </label>
            <label>
              What happened
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={4}
                required
              />
            </label>
            <label>
              Immediate actions / first aid
              <textarea
                value={draft.immediateActions}
                onChange={(e) => setDraft({ ...draft, immediateActions: e.target.value })}
                rows={3}
              />
            </label>
            <label>
              Notifications made (one per line: who — name — time)
              <textarea
                value={(draft.notificationsMade ?? [])
                  .map((n) => `${n.party} — ${n.name} — ${n.atTime}`)
                  .join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    notificationsMade: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const [party = "", name = "", atTime = ""] = line
                          .split("—")
                          .map((part) => part.trim());
                        return { party, name, atTime };
                      }),
                  })
                }
                rows={3}
              />
            </label>
            <label>
              Witnesses
              <input
                value={draft.witnesses}
                onChange={(e) => setDraft({ ...draft, witnesses: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Reporting staff name
                <input
                  value={draft.reporterName}
                  onChange={(e) => setDraft({ ...draft, reporterName: e.target.value })}
                  required
                />
              </label>
              <label>
                Electronic signature (type full name)
                <input
                  value={draft.reporterSignature}
                  onChange={(e) =>
                    setDraft({ ...draft, reporterSignature: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                Report date
                <input
                  type="date"
                  value={draft.reporterDate}
                  onChange={(e) => setDraft({ ...draft, reporterDate: e.target.value })}
                  required
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="button" disabled={busy}>
                Save draft
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void saveDraft(true)}
              >
                Save and submit
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  setDraft(null);
                  setEditingId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {selected && !draft && (
        <div className="panel ger-detail">
          <div className="panel-heading">
            <h3>
              {selected.eventType} — {nameOf(selected.individualId)}
            </h3>
            <button
              type="button"
              className="button"
              onClick={() =>
                void openPrintable(
                  `event-report-${selected.id}.html`,
                  new Blob([gerPrintHtml(selected, nameOf(selected.individualId))], {
                    type: "text/html",
                  }),
                  "print",
                )
              }
            >
              <Printer size={15} aria-hidden /> Print
            </button>
          </div>
          <dl className="ger-fields">
            <dt>Severity</dt>
            <dd>{selected.severity}</dd>
            <dt>When</dt>
            <dd>
              {formatDate(selected.eventDate)}
              {selected.eventTime ? ` at ${selected.eventTime}` : ""} · {selected.location || "—"}
            </dd>
            <dt>What happened</dt>
            <dd>{selected.description}</dd>
            <dt>Immediate actions</dt>
            <dd>{selected.immediateActions || "—"}</dd>
            <dt>Notifications</dt>
            <dd>
              {selected.notificationsMade.length
                ? selected.notificationsMade
                    .map((n) => `${n.party} — ${n.name} (${n.atTime})`)
                    .join("; ")
                : "None recorded"}
            </dd>
            <dt>Witnesses</dt>
            <dd>{selected.witnesses || "—"}</dd>
            {selected.linkedIndividualIds.length > 0 && (
              <>
                <dt>Also involved</dt>
                <dd>{selected.linkedIndividualIds.map(nameOf).join(", ")}</dd>
              </>
            )}
            <dt>Reported by</dt>
            <dd>
              {selected.reporterName} — signed {selected.reporterSignature} on{" "}
              {formatDate(selected.reporterDate)}
            </dd>
            <dt>Status</dt>
            <dd>
              {selected.status}
              {selected.reviewNote ? ` — ${selected.reviewNote}` : ""}
            </dd>
          </dl>

          {canEditGerReportBody(selected, session) && canCreate && (
            <div className="form-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setDraft(reportToDraft(selected));
                  setEditingId(selected.id);
                }}
              >
                Edit report
              </button>
              {selected.status !== "submitted" && selected.status !== "approved" && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.submitGerReport(selected.id);
                    })
                  }
                >
                  Submit for review
                </button>
              )}
              {selected.status === "draft" && (
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.deleteGerReport(selected.id);
                      setSelectedId(null);
                    })
                  }
                >
                  Delete draft
                </button>
              )}
            </div>
          )}

          {selected.status === "submitted" && canReview && (
            <div className="ger-review">
              <h4>Review</h4>
              <label>
                Review note
                <input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Required context for a return; optional on approval"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.reviewGerReport(selected.id, "approved", reviewNote);
                      setReviewNote("");
                    })
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.reviewGerReport(selected.id, "returned", reviewNote);
                      setReviewNote("");
                    })
                  }
                >
                  Return for corrections
                </button>
              </div>
            </div>
          )}

          {(selected.status === "submitted" || selected.status === "approved") && (
            <div className="ger-resolution">
              <h4>
                Follow-up — {RESOLUTION_LABELS[deriveGerResolutionDisplay(selected)]}
              </h4>
              {canResolve ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await api.updateGerResolution(selected.id, {
                        resolutionStatus: resolution.resolutionStatus,
                        assignedManagerUserId: resolution.assignedManagerUserId || null,
                        resolutionDueOn: resolution.resolutionDueOn || null,
                        investigationRequired: resolution.investigationRequired,
                        investigationNotes: resolution.investigationNotes,
                        closureNote: resolution.closureNote,
                      });
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Follow-up status
                      <select
                        value={resolution.resolutionStatus}
                        onChange={(e) =>
                          setResolution({
                            ...resolution,
                            resolutionStatus: e.target.value as typeof resolution.resolutionStatus,
                          })
                        }
                      >
                        <option value="unaddressed">Unaddressed</option>
                        <option value="in_progress">In progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </label>
                    <label>
                      Assigned manager
                      <select
                        value={resolution.assignedManagerUserId}
                        onChange={(e) =>
                          setResolution({
                            ...resolution,
                            assignedManagerUserId: e.target.value,
                          })
                        }
                      >
                        <option value="">Unassigned</option>
                        {staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} — {member.role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Due date
                      <input
                        type="date"
                        value={resolution.resolutionDueOn}
                        onChange={(e) =>
                          setResolution({ ...resolution, resolutionDueOn: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={resolution.investigationRequired}
                      onChange={(e) =>
                        setResolution({
                          ...resolution,
                          investigationRequired: e.target.checked,
                        })
                      }
                    />
                    Investigation required
                  </label>
                  {resolution.investigationRequired && (
                    <label>
                      Investigation notes
                      <textarea
                        value={resolution.investigationNotes}
                        onChange={(e) =>
                          setResolution({
                            ...resolution,
                            investigationNotes: e.target.value,
                          })
                        }
                        rows={3}
                      />
                    </label>
                  )}
                  <label>
                    Closure note (required to resolve)
                    <textarea
                      value={resolution.closureNote}
                      onChange={(e) =>
                        setResolution({ ...resolution, closureNote: e.target.value })
                      }
                      rows={2}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="submit" className="button primary" disabled={busy}>
                      Save follow-up
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted">
                  {selected.assignedManagerUserId
                    ? `Assigned to ${staff.find((s) => s.id === selected.assignedManagerUserId)?.name ?? "a manager"}`
                    : "Not yet assigned"}
                  {selected.resolutionDueOn
                    ? ` · due ${formatDate(selected.resolutionDueOn)}`
                    : ""}
                  {selected.closureNote ? ` · ${selected.closureNote}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
