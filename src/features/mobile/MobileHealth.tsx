import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canViewHealthTrack,
  validateHealthTrackDraft,
  type HealthTrackEntry,
  type HealthTrackKind,
} from "../../data/healthTrack";
import {
  HEALTH_DATE_LABELS,
  HEALTH_KIND_FIELDS,
} from "../healthTrack/kindFields";
import { centralTodayIso, formatIsoDay } from "./mar";
import {
  healthHomeStatuses,
  healthKindLabel,
  initialHealthDetails,
} from "./health";
import MobilePeopleList from "./MobilePeopleList";
import { PersonHeader } from "./MobileMar";
import type { WorkspaceIndividual } from "./types";

/**
 * Mobile Health home — the seven day-to-day trackers (intake,
 * elimination, vitals, blood glucose, skin, seizures, menses) as a
 * phone-first view over the SAME health-entry store the chart reads.
 * Rows state facts in words (logged today / last logged), never a
 * due-or-missed judgment: these are observational logs. Quick-log
 * sheets reuse the chart's field definitions (kindFields) and the
 * shared draft validation, and save through the same API methods, so
 * demo and hosted behave identically. Permissions mirror the chart:
 * health.record records; view-only roles (auditors) get no log actions.
 * Medications deep-link to the MAR — never a second MAR here.
 */
export default function MobileHealth({
  api,
  session,
  people,
  onOpenChart,
  onOpenMedications,
}: {
  api: ComplyraApi;
  session: SessionUser;
  people: WorkspaceIndividual[];
  onOpenChart: (name: string) => void;
  onOpenMedications: () => void;
}) {
  const todayIso = centralTodayIso();
  const [personId, setPersonId] = useState<string | null>(null);
  const [entries, setEntries] = useState<HealthTrackEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [logKind, setLogKind] = useState<HealthTrackKind | null>(null);

  const person = people.find((row) => row.id === personId) ?? null;
  const visible = canViewHealthTrack(session);
  const canRecord = session.permissions["health.record"] === true;

  const load = useCallback(async () => {
    if (!personId || !visible) return;
    try {
      setEntries(await api.listHealthTrackEntries({ individualId: personId }));
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load health records.",
      );
    } finally {
      setLoaded(true);
    }
  }, [api, personId, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  const statuses = useMemo(
    () => healthHomeStatuses(entries, todayIso),
    [entries, todayIso],
  );

  if (!visible) {
    return <p className="msh-empty">Health records are not part of your role.</p>;
  }

  if (!person) {
    return (
      <div>
        <p className="msh-section-note">
          Pick the Individual whose health you are logging or checking.
        </p>
        <MobilePeopleList
          people={people}
          onPick={(row) => {
            setPersonId(row.id);
            setLoaded(false);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="msh-text-button"
        onClick={() => {
          setPersonId(null);
          setEntries([]);
          setLogKind(null);
        }}
      >
        ‹ All Individuals
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />

      <h3 className="msh-pass-title">Today's health · {formatIsoDay(todayIso)}</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p className="msh-empty">Loading health records…</p>
      ) : (
        <>
          {canRecord && (
            <button
              type="button"
              className="msh-button primary block"
              onClick={() => setLogKind("seizure")}
            >
              Log a seizure
            </button>
          )}
          <div className="msh-list">
            {statuses.map((status) => {
              const main = (
                <>
                  <span className="msh-row-main">
                    <strong>{status.label}</strong>
                    <small className="msh-status-text">{status.text}</small>
                  </span>
                  {canRecord && (
                    <span className="msh-chip-button" aria-hidden="true">
                      Log
                    </span>
                  )}
                </>
              );
              return canRecord ? (
                <button
                  key={status.kind}
                  type="button"
                  className="msh-row"
                  aria-label={`Log ${status.label} for ${person.name}. ${status.text}`}
                  onClick={() => setLogKind(status.kind)}
                >
                  {main}
                </button>
              ) : (
                <div key={status.kind} className="msh-row static">
                  {main}
                </div>
              );
            })}
            <button
              type="button"
              className="msh-row"
              onClick={onOpenMedications}
            >
              <span className="msh-tile-icon" aria-hidden="true">
                <Pill size={22} />
              </span>
              <span className="msh-row-main">
                <strong>Medications</strong>
                <small>Pass meds and record doses in the MAR</small>
              </span>
              <span className="msh-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
          {!canRecord && (
            <p className="msh-section-note">
              Read-only — your role can review health records but not record
              new ones.
            </p>
          )}
        </>
      )}

      {logKind && (
        <HealthLogSheet
          api={api}
          person={person}
          kind={logKind}
          todayIso={todayIso}
          onClose={() => setLogKind(null)}
          onSaved={() => {
            setLogKind(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Bottom-sheet quick log for one tracker kind. Fields, labels, options,
 * and conditional visibility come from the chart's shared definitions;
 * validation is the shared draft validator the API also enforces, so a
 * sheet can never save something the chart would refuse.
 */
function HealthLogSheet({
  api,
  person,
  kind,
  todayIso,
  onClose,
  onSaved,
}: {
  api: ComplyraApi;
  person: WorkspaceIndividual;
  kind: HealthTrackKind;
  todayIso: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [occurredOn, setOccurredOn] = useState(todayIso);
  const [details, setDetails] = useState<Record<string, string>>(() =>
    initialHealthDetails(kind),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fields = HEALTH_KIND_FIELDS[kind].filter(
    (field) => !field.when || field.when(details),
  );
  const label = HEALTH_DATE_LABELS[kind];

  const save = async () => {
    const draft = { kind, occurredOn, details, flaggedAbnormal: false, note };
    const errors = validateHealthTrackDraft(draft);
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.addHealthTrackEntry(person.id, draft);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close log form"
        onClick={onClose}
      />
      <div className="msh-sheet msh-health-sheet" role="dialog" aria-label="Log health entry">
        <h3 className="msh-sheet-title">
          Log {healthKindLabel(kind).toLowerCase()} — {person.name}
        </h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className="msh-field">
            <span>{label}</span>
            <input
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              required
            />
          </label>
          {fields.map((field) =>
            field.type === "select" ? (
              <label key={field.key} className="msh-field">
                <span>{field.label}</span>
                <select
                  value={details[field.key] ?? ""}
                  onChange={(event) =>
                    setDetails({ ...details, [field.key]: event.target.value })
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
              <label key={field.key} className="msh-field">
                <span>{field.label}</span>
                <input
                  type={
                    field.type === "date"
                      ? "date"
                      : field.type === "time"
                        ? "time"
                        : "text"
                  }
                  value={details[field.key] ?? ""}
                  onChange={(event) =>
                    setDetails({ ...details, [field.key]: event.target.value })
                  }
                />
              </label>
            ),
          )}
          <label className="msh-field">
            <span>Note</span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error && (
            <p className="msh-alert" role="alert">
              {error}
            </p>
          )}
          <div className="msh-form-actions">
            <button
              type="button"
              className="msh-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="msh-button primary" disabled={busy}>
              {busy ? "Saving…" : "Save entry"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
