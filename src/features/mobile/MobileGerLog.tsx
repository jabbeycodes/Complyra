import { useMemo, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  GER_EVENT_TYPES,
  GER_SEVERITIES,
  deriveGerResolutionDisplay,
  validateGerDraft,
  type GerEventType,
  type GerReport,
  type GerReportDraft,
  type GerSeverity,
} from "../../data/ger";
import { centralNowHhmm, centralTodayIso, formatIsoDay } from "./mar";
import {
  GER_STATUS_LABELS,
  newGerDraft,
  parseNotificationsText,
} from "./fieldLogs";
import type { WorkspaceIndividual } from "./types";

/**
 * Mobile incident reports (GER) — file a general event report from the
 * field and read the home's recent reports. The form is the desktop
 * Reporting tab's form: same fields, same shared draft validation
 * (validateGerDraft — the API re-validates with the site context), same
 * draft → submit lifecycle (Save draft, or File report = create +
 * submit). Filing follows the ger.create permission the API asserts;
 * reading follows canViewGerReports — auditors read everything here
 * and file nothing.
 */
const RESOLUTION_LABELS: Record<string, string> = {
  unaddressed: "Unaddressed",
  in_progress: "In progress",
  overdue: "Overdue",
  resolved: "Resolved",
};

export default function MobileGerLog({
  api,
  session,
  siteId,
  siteName,
  people,
  reports,
  canCreate,
  canView,
  onBack,
  onLogged,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  siteName: string;
  people: WorkspaceIndividual[];
  reports: GerReport[];
  canCreate: boolean;
  canView: boolean;
  onBack: () => void;
  onLogged: () => void;
}) {
  const [mode, setMode] = useState<"list" | "form">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const names = new Map(people.map((person) => [person.id, person.name]));
    return (id: string) => names.get(id) ?? "An Individual";
  }, [people]);

  const selected = reports.find((report) => report.id === selectedId) ?? null;
  const recent = reports.slice(0, 8);

  if (mode === "form") {
    return (
      <GerReportForm
        api={api}
        session={session}
        siteId={siteId}
        people={people}
        onCancel={() => setMode("list")}
        onSaved={(reportId) => {
          setMode("list");
          setSelectedId(reportId);
          onLogged();
        }}
      />
    );
  }

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Quick log
      </button>
      <h3 className="msh-pass-title">Incident reports — {siteName}</h3>
      {canCreate && (
        <button
          type="button"
          className="msh-button primary block"
          onClick={() => setMode("form")}
        >
          File an incident report
        </button>
      )}
      {!canView && (
        <p className="msh-section-note">
          Filed reports are reviewed by the home's managers. Your role
          files reports but does not read the home's report list.
        </p>
      )}
      {canView && (
        <>
          <h4 className="msh-pass-title">Recent reports</h4>
          <div className="msh-list">
            {recent.length === 0 && (
              <p className="msh-empty">No reports filed at this home yet.</p>
            )}
            {recent.map((report) => (
              <button
                key={report.id}
                type="button"
                className="msh-row"
                onClick={() =>
                  setSelectedId(selectedId === report.id ? null : report.id)
                }
              >
                <span className="msh-row-main">
                  <strong>
                    {report.eventType} — {nameOf(report.individualId)}
                  </strong>
                  <small>
                    {formatIsoDay(report.eventDate)}
                    {report.eventTime ? ` · ${report.eventTime}` : ""} ·
                    Severity: {report.severity}
                  </small>
                  <small className="msh-status-text">
                    {GER_STATUS_LABELS[report.status]} · Follow-up:{" "}
                    {RESOLUTION_LABELS[deriveGerResolutionDisplay(report)]}
                  </small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
          {selected && <GerReportDetail report={selected} nameOf={nameOf} />}
          {!canCreate && (
            <p className="msh-section-note">
              Read-only — your role can review reports but not file new
              ones.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GerReportDetail({
  report,
  nameOf,
}: {
  report: GerReport;
  nameOf: (id: string) => string;
}) {
  const notifications = report.notificationsMade.length
    ? report.notificationsMade
        .map((n) => `${n.party} — ${n.name}${n.atTime ? ` (${n.atTime})` : ""}`)
        .join("; ")
    : "None recorded";
  return (
    <section className="msh-ger-detail" aria-label="Report detail">
      <h4 className="msh-pass-title">
        {report.eventType} — {nameOf(report.individualId)}
      </h4>
      <div className="msh-facts">
        <div>
          <h4>Severity</h4>
          <p>{report.severity}</p>
        </div>
        <div>
          <h4>When</h4>
          <p>
            {formatIsoDay(report.eventDate)}
            {report.eventTime ? ` at ${report.eventTime}` : ""}
            {report.location ? ` · ${report.location}` : ""}
          </p>
        </div>
        <div>
          <h4>What happened</h4>
          <p>{report.description}</p>
        </div>
        <div>
          <h4>Immediate actions</h4>
          <p>{report.immediateActions || "—"}</p>
        </div>
        <div>
          <h4>Notifications</h4>
          <p>{notifications}</p>
        </div>
        <div>
          <h4>Witnesses</h4>
          <p>{report.witnesses || "—"}</p>
        </div>
        <div>
          <h4>Reported by</h4>
          <p>
            {report.reporterName} — signed {formatIsoDay(report.reporterDate)}
          </p>
        </div>
        <div>
          <h4>Status</h4>
          <p>
            {GER_STATUS_LABELS[report.status]} · Follow-up:{" "}
            {RESOLUTION_LABELS[deriveGerResolutionDisplay(report)]}
          </p>
        </div>
      </div>
    </section>
  );
}

function GerReportForm({
  api,
  session,
  siteId,
  people,
  onCancel,
  onSaved,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  people: WorkspaceIndividual[];
  onCancel: () => void;
  onSaved: (reportId: string) => void;
}) {
  const todayIso = centralTodayIso();
  const [draft, setDraft] = useState<GerReportDraft>(() =>
    newGerDraft({
      siteId,
      individualId: people[0]?.id ?? "",
      reporterName: session.fullName,
      todayIso,
      nowTime: centralNowHhmm(),
    }),
  );
  const [notificationsText, setNotificationsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<GerReportDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const toggleLinked = (id: string) =>
    setDraft((current) => {
      const linked = current.linkedIndividualIds ?? [];
      return {
        ...current,
        linkedIndividualIds: linked.includes(id)
          ? linked.filter((row) => row !== id)
          : [...linked, id],
      };
    });

  const save = async (submitAfter: boolean) => {
    const full: GerReportDraft = {
      ...draft,
      notificationsMade: parseNotificationsText(notificationsText),
    };
    const errors = validateGerDraft(full);
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.createGerReport(full);
      if (submitAfter) await api.submitGerReport(saved.id);
      onSaved(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onCancel}>
        ‹ Incident reports
      </button>
      <h3 className="msh-pass-title">New incident report</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save(false);
        }}
      >
        <label className="msh-field">
          <span>Individual</span>
          <select
            value={draft.individualId}
            onChange={(event) => set({ individualId: event.target.value })}
            required
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="msh-fieldset">
          <legend>Other Individuals involved (optional)</legend>
          {people
            .filter((person) => person.id !== draft.individualId)
            .map((person) => (
              <label key={person.id} className="msh-confirm">
                <input
                  type="checkbox"
                  checked={(draft.linkedIndividualIds ?? []).includes(person.id)}
                  onChange={() => toggleLinked(person.id)}
                />
                <span>{person.name}</span>
              </label>
            ))}
          {people.length <= 1 && (
            <p className="msh-empty">No other Individuals at this home.</p>
          )}
        </fieldset>
        <div className="msh-field-pair">
          <label className="msh-field">
            <span>Event date</span>
            <input
              type="date"
              value={draft.eventDate}
              onChange={(event) => set({ eventDate: event.target.value })}
              required
            />
          </label>
          <label className="msh-field">
            <span>Event time</span>
            <input
              type="time"
              value={draft.eventTime}
              onChange={(event) => set({ eventTime: event.target.value })}
            />
          </label>
        </div>
        <div className="msh-field-pair">
          <label className="msh-field">
            <span>Event type</span>
            <select
              value={draft.eventType}
              onChange={(event) =>
                set({ eventType: event.target.value as GerEventType })
              }
            >
              {GER_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="msh-field">
            <span>Severity</span>
            <select
              value={draft.severity}
              onChange={(event) =>
                set({ severity: event.target.value as GerSeverity })
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
        <label className="msh-field">
          <span>Location</span>
          <input
            type="text"
            value={draft.location}
            onChange={(event) => set({ location: event.target.value })}
          />
        </label>
        <label className="msh-field">
          <span>What happened</span>
          <textarea
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            rows={4}
            required
          />
        </label>
        <label className="msh-field">
          <span>Immediate actions / first aid</span>
          <textarea
            value={draft.immediateActions}
            onChange={(event) => set({ immediateActions: event.target.value })}
            rows={3}
          />
        </label>
        <label className="msh-field">
          <span>Notifications made (one per line: who — name — time)</span>
          <textarea
            value={notificationsText}
            onChange={(event) => {
              setNotificationsText(event.target.value);
              setDraft((current) => ({
                ...current,
                notificationsMade: parseNotificationsText(event.target.value),
              }));
            }}
            rows={3}
          />
        </label>
        <label className="msh-field">
          <span>Witnesses</span>
          <input
            type="text"
            value={draft.witnesses ?? ""}
            onChange={(event) => set({ witnesses: event.target.value })}
          />
        </label>
        <label className="msh-field">
          <span>Reporting staff name</span>
          <input
            type="text"
            value={draft.reporterName}
            onChange={(event) => set({ reporterName: event.target.value })}
            required
          />
        </label>
        <div className="msh-field-pair">
          <label className="msh-field">
            <span>Electronic signature (type full name)</span>
            <input
              type="text"
              value={draft.reporterSignature}
              onChange={(event) => set({ reporterSignature: event.target.value })}
              required
            />
          </label>
          <label className="msh-field">
            <span>Report date</span>
            <input
              type="date"
              value={draft.reporterDate}
              onChange={(event) => set({ reporterDate: event.target.value })}
              required
            />
          </label>
        </div>
        {error && (
          <p className="msh-alert" role="alert">
            {error}
          </p>
        )}
        <div className="msh-form-actions">
          <button
            type="button"
            className="msh-button secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="msh-button secondary" disabled={busy}>
            Save draft
          </button>
          <button
            type="button"
            className="msh-button primary"
            disabled={busy}
            onClick={() => void save(true)}
          >
            {busy ? "Saving…" : "File report"}
          </button>
        </div>
      </form>
    </div>
  );
}
