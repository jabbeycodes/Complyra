/**
 * Issue #75 — HM "Alone time" editor on the Individual chart.
 *
 * House manager + Admin set recurring-weekly or one-off windows during which
 * the Individual is intentionally unstaffed. These hours SHRINK the required
 * Shift-note range on the site Overview and never flag a missing note. DSP /
 * Nurse / PM see the windows read-only so they don't over-document. Never uses
 * the word "unsupervised" in staff chrome; Individuals wording only.
 */
import { useEffect, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { Empty } from "../components";
import { useData } from "../data/DataProvider";
import { canEditAloneTime, formatClock, hhmmToMinutes } from "../data/dueItems";
import type { AloneTimeRecurrence, AloneTimeWindow } from "../data/types";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function rangeLabel(w: AloneTimeWindow): string {
  const start = hhmmToMinutes(w.startTime);
  let end = hhmmToMinutes(w.endTime);
  if (end <= start) end += 1440; // wraps past midnight
  return `${formatClock(start)}–${formatClock(end)}`;
}

function whenLabel(w: AloneTimeWindow): string {
  if (w.recurrence === "weekly") {
    return `Every ${WEEKDAYS[w.weekday ?? 0]}`;
  }
  return w.onDate ? `On ${w.onDate}` : "One-off";
}

interface DraftState {
  recurrence: AloneTimeRecurrence;
  weekday: number;
  onDate: string;
  startTime: string;
  endTime: string;
  note: string;
}

const EMPTY_DRAFT: DraftState = {
  recurrence: "weekly",
  weekday: 1,
  onDate: new Date().toISOString().slice(0, 10),
  startTime: "14:00",
  endTime: "16:00",
  note: "",
};

export default function AloneTimeCard({
  individualId,
  individualName,
}: {
  individualId: string;
  individualName: string;
}) {
  const { api, session } = useData();
  const [windows, setWindows] = useState<AloneTimeWindow[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setWindows(await api.listAloneTime(individualId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    let live = true;
    setWindows(null);
    api
      .listAloneTime(individualId)
      .then((rows) => live && setWindows(rows))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, individualId]);

  if (!session) return null;
  const canEdit = canEditAloneTime(session.roleKey);

  async function save() {
    setError("");
    setBusy(true);
    try {
      await api.saveAloneTimeWindow({
        individualId,
        recurrence: draft.recurrence,
        weekday: draft.recurrence === "weekly" ? draft.weekday : null,
        onDate: draft.recurrence === "once" ? draft.onDate : null,
        startTime: draft.startTime,
        endTime: draft.endTime,
        note: draft.note,
      });
      setAdding(false);
      setDraft(EMPTY_DRAFT);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError("");
    setBusy(true);
    try {
      await api.deleteAloneTimeWindow(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chart-widget alone-time-card" aria-labelledby="alone-time-heading">
      <div className="chart-widget-head">
        <h2 id="alone-time-heading">
          <CalendarClock size={16} aria-hidden="true" /> Alone time
        </h2>
        {canEdit && !adding && (
          <button
            type="button"
            className="button"
            onClick={() => setAdding(true)}
          >
            <Plus size={16} /> Add window
          </button>
        )}
      </div>
      <p className="muted alone-time-help">
        Hours {individualName.split(" ")[0]} is intentionally unstaffed. Notes are
        not required for these hours; every other staffed hour still needs one.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {adding && canEdit && (
        <div className="alone-time-form">
          <div className="alone-time-form-row">
            <label>
              Repeats
              <select
                value={draft.recurrence}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    recurrence: e.target.value as AloneTimeRecurrence,
                  }))
                }
              >
                <option value="weekly">Weekly</option>
                <option value="once">One-off</option>
              </select>
            </label>
            {draft.recurrence === "weekly" ? (
              <label>
                Weekday
                <select
                  value={draft.weekday}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))
                  }
                >
                  {WEEKDAYS.map((name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Date
                <input
                  type="date"
                  value={draft.onDate}
                  onChange={(e) => setDraft((d) => ({ ...d, onDate: e.target.value }))}
                />
              </label>
            )}
          </div>
          <div className="alone-time-form-row">
            <label>
              Start
              <input
                type="time"
                value={draft.startTime}
                onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
              />
            </label>
            <label>
              End
              <input
                type="time"
                value={draft.endTime}
                onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
              />
            </label>
          </div>
          <label>
            Why (optional)
            <input
              type="text"
              placeholder="ISP / family / community"
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </label>
          <div className="alone-time-form-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Save window
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {windows && windows.length === 0 && !adding && (
        <Empty
          mark="none"
          title="No alone time set"
          text="No alone-time hours set. Notes are expected whenever this Individual is staffed."
        />
      )}

      {windows && windows.length > 0 && (
        <ul className="record-list alone-time-list">
          {windows.map((w) => (
            <li key={w.id} className="record-row">
              <div>
                <strong>
                  {whenLabel(w)} · {rangeLabel(w)}
                </strong>
                {w.note && <p className="muted">{w.note}</p>}
                <p className="muted alone-time-stamp">
                  Set by {w.createdByName} · {w.updatedAt.slice(0, 10)}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="text-button alone-time-remove"
                  aria-label={`Remove alone-time window (${whenLabel(w)} ${rangeLabel(w)})`}
                  disabled={busy}
                  onClick={() => void remove(w.id)}
                >
                  <Trash2 size={16} /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
