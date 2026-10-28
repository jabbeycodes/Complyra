import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type {
  IspProgramView,
  ShiftNoteView,
  SiteShiftNoteView,
} from "../../data/shiftNotes";
import { canEnterShiftNotes } from "../../data/permissions";
import MobilePeopleList from "./MobilePeopleList";
import { NoteReadView } from "./MobileIsp";
import type { WorkspaceIndividual } from "./types";
import { centralTodayIso, formatCentralTime, formatDoseTime } from "./mar";
import { groupNotesByDay, noteTimeText, windowHistory } from "./isp";

/**
 * Home-wide shift-note history — the audit/oversight view inside the ISP
 * Data door (there is no separate Shift Notes destination: a shift note
 * is an ISP data entry). Where the per-person entries list reads one
 * Individual's notes through an API read capped at 30, this list reads
 * the whole home's notes (getSiteShiftNotes), so notes tied to older or
 * not-currently-visible plans, and notes beyond one person's cap, stay
 * reachable. The list is windowed to the most recent entries and says
 * so plainly whenever the window cuts older entries off.
 */
export default function MobileSiteNotes({
  api,
  session,
  siteId,
  siteName,
  people,
  onBack,
  onCreateEntry,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  siteName: string;
  people: WorkspaceIndividual[];
  onBack: () => void;
  onCreateEntry: (personId: string) => void;
}) {
  const todayIso = centralTodayIso();
  const [notes, setNotes] = useState<SiteShiftNoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SiteShiftNoteView | null>(null);
  const [levelsProgram, setLevelsProgram] = useState<IspProgramView | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const canEnter = canEnterShiftNotes(session.roleKey);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setNotes(await api.getSiteShiftNotes(siteId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, siteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const windowed = useMemo(
    () =>
      windowHistory(
        [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),
    [notes],
  );
  const groups = useMemo(
    () => groupNotesByDay(windowed.visible, todayIso),
    [windowed, todayIso],
  );

  const openNote = async (note: SiteShiftNoteView) => {
    setSelected(note);
    setLevelsProgram(null);
    try {
      // Resolve score captions from the note's own plan (one read on tap).
      const data = await api.getIspData(note.individualId);
      setLevelsProgram(
        data.programs.find((program) => program.id === note.programId) ?? null,
      );
    } catch {
      // Captions fall back to a generic label; the note itself still reads.
    }
  };

  if (selected) {
    const levelCaption = (levelId: string) =>
      levelsProgram?.scoringMethod?.levels.find(
        (level) => level.id === levelId,
      )?.caption ?? "Scored";
    return (
      <div>
        <button
          type="button"
          className="msh-text-button"
          onClick={() => setSelected(null)}
        >
          ‹ All entries
        </button>
        <NoteReadView
          note={selected as ShiftNoteView}
          levelCaption={levelCaption}
          individualName={selected.individualName}
        />
      </div>
    );
  }

  if (picking) {
    return (
      <div>
        <button
          type="button"
          className="msh-text-button"
          onClick={() => setPicking(false)}
        >
          ‹ All entries
        </button>
        <p className="msh-section-note">
          A shift note is collected against the Individual's active ISP plan.
          Pick who the note is about:
        </p>
        <MobilePeopleList
          people={people}
          onPick={(person) => onCreateEntry(person.id)}
        />
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ ISP Data
      </button>
      <p className="msh-section-note">
        Shift notes at {siteName}, newest first. Times are Central.
      </p>
      {canEnter && (
        <button
          type="button"
          className="msh-button primary block"
          onClick={() => setPicking(true)}
        >
          Create shift note
        </button>
      )}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="msh-empty">Loading shift notes…</p>}
      {!loading && notes.length === 0 && (
        <p className="msh-empty">No shift notes yet at this home.</p>
      )}
      {!loading && windowed.truncated && (
        <p className="msh-section-note">
          Showing the most recent {windowed.visible.length} of{" "}
          {windowed.total} entries at this home.
        </p>
      )}
      {groups.map((group) => (
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
                onClick={() => void openNote(note)}
              >
                <span className="msh-row-main">
                  <strong>{note.individualName}</strong>
                  <small>
                    {note.staffName}
                    {note.staffTitle ? ` · ${note.staffTitle}` : ""} ·{" "}
                    {formatCentralTime(note.createdAt)} Central
                  </small>
                  <small>{noteTimeText(note, formatDoseTime)}</small>
                  <small className="msh-snippet">{note.summary}</small>
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
  );
}
