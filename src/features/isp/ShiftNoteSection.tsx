import { useState } from "react";
import { Empty } from "../../components";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import type { ComplyraApi } from "../../data/localApi";
import {
  activeIspProgram,
  canEditShiftNoteRow,
  ISP_SHIFTS,
  type IspProgramView,
  type ShiftNoteView,
} from "../../data/shiftNotes";
import { currentPlanYear, type IspChartData } from "./useIspData";

/**
 * Issue #80 — staff shift-note entry against the active approved ISP program.
 * Replaces the #81 placeholder. DSPs create anytime and edit only their own
 * notes; HM/PM/admin may edit notes within scope. Who/when is stamped on
 * every save; deletes are soft.
 *
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */

interface ScoreDraft {
  taskId: string;
  levelId: string;
  comment: string;
}

function NoteForm({
  program,
  api,
  individualId,
  runIsp,
  initial,
  onDone,
}: {
  program: IspProgramView;
  api: ComplyraApi;
  individualId: string;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
  initial?: ShiftNoteView;
  onDone?: () => void;
}) {
  const levels = [...(program.scoringMethod?.levels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const [noteDate, setNoteDate] = useState(initial?.noteDate ?? new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState(initial?.shift ?? ISP_SHIFTS[0]);
  const [scores, setScores] = useState<ScoreDraft[]>(() =>
    program.tasks.map((task) => {
      const existing = initial?.scores.find((s) => s.taskId === task.id);
      return { taskId: task.id, levelId: existing?.levelId ?? "", comment: existing?.comment ?? "" };
    }),
  );
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [timeSpent, setTimeSpent] = useState(initial?.timeSpentMinutes?.toString() ?? "");
  const canSave = noteDate.length > 0 && shift.trim().length > 0;

  const setScore = (taskId: string, patch: Partial<ScoreDraft>) =>
    setScores((prev) => prev.map((s) => (s.taskId === taskId ? { ...s, ...patch } : s)));

  return (
    <form
      className="overview-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        void runIsp(() =>
          api
            .saveShiftNote({
              noteId: initial?.id,
              individualId,
              programId: program.id,
              noteDate,
              shift,
              summary,
              timeSpentMinutes: timeSpent.trim() === "" ? null : Number(timeSpent),
              scores: scores.filter((s) => s.levelId.length > 0),
            })
            .then(() => undefined),
        ).then(() => onDone?.());
      }}
    >
      <h3>{initial ? "Edit shift note" : `New shift note — ${program.name}`}</h3>
      <div className="overview-form-grid">
        <label>
          Date
          <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} required />
        </label>
        <label>
          Shift
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            {ISP_SHIFTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
        </label>
      </div>
      {program.tasks.map((task) => {
        const draft = scores.find((s) => s.taskId === task.id)!;
        return (
          <fieldset key={task.id} className="isp-score-field">
            <legend>
              {task.title}
              {task.instructions && <span className="muted"> — {task.instructions}</span>}
            </legend>
            <div className="isp-score-group" role="radiogroup" aria-label={`Score for ${task.title}`}>
              {levels.map((level) => (
                <label key={level.id} className="isp-score-option">
                  <input
                    type="radio"
                    name={`score-${task.id}-${initial?.id ?? "new"}`}
                    checked={draft.levelId === level.id}
                    onChange={() => setScore(task.id, { levelId: level.id })}
                  />
                  <span>{level.caption}</span>
                </label>
              ))}
            </div>
            <label className="isp-comment-label">
              Comment
              <input
                value={draft.comment}
                onChange={(e) => setScore(task.id, { comment: e.target.value })}
                autoComplete="off"
                placeholder="What happened with this task"
                aria-label={`Comment for ${task.title}`}
              />
            </label>
          </fieldset>
        );
      })}
      <label>
        Other summary
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="Shift summary, time-relevant notes not tied to a task"
        />
      </label>
      <div className="overview-form-grid">
        <label>
          Time spent (minutes)
          <input
            value={timeSpent}
            onChange={(e) => setTimeSpent(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Optional"
          />
        </label>
      </div>
      <div className="overview-editor-actions">
        {onDone && (
          <button type="button" className="button" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="button primary" disabled={!canSave}>
          {initial ? "Save changes" : "Save note"}
        </button>
      </div>
    </form>
  );
}

function NoteCard({
  note,
  canEdit,
  api,
  individualId,
  program,
  runIsp,
}: {
  note: ShiftNoteView;
  canEdit: boolean;
  api: ComplyraApi;
  individualId: string;
  program: IspProgramView | null;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const levelById = new Map(
    (program?.scoringMethod?.levels ?? []).map((level) => [level.id, level]),
  );
  return (
    <div className="isp-note-card">
      <div className="isp-program-head">
        <div>
          <strong>
            {note.noteDate} · {note.shift}
          </strong>
          <span className="muted">
            {" "}
            · {note.programName} · {note.staffName}
          </span>
        </div>
        {canEdit && !editing && (
          <div className="chart-actions">
            <button type="button" className="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                if (window.confirm("Delete this shift note? It will be kept as a soft-deleted record.")) {
                  void runIsp(() => api.deleteShiftNote(note.id));
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {editing && program ? (
        <NoteForm
          program={program}
          api={api}
          individualId={individualId}
          runIsp={runIsp}
          initial={note}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <ul className="isp-note-scores">
            {note.scores.map((score) => (
              <li key={score.id}>
                <span className="isp-score-chip">{levelById.get(score.levelId)?.shortLabel ?? "?"}</span>{" "}
                {levelById.get(score.levelId)?.caption ?? "Scored"}
                {score.comment && <span className="muted"> — {score.comment}</span>}
              </li>
            ))}
          </ul>
          {note.summary && <p>{note.summary}</p>}
          {note.timeSpentMinutes !== null && (
            <p className="muted">Time spent: {note.timeSpentMinutes} minutes</p>
          )}
          <ComplyrerRecordMark documentId={note.id} generatedAt={note.createdAt} />
        </>
      )}
    </div>
  );
}

export default function ShiftNoteSection({
  individualId,
  data,
  api,
  runIsp,
  sessionUserId,
  roleKey,
  canEnter,
  canConfigure,
}: {
  individualId: string;
  data: IspChartData;
  api: ComplyraApi;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
  sessionUserId: string;
  roleKey: string;
  canEnter: boolean;
  canConfigure: boolean;
}) {
  const planYear = currentPlanYear();
  const program = activeIspProgram(data.programs, individualId, planYear);
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="chart-widget" id="chart-shift-notes" aria-labelledby="shift-notes-heading">
      <h2 id="shift-notes-heading">Shift notes</h2>
      {!program ? (
        <Empty
          mark="quiet"
          title="No ISP program approved for this plan year yet"
          text="Notes open once the DPM approves one."
          actions={
            canConfigure ? (
              <p className="muted">Configure the program in the ISP / PCSP tasks section above.</p>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="stack-help">
            Noting against <strong>{program.name}</strong> (plan year {program.planYear}).
          </p>
          {canEnter && !showForm && (
            <div className="chart-actions">
              <button type="button" className="button primary" onClick={() => setShowForm(true)}>
                New shift note
              </button>
            </div>
          )}
          {canEnter && showForm && (
            <NoteForm
              program={program}
              api={api}
              individualId={individualId}
              runIsp={runIsp}
              onDone={() => setShowForm(false)}
            />
          )}
          {!canEnter && (
            <p className="muted">Your role can read shift notes but not enter them.</p>
          )}
        </>
      )}
      {data.notes.length > 0 && (
        <div className="isp-notes-list">
          <h3>Recent notes</h3>
          {data.notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              canEdit={canEnter && canEditShiftNoteRow(roleKey, sessionUserId, note)}
              api={api}
              individualId={individualId}
              program={data.programs.find((p) => p.id === note.programId) ?? program}
              runIsp={runIsp}
            />
          ))}
        </div>
      )}
    </section>
  );
}
