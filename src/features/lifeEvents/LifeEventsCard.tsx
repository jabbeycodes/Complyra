/**
 * LIFE EVENTS — Individual chart card: the significant-events timeline.
 *
 * Context, not incident paperwork: this section answers "what has happened
 * in this person's life lately" at a glance. It raises no alerts and no
 * dashboard work — recording an entry changes nothing but this timeline.
 * Anyone who can read the Individual sees it (auditors read-only); the
 * editor roles (administrator, compliance_admin, program manager, house
 * manager, nurse) add, correct, and void entries. Removal is a void with
 * a reason — entries are never deleted.
 */
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Empty, formatDateLong } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  LIFE_EVENT_CATEGORIES,
  type LifeEventDraft,
  type LifeEventView,
} from "../../data/lifeEvents";
import { canRecordLifeEvents } from "../../data/permissions";
import "./lifeEvents.css";

const EMPTY_DRAFT: LifeEventDraft = {
  eventDate: "",
  category: "milestone",
  title: "",
  note: "",
  relatedGerId: "",
};

export default function LifeEventsCard({
  individualId,
}: {
  individualId: string;
}) {
  const { api, session } = useData();
  const [events, setEvents] = useState<LifeEventView[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<LifeEventDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LifeEventDraft>(EMPTY_DRAFT);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canRecord = session ? canRecordLifeEvents(session) : false;

  const reload = useCallback(async () => {
    try {
      const rows = await api.listLifeEvents(individualId);
      setEvents(rows);
    } catch {
      setEvents([]);
    }
  }, [api, individualId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.listLifeEvents(individualId);
        if (!cancelled) setEvents(rows);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, individualId, session?.userId]);

  async function runAction(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  const years: { year: string; rows: LifeEventView[] }[] = [];
  for (const row of events ?? []) {
    const year = row.eventDate.slice(0, 4);
    const group = years.find((item) => item.year === year);
    if (group) group.rows.push(row);
    else years.push({ year, rows: [row] });
  }

  return (
    <section className="chart-widget" aria-labelledby="life-events-heading">
      <h2 id="life-events-heading">Life events</h2>
      <p className="stack-help">
        Significant moments in this person&rsquo;s life — moves, hospital
        stays, family changes, milestones. This timeline is context for the
        care team, not incident paperwork; event reports stay the record
        for incidents.
      </p>

      {error && <p className="form-error">{error}</p>}

      {events === null && <p className="muted">Loading life events…</p>}

      {events !== null && events.length === 0 && (
        <Empty
          title="No life events recorded"
          text="Nothing has been added to this timeline yet."
          mark="quiet"
        />
      )}

      {years.map((group) => (
        <div key={group.year} className="life-events-year">
          <h3 className="life-events-year-label">{group.year}</h3>
          <ol className="life-events-list">
            {group.rows.map((row) => (
              <li key={row.id} className="life-event-row">
                <div className="life-event-head">
                  <span className="life-event-date">
                    {formatDateLong(row.eventDate)}
                  </span>
                  <span className="life-event-category">
                    {row.categoryLabel}
                  </span>
                </div>
                <h4 className="life-event-title">{row.title}</h4>
                {row.note && <p className="life-event-note">{row.note}</p>}
                {row.relatedGerId && (
                  <p className="life-event-meta">
                    Related event report: {row.relatedGerId}
                  </p>
                )}
                <p className="life-event-meta">
                  Recorded by {row.recordedByName} ·{" "}
                  {formatDateLong(row.createdAt)}
                  {row.updatedAt && row.updatedByName
                    ? ` · Edited by ${row.updatedByName} · ${formatDateLong(row.updatedAt)}`
                    : ""}
                </p>

                {canRecord && editingId !== row.id && voidingId !== row.id && (
                  <div className="chart-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setVoidingId(null);
                        setEditDraft({
                          eventDate: row.eventDate,
                          category: row.category,
                          title: row.title,
                          note: row.note,
                          relatedGerId: row.relatedGerId ?? "",
                        });
                      }}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setVoidingId(row.id);
                        setEditingId(null);
                        setVoidReason("");
                      }}
                    >
                      <X size={14} /> Void entry
                    </button>
                  </div>
                )}

                {canRecord && editingId === row.id && (
                  <LifeEventForm
                    draft={editDraft}
                    onChange={setEditDraft}
                    busy={busy}
                    submitLabel="Save correction"
                    onCancel={() => setEditingId(null)}
                    onSubmit={() =>
                      runAction(async () => {
                        await api.updateLifeEvent(row.id, editDraft);
                        setEditingId(null);
                      })
                    }
                  />
                )}

                {canRecord && voidingId === row.id && (
                  <form
                    className="life-event-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runAction(async () => {
                        await api.voidLifeEvent(row.id, voidReason);
                        setVoidingId(null);
                      });
                    }}
                  >
                    <label>
                      Why is this entry being voided?
                      <input
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        placeholder="e.g. Recorded on the wrong chart"
                        required
                      />
                    </label>
                    <p className="stack-help">
                      Voiding keeps the entry on file with your name and
                      this reason; it leaves the timeline and cannot be
                      undone.
                    </p>
                    <div className="chart-actions">
                      <button
                        type="submit"
                        className="button primary"
                        disabled={busy}
                      >
                        Void this entry
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setVoidingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}

      {canRecord && !adding && (
        <div className="chart-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setAdding(true);
              setDraft(EMPTY_DRAFT);
            }}
          >
            <Plus size={15} /> Add life event
          </button>
        </div>
      )}

      {canRecord && adding && (
        <LifeEventForm
          draft={draft}
          onChange={setDraft}
          busy={busy}
          submitLabel="Add to timeline"
          onCancel={() => setAdding(false)}
          onSubmit={() =>
            runAction(async () => {
              await api.createLifeEvent({ individualId, ...draft });
              setAdding(false);
            })
          }
        />
      )}
    </section>
  );
}

function LifeEventForm({
  draft,
  onChange,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  draft: LifeEventDraft;
  onChange: (draft: LifeEventDraft) => void;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="life-event-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        Date of the event
        <input
          type="date"
          value={draft.eventDate}
          onChange={(event) =>
            onChange({ ...draft, eventDate: event.target.value })
          }
          required
        />
      </label>
      <label>
        Category
        <select
          value={draft.category}
          onChange={(event) =>
            onChange({ ...draft, category: event.target.value })
          }
        >
          {LIFE_EVENT_CATEGORIES.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="e.g. Moved into the Brengman home"
          required
        />
      </label>
      <label>
        Note (optional)
        <textarea
          value={draft.note ?? ""}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          rows={3}
          placeholder="A few sentences of context for the care team"
        />
      </label>
      <label>
        Related event report ID (optional)
        <input
          value={draft.relatedGerId ?? ""}
          onChange={(event) =>
            onChange({ ...draft, relatedGerId: event.target.value })
          }
          placeholder="Only when an event report covers this"
        />
      </label>
      <div className="chart-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
