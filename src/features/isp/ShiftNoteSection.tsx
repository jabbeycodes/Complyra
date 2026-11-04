import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Empty } from "../../components";
import { todayIso } from "../../data/chart";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import type { ComplyraApi } from "../../data/localApi";
import { shiftNoteShiftOptions, type ShiftStarts } from "../../data/dueItems";
import {
  activeIspProgram,
  canEditShiftNoteRow,
  clinicianProvider,
  clinicianTimes,
  clocksFromShiftLabel,
  formatDurationHhmm,
  formatMonthLabel,
  monthsWithNotes,
  progressNoteName,
  shiftDurationMinutes,
  shiftNoteTimingProblem,
  shiftNotesForMonth,
  waiverServiceNames,
  waiverServiceWriteAbout,
  shiftNotesForPrint,
  type IspProgramView,
  type ShiftNoteView,
} from "../../data/shiftNotes";
import { centralTodayIso } from "../../data/menuRecords";
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
  shiftOptions,
  defaultLocation,
  staffTitle,
  staffName,
  legalName,
  dateOfBirth,
  defaultWaiverService,
  onDone,
}: {
  program: IspProgramView;
  api: ComplyraApi;
  individualId: string;
  runIsp: (action: () => Promise<unknown>) => Promise<boolean>;
  initial?: ShiftNoteView;
  /** This house's windows, including ones that overlap. */
  shiftOptions: string[];
  defaultLocation: string;
  staffTitle: string;
  staffName: string;
  legalName: string;
  dateOfBirth: string;
  defaultWaiverService: string;
  onDone?: () => void;
}) {
  const levels = [...(program.scoringMethod?.levels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const choices = initial?.shift && !shiftOptions.includes(initial.shift)
    ? [initial.shift, ...shiftOptions]
    : shiftOptions;
  const seededClock = clocksFromShiftLabel(initial?.shift ?? choices[0] ?? "");
  const [noteDate, setNoteDate] = useState(initial?.noteDate ?? centralTodayIso());
  const [shift, setShift] = useState(initial?.shift ?? choices[0] ?? "");
  const [beginTime, setBeginTime] = useState(initial?.beginTime || seededClock?.begin || "");
  const [endTime, setEndTime] = useState(initial?.endTime || seededClock?.end || "");
  const [location, setLocation] = useState(initial?.location || defaultLocation);
  const [waiverService, setWaiverService] = useState(
    initial?.waiverService || defaultWaiverService || "",
  );
  const [signatureUrl, setSignatureUrl] = useState(initial?.signatureDataUrl ?? "");
  const [scores, setScores] = useState<ScoreDraft[]>(() =>
    program.tasks.map((task) => {
      const existing = initial?.scores.find((s) => s.taskId === task.id);
      return { taskId: task.id, levelId: existing?.levelId ?? "", comment: existing?.comment ?? "" };
    }),
  );
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const duration = shiftDurationMinutes(beginTime, endTime);
  const goal = program.goalService?.trim() ?? "";
  const signed = Boolean(signatureUrl || initial?.signatureDataUrl);
  const timingProblem = shiftNoteTimingProblem({ noteDate, beginTime });
  const canSave =
    noteDate.length > 0 &&
    shift.trim().length > 0 &&
    duration !== null &&
    !timingProblem &&
    waiverServiceNames().includes(waiverService) &&
    summary.trim().length > 0 &&
    (Boolean(initial) || (signed && goal.length > 0));

  useEffect(() => {
    if (initial?.signatureDataUrl) return;
    let cancelled = false;
    void api.getMySignature().then(async (adopted) => {
      if (!adopted || cancelled) return;
      try {
        const url = await api.getSignatureImageUrl(adopted.signaturePath);
        if (!cancelled) setSignatureUrl(url);
      } catch {
        // An unreadable signature stays unsigned. The save explains why.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, initial?.signatureDataUrl]);

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
              beginTime,
              endTime,
              location,
              staffTitle: initial?.staffTitle || staffTitle,
              waiverService,
              signatureDataUrl: signatureUrl || initial?.signatureDataUrl,
              summary,
              timeSpentMinutes: duration,
              scores: scores.filter((s) => s.levelId.length > 0),
            })
            .then(() => undefined),
          // Close ONLY on success: runIsp resolves false when the save
          // failed (the error shows in the chart banner and the form must
          // stay open with the note intact — simulation batch 9, Finding 1).
        ).then((saved) => {
          if (saved) onDone?.();
        });
      }}
    >
      <h3>{initial ? "Edit shift note" : `New shift note — ${program.name}`}</h3>
      <p className="muted">
        {progressNoteName(legalName) || "Name not on file"}
        {dateOfBirth ? ` · Date of birth ${dateOfBirth}` : " · Date of birth not on file"}
      </p>
      <div className="overview-form-grid">
        <label>
          Date
          <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} required />
        </label>
        <label>
          Begin time
          <input
            type="time"
            aria-label="Begin time"
            value={beginTime}
            onChange={(e) => setBeginTime(e.target.value)}
            required
          />
        </label>
        <label>
          End time
          <input
            type="time"
            aria-label="End time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </label>
        <label>
          Duration
          <input
            aria-label="Duration"
            value={duration === null ? "" : formatDurationHhmm(duration)}
            readOnly
          />
        </label>
        <label>
          Location
          <input
            aria-label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            autoComplete="off"
            placeholder="House or address"
          />
        </label>
        <label>
          Counts toward
          <select
            value={shift}
            aria-label="Counts toward"
            onChange={(e) => {
              const next = e.target.value;
              const previous = clocksFromShiftLabel(shift);
              const stillDefault =
                !beginTime ||
                !endTime ||
                (previous !== null && beginTime === previous.begin && endTime === previous.end);
              setShift(next);
              const clock = clocksFromShiftLabel(next);
              if (clock && stillDefault) {
                setBeginTime(clock.begin);
                setEndTime(clock.end);
              }
            }}
          >
            {choices.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
        </label>
        <label className="overview-form-span">
          Waiver service
          <select
            aria-label="Waiver service"
            value={waiverService}
            onChange={(e) => setWaiverService(e.target.value)}
            required
          >
            <option value="">Choose the service</option>
            {waiverServiceNames().map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {timingProblem && <p className="muted">{timingProblem}</p>}
      {waiverServiceWriteAbout(waiverService) && (
        <p className="muted">{waiverServiceWriteAbout(waiverService)}</p>
      )}
      <p className="muted">
        {goal
          ? `PCSP goal: ${goal}`
          : "A program manager saves the goal or outcome from the current PCSP on this ISP before a progress note can be saved."}
      </p>
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
              Scoring comment
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
        Progress note
        <textarea
          aria-label="Progress note"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          required
          placeholder="What the person did, and how you supported a goal in the current PCSP"
        />
      </label>
      <div className="overview-form-grid">
        <p>
          Printed name
          <br />
          <strong>{initial?.staffName || staffName || "You"}</strong>
        </p>
        <p>
          Title
          <br />
          <strong>{initial?.staffTitle || staffTitle || "Title not on file"}</strong>
        </p>
      </div>
      {signatureUrl ? (
        <p>
          Signature
          <br />
          <img src={signatureUrl} alt="Adopted signature" style={{ maxHeight: 48 }} />
        </p>
      ) : (
        <p className="muted">Adopt your signature from Your profile before this progress note can be saved. A printed name is not a signature.</p>
      )}
      <p className="muted">
        End time may be the same as begin time, or earlier when the shift crosses midnight. A note does not replace another note that overlaps it.
      </p>
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
  shiftOptions,
  defaultLocation,
  staffTitle,
  staffName,
  staffTitles,
  legalName,
  dateOfBirth,
  defaultWaiverService,
}: {
  note: ShiftNoteView;
  canEdit: boolean;
  api: ComplyraApi;
  individualId: string;
  program: IspProgramView | null;
  runIsp: (action: () => Promise<unknown>) => Promise<boolean>;
  shiftOptions: string[];
  defaultLocation: string;
  staffTitle: string;
  staffName: string;
  staffTitles: Record<string, string>;
  legalName: string;
  dateOfBirth: string;
  defaultWaiverService: string;
}) {
  const [editing, setEditing] = useState(false);
  const times = clinicianTimes(note);
  const shown = {
    ...note,
    location: note.location?.trim() || defaultLocation,
    staffTitle: note.staffTitle?.trim() || staffTitles[note.staffUserId] || "",
  };
  const levelById = new Map(
    (program?.scoringMethod?.levels ?? []).map((level) => [level.id, level]),
  );
  return (
    <div className="isp-note-card">
      <div className="isp-program-head">
        <div>
          <strong>
            {note.noteDate} · {times.beginLabel || note.shift}
            {times.endLabel ? `–${times.endLabel}` : ""}
            {times.durationLabel ? ` · ${times.durationLabel}` : ""}
          </strong>
          <span className="muted">
            {" "}
            · {clinicianProvider(shown)}
            {shown.location ? ` · ${shown.location}` : ""}
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
          shiftOptions={shiftOptions}
          defaultLocation={defaultLocation}
          staffTitle={staffTitle}
          staffName={staffName}
          legalName={legalName}
          dateOfBirth={dateOfBirth}
          defaultWaiverService={defaultWaiverService}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <table className="clinician-note">
            <thead>
              <tr>
                <th>Task</th>
                <th>Score</th>
                <th>Scoring comments</th>
              </tr>
            </thead>
            <tbody>
              {note.scores.map((score) => (
                <tr key={score.id}>
                  <td>{score.taskTitle}</td>
                  <td>{levelById.get(score.levelId)?.caption ?? "Scored"}</td>
                  <td>{score.comment}</td>
                </tr>
              ))}
              <tr>
                <th>Progress note</th>
                <td colSpan={2}>{note.summary}</td>
              </tr>
              {note.waiverService ? (
                <tr>
                  <th>Waiver service</th>
                  <td colSpan={2}>{note.waiverService}</td>
                </tr>
              ) : null}
              <tr>
                <th>Signature</th>
                <td colSpan={2}>
                  {note.signatureDataUrl ? (
                    <img src={note.signatureDataUrl} alt={`Signature of ${note.staffName}`} style={{ maxHeight: 40 }} />
                  ) : (
                    "Signature not on this note"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
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
  shiftClock,
  defaultLocation,
  staffTitle,
  staffName,
  staffTitles,
  legalName,
  dateOfBirth,
  defaultWaiverService,
  onOpenNotes,
}: {
  individualId: string;
  data: IspChartData;
  api: ComplyraApi;
  runIsp: (action: () => Promise<unknown>) => Promise<boolean>;
  sessionUserId: string;
  roleKey: string;
  canEnter: boolean;
  canConfigure: boolean;
  /** This house's shift clock. Omitted houses use 6:00 a.m. / 2:00 p.m. / 10:00 p.m. */
  shiftClock?: ShiftStarts;
  defaultLocation: string;
  staffTitle: string;
  staffName: string;
  staffTitles?: Record<string, string>;
  legalName: string;
  dateOfBirth: string;
  defaultWaiverService: string;
  /** Print or download the selected window. Omitted when the chart has no session. */
  onOpenNotes?: (
    mode: "download" | "print",
    reportDescription: string,
    range: { from: string; to: string },
  ) => Promise<void>;
}) {
  const planYear = currentPlanYear();
  const program = activeIspProgram(data.programs, individualId, planYear);
  const shiftOptions = shiftNoteShiftOptions(shiftClock ?? {
    dayStart: "06:00",
    dayEnd: "14:00",
    eveningStart: "14:00",
    eveningEnd: "22:00",
    overnightStart: "22:00",
    overnightEnd: "06:00",
  });
  const [showForm, setShowForm] = useState(false);
  const [reportDescription, setReportDescription] = useState(program?.name ?? "");
  const [windowKey, setWindowKey] = useState("recent");
  const printed = shiftNotesForPrint(data.notes, todayIso());
  const monthPacket = windowKey === "recent" ? null : shiftNotesForMonth(data.notes, windowKey);
  const recent = monthPacket?.notes ?? printed.notes;
  const windowFrom = monthPacket?.from ?? printed.from;
  const windowTo = monthPacket?.to ?? printed.to;
  const windowLabel = monthPacket ? formatMonthLabel(windowKey) : printed.coversToday ? "Last 14 days" : "Latest notes on file";
  const months = monthsWithNotes(data.notes);

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
              shiftOptions={shiftOptions}
              defaultLocation={defaultLocation}
              staffTitle={staffTitle}
              staffName={staffName}
              legalName={legalName}
              dateOfBirth={dateOfBirth}
              defaultWaiverService={defaultWaiverService}
              onDone={() => setShowForm(false)}
            />
          )}
          {!canEnter && (
            <p className="muted">Your role can read shift notes but not enter them.</p>
          )}
        </>
      )}
      {recent.length > 0 && onOpenNotes && (
        <div className="overview-form-grid">
          <label className="overview-form-span">
            Report description
            <input
              aria-label="Report description"
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              maxLength={150}
              placeholder={program?.name ?? "Shift notes"}
            />
          </label>
          <label>
            Report window
            <select
              aria-label="Report window"
              value={months.includes(windowKey) || windowKey === "recent" ? windowKey : "recent"}
              onChange={(e) => setWindowKey(e.target.value)}
            >
              <option value="recent">{printed.coversToday ? "Last 14 days" : "Latest notes on file"}</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          </label>
          <div className="chart-actions">
            <button
              type="button"
              className="button"
              onClick={() =>
                void onOpenNotes("print", reportDescription.trim() || program?.name || "Shift notes", {
                  from: windowFrom,
                  to: windowTo,
                })
              }
            >
              <Printer size={16} aria-hidden="true" /> Print {windowLabel}
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                void onOpenNotes("download", reportDescription.trim() || program?.name || "Shift notes", {
                  from: windowFrom,
                  to: windowTo,
                })
              }
            >
              <Download size={16} aria-hidden="true" /> Download
            </button>
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="isp-notes-list">
          <h3>{windowLabel}</h3>
          <p className="muted">
            {recent.length} notes, newest first
            {` · ${windowFrom} to ${windowTo}.`}
          </p>
          {recent.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              canEdit={canEnter && canEditShiftNoteRow(roleKey, sessionUserId, note)}
              api={api}
              individualId={individualId}
              program={data.programs.find((p) => p.id === note.programId) ?? program}
              runIsp={runIsp}
              shiftOptions={shiftOptions}
              defaultLocation={defaultLocation}
              staffTitle={staffTitle}
              staffName={staffName}
              staffTitles={staffTitles ?? {}}
              legalName={legalName}
              dateOfBirth={dateOfBirth}
              defaultWaiverService={defaultWaiverService}
            />
          ))}
        </div>
      )}
    </section>
  );
}
