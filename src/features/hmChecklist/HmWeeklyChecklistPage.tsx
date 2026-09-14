import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, PageHeading } from "../../components";
import StatusBadge from "../../components/StatusBadge";
import { useData } from "../../data/DataProvider";
import { SignatureField } from "../signatures/SignatureField";
import { hmChecklistPayload } from "../signatures/documentPayloads";
import "./hmChecklist.css";
import "./scheduler.css";
import { downloadBlob } from "../../data/openFile";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { todayIso } from "../../data/chart";
import type {
  ChecklistAnswer,
  HmWeeklyChecklist,
  ServiceLogEntry,
  ServiceLogKind,
} from "../../data/types";
import {
  CHECKLIST_ATTESTATION_TEXT,
  CHECKLIST_DEADLINE_TEXT,
  ITEM_21_KEY,
  SERVICE_LOG_KINDS,
  SERVICE_LOG_KIND_LABELS,
  SERVICE_LOG_PROMPTS,
  computeChecklistStatus,
  deadlineMondayIso,
  deadlinePassed,
  formatDueAt,
  formatShortDate,
  weekOfSundayIso,
  weekRangeLabel,
} from "../../data/hmChecklist";

const ANSWERS: ChecklistAnswer[] = ["Y", "N", "N/A"];

function statusBadge(status: HmWeeklyChecklist["status"]) {
  if (status === "open") return "Open";
  if (status === "submitted") return "Submitted";
  if (status === "overdue") return "Overdue";
  return "Locked";
}

