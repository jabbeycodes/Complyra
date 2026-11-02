import { useCallback, useEffect, useMemo, useState } from "react";
import { FileHeart, FileSignature, HeartPulse, Pill, Wallet } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { canSeeMeds } from "../../data/chart";
import { canViewPersonalSpending } from "../../data/permissions";
import { canViewCare } from "../../data/careScreening";
import { canSeeConsents } from "../../data/consents";
import {
  computePersonalBalanceCents,
  formatCents,
} from "../../data/personalSpending";
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
 *
 * Medications live UNDER Health on mobile (founder directive,
 * 2026-10-31): this surface is their only mobile door. The Medications
 * section — an entry on the Health home and a row in each person's
 * view — renders only for roles passing canSeeMeds, and opens the one
 * MAR (passes, med orders, med counts); recording inside the MAR
 * follows the MAR's own med permissions. Never a second MAR here.
 */
/**
 * The Medications section entry — the one door from Health into the
 * MAR. Callers render it only for roles passing canSeeMeds: on the
 * Health home above the people picker, and in each person's view
 * alongside their tracker statuses.
 */
function MedicationsEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="msh-row" onClick={onOpen}>
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
  );
}

export default function MobileHealth({
  api,
  session,
  people,
  onOpenChart,
  onOpenMedications,
  onBack,
  backLabel,
  onEntrySaved,
  onOpenSpending,
  onOpenCarePlans,
  onOpenConsents,
  onOpenLifeEvents,
}: {
  api: ComplyraApi;
  session: SessionUser;
  people: WorkspaceIndividual[];
  onOpenChart: (name: string) => void;
  onOpenMedications: () => void;
  /**
   * Embedding door (the Quick log chooser): when set, the people picker
   * carries a back button to the host flow. The Health TILE mounts this
   * view without it — the shell's own subheader is the way back there.
   */
  onBack?: () => void;
  backLabel?: string;
  /** Embedding door: told after every successful save (drives the host's status refresh). */
  onEntrySaved?: () => void;
  /**
   * Opens the person's mobile Personal Spending view (the quick-entry
   * money screen). Optional so other hosts keep the health view alone;
   * shown only to roles that may view personal spending (#152).
   */
  onOpenSpending?: (person: WorkspaceIndividual) => void;
  /**
   * Chart-section doors (Phase 4): the person's Care Plans, Consents,
   * and Life Events mobile views. Optional like onOpenSpending — hosts
   * that only need the health trackers (the Quick log embedding) omit
   * them and the rows never render. Each row also follows its desktop
   * chart gate (canViewCare / canSeeConsents; life events ride the
   * chart read access this view already requires).
   */
  onOpenCarePlans?: (person: WorkspaceIndividual) => void;
  onOpenConsents?: (person: WorkspaceIndividual) => void;
  onOpenLifeEvents?: (person: WorkspaceIndividual) => void;
}) {
  const todayIso = centralTodayIso();
  const [personId, setPersonId] = useState<string | null>(null);
  const [entries, setEntries] = useState<HealthTrackEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [logKind, setLogKind] = useState<HealthTrackKind | null>(null);
  const [spendingBalance, setSpendingBalance] = useState<number | null>(
    null,
  );

  const person = people.find((row) => row.id === personId) ?? null;
  const visible = canViewHealthTrack(session);
  const medsVisible = canSeeMeds(session.roleKey);
  const canRecord = session.permissions["health.record"] === true;
  const spendingVisible = canViewPersonalSpending(session.roleKey);

  // The person's current personal-funds balance, for the spending row
  // below. Best-effort: a failed load just shows the plain row.
  useEffect(() => {
    if (!personId || !spendingVisible || !onOpenSpending) {
      setSpendingBalance(null);
      return;
    }
    let cancelled = false;
    api
      .listPersonalSpendingEntries(personId)
      .then((rows) => {
        if (!cancelled) {
          setSpendingBalance(computePersonalBalanceCents(rows));
        }
      })
      .catch(() => {
        if (!cancelled) setSpendingBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, personId, spendingVisible, onOpenSpending]);

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
        {onBack && (
          <button type="button" className="msh-text-button" onClick={onBack}>
            ‹ {backLabel ?? "Back"}
          </button>
        )}
        {medsVisible && (
          <>
            <h3 className="msh-pass-title">Medications</h3>
            <div className="msh-list">
              <MedicationsEntry onOpen={onOpenMedications} />
            </div>
          </>
        )}
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
            {medsVisible && <MedicationsEntry onOpen={onOpenMedications} />}
            {spendingVisible && onOpenSpending && (
              <button
                type="button"
                className="msh-row"
                onClick={() => onOpenSpending(person)}
              >
                <span className="msh-tile-icon" aria-hidden="true">
                  <Wallet size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>Personal spending</strong>
                  <small>
                    {spendingBalance !== null
                      ? `Personal funds balance: ${formatCents(spendingBalance)}`
                      : `${person.name}'s own money — spends, deposits, and balance`}
                  </small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
            {onOpenCarePlans && canViewCare(session.roleKey) && (
              <button
                type="button"
                className="msh-row"
                onClick={() => onOpenCarePlans(person)}
              >
                <span className="msh-tile-icon" aria-hidden="true">
                  <FileHeart size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>Care plans</strong>
                  <small>Care plans and health screenings</small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
            {onOpenConsents && canSeeConsents(session.roleKey) && (
              <button
                type="button"
                className="msh-row"
                onClick={() => onOpenConsents(person)}
              >
                <span className="msh-tile-icon" aria-hidden="true">
                  <FileSignature size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>Consents</strong>
                  <small>Consent register and packets</small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
            {onOpenLifeEvents && (
              <button
                type="button"
                className="msh-row"
                onClick={() => onOpenLifeEvents(person)}
              >
                <span className="msh-tile-icon" aria-hidden="true">
                  <HeartPulse size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>Life events</strong>
                  <small>Significant moments in this person&rsquo;s life</small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
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
            onEntrySaved?.();
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
