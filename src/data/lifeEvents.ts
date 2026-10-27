/**
 * LIFE EVENTS — the per-Individual significant-events timeline.
 *
 * Life events are CONTEXT, not incident paperwork: they record what has
 * happened in a person's life (a move, a hospital stay, a bereavement, a
 * milestone) so anyone opening the chart can see recent life context at a
 * glance. Event reports (GER) remain the incident record; a life event may
 * point at one related event report, but a life event is never a substitute
 * for one.
 *
 * Deliberate design choices (also stated in the PR):
 *  - NO alerts, NO dashboard panel, NO bell entries. Life events are
 *    context, not compliance work, so nothing counts down or escalates.
 *  - Viewable by anyone who can read the Individual — DSPs on their
 *    Individuals and auditors read-only included — because the timeline is
 *    part of the person's record (unlike internal messaging, which is
 *    staff communication and excludes auditors).
 *  - Corrections never erase: entries are editable by the recording roles
 *    (with updated_by/at tracked) and removal is a soft VOID with a
 *    reason. Voided entries leave the timeline but stay in the data.
 *
 * Integrity rules are enforced again at the DB layer in
 * supabase/migrations/20261027190000_life_events.sql.
 */

export const LIFE_EVENT_TITLE_MAX = 200;
export const LIFE_EVENT_NOTE_MAX = 2000;
export const LIFE_EVENT_VOID_REASON_MAX = 500;

/** One entry in the fixed category list (stored key + chart label). */
export interface LifeEventCategoryOption {
  key: string;
  label: string;
}

/**
 * The fixed category list for a life event. Complyrer's own wording; the
 * stored keys are what the DB check constraint allows.
 */
export const LIFE_EVENT_CATEGORIES: LifeEventCategoryOption[] = [
  { key: "admission_move_in", label: "Admission or move-in" },
  { key: "home_transfer", label: "Home transfer" },
  { key: "hospital_er_stay", label: "Hospital or ER stay" },
  { key: "family_change", label: "Family change" },
  { key: "guardianship_legal_change", label: "Guardianship or legal change" },
  { key: "day_program_change", label: "Day program change" },
  { key: "school_change", label: "School change" },
  { key: "bereavement", label: "Bereavement" },
  { key: "milestone", label: "Milestone" },
  { key: "other", label: "Other" },
];

export type LifeEventCategory = (typeof LIFE_EVENT_CATEGORIES)[number]["key"];

const CATEGORY_KEYS = new Set(LIFE_EVENT_CATEGORIES.map((row) => row.key));
const CATEGORY_LABELS = new Map(
  LIFE_EVENT_CATEGORIES.map((row) => [row.key, row.label]),
);

export function isLifeEventCategory(value: string): value is LifeEventCategory {
  return CATEGORY_KEYS.has(value);
}

export function lifeEventCategoryLabel(category: string): string {
  return CATEGORY_LABELS.get(category) ?? "Other";
}

/** Stored life-event row (local store shape; the hosted API maps snake_case to this). */
export interface LifeEventRow {
  id: string;
  agencyId: string;
  siteId: string;
  individualId: string;
  /** Calendar date the event happened (YYYY-MM-DD); may be in the past. */
  eventDate: string;
  category: string;
  title: string;
  note: string;
  /**
   * Optional link to one related event report (GER). Stored as a bare id:
   * the event-report table lands with PR #117, so no cross-branch foreign
   * key exists yet.
   */
  relatedGerId: string | null;
  recordedBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/** A life event as the chart displays it (names and label resolved). */
export interface LifeEventView extends LifeEventRow {
  categoryLabel: string;
  recordedByName: string;
  updatedByName: string | null;
  voidedByName: string | null;
  voided: boolean;
}

/** The writable fields of a life event (create + edit share this shape). */
export interface LifeEventDraft {
  eventDate: string;
  category: string;
  title: string;
  note?: string;
  relatedGerId?: string | null;
}

export function validateLifeEventDate(value: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Choose the date the event happened.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Enter the event date as YYYY-MM-DD.");
  const parsed = new Date(`${text}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("That is not a real calendar date.");
  }
  return text;
}

export function validateLifeEventCategory(value: string): LifeEventCategory {
  const text = (value ?? "").trim();
  if (!isLifeEventCategory(text)) {
    throw new Error("Choose a category for this life event.");
  }
  return text;
}

export function validateLifeEventTitle(value: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Give the life event a short title.");
  if (text.length > LIFE_EVENT_TITLE_MAX) {
    throw new Error(
      `Titles are limited to ${LIFE_EVENT_TITLE_MAX} characters.`,
    );
  }
  return text;
}

export function validateLifeEventNote(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  if (text.length > LIFE_EVENT_NOTE_MAX) {
    throw new Error(`Notes are limited to ${LIFE_EVENT_NOTE_MAX} characters.`);
  }
  return text;
}

export function validateRelatedGerId(
  value: string | undefined | null,
): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

export function validateVoidReason(value: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Say why this entry is being voided.");
  if (text.length > LIFE_EVENT_VOID_REASON_MAX) {
    throw new Error(
      `Void reasons are limited to ${LIFE_EVENT_VOID_REASON_MAX} characters.`,
    );
  }
  return text;
}

/** Validate a full draft the way both APIs do before writing a row. */
export function validateLifeEventDraft(draft: LifeEventDraft): {
  eventDate: string;
  category: LifeEventCategory;
  title: string;
  note: string;
  relatedGerId: string | null;
} {
  return {
    eventDate: validateLifeEventDate(draft.eventDate),
    category: validateLifeEventCategory(draft.category),
    title: validateLifeEventTitle(draft.title),
    note: validateLifeEventNote(draft.note),
    relatedGerId: validateRelatedGerId(draft.relatedGerId),
  };
}

/** Timeline order: newest event first; same-day entries newest-recorded first. */
export function sortLifeEvents<T extends LifeEventRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.eventDate === a.eventDate
      ? b.createdAt.localeCompare(a.createdAt)
      : b.eventDate.localeCompare(a.eventDate),
  );
}

/** Build the display view of one row for one reader. */
export function toLifeEventView(
  row: LifeEventRow,
  nameFor: (userId: string) => string,
): LifeEventView {
  return {
    ...row,
    categoryLabel: lifeEventCategoryLabel(row.category),
    recordedByName: nameFor(row.recordedBy),
    updatedByName: row.updatedBy ? nameFor(row.updatedBy) : null,
    voidedByName: row.voidedBy ? nameFor(row.voidedBy) : null,
    voided: row.voidedAt !== null,
  };
}