function AnswerControl({
  value,
  onChange,
  disabled,
}: {
  value: ChecklistAnswer | null;
  onChange: (answer: ChecklistAnswer) => void;
  disabled: boolean;
}) {
  return (
    <div className="answer-segment" role="radiogroup" aria-label="Answer">
      {ANSWERS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          className={`answer-option ${value === a ? "selected" : ""}`}
          disabled={disabled}
          onClick={() => onChange(a)}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

export default function HmWeeklyChecklistPage() {
  const { api, session, workspace, refresh } = useData();
  const [lists, setLists] = useState<HmWeeklyChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logKind, setLogKind] = useState<ServiceLogKind>("class_reminder");
  const [logDetail, setLogDetail] = useState("");
  const [logStaff, setLogStaff] = useState("");
  const [logDateTime, setLogDateTime] = useState("");

  const currentWeek = weekOfSundayIso(todayIso());
  const openList = useMemo(
    () => lists.find((c) => c.status === "open" && c.weekOf === currentWeek),
    [lists, currentWeek],
  );
  const past = useMemo(
    () => lists.filter((c) => c !== openList),
    [lists, openList],
  );
  const openSite = openList
    ? workspace?.sites.find((s) => s.id === openList.siteId)
    : null;

  async function load() {
    setError("");
    try {
      // Lightweight Sunday rollover trigger: the routine is idempotent, and
      // there is no backend cron, so the app advances the week on load.
      await api.rolloverWeeklyChecklists();
      const rows = await api.listWeeklyChecklists();
      const open = rows.find(
        (c) => c.status === "open" && c.weekOf === weekOfSundayIso(todayIso()),
      );
      if (open) {
        // Keep item 21 live: recompute from training records on every load.
        await api.refreshChecklistItem21(open.id);
        const refreshed = await api.listWeeklyChecklists();
        setLists(refreshed);
      } else {
        setLists(rows);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session || !workspace) return null;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await refresh();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function download(checklistId: string) {
    const file = await api.exportWeeklyChecklistPdf(checklistId);
    downloadBlob(file.name, file.blob);
  }

  const overdue = openList ? deadlinePassed(openList.weekOf) : false;
  // Scheduler-driven lifecycle status: submitted -> compliant, past due_at
  // and unsubmitted -> late, otherwise pending.
  const openComputedStatus = openList
    ? computeChecklistStatus({
        submittedAt: openList.submittedAt,
        dueAt: openList.dueAt,
        late: openList.late,
      })
    : null;

  return (
    <div data-tour="hm-checklist" aria-labelledby="hm-checklist-heading">
      <PageHeading
        title="Weekly checklist"
        description="Your weekly compliance walkthrough. Answer every item — do not leave blanks — and submit it Monday by 4:00 p.m."
      />
      {error && <p className="form-error">{error}</p>}
      {loading && <p>Loading your checklist…</p>}
      {!loading && !openList && (
        <section className="panel">
          <h2>No open checklist for this week</h2>
          <p>
            Your DPM assigns the weekly checklist each week. If one should be
            here, ask your DPM to assign it.
          </p>
        </section>
      )}
      {openList && (
        <section className="panel" aria-label="Current weekly checklist">
          {openComputedStatus === "late" && (
            <div className="scheduler-late-banner" role="alert">
              <StatusBadge status="late" />
              <div className="scheduler-late-text">
                <span className="scheduler-late-title">
                  This checklist is past due
                </span>
                <span className="scheduler-late-sub">
                  Submit it now — the late flag stays on the record.
                </span>
              </div>
            </div>
          )}
          <div className="panel-heading">
            <div>
              <h2 id="hm-checklist-heading">
                Week of {weekRangeLabel(openList.weekOf)}
                {openSite ? ` · ${openSite.name}` : ""}
              </h2>
              <p>
                Home: {openSite?.name ?? "—"} · {CHECKLIST_DEADLINE_TEXT} (
                {formatShortDate(deadlineMondayIso(openList.weekOf))})
                {overdue ? " — past due" : ""}
              </p>
              {openList.dueAt && (
                <p
                  className={`scheduler-due-line${openComputedStatus === "late" ? " is-late" : ""}`}
                >
                  <span>
                    Due{" "}
                    <span className="scheduler-due-date">
                      {formatDueAt(openList.dueAt)}
                    </span>
                  </span>
                  <span>Week of {weekRangeLabel(openList.weekOf)}</span>
                </p>
              )}
            </div>
            <Badge status={overdue ? "Overdue" : statusBadge(openList.status)} />
          </div>

          <ol className="checklist-items">
            {openList.items.map((item, i) => {
              const locked = item.key === ITEM_21_KEY;
              return (
                <li key={item.key} className="checklist-item">
                  <div className="checklist-item-row">
                    <span className="checklist-number">{i + 1}</span>
                    <span className="checklist-prompt">
                      {item.prompt}
                      {locked && (
                        <span className="auto-badge" title="Auto-checked from training records">
                          <Sparkles size={12} /> Auto
                        </span>
                      )}
                    </span>
                    <AnswerControl
                      value={item.answer}
                      disabled={locked}
                      onChange={(a) =>
                        run(() =>
                          api.answerChecklistItem(openList.id, item.key, a),
                        )
                      }
                    />
                  </div>
                  {locked ? (
                    <p className="checklist-auto-note">{item.note}</p>
                  ) : (
                    <input
                      className="input checklist-note"
                      placeholder="Note (optional)"
                      defaultValue={item.note}
                      key={`${openList.id}-${item.key}-${item.answer}`}
                      onBlur={(e) => {
                        const next = e.target.value;
                        if (next !== item.note && item.answer) {
                          run(() =>
                            api.answerChecklistItem(
                              openList.id,
                              item.key,
                              item.answer as ChecklistAnswer,
                              next,
                            ),
                          );
                        }
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <h3>Service log</h3>
          <p className="muted">
            Second-page fill-ins, as structured entries.
          </p>
          <div className="service-log-form">
            <label>
              Entry type
              <select
                value={logKind}
                onChange={(e) => setLogKind(e.target.value as ServiceLogKind)}
              >
                {SERVICE_LOG_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {SERVICE_LOG_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{SERVICE_LOG_PROMPTS[logKind]}</p>
            <textarea
              className="input"
              rows={3}
              value={logDetail}
              onChange={(e) => setLogDetail(e.target.value)}
              placeholder="Details"
            />
            <div className="form-row">
              <label>
                Staff name (if relevant)
                <input
                  className="input"
                  value={logStaff}
                  onChange={(e) => setLogStaff(e.target.value)}
                />
              </label>
              <label>
                Date / time (if relevant)
                <input
                  className="input"
                  value={logDateTime}
                  onChange={(e) => setLogDateTime(e.target.value)}
                  placeholder="e.g. Mon 9/14 2:30p"
                />
              </label>
            </div>
            <button
              className="button secondary"
              onClick={() =>
                run(async () => {
                  await api.addServiceLogEntry(openList.id, {
                    kind: logKind,
                    detail: logDetail,
                    staffName: logStaff,
                    dateTime: logDateTime,
                  });
                  setLogDetail("");
                  setLogStaff("");
                  setLogDateTime("");
                })
              }
            >
              <Plus size={16} /> Add entry
            </button>
          </div>
          <ul className="service-log-list">
            {openList.serviceLogs.map((entry: ServiceLogEntry) => (
              <li key={entry.id}>
                <strong>{SERVICE_LOG_KIND_LABELS[entry.kind]}</strong>
                <span>{entry.detail}</span>
                {(entry.staffName || entry.dateTime) && (
                  <span className="cell-sub">
                    {[entry.staffName, entry.dateTime]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label="Remove entry"
                  onClick={() =>
                    run(() => api.removeServiceLogEntry(openList.id, entry.id))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>

          <h3>Attestation</h3>
          <p className="attestation">{CHECKLIST_ATTESTATION_TEXT}</p>
          <SignatureField
            documentType="hm_checklist"
            documentId={openList.id}
            fieldName="hm_signature"
            label="HM signature"
            actionLabel="Sign & submit as {name}"
            getDocumentPayload={() => hmChecklistPayload(openList)}
            canAct={session?.userId === openList.assignedToUserId}
            legacySigned={
              openList.submittedAt
                ? {
                    signerName: openList.attestation?.signedBy ?? "Signed",
                    signedAt: openList.submittedAt,
                  }
                : null
            }
          />
          <div className="panel-actions">
            <button
              className="button secondary"
              onClick={() => run(() => download(openList.id))}
            >
              <Download size={16} /> Download PDF
            </button>
          </div>
          <ComplyrerRecordMark
            documentId={openList.id}
            generatedAt={openList.submittedAt}
          />
        </section>
      )}

      {past.length > 0 && (
        <section className="panel" aria-label="Past checklists">
          <h2>Past weeks</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {past.map((c) => (
                  <tr key={c.id}>
                    <td>{weekRangeLabel(c.weekOf)}</td>
                    <td>
                      {c.late && !c.submittedAt ? (
                        <StatusBadge status="late" />
                      ) : (
                        <Badge status={statusBadge(c.status)} />
                      )}
                    </td>
                    <td>{formatDueAt(c.dueAt)}</td>
                    <td>
                      {c.submittedAt
                        ? formatShortDate(c.submittedAt.slice(0, 10))
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="button secondary small"
                        onClick={() => run(() => download(c.id))}
                      >
                        <Download size={14} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
