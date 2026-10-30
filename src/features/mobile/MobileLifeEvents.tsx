import { useCallback, useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  LIFE_EVENT_CATEGORIES,
  type LifeEventDraft,
  type LifeEventView,
} from "../../data/lifeEvents";
import { canRecordLifeEvents } from "../../data/permissions";
import { PersonHeader } from "./MobileMar";
import { groupLifeEventsByYear } from "./chartSections";
import type { WorkspaceIndividual } from "./types";

/**
 * Mobile Life Events — the chart's significant-events timeline as a
 * phone view over the same records (listLifeEvents). Anyone who can
 * read the Individual sees the timeline (auditors read-only); the
 * editor roles the desktop admits (administrator, compliance_admin,
 * program manager, house manager, nurse) can add an event here through
 * the same createLifeEvent call. Corrections and voids stay on the
 * desktop chart — a void is never a delete, there or here.
 */
export default function MobileLifeEvents({
  api,
  session,
  person,
  onOpenChart,
  onBack,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  onOpenChart: (name: string) => void;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<LifeEventView[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const canRecord = canRecordLifeEvents(session);

  const load = useCallback(async () => {
    try {
      setEvents(await api.listLifeEvents(person.id));
      setError("");
    } catch {
      setEvents([]);
    }
  }, [api, person.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = events ? groupLifeEventsByYear(events) : [];

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Back
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />

      <h3 className="msh-pass-title">Life events</h3>
      <p className="msh-section-note">
        Significant moments in this person&rsquo;s life — moves, hospital
        stays, family changes, milestones. Context for the care team, not
        incident paperwork.
      </p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {canRecord && (
        <button
          type="button"
          className="msh-button primary block"
          onClick={() => setAdding(true)}
        >
          Add a life event
        </button>
      )}
      {events === null && <p className="msh-empty">Loading life events…</p>}
      {events !== null && events.length === 0 && (
        <p className="msh-empty">
          No life events recorded. Nothing has been added to this timeline
          yet.
        </p>
      )}
      {groups.map((group) => (
        <div key={group.year}>
          <h4 className="msh-day-heading">{group.year}</h4>
          <div className="msh-list">
            {group.rows.map((row) => (
              <div key={row.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>{row.title}</strong>
                  <small className="msh-status-text">
                    {row.categoryLabel} · {row.eventDate}
                    {row.voided ? " · Voided" : ""}
                  </small>
                  {row.note && <small>{row.note}</small>}
                  <small>Recorded by {row.recordedByName}</small>
                  {row.voided && (
                    <small>
                      Voided by {row.voidedByName ?? "staff"}
                      {row.voidReason ? `: ${row.voidReason}` : ""}
                    </small>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {adding && (
        <LifeEventSheet
          api={api}
          person={person}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function LifeEventSheet({
  api,
  person,
  onClose,
  onSaved,
  onError,
}: {
  api: ComplyraApi;
  person: WorkspaceIndividual;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<LifeEventDraft>({
    eventDate: "",
    category: "milestone",
    title: "",
    note: "",
    relatedGerId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.createLifeEvent({ individualId: person.id, ...draft });
      onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save the life event.";
      setError(message);
      onError(message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close life event form"
        onClick={onClose}
      />
      <div className="msh-sheet" role="dialog" aria-label="Add a life event">
        <h3 className="msh-sheet-title">Add a life event — {person.name}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className="msh-field">
            <span>Event date</span>
            <input
              type="date"
              required
              value={draft.eventDate}
              onChange={(event) =>
                setDraft({ ...draft, eventDate: event.target.value })
              }
            />
          </label>
          <label className="msh-field">
            <span>Category</span>
            <select
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value })
              }
            >
              {LIFE_EVENT_CATEGORIES.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className="msh-field">
            <span>Title</span>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label className="msh-field">
            <span>Note</span>
            <input
              type="text"
              value={draft.note ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
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
              {busy ? "Saving…" : "Save event"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
