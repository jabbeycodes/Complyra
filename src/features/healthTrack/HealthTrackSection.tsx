import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Badge, Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { openPrintable } from "../../data/openFile";
import { DIGITAL_RECORD_MARK } from "../../delegation/delegation";
import {
  HEALTH_TRACK_KINDS,
  HEALTH_TRACK_KIND_LABELS,
  SLEEP_QUALITIES,
  canCorrectHealthTrackEntry,
  canViewHealthTrack,
  isImmunizationOverdue,
  type HealthTrackEntry,
  type HealthTrackKind,
} from "../../data/healthTrack";

/**
 * Health trackers on the Individual chart: immunizations, lab results,
 * infection tracking, and sleep — quick-add forms and dated lists beside
 * the Health card's appointments. Overdue immunizations and flagged
 * results are labeled in text (never color alone); significant entries
 * alert the responsible managers when recorded. Auditors read-only.
 */

const KIND_FIELDS: Record<
  HealthTrackKind,
  Array<{ key: string; label: string; type?: "date" | "select" | "checkbox-text"; options?: readonly string[] }>
> = {
  immunization: [
    { key: "vaccineName", label: "Vaccine" },
    { key: "doseLabel", label: "Dose (e.g. Annual, Booster)" },
    { key: "nextDueOn", label: "Next due", type: "date" },
  ],
  lab: [
    { key: "testName", label: "Test" },
    { key: "resultValue", label: "Result" },
    { key: "unit", label: "Unit" },
    { key: "referenceRange", label: "Reference range" },
  ],
  infection: [
    { key: "infectionType", label: "Infection" },
    { key: "bodySite", label: "Where on the body" },
    { key: "symptoms", label: "Symptoms" },
    { key: "treatment", label: "Treatment" },
    { key: "resolvedOn", label: "Resolved on", type: "date" },
    {
      key: "confirmedPositive",
      label: "Confirmed positive",
      type: "select",
      options: ["no", "yes"],
    },
  ],
  sleep: [
    { key: "hoursSlept", label: "Hours slept" },
    { key: "quality", label: "Quality", type: "select", options: SLEEP_QUALITIES },
    { key: "interruptions", label: "Interruptions" },
  ],
};

const DATE_LABELS: Record<HealthTrackKind, string> = {
  immunization: "Date given",
  lab: "Date collected",
  infection: "Started on",
  sleep: "Night of",
};

