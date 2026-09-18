import { useMemo, useState } from "react";
import { Badge, Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  INVESTIGATION_SOURCE_LABELS,
  INVESTIGATION_STATUS_META,
  deriveInvestigationStatus,
  sortInvestigations,
  type Investigation,
  type InvestigationStatus,
} from "../../data/investigations";

type Filter = "all" | InvestigationStatus;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "overdue", label: "Overdue" },
  { id: "resolved", label: "Resolved" },
];

interface InvestigationsPanelProps {
  siteName: string;
  investigations: Investigation[] | null;
  onChanged: () => Promise<void>;
  sectionRef: React.RefObject<HTMLElement | null>;
}

function eventLabel(event: Investigation["history"][number]): string {
  switch (event.eventType) {
    case "created":
      return "Created";
    case "assigned":
      return "Assigned";
    case "status_changed":
      return `Status: ${event.fromStatus ?? "—"} → ${event.toStatus ?? "—"}`;
    case "note":
      return "Note";
    case "reopened":
      return "Re-opened";
    case "deleted":
      return "Deleted";
    default:
      return event.eventType;
  }
}

/**
 * Investigations for one program site (issue #98). Rendered only for
 * investigations.manage holders; NOT a tab — tab order stays fixed.
 */
export default function InvestigationsPanel({
  siteName,
  investigations,
  onChanged,
  sectionRef,
}: InvestigationsPanelProps) {
  const { api } = useData();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const rows = useMemo(() => {
    const list = investigations ?? [];
    const sorted = sortInvestigations(list);
    if (filter === "all") return sorted;
    return sorted.filter((i) => deriveInvestigationStatus(i) === filter);
  }, [investigations, filter]);

  async function run(id: string, action: () => Promise<unknown>) {
    setError("");
    setBusy(id);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addNote(id: string) {
    const note = noteDraft.trim();
    if (!note) return;
    await run(id, () => api.addInvestigationNote(id, note));
    setNoteDraft("");
    setNoteFor(null);
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete the investigation "${title}"? It stays in the record as deleted.`)) {
      return;
    }
    await run(id, () => api.deleteInvestigation(id));
    setExpanded((cur) => (cur === id ? null : cur));
  }

  return (
    <section ref={sectionRef} className="panel investigations-panel" aria-label={`${siteName} investigations`}>
      <div className="panel-heading">
        <h2>Investigations</h2>
        <div className="investigations-filters" role="group" aria-label="Filter investigations">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? "selected" : ""}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="investigations-error" role="alert">
          {error}
        </p>
      )}
      {investigations === null && <p className="muted section-note">Loading investigations…</p>}
      {investigations !== null && rows.length === 0 && (
        <Empty
          mark="none"
          title="No investigations"
          text={
            filter === "all"
              ? "Nothing is under investigation at this home. Open any dashboard tile to start one."
              : `No ${filter.replace("_", " ")} investigations.`
          }
        />
      )}
      {rows.length > 0 && (
        <ul className="record-list investigations-list">
          {rows.map((inv) => {
            const status = deriveInvestigationStatus(inv);
            const meta = INVESTIGATION_STATUS_META[status];
            const isOpen = expanded === inv.id;
            return (
              <li key={inv.id} className="record-row investigation-row">
                <div className="investigation-main">
                  <button
                    type="button"
                    className="investigation-toggle"
                    aria-expanded={isOpen}
                    aria-controls={`inv-body-${inv.id}`}
                    onClick={() => setExpanded(isOpen ? null : inv.id)}
                  >
                    <strong>{inv.title}</strong>
                    <span className="muted">
                      {" "}
                      · {INVESTIGATION_SOURCE_LABELS[inv.sourceMetric]}
                      {inv.sourceLabel ? ` · ${inv.sourceLabel}` : ""}
                      {inv.assignedToName ? ` · owner: ${inv.assignedToName}` : ""}
                      {inv.dueOn ? ` · due ${formatDate(inv.dueOn)}` : ""}
                    </span>
                  </button>
                  <Badge status={meta.label} />
                </div>
                {isOpen && (
                  <div id={`inv-body-${inv.id}`} className="investigation-detail">
                    {inv.description && <p>{inv.description}</p>}
                    <p className="muted">
                      Opened by {inv.createdByName || "staff"}
                      {inv.createdAt ? ` · ${formatDate(inv.createdAt.slice(0, 10))}` : ""}
                      {inv.resolvedAt ? ` · resolved ${formatDate(inv.resolvedAt.slice(0, 10))}` : ""}
                    </p>
                    {inv.history.length > 0 && (
                      <ul className="investigation-history">
                        {[...inv.history]
                          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                          .map((event) => (
                            <li key={event.id}>
                              <strong>{eventLabel(event)}</strong>
                              <span className="muted">
                                {" "}
                                · {event.createdByName || "staff"}
                                {event.createdAt
                                  ? ` · ${formatDate(event.createdAt.slice(0, 10))}`
                                  : ""}
                              </span>
                              {event.note && <p>{event.note}</p>}
                            </li>
                          ))}
                      </ul>
                    )}
                    <div className="investigation-actions">
                      {noteFor === inv.id ? (
                        <div className="investigation-note-form">
                          <textarea
                            value={noteDraft}
                            rows={2}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            placeholder="Add a note to the history…"
                            aria-label={`Note for ${inv.title}`}
                          />
                          <div>
                            <button
                              type="button"
                              className="button"
                              onClick={() => {
                                setNoteFor(null);
                                setNoteDraft("");
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="button primary"
                              disabled={busy === inv.id || !noteDraft.trim()}
                              onClick={() => void addNote(inv.id)}
                            >
                              Add note
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setNoteFor(inv.id)}
                        >
                          Add note
                        </button>
                      )}
                      {status === "resolved" ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy === inv.id}
                          onClick={() => void run(inv.id, () => api.reopenInvestigation(inv.id))}
                        >
                          Re-open
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy === inv.id}
                          onClick={() => void run(inv.id, () => api.resolveInvestigation(inv.id))}
                        >
                          Resolve
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button investigation-delete"
                        disabled={busy === inv.id}
                        onClick={() => void remove(inv.id, inv.title)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
