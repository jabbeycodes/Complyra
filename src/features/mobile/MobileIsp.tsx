import { useEffect, useMemo, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  ISP_SHIFTS,
  canEditShiftNoteRow,
  clocksFromShiftLabel,
  shiftDurationMinutes,
  waiverServiceNames,
  type IspProgramView,
  type ShiftNoteView,
} from "../../data/shiftNotes";
import { canEnterShiftNotes } from "../../data/permissions";
import SignatureAdoption from "../signatures/SignatureAdoption";
import { useIspData } from "../isp/useIspData";
import MobilePeopleList from "./MobilePeopleList";
import { PersonHeader } from "./MobileMar";
import type { WorkspaceIndividual } from "./types";
import { centralTodayIso, formatDoseTime } from "./mar";
import {
  groupNotesByDay,
  noteTimeText,
  orderPlans,
  planPeriodText,
  planStatus,
} from "./isp";

/** Read view: the same grouped sections as the entry form, as label/value rows. */
export function NoteReadView({
  note,
  levelCaption,
  individualName,
}: {
  note: ShiftNoteView;
  levelCaption: (levelId: string) => string;
  individualName?: string;
}) {
  return (
    <div className="msh-read">
      <section className="msh-read-section">
        <h4>About</h4>
        {individualName && (
          <div className="msh-read-row">
            <span>Individual</span>
            <strong>{individualName}</strong>
          </div>
        )}
        <div className="msh-read-row">
          <span>Plan</span>
          <strong>{note.programName}</strong>
        </div>
        <div className="msh-read-row">
          <span>Entered by</span>
          <strong>
            {note.staffName}
            {note.staffTitle ? ` · ${note.staffTitle}` : ""}
          </strong>
        </div>
      </section>
      <section className="msh-read-section">
        <h4>Collection details</h4>
        <div className="msh-read-row">
          <span>Date (Central)</span>
          <strong>{note.noteDate}</strong>
        </div>
        <div className="msh-read-row">
          <span>Shift and time</span>
          <strong>{noteTimeText(note, formatDoseTime)}</strong>
        </div>
        <div className="msh-read-row">
          <span>Location</span>
          <strong>{note.location?.trim() || "Not recorded"}</strong>
        </div>
        <div className="msh-read-row">
          <span>Waiver service</span>
          <strong>{note.waiverService?.trim() || "Not recorded"}</strong>
        </div>
      </section>
      <section className="msh-read-section">
        <h4>Task scores</h4>
        {note.scores.length === 0 && <p className="msh-empty">No tasks scored.</p>}
        {note.scores.map((score) => (
          <div key={score.id} className="msh-read-row stack">
            <span>{score.taskTitle}</span>
            <strong>{levelCaption(score.levelId)}</strong>
            {score.comment && <small>{score.comment}</small>}
          </div>
        ))}
      </section>
      <section className="msh-read-section">
        <h4>Overall comment</h4>
        <p className="msh-read-summary">{note.summary}</p>
      </section>
    </div>
  );
}

