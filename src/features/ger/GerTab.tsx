/**
 * GER reporting tab for a program site: the list of event reports with
 * filters, the report form (draft), the detail view, and the
 * submit → review → approve/return workflow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import type { GerReportView, GerNotificationMadeRow } from "../../data/types";
import { downloadBlob } from "../../data/openFile";
import {
  GER_EVENT_TYPES,
  GER_EVENT_TYPE_LABELS,
  GER_SEVERITIES,
  GER_SEVERITY_LABELS,
  GER_STATUSES,
  GER_STATUS_LABELS,
  GER_NOTIFICATION_CHANNELS,
  GER_NOTIFICATION_CHANNEL_LABELS,
  EMPTY_GER_FILTERS,
  validateGerInput,
  canCreateGerReport,
  canReviewGerReport,
  canEditGerReportBody,
  canDecideGerReport,
  type GerEventType,
  type GerSeverity,
  type GerStatus,
  type GerNotificationChannel,
  type GerReportFilters,
  type GerReportCore,
} from "../../data/ger";
import { buildGerReportPdf, gerReportFileName } from "../../pdf/gerPdf";
import "./ger.css";

export interface GerTabIndividual {
  id: string;
  name: string;
}

interface GerTabProps {
  siteId: string;
  siteName: string;
  individuals: GerTabIndividual[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankNotification(): GerNotificationMadeRow {
  return { channel: "guardian", name: "", notifiedAt: "" };
}

interface FormState {
  individualId: string;
  eventDate: string;
  eventTime: string;
  location: string;
  eventType: GerEventType | "";
  severity: GerSeverity;
  description: string;
  actionsTaken: string;
  notificationsMade: GerNotificationMadeRow[];
  witnesses: string;
  reportedByName: string;
  signatureName: string;
}

function formFromReport(report: GerReportView): FormState {
  return {
    individualId: report.individualId,
    eventDate: report.eventDate,
    eventTime: report.eventTime,
    location: report.location,
    eventType: (report.eventType || "") as GerEventType | "",
    severity: (GER_SEVERITIES as readonly string[]).includes(report.severity)
      ? (report.severity as GerSeverity)
      : "low",
    description: report.description,
    actionsTaken: report.actionsTaken,
    notificationsMade:
      report.notificationsMade.length > 0 ? [...report.notificationsMade] : [blankNotification()],
    witnesses: report.witnesses,
    reportedByName: report.reportedByName,
    signatureName: report.signatureName,
  };
}

function blankForm(reporterName: string): FormState {
  return {
    individualId: "",
    eventDate: todayIso(),
    eventTime: "",
    location: "",
    eventType: "",
    severity: "low",
    description: "",
    actionsTaken: "",
    notificationsMade: [blankNotification()],
    witnesses: "",
    reportedByName: reporterName,
    signatureName: "",
  };
}

function formErrors(form: FormState, forSubmit: boolean): string[] {
  const core: GerReportCore = {
    individualId: form.individualId,
    eventDate: form.eventDate,
    eventTime: form.eventTime,
    location: form.location,
    eventType: (form.eventType || "other") as GerEventType,
    severity: form.severity,
    description: form.description,
    actionsTaken: form.actionsTaken,
    notificationsMade: form.notificationsMade
      .filter((n) => n.channel || n.name || n.notifiedAt)
      .map((n) => ({
        channel: (n.channel || "other") as GerNotificationChannel,
        name: n.name,
        notifiedAt: n.notifiedAt,
      })),
    witnesses: form.witnesses,
    reportedByName: form.reportedByName,
    signatureName: form.signatureName,
  };
  return validateGerInput(core, { forSubmit }).map((e) => e.message);
}

export default function GerTab({ siteId, siteName, individuals }: GerTabProps) {
  const { api, session } = useData();
  const [reports, setReports] = useState<GerReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<GerReportFilters>(EMPTY_GER_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [formProblems, setFormProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const canCreate = canCreateGerReport(session);
  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.listGerReports(siteId, filters);
      setReports(rows);
      if (selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load event reports.");
    } finally {
      setLoading(false);
    }
  }, [api, siteId, filters, selectedId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, filters]);

  function setForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormState((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveForm(forSubmit: boolean) {
    if (!formState) return;
    const problems = formErrors(formState, forSubmit);
    setFormProblems(problems);
    if (problems.length > 0) {
      setFormError(
        forSubmit
          ? "The report is not ready to submit yet. Fix the items listed above."
          : "Fix the items listed above to save.",
      );
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        individualId: formState.individualId,
        eventDate: formState.eventDate,
        eventTime: formState.eventTime,
        location: formState.location.trim(),
        eventType: formState.eventType as string,
        severity: formState.severity,
        description: formState.description.trim(),
        actionsTaken: formState.actionsTaken.trim(),
        notificationsMade: formState.notificationsMade.filter(
          (n) => n.channel || n.name.trim() || n.notifiedAt,
        ),
        witnesses: formState.witnesses.trim(),
        reportedByName: formState.reportedByName.trim(),
        signatureName: formState.signatureName.trim(),
      };
      const saved = editingId
        ? await api.updateGerReport(editingId, payload)
        : await api.addGerReport({ siteId, ...payload });
      if (forSubmit) await api.submitGerReport(saved.id);
      setFormState(null);
      setEditingId(null);
      setSelectedId(saved.id);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the report.");
    } finally {
      setSaving(false);
    }
  }

  async function review(decision: "approve" | "return") {
    if (!selected) return;
    if (decision === "return" && !reviewNote.trim()) {
      setError("Add a note explaining what needs to be corrected before returning the report.");
      return;
    }
    setReviewBusy(true);
    setError("");
    try {
      await api.reviewGerReport(selected.id, decision, reviewNote.trim());
      setReviewNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the review decision.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function downloadPdf(report: GerReportView) {
    setDownloading(true);
    setError("");
    try {
      const doc = buildGerReportPdf({
        report,
        agencyName: session?.agencyName ?? "Agency",
      });
      const blob = doc.output("blob") as Blob;
      downloadBlob(gerReportFileName(report), blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  const filterBar = (
    <div className="ger-filters" role="search" aria-label="Filter event reports">
      <label>
        Individual
        <select
          value={filters.individualId}
          onChange={(e) => setFilters((f) => ({ ...f, individualId: e.target.value }))}
        >
          <option value="">All</option>
          {individuals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Event type
        <select
          value={filters.eventType}
          onChange={(e) =>
            setFilters((f) => ({ ...f, eventType: e.target.value as GerReportFilters["eventType"] }))
          }
        >
          <option value="">All</option>
          {GER_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {GER_EVENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({ ...f, status: e.target.value as GerReportFilters["status"] }))
          }
        >
          <option value="">All</option>
          {GER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {GER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
        />
      </label>
      <button
        type="button"
        className="ger-filter-clear"
        onClick={() => setFilters(EMPTY_GER_FILTERS)}
      >
        Clear
      </button>
    </div>
  );

  if (formState) {
    const editing = !!editingId;
    return (
      <section className="ger" aria-label={editing ? "Edit event report" : "New event report"}>
        <div className="ger-head">
          <h2>{editing ? "Edit event report" : "New event report"}</h2>
          <button type="button" className="ger-back" onClick={() => setFormState(null)}>
            Back to list
          </button>
        </div>
        {formError && (
          <p className="ger-error" role="alert">
            {formError}
          </p>
        )}
        {formProblems.length > 0 && (
          <ul className="ger-problems" aria-label="Items to fix">
            {formProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <div className="ger-form">
          <label>
            Individual *
            <select
              value={formState.individualId}
              onChange={(e) => setForm("individualId", e.target.value)}
            >
              <option value="">Choose…</option>
              {individuals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event date *
            <input
              type="date"
              value={formState.eventDate}
              max={todayIso()}
              onChange={(e) => setForm("eventDate", e.target.value)}
            />
          </label>
          <label>
            Event time
            <input
              type="time"
              value={formState.eventTime}
              onChange={(e) => setForm("eventTime", e.target.value)}
            />
          </label>
          <label>
            Location *
            <input
              type="text"
              value={formState.location}
              onChange={(e) => setForm("location", e.target.value)}
              placeholder="e.g. Living room, front yard, van"
            />
          </label>
          <label>
            Event type *
            <select
              value={formState.eventType}
              onChange={(e) => setForm("eventType", e.target.value as GerEventType)}
            >
              <option value="">Choose…</option>
              {GER_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {GER_EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="ger-severity">
            <legend>Severity *</legend>
            {GER_SEVERITIES.map((s) => (
              <label key={s} className={`ger-severity-option ger-severity-${s}`}>
                <input
                  type="radio"
                  name="ger-severity"
                  value={s}
                  checked={formState.severity === s}
                  onChange={() => setForm("severity", s)}
                />
                {GER_SEVERITY_LABELS[s]}
              </label>
            ))}
          </fieldset>
          <label className="ger-form-wide">
            What happened *
            <textarea
              rows={4}
              value={formState.description}
              onChange={(e) => setForm("description", e.target.value)}
              placeholder="Describe the event in your own words."
            />
          </label>
          <label className="ger-form-wide">
            Immediate actions taken / first aid *
            <textarea
              rows={3}
              value={formState.actionsTaken}
              onChange={(e) => setForm("actionsTaken", e.target.value)}
              placeholder="What did staff do right away?"
            />
          </label>
          <fieldset className="ger-form-wide ger-notify">
            <legend>Notifications made</legend>
            {formState.notificationsMade.map((n, i) => (
              <div key={i} className="ger-notify-row">
                <label>
                  Who
                  <select
                    value={n.channel}
                    onChange={(e) => {
                      const next = [...formState.notificationsMade];
                      next[i] = { ...next[i], channel: e.target.value as GerNotificationChannel };
                      setForm("notificationsMade", next);
                    }}
                  >
                    {GER_NOTIFICATION_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {GER_NOTIFICATION_CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Name
                  <input
                    type="text"
                    value={n.name}
                    onChange={(e) => {
                      const next = [...formState.notificationsMade];
                      next[i] = { ...next[i], name: e.target.value };
                      setForm("notificationsMade", next);
                    }}
                    placeholder="Name"
                  />
                </label>
                <label>
                  Time notified
                  <input
                    type="datetime-local"
                    value={n.notifiedAt}
                    onChange={(e) => {
                      const next = [...formState.notificationsMade];
                      next[i] = { ...next[i], notifiedAt: e.target.value };
                      setForm("notificationsMade", next);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ger-notify-remove"
                  aria-label={`Remove notification ${i + 1}`}
                  onClick={() =>
                    setForm(
                      "notificationsMade",
                      formState.notificationsMade.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ger-notify-add"
              onClick={() =>
                setForm("notificationsMade", [...formState.notificationsMade, blankNotification()])
              }
            >
              Add notification
            </button>
          </fieldset>
          <label className="ger-form-wide">
            Witnesses
            <input
              type="text"
              value={formState.witnesses}
              onChange={(e) => setForm("witnesses", e.target.value)}
              placeholder="Names of anyone who saw what happened"
            />
          </label>
          <label>
            Reporting staff name *
            <input
              type="text"
              value={formState.reportedByName}
              onChange={(e) => setForm("reportedByName", e.target.value)}
            />
          </label>
          <label>
            Electronic signature *
            <input
              type="text"
              value={formState.signatureName}
              onChange={(e) => setForm("signatureName", e.target.value)}
              placeholder="Type your full name to sign"
              autoComplete="off"
            />
          </label>
        </div>
        <div className="ger-form-actions">
          <button type="button" onClick={() => void saveForm(false)} disabled={saving}>
            {saving ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="button"
            className="ger-primary"
            onClick={() => void saveForm(true)}
            disabled={saving}
          >
            {saving ? "Submitting…" : "Submit for review"}
          </button>
        </div>
        <p className="ger-hint">
          Drafts stay private to this home until submitted. High and Critical
          severities notify the program manager and nurse on submission.
        </p>
      </section>
    );
  }

  if (selected) {
    const editable = canEditGerReportBody(session, selected);
    const decidable = canDecideGerReport(session, selected);
    const submittable =
      editable && (selected.status === "draft" || selected.status === "returned");

  async function submitNow() {
    if (!selected) return;
    setReviewBusy(true);
    setError("");
    try {
      await api.submitGerReport(selected.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the report.");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
      <section className="ger" aria-label="Event report detail">
        <div className="ger-head">
          <button type="button" className="ger-back" onClick={() => setSelectedId(null)}>
            ← All reports
          </button>
          <div className="ger-detail-actions">
            <button
              type="button"
              onClick={() => void downloadPdf(selected)}
              disabled={downloading}
            >
              {downloading ? "Building…" : "Download PDF"}
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(selected.id);
                  setFormState(formFromReport(selected));
                  setFormError("");
                  setFormProblems([]);
                }}
              >
                Edit
              </button>
            )}
            {submittable && (
              <button
                type="button"
                className="ger-primary"
                onClick={() => void submitNow()}
                disabled={reviewBusy}
              >
                {reviewBusy ? "Submitting…" : "Submit for review"}
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="ger-error" role="alert">
            {error}
          </p>
        )}
        <article className="ger-detail">
          <div className="ger-detail-title">
            <h2>
              {GER_EVENT_TYPE_LABELS[(selected.eventType as GerEventType) ?? "other"] ??
                selected.eventType}
            </h2>
            <span className={`ger-chip ger-status-${selected.status}`}>
              {GER_STATUS_LABELS[selected.status as GerStatus] ?? selected.status}
            </span>
            <span className={`ger-chip ger-severity-${selected.severity}`}>
              {GER_SEVERITY_LABELS[(selected.severity as GerSeverity) ?? "low"] ??
                selected.severity}{" "}
              severity
            </span>
          </div>
          <dl className="ger-meta">
            <div>
              <dt>Individual</dt>
              <dd>{selected.individualName}</dd>
            </div>
            <div>
              <dt>Event date</dt>
              <dd>
                {formatDate(selected.eventDate)}
                {selected.eventTime ? ` at ${selected.eventTime}` : ""}
              </dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{selected.location || "—"}</dd>
            </div>
            <div>
              <dt>Reported by</dt>
              <dd>{selected.createdByName}</dd>
            </div>
          </dl>
          <section>
            <h3>What happened</h3>
            <p>{selected.description || "—"}</p>
          </section>
          <section>
            <h3>Immediate actions taken / first aid</h3>
            <p>{selected.actionsTaken || "—"}</p>
          </section>
          <section>
            <h3>Notifications made</h3>
            {selected.notificationsMade.length > 0 ? (
              <ul>
                {selected.notificationsMade.map((n, i) => (
                  <li key={i}>
                    {GER_NOTIFICATION_CHANNEL_LABELS[
                      n.channel as GerNotificationChannel
                    ] ?? n.channel}
                    {n.name ? ` — ${n.name}` : ""}
                    {n.notifiedAt ? ` (${n.notifiedAt.replace("T", " ")})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
          </section>
          <section>
            <h3>Witnesses</h3>
            <p>{selected.witnesses || "—"}</p>
          </section>
          <section>
            <h3>Reporting staff &amp; signature</h3>
            <p>
              {selected.reportedByName || "—"}
              {selected.signatureName
                ? ` — signed ${formatDate(selected.signedAt.slice(0, 10))}`
                : ""}
            </p>
          </section>
          {selected.status !== "draft" && (
            <section>
              <h3>Review</h3>
              <p>
                {GER_STATUS_LABELS[selected.status as GerStatus] ?? selected.status}
                {selected.reviewerName ? ` — ${selected.reviewerName}` : ""}
                {selected.reviewedAt
                  ? `, ${formatDate(selected.reviewedAt.slice(0, 10))}`
                  : ""}
              </p>
              {selected.reviewNote && <p>Note: {selected.reviewNote}</p>}
            </section>
          )}
          {decidable && (
            <section className="ger-review" aria-label="Review this report">
              <h3>Review</h3>
              <label>
                Return note (required to return)
                <textarea
                  rows={3}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="What needs to be corrected? (required when returning)"
                />
              </label>
              <div className="ger-review-actions">
                <button
                  type="button"
                  className="ger-primary"
                  onClick={() => void review("approve")}
                  disabled={reviewBusy}
                >
                  {reviewBusy ? "Working…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="ger-danger"
                  onClick={() => void review("return")}
                  disabled={reviewBusy}
                >
                  {reviewBusy ? "Working…" : "Return for corrections"}
                </button>
              </div>
            </section>
          )}
        </article>
      </section>
    );
  }

  return (
    <section className="ger" aria-label="Event reports">
      <div className="ger-head">
        <h2>
          Event reports{" "}
          <span className="ger-count" aria-label={`${reports.length} reports`}>
            {reports.length}
          </span>
        </h2>
        {canCreate && (
          <button
            type="button"
            className="ger-primary"
            onClick={() => {
              setEditingId(null);
              setFormState(blankForm(session?.fullName ?? ""));
              setFormError("");
              setFormProblems([]);
            }}
          >
            New report
          </button>
        )}
      </div>
      {error && (
        <p className="ger-error" role="alert">
          {error}
        </p>
      )}
      {filterBar}
      {loading ? (
        <p className="ger-loading">Loading reports…</p>
      ) : reports.length === 0 ? (
        <Empty
          mark="quiet"
          title="No event reports"
          text="No event reports match the current filters for this home."
        />
      ) : (
        <ul className="ger-list">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="ger-card"
                onClick={() => setSelectedId(r.id)}
                aria-label={`${GER_EVENT_TYPE_LABELS[(r.eventType as GerEventType) ?? "other"] ?? r.eventType} for ${r.individualName} on ${r.eventDate}, ${GER_STATUS_LABELS[r.status as GerStatus] ?? r.status}`}
              >
                <span className={`ger-chip ger-severity-${r.severity}`}>
                  {GER_SEVERITY_LABELS[(r.severity as GerSeverity) ?? "low"] ?? r.severity}
                </span>
                <span className="ger-card-main">
                  <strong>
                    {GER_EVENT_TYPE_LABELS[(r.eventType as GerEventType) ?? "other"] ??
                      r.eventType}
                  </strong>
                  <span className="ger-card-sub">
                    {r.individualName} · {formatDate(r.eventDate)}
                    {r.eventTime ? ` ${r.eventTime}` : ""}
                  </span>
                </span>
                <span className={`ger-chip ger-status-${r.status}`}>
                  {GER_STATUS_LABELS[r.status as GerStatus] ?? r.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canReviewGerReport(session) && (
        <p className="ger-hint">
          {siteName} — high and critical submissions notify the program manager and
          nurse automatically.
        </p>
      )}
    </section>
  );
}