export default function HealthTrackSection({
  individualId,
  individualName,
}: {
  individualId: string;
  individualName: string;
}) {
  const { api, session } = useData();
  const [kind, setKind] = useState<HealthTrackKind>("immunization");
  const [entries, setEntries] = useState<HealthTrackEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [occurredOn, setOccurredOn] = useState(today);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [flaggedAbnormal, setFlaggedAbnormal] = useState(false);
  const [note, setNote] = useState("");

  const [correcting, setCorrecting] = useState<HealthTrackEntry | null>(null);
  const [corrOccurredOn, setCorrOccurredOn] = useState(today);
  const [corrDetails, setCorrDetails] = useState<Record<string, string>>({});
  const [corrFlaggedAbnormal, setCorrFlaggedAbnormal] = useState(false);
  const [corrNote, setCorrNote] = useState("");
  const [rationale, setRationale] = useState("");

  const visible = canViewHealthTrack(session);
  const canRecord = session?.permissions["health.record"] === true;
  const canCorrect = canRecord && canCorrectHealthTrackEntry(session?.roleKey);

  const startCorrection = (entry: HealthTrackEntry) => {
    setCorrecting(entry);
    setCorrOccurredOn(entry.occurredOn);
    setCorrDetails({ ...entry.details });
    setCorrFlaggedAbnormal(entry.flaggedAbnormal);
    setCorrNote(entry.note);
    setRationale("");
  };

  const load = useCallback(async () => {
    if (!visible) return;
    try {
      setEntries(await api.listHealthTrackEntries({ individualId, kind }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load health records.");
    } finally {
      setLoaded(true);
    }
  }, [api, individualId, kind, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!visible) return null;

  const printKind = () => {
    const esc = (v: string) =>
      v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const rows = entries
      .map(
        (e) =>
          `<tr><td>${esc(e.occurredOn)}</td><td>${esc(e.title)}</td><td>${esc(
            Object.entries(e.details)
              .map(([k, v]) => `${k}: ${v}`)
              .join("; "),
          )}</td><td>${e.flaggedAbnormal ? "Flagged abnormal" : ""}</td><td>${esc(e.note)}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><title>${HEALTH_TRACK_KIND_LABELS[kind]} — ${esc(individualName)}</title><style>body{font-family:Arial,sans-serif;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:5px 7px;text-align:left}</style></head><body><h1>${HEALTH_TRACK_KIND_LABELS[kind]} — ${esc(individualName)}</h1><table><tr><th>Date</th><th>Record</th><th>Details</th><th>Flag</th><th>Note</th></tr>${rows}</table><p><em>${DIGITAL_RECORD_MARK}</em></p></body></html>`;
    void openPrintable(
      `health-${kind}-${individualId}.html`,
      new Blob([html], { type: "text/html" }),
      "print",
    );
  };

  return (
    <section
      className="chart-widget health-track-widget"
      aria-labelledby="health-track-heading"
    >
      <h2 id="health-track-heading">Trackers and logs</h2>
      <div className="tabs health-track-tabs" role="tablist" aria-label="Health trackers">
        {HEALTH_TRACK_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            id={`health-track-tab-${k}`}
            aria-controls="health-track-panel"
            aria-selected={kind === k}
            className={kind === k ? "selected" : ""}
            onClick={() => {
              setKind(k);
              setDetails({});
              setFlaggedAbnormal(false);
              setNote("");
              setLoaded(false);
            }}
          >
            {HEALTH_TRACK_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="health-track-panel"
        aria-labelledby={`health-track-tab-${kind}`}
      >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canRecord && (
        <form
          className="health-track-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            api
              .addHealthTrackEntry(individualId, {
                kind,
                occurredOn,
                details,
                flaggedAbnormal,
                note,
              })
              .then(() => {
                setDetails({});
                setFlaggedAbnormal(false);
                setNote("");
                return load();
              })
              .catch((err) =>
                setError(err instanceof Error ? err.message : "Could not save."),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label>
              {DATE_LABELS[kind]}
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                required
              />
            </label>
            {KIND_FIELDS[kind].map((field) =>
              field.type === "select" ? (
                <label key={field.key}>
                  {field.label}
                  <select
                    value={details[field.key] ?? ""}
                    onChange={(e) =>
                      setDetails({ ...details, [field.key]: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={field.key}>
                  {field.label}
                  <input
                    type={field.type === "date" ? "date" : "text"}
                    value={details[field.key] ?? ""}
                    onChange={(e) =>
                      setDetails({ ...details, [field.key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {kind === "lab" && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={flaggedAbnormal}
                onChange={(e) => setFlaggedAbnormal(e.target.checked)}
              />
              Flag this result abnormal (alerts the home's managers)
            </label>
          )}
          <div className="form-actions">
            <button type="submit" className="button primary" disabled={busy}>
              Add record
            </button>
            <button type="button" className="button" onClick={printKind}>
              <Printer size={15} aria-hidden /> Print
            </button>
          </div>
        </form>
      )}
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <Empty title={`No ${HEALTH_TRACK_KIND_LABELS[kind].toLowerCase()} recorded yet.`} mark="quiet" />
      ) : (
        <ul className="record-list">
          {entries.map((entry) => {
            const overdue = isImmunizationOverdue(entry, entries);
            const positive =
              entry.kind === "infection" && entry.details.confirmedPositive === "yes";
            return (
              <li key={entry.id} className="record-row">
                <div>
                  <strong>{entry.title}</strong>
                  <span className="muted"> · {formatDate(entry.occurredOn)}</span>
                  {entry.kind === "immunization" && entry.details.nextDueOn && (
                    <span className="muted">
                      {" "}
                      · next due {formatDate(entry.details.nextDueOn)}
                    </span>
                  )}
                  {entry.kind === "infection" && entry.details.resolvedOn && (
                    <span className="muted">
                      {" "}
                      · resolved {formatDate(entry.details.resolvedOn)}
                    </span>
                  )}
                  {entry.note && <p className="muted">{entry.note}</p>}
                </div>
                {overdue && <Badge status="Overdue" />}
                {entry.flaggedAbnormal && <Badge status="Flagged abnormal" />}
                {positive && <Badge status="Confirmed positive" />}
                {canRecord && entry.recordedByUserId === session?.userId && (
                  <button
                    type="button"
                    className="button ghost"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      api
                        .deleteHealthTrackEntry(entry.id)
                        .then(load)
                        .catch((err) =>
                          setError(
                            err instanceof Error ? err.message : "Could not remove.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    Remove
                  </button>
                )}
                {canCorrect && (
                  <button
                    type="button"
                    className="button ghost"
                    disabled={busy}
                    onClick={() => startCorrection(entry)}
                  >
                    Record correction
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {correcting && (
        <form
          className="health-track-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            api
              .correctHealthTrackEntry(
                correcting.id,
                {
                  kind: correcting.kind,
                  occurredOn: corrOccurredOn,
                  details: corrDetails,
                  flaggedAbnormal: corrFlaggedAbnormal,
                  note: corrNote,
                },
                rationale,
              )
              .then(() => {
                setCorrecting(null);
                return load();
              })
              .catch((err) =>
                setError(err instanceof Error ? err.message : "Could not save."),
              )
              .finally(() => setBusy(false));
          }}
        >
          <h4>Record a correction</h4>
          <p className="muted">
            Correcting “{correcting.title}” from{" "}
            {formatDate(correcting.occurredOn)}. The original version and your
            reason stay on the record — a correction never erases what was
            first written.
          </p>
          <div className="form-grid">
            <label>
              {DATE_LABELS[correcting.kind]}
              <input
                type="date"
                value={corrOccurredOn}
                onChange={(e) => setCorrOccurredOn(e.target.value)}
                required
              />
            </label>
            {KIND_FIELDS[correcting.kind].map((field) =>
              field.type === "select" ? (
                <label key={field.key}>
                  {field.label}
                  <select
                    value={corrDetails[field.key] ?? ""}
                    onChange={(e) =>
                      setCorrDetails({ ...corrDetails, [field.key]: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={field.key}>
                  {field.label}
                  <input
                    type={field.type === "date" ? "date" : "text"}
                    value={corrDetails[field.key] ?? ""}
                    onChange={(e) =>
                      setCorrDetails({ ...corrDetails, [field.key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <label>
            Note
            <input value={corrNote} onChange={(e) => setCorrNote(e.target.value)} />
          </label>
          {correcting.kind === "lab" && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={corrFlaggedAbnormal}
                onChange={(e) => setCorrFlaggedAbnormal(e.target.checked)}
              />
              Flag this result abnormal (alerts the home's managers)
            </label>
          )}
          <label>
            Reason for the correction
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button primary" disabled={busy}>
              Save correction
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setCorrecting(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      </div>
    </section>
  );
}