function EntryForm({
  api,
  session,
  person,
  program,
  siteName,
  initial,
  onSaved,
  onCancel,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  program: IspProgramView;
  siteName: string;
  initial?: ShiftNoteView;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const levels = useMemo(
    () =>
      [...(program.scoringMethod?.levels ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    [program],
  );
  const shiftOptions = useMemo(() => {
    const base: string[] = [...ISP_SHIFTS];
    if (initial?.shift && !base.includes(initial.shift)) {
      return [initial.shift, ...base];
    }
    return base;
  }, [initial]);
  const seededClock = clocksFromShiftLabel(initial?.shift ?? shiftOptions[0] ?? "");

  const [noteDate, setNoteDate] = useState(
    initial?.noteDate ?? centralTodayIso(),
  );
  const [shift, setShift] = useState(initial?.shift ?? shiftOptions[0] ?? "");
  const [beginTime, setBeginTime] = useState(
    initial?.beginTime || seededClock?.begin || "",
  );
  const [endTime, setEndTime] = useState(initial?.endTime || seededClock?.end || "");
  const [location, setLocation] = useState(initial?.location || siteName);
  const [waiverService, setWaiverService] = useState(
    initial?.waiverService || waiverServiceNames()[0] || "",
  );
  const [scores, setScores] = useState(() =>
    program.tasks.map((task) => {
      const existing = initial?.scores.find((score) => score.taskId === task.id);
      return {
        taskId: task.id,
        levelId: existing?.levelId ?? "",
        comment: existing?.comment ?? "",
      };
    }),
  );
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [signatureUrl, setSignatureUrl] = useState(
    initial?.signatureDataUrl ?? "",
  );
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const duration = shiftDurationMinutes(beginTime, endTime);
  const isNew = !initial;
  // Mirrors the desktop entry gate (and the API's progress-note rule): a new
  // entry cannot be saved until the plan carries its goal/outcome text.
  const goalMissing = isNew && !(program.goalService ?? "").trim();

  const refreshSignature = async () => {
    try {
      const adopted = await api.getMySignature();
      if (adopted) {
        setSignatureUrl(await api.getSignatureImageUrl(adopted.signaturePath));
      }
    } catch {
      // No readable signature — the save path explains what is missing.
    }
  };

  useEffect(() => {
    if (!initial) void refreshSignature();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const canSave =
    noteDate.length > 0 &&
    shift.trim().length > 0 &&
    duration !== null &&
    waiverServiceNames().includes(waiverService) &&
    summary.trim().length > 0 &&
    (!isNew || signatureUrl.length > 0) &&
    !goalMissing &&
    !busy;

  const setScore = (
    taskId: string,
    patch: Partial<{ levelId: string; comment: string }>,
  ) =>
    setScores((prev) =>
      prev.map((score) =>
        score.taskId === taskId ? { ...score, ...patch } : score,
      ),
    );

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      // Same payload the desktop ShiftNoteSection writes — one ISP record
      // model for both surfaces, enforced again by the API.
      await api.saveShiftNote({
        noteId: initial?.id,
        individualId: person.id,
        programId: program.id,
        noteDate,
        shift,
        beginTime,
        endTime,
        location,
        staffTitle: initial?.staffTitle || session.jobTitle,
        waiverService,
        signatureDataUrl: signatureUrl || initial?.signatureDataUrl,
        summary,
        timeSpentMinutes: duration,
        scores: scores.filter((score) => score.levelId.length > 0),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="msh-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void save();
      }}
    >
      <section className="msh-form-section">
        <h4>About</h4>
        <dl className="msh-dl">
          <div>
            <dt>Individual</dt>
            <dd>{person.name}</dd>
          </div>
          <div>
            <dt>Home</dt>
            <dd>{siteName}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              {program.name} · {planPeriodText(program)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="msh-form-section">
        <h4>Collection details</h4>
        <label className="msh-field">
          <span>Date (Central)</span>
          <input
            type="date"
            value={noteDate}
            onChange={(event) => setNoteDate(event.target.value)}
          />
        </label>
        <label className="msh-field">
          <span>Shift</span>
          <select
            value={shift}
            onChange={(event) => {
              const next = event.target.value;
              setShift(next);
              if (!initial) {
                const clocks = clocksFromShiftLabel(next);
                if (clocks) {
                  setBeginTime(clocks.begin);
                  setEndTime(clocks.end);
                }
              }
            }}
          >
            {shiftOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="msh-field-pair">
          <label className="msh-field">
            <span>Start time</span>
            <input
              type="time"
              value={beginTime}
              onChange={(event) => setBeginTime(event.target.value)}
            />
          </label>
          <label className="msh-field">
            <span>End time</span>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
        </div>
        <p className="msh-duration" aria-live="polite">
          {duration !== null
            ? `Duration: ${duration} minutes`
            : "Enter a start and end time to compute the duration."}
        </p>
        <label className="msh-field">
          <span>Location</span>
          <input
            type="text"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label className="msh-field">
          <span>Waiver service</span>
          <select
            value={waiverService}
            onChange={(event) => setWaiverService(event.target.value)}
          >
            {waiverServiceNames().map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="msh-form-section">
        <h4>Task scores</h4>
        {program.tasks.length === 0 && (
          <p className="msh-empty">This plan has no tasks to score.</p>
        )}
        {program.tasks.map((task) => {
          const draft = scores.find((score) => score.taskId === task.id);
          return (
            <div key={task.id} className="msh-task">
              <p className="msh-task-title">{task.title}</p>
              {task.instructions && (
                <p className="msh-task-instructions">{task.instructions}</p>
              )}
              <div className="msh-segmented" role="group" aria-label={`Score for ${task.title}`}>
                {levels.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    className={draft?.levelId === level.id ? "active" : ""}
                    aria-pressed={draft?.levelId === level.id}
                    onClick={() =>
                      setScore(task.id, {
                        levelId: draft?.levelId === level.id ? "" : level.id,
                      })
                    }
                  >
                    {level.caption}
                  </button>
                ))}
              </div>
              <label className="msh-field">
                <span>Comment for this task</span>
                <input
                  type="text"
                  value={draft?.comment ?? ""}
                  onChange={(event) =>
                    setScore(task.id, { comment: event.target.value })
                  }
                />
              </label>
            </div>
          );
        })}
      </section>

      <section className="msh-form-section">
        <h4>Overall comment</h4>
        <label className="msh-field">
          <span>What the person did, and how you supported a goal in the plan</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
          />
        </label>
      </section>

      <section className="msh-form-section">
        <h4>Signature</h4>
        {signatureUrl ? (
          <p className="msh-signature-ok">
            Signature on file — this entry is signed as {session.fullName}.
          </p>
        ) : (
          <>
            <p className="msh-section-note">
              A progress note must be signed. Adopt your electronic signature
              once and it is used for your entries.
            </p>
            <button
              type="button"
              className="msh-button secondary"
              onClick={() => setAdoptOpen(true)}
            >
              Add your signature
            </button>
          </>
        )}
      </section>

      {goalMissing && (
        <p className="msh-alert" role="alert">
          This plan has no goal or outcome recorded yet. A manager needs to
          add it in the plan setup (open the chart, ISP section) before new
          entries can be saved.
        </p>
      )}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="msh-button primary" disabled={!canSave}>
          {busy ? "Saving…" : initial ? "Save changes" : "Save entry"}
        </button>
      </div>

      {adoptOpen && (
        <SignatureAdoption
          onClose={() => setAdoptOpen(false)}
          onAdopted={() => {
            setAdoptOpen(false);
            void refreshSignature();
          }}
        />
      )}
    </form>
  );
}

type IspStep = "people" | "plans" | "entries" | "read" | "form";

export default function MobileIsp({
  api,
  session,
  people,
  siteName,
  initialPersonId,
  onOpenChart,
  onFormActiveChange,
}: {
  api: ComplyraApi;
  session: SessionUser;
  people: WorkspaceIndividual[];
  siteName: string;
  initialPersonId?: string | null;
  onOpenChart: (name: string) => void;
  /** Lets the shell hide its bottom navigation while the entry form is open. */
  onFormActiveChange?: (active: boolean) => void;
}) {
  const todayIso = centralTodayIso();
  const [personId, setPersonId] = useState<string | null>(
    initialPersonId ?? null,
  );
  const [step, setStep] = useState<IspStep>(initialPersonId ? "plans" : "people");
  const [programId, setProgramId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<ShiftNoteView | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    onFormActiveChange?.(step === "form");
  }, [step, onFormActiveChange]);

  const person = people.find((row) => row.id === personId) ?? null;
  const { data, loading, error, reload } = useIspData(
    api,
    personId ?? "",
    Boolean(personId),
  );
  const program =
    data?.programs.find((row) => row.id === programId) ?? null;
  const canEnter = canEnterShiftNotes(session.roleKey);

  const entries = useMemo(() => {
    if (!data || !programId) return [];
    return data.notes
      .filter((note) => note.programId === programId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, programId]);
  const entryGroups = useMemo(
    () => groupNotesByDay(entries, todayIso),
    [entries, todayIso],
  );

  const levelCaption = (levelId: string): string => {
    const levels = program?.scoringMethod?.levels ?? [];
    return levels.find((level) => level.id === levelId)?.caption ?? "Scored";
  };

  if (step === "people" || !person) {
    return (
      <div>
        <p className="msh-section-note">
          Pick the Individual whose plan data you are collecting.
        </p>
        <MobilePeopleList
          people={people}
          onPick={(row) => {
            setPersonId(row.id);
            setProgramId(null);
            setStep("plans");
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
          setProgramId(null);
          setSelectedNote(null);
          setStep("people");
        }}
      >
        ‹ All Individuals
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />

      {loading && <p className="msh-empty">Loading plans…</p>}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}

      {step === "plans" && data && (
        <div className="msh-list">
          {data.programs.length === 0 && (
            <p className="msh-empty">No ISP plans on file for {person.name}.</p>
          )}
          {orderPlans(data.programs, todayIso).map((row) => {
            const status = planStatus(row, todayIso);
            return (
              <button
                key={row.id}
                type="button"
                className="msh-row"
                onClick={() => {
                  setProgramId(row.id);
                  setStep("entries");
                }}
              >
                <span className="msh-row-main">
                  <strong>{row.name}</strong>
                  <small>{planPeriodText(row)}</small>
                  <small className="msh-status-text">
                    {status.text} · {row.tasks.length} task
                    {row.tasks.length === 1 ? "" : "s"}
                    {row.scoringMethod ? ` · ${row.scoringMethod.name}` : ""}
                  </small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}

      {step === "entries" && program && (
        <div>
          <button
            type="button"
            className="msh-text-button"
            onClick={() => setStep("plans")}
          >
            ‹ All plans
          </button>
          <h3 className="msh-pass-title">{program.name}</h3>
          <p className="msh-section-note">
            {planPeriodText(program)} · {planStatus(program, todayIso).text}
          </p>
          {canEnter && planStatus(program, todayIso).selectable && (
            <button
              type="button"
              className="msh-button primary block"
              onClick={() => {
                setEditing(false);
                setSelectedNote(null);
                setStep("form");
              }}
            >
              Create entry
            </button>
          )}
          {entryGroups.length === 0 && (
            <p className="msh-empty">No entries yet for this plan.</p>
          )}
          {entryGroups.map((group) => (
            <div key={group.dateIso} className="msh-day-group">
              <h4 className="msh-day-heading">
                {group.label ? `${group.label} · ` : ""}
                {group.dateText}
              </h4>
              <div className="msh-list">
                {group.notes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="msh-row"
                    onClick={() => {
                      setSelectedNote(note);
                      setStep("read");
                    }}
                  >
                    <span className="msh-row-main">
                      <strong>
                        {note.staffName}
                        {note.staffTitle ? ` · ${note.staffTitle}` : ""}
                      </strong>
                      <small>{noteTimeText(note, formatDoseTime)}</small>
                      <small>
                        {note.scores.length} of {program.tasks.length} tasks
                        scored
                      </small>
                    </span>
                    <span className="msh-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === "read" && selectedNote && program && (
        <div>
          <button
            type="button"
            className="msh-text-button"
            onClick={() => setStep("entries")}
          >
            ‹ All entries
          </button>
          <NoteReadView note={selectedNote} levelCaption={levelCaption} />
          {canEditShiftNoteRow(session.roleKey, session.userId, selectedNote) &&
          canEnter ? (
            <button
              type="button"
              className="msh-button primary block"
              onClick={() => {
                setEditing(true);
                setStep("form");
              }}
            >
              Edit entry
            </button>
          ) : (
            <p className="msh-section-note">
              Read-only — entries can be edited by their author or a manager.
            </p>
          )}
        </div>
      )}

      {step === "form" && program && (
        <EntryForm
          api={api}
          session={session}
          person={person}
          program={program}
          siteName={siteName}
          initial={editing ? (selectedNote ?? undefined) : undefined}
          onCancel={() => setStep(editing ? "read" : "entries")}
          onSaved={() => {
            setEditing(false);
            setSelectedNote(null);
            void reload();
            setStep("entries");
          }}
        />
      )}
    </div>
  );
}
