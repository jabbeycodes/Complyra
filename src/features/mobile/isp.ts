/**
 * Mobile ISP data — pure helpers for plan status and day grouping.
 *
 * ComplyRer's ISP model (src/data/shiftNotes.ts): a plan is an ISP program;
 * staff only ever receive approved programs from the API (the approve gate),
 * and an entry can only be created against a program that is approved AND
 * whose effective period covers the entry date. Entries are shift notes with
 * per-task scores — the same records the desktop chart writes.
 */
import type { IspProgramView, ShiftNoteView } from "../../data/shiftNotes";
import { formatIsoDay, isoDayDiff } from "./mar";

export interface PlanStatus {
  /** True when a new entry may be created against this plan today. */
  selectable: boolean;
  /** Status in words — never color alone. */
  text: string;
}

function formatPeriodDate(iso: string): string {
  return formatIsoDay(iso.slice(0, 10));
}

/** Plan period line: "Jan 1 – Dec 31, 2026" style via day formatting. */
export function planPeriodText(program: IspProgramView): string {
  return `${formatPeriodDate(program.effectiveOn)} – ${formatPeriodDate(program.expiresOn)}`;
}

/**
 * Where a plan stands for data collection. The model's gate is approval:
 * a draft program is one that has not been approved yet (staff roles never
 * receive drafts at all; managers see them here so the plan list is honest).
 */
export function planStatus(
  program: IspProgramView,
  todayIso: string,
): PlanStatus {
  if (program.status === "draft") {
    return { selectable: false, text: "Draft — not yet approved" };
  }
  if (program.status === "superseded") {
    return { selectable: false, text: "Superseded by a newer plan" };
  }
  const starts = program.effectiveOn.slice(0, 10);
  const ends = program.expiresOn.slice(0, 10);
  if (todayIso < starts) {
    return { selectable: false, text: `Starts ${formatPeriodDate(starts)}` };
  }
  if (todayIso > ends) {
    return { selectable: false, text: `Ended ${formatPeriodDate(ends)}` };
  }
  return { selectable: true, text: "Active" };
}

/** Plans ordered for the picker: selectable (active) first, then by start. */
export function orderPlans(
  programs: IspProgramView[],
  todayIso: string,
): IspProgramView[] {
  return [...programs].sort((a, b) => {
    const aActive = planStatus(a, todayIso).selectable ? 0 : 1;
    const bActive = planStatus(b, todayIso).selectable ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.effectiveOn.localeCompare(a.effectiveOn);
  });
}

export interface NoteDayGroup<TNote> {
  dateIso: string;
  /** "Today" / "Yesterday" / weekday for the last week / "" beyond that. */
  label: string;
  /** "Fri, Sep 12" */
  dateText: string;
  notes: TNote[];
}

/** Group entries by their note date, newest day first, Central day labels. */
export function groupNotesByDay<TNote extends Pick<ShiftNoteView, "noteDate">>(
  notes: TNote[],
  todayIso: string,
): NoteDayGroup<TNote>[] {
  const byDay = new Map<string, TNote[]>();
  for (const note of notes) {
    const day = note.noteDate.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(note);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateIso, dayNotes]) => {
      const diff = isoDayDiff(dateIso, todayIso);
      let label = "";
      if (diff === 0) label = "Today";
      else if (diff === 1) label = "Yesterday";
      else if (diff > 1 && diff < 7) {
        label = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          timeZone: "America/Chicago",
        }).format(new Date(`${dateIso}T12:00:00Z`));
      }
      return {
        dateIso,
        label,
        dateText: formatIsoDay(dateIso),
        notes: dayNotes,
      };
    });
}

/** "7a–3p · 7:00 AM – 3:00 PM · 480 minutes" style duration text for a note. */
export function noteTimeText(
  note: Pick<ShiftNoteView, "shift" | "beginTime" | "endTime" | "timeSpentMinutes">,
  formatTime: (hhmm: string) => string,
): string {
  const parts = [note.shift];
  if (note.beginTime && note.endTime) {
    parts.push(`${formatTime(note.beginTime)} – ${formatTime(note.endTime)}`);
  }
  if (note.timeSpentMinutes != null) {
    parts.push(`${note.timeSpentMinutes} minutes`);
  }
  return parts.filter(Boolean).join(" · ");
}
