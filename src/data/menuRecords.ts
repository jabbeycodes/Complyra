/**
 * Menu records — what an Individual actually ate, recorded by the staff
 * supporting them. One entry per food record: a service date, a meal slot,
 * the food eaten, how much was eaten (a text label — never color alone),
 * and an optional note.
 *
 * Placement: the record lives on the Individual's chart (Individuals tab →
 * Menu section), next to the person's other daily records. It is a
 * consumption record — what was served and eaten — and is deliberately NOT
 * the health intake tracker (amounts/fluids charted clinically); the two
 * sit side by side and are not merged.
 *
 * Correction rule (mirrors the shift-note family): the author may correct
 * their own entry at any time; house managers / program managers /
 * administrators may correct any entry in their scope. Every correction
 * keeps the previous version, and removal is a void with a reason, never a
 * silent delete.
 *
 * Weeks run Monday–Sunday and "today" is always the America/Chicago date,
 * regardless of the device timezone.
 *
 * Wording: "Individual/Individuals" only — never client/patient.
 */

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const AMOUNT_EATEN_OPTIONS = ["all", "most", "some", "none"] as const;
export type AmountEaten = (typeof AMOUNT_EATEN_OPTIONS)[number];

export const AMOUNT_EATEN_LABELS: Record<AmountEaten, string> = {
  all: "All",
  most: "Most",
  some: "Some",
  none: "None",
};

export interface MenuEntry {
  id: string;
  agencyId: string;
  siteId: string;
  individualId: string;
  /** Service date, YYYY-MM-DD (America/Chicago calendar day). */
  entryDate: string;
  mealSlot: MealSlot;
  foodText: string;
  amountEaten: AmountEaten;
  note: string;
  recordedBy: string;
  recordedByName: string;
  /** Role key of the recorder, stamped when the entry was written. */
  recordedByRole: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the entry has been voided (soft removal, reason kept). */
  deletedAt: string | null;
  voidedBy: string | null;
  voidReason: string;
}

export type MenuEntryView = MenuEntry;

/**
 * One preserved earlier version of a menu entry, written when the entry
 * was corrected or voided (the database keeps these in
 * menu_entry_history; the local store mirrors the same rule). The version
 * shows the values as they stood BEFORE the change that replaced them.
 */
export interface MenuEntryVersion {
  id: string;
  entryId: string;
  entryDate: string;
  mealSlot: MealSlot;
  foodText: string;
  amountEaten: AmountEaten;
  note: string;
  /**
   * When this version stopped being current — the entry's server-stamped
   * save time at the moment it was replaced.
   */
  versionSavedAt: string;
  /** Who made the change that replaced this version (id + display name). */
  replacedBy: string | null;
  replacedByName: string;
  /** When the replacing change was written. */
  replacedAt: string;
}

/** A voided entry as it stays on the record: the entry plus the voider's name. */
export interface MenuVoidedEntry extends MenuEntry {
  voidedByName: string;
}

/**
 * The audit read for one Individual's menu record: every preserved prior
 * version, and every voided entry with its reason and voider. Read-gated
 * exactly like the entries themselves (auditors included, read-only).
 */
export interface MenuEntryHistory {
  versions: MenuEntryVersion[];
  voided: MenuVoidedEntry[];
}

export function mealSlotLabel(slot: string): string {
  return MEAL_SLOT_LABELS[slot as MealSlot] ?? slot;
}

export function amountEatenLabel(amount: string): string {
  return AMOUNT_EATEN_LABELS[amount as AmountEaten] ?? amount;
}

/**
 * Who may correct (or void) a menu entry: the author always; house
 * managers, program managers, and administrators may correct entries for
 * Individuals in their access scope (scope itself is enforced by the API
 * layer and by row-level security on the hosted side).
 */
export function canEditMenuEntryRow(
  roleKey: string,
  sessionUserId: string,
  entry: Pick<MenuEntry, "recordedBy">,
): boolean {
  if (entry.recordedBy === sessionUserId) return true;
  return ["house_manager", "program_manager", "administrator"].includes(roleKey);
}

// ---------------------------------------------------------------------------
// Dates — ISO calendar days; week math is timezone-free once a day is known.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function utcMsToIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  return utcMsToIso(isoToUtcMs(iso) + days * DAY_MS);
}

/** Today's date in America/Chicago, whatever the device clock says. */
export function centralTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Monday of the week (Mon–Sun) containing the given ISO date. */
export function weekStartMondayIso(iso: string): string {
  const ms = isoToUtcMs(iso);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return utcMsToIso(ms - sinceMonday * DAY_MS);
}

/** The seven ISO dates of the week starting at weekStartIso. */
export function weekDayIsos(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "September 7 – 13, 2026" (or with both months/years when a week spans them). */
export function menuWeekRangeLabel(weekStartIso: string): string {
  const start = weekStartIso;
  const end = addDaysIso(weekStartIso, 6);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) {
    return `${MONTH_NAMES[sm - 1]} ${sd} – ${ed}, ${sy}`;
  }
  if (sy === ey) {
    return `${MONTH_NAMES[sm - 1]} ${sd} – ${MONTH_NAMES[em - 1]} ${ed}, ${sy}`;
  }
  return `${MONTH_NAMES[sm - 1]} ${sd}, ${sy} – ${MONTH_NAMES[em - 1]} ${ed}, ${ey}`;
}

/** "Mon 7" style heading for one day of the week grid. */
export function menuDayHeading(iso: string, weekStartIso: string): string {
  const index = Math.round((isoToUtcMs(iso) - isoToUtcMs(weekStartIso)) / DAY_MS);
  const [, , d] = iso.split("-").map(Number);
  return `${WEEKDAY_SHORT[((index % 7) + 7) % 7]} ${d}`;
}

// ---------------------------------------------------------------------------
// Week grid
// ---------------------------------------------------------------------------

export interface MenuGridCell {
  slot: MealSlot;
  slotLabel: string;
  entries: MenuEntryView[];
}

export interface MenuGridDay {
  date: string;
  heading: string;
  isToday: boolean;
  cells: MenuGridCell[];
}

/**
 * Build the Mon–Sun × meal-slot grid for one week. Voided entries never
 * appear. Multiple entries in one slot are all listed (a second snack is a
 * real record, not an overwrite).
 */
export function buildMenuWeekGrid(
  entries: MenuEntryView[],
  weekStartIso: string,
  todayIso: string,
): MenuGridDay[] {
  const visible = entries.filter((entry) => !entry.deletedAt);
  return weekDayIsos(weekStartIso).map((date) => ({
    date,
    heading: menuDayHeading(date, weekStartIso),
    isToday: date === todayIso,
    cells: MEAL_SLOTS.map((slot) => ({
      slot,
      slotLabel: MEAL_SLOT_LABELS[slot],
      entries: visible
        .filter((entry) => entry.entryDate === date && entry.mealSlot === slot)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    })),
  }));
}
