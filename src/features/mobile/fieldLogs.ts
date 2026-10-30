/**
 * Mobile Quick log — the field logs (health trackers, menu records,
 * mileage, drills, incident/GER reports) and the expenditure trackers
 * (house card, personal spending) as phone flows over the SAME stores
 * and API methods the desktop surfaces use.
 *
 * This module is the pure half: who may record in each domain (computed
 * from the exact helpers and permission keys the desktop surfaces gate
 * on — never a second, drifting rule), the factual one-line status each
 * domain shows on the chooser, and the GER notification-line format the
 * desktop form parses. Statuses state facts in words — counts, dates,
 * what is still to record — never a judgment the desktop logic does not
 * itself make, and never color alone.
 */
import {
  DRILL_LABELS,
  canCompleteMonthly,
  drillComplete,
  type EmergencyDrill,
} from "../../data/monthlyChecks";
import {
  canEnterMenuEntries,
  canRecordHouseCard,
  canRecordPersonalSpending,
  canViewHouseCard,
  canViewPersonalSpending,
} from "../../data/permissions";
import {
  computeBalanceCents,
  formatCents,
  isLowBalance,
  type HouseCardEntryView,
} from "../../data/houseCard";
import {
  computePersonalBalanceCents,
  type PersonalSpendingEntryView,
} from "../../data/personalSpending";
import {
  MEAL_SLOT_LABELS,
  type MealSlot,
  type MenuEntryView,
} from "../../data/menuRecords";
import type {
  GerNotificationMade,
  GerReport,
  GerReportDraft,
} from "../../data/ger";
import type { HealthTrackEntry } from "../../data/healthTrack";
import type { MileageTripView } from "../../data/types";
import { todaysHealthEntryCount } from "./health";

export type FieldLogDomain =
  | "menu"
  | "mileage"
  | "drills"
  | "ger"
  | "health"
  | "housecard"
  | "spending";

export interface FieldLogAccess {
  /** Record menu entries (the chart Menu section's entry gate). */
  menu: boolean;
  /** Log mileage trips (the mileage.manage permission the API asserts). */
  mileage: boolean;
  /** Record emergency drills (the monthly-checks completion gate). */
  drills: boolean;
  /** File incident reports (the ger.create permission the API asserts). */
  gerCreate: boolean;
  /**
   * Read filed incident reports at the home (canViewGerReports restated
   * against the tile context: individuals.view, and never the HR role —
   * HR holds no clinical permissions; auditors ARE readers here).
   */
  gerView: boolean;
  /**
   * Open the Health flow (canViewHealthTrack restated against the tile
   * context: individuals.view, and never the HR role). Health is a view
   * gate, not a record gate — recording inside follows health.record,
   * exactly as the Health home enforces; view-only roles (auditors)
   * see the trackers' statuses with no log actions.
   */
  healthView: boolean;
  /**
   * Open the home's House Card ledger (canViewHouseCard — the desktop
   * page gate itself is the pure role list, restated verbatim by both
   * API layers; no permission key is involved). View-only roles
   * (auditor, compliance_admin) get the row reaching the read-only
   * mobile view; recording follows houseCardRecord.
   */
  houseCardView: boolean;
  /** Record house card entries (canRecordHouseCard, the role list). */
  houseCardRecord: boolean;
  /**
   * Open Personal Spending (canViewPersonalSpending — the same pure
   * role list the chart card and both APIs gate on). The chooser row
   * additionally needs at least one accessible Individual, checked
   * where the people list lives. Per-person recording follows
   * spendingRecord, with assignment scoping enforced by the APIs
   * (canReadIndividual) exactly as the spending view relies on.
   */
  spendingView: boolean;
  /** Record personal spending entries (canRecordPersonalSpending). */
  spendingRecord: boolean;
  /**
   * The Quick log tile's gate: record in at least one domain, or view
   * health, or view either money tracker — a view-only user gets the
   * tile with the read rows their flags allow, nothing more.
   */
  any: boolean;
}

export function fieldLogAccess(
  roleKey: string,
  permissions: Record<string, boolean>,
): FieldLogAccess {
  const menu = canEnterMenuEntries(roleKey);
  const mileage = permissions["mileage.manage"] === true;
  const drills = canCompleteMonthly(roleKey);
  const gerCreate = permissions["ger.create"] === true;
  const gerView =
    permissions["individuals.view"] === true && roleKey !== "hr";
  const healthView =
    permissions["individuals.view"] === true && roleKey !== "hr";
  const houseCardView = canViewHouseCard(roleKey);
  const houseCardRecord = canRecordHouseCard(roleKey);
  const spendingView = canViewPersonalSpending(roleKey);
  const spendingRecord = canRecordPersonalSpending(roleKey);
  return {
    menu,
    mileage,
    drills,
    gerCreate,
    gerView,
    healthView,
    houseCardView,
    houseCardRecord,
    spendingView,
    spendingRecord,
    any:
      menu ||
      mileage ||
      drills ||
      gerCreate ||
      healthView ||
      houseCardView ||
      spendingView,
  };
}

// ───────────────────────────── Date helpers ─────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10" from an ISO date. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** "October 2026" for a "YYYY-MM" month key. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[(month || 1) - 1]} ${year}`;
}

// ───────────────────────────── Menu status ─────────────────────────────

/** The three meals a day is counted by (snacks are recorded on top). */
export const CORE_MEAL_SLOTS: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
];

export interface MenuTodayStatus {
  /** Core meal slots with at least one entry at the home today. */
  recordedCount: number;
  /** Labels of the core slots with no entry yet today. */
  missingLabels: string[];
  text: string;
}

/**
 * The house's menu picture for today, from every Individual's entries:
 * how many of breakfast / lunch / dinner have been recorded (for anyone
 * at the home), in the brief's "2 of 3 meals recorded today" shape.
 */
export function menuTodayStatus(
  entries: readonly MenuEntryView[],
  todayIso: string,
): MenuTodayStatus {
  const todays = entries.filter(
    (entry) => entry.entryDate === todayIso && !entry.deletedAt,
  );
  const recorded = CORE_MEAL_SLOTS.filter((slot) =>
    todays.some((entry) => entry.mealSlot === slot),
  );
  const missingLabels = CORE_MEAL_SLOTS.filter(
    (slot) => !recorded.includes(slot),
  ).map((slot) => MEAL_SLOT_LABELS[slot]);
  let text = `${recorded.length} of 3 meals recorded today`;
  if (missingLabels.length > 0) {
    text += ` · ${missingLabels.join(", ")} not yet recorded`;
  }
  return { recordedCount: recorded.length, missingLabels, text };
}

/** One person's recorded entries for a single date, in slot order. */
export function personDayEntries(
  entries: readonly MenuEntryView[],
  individualId: string,
  dateIso: string,
): MenuEntryView[] {
  const slotOrder = new Map<string, number>([
    ["breakfast", 0],
    ["lunch", 1],
    ["dinner", 2],
    ["snack", 3],
  ]);
  return entries
    .filter(
      (entry) =>
        entry.individualId === individualId &&
        entry.entryDate === dateIso &&
        !entry.deletedAt,
    )
    .sort(
      (a, b) =>
        (slotOrder.get(a.mealSlot) ?? 9) - (slotOrder.get(b.mealSlot) ?? 9) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

// ───────────────────────────── Mileage status ─────────────────────────────

export interface MileageMonthStatus {
  tripCount: number;
  totalMiles: number;
  text: string;
}

export function formatMiles(miles: number): string {
  return Number.isInteger(miles) ? String(miles) : miles.toFixed(1);
}

/** The house's mileage picture for one month, from its trip list. */
export function mileageMonthStatus(
  trips: readonly MileageTripView[],
  monthKey: string,
): MileageMonthStatus {
  const totalMiles = trips.reduce((sum, trip) => sum + trip.miles, 0);
  const label = monthLabel(monthKey);
  const text =
    trips.length === 0
      ? `No trips logged yet in ${label}`
      : `${trips.length} trip${trips.length === 1 ? "" : "s"} · ${formatMiles(totalMiles)} miles logged in ${label}`;
  return { tripCount: trips.length, totalMiles, text };
}

// ───────────────────────────── Drill status ─────────────────────────────

export interface DrillMonthStatus {
  doneCount: number;
  totalCount: number;
  /** Label of the first drill of the month still to record, if any. */
  nextLabel: string | null;
  text: string;
}

/**
 * The house's drill picture for one month, from the scheduled drill
 * rows the monthly-checks cycle maintains: completeness is the desktop
 * rule (drillComplete — date, time, leader, participants all present).
 */
export function drillMonthStatus(
  drills: readonly EmergencyDrill[],
  monthKey: string,
): DrillMonthStatus {
  const rows = drills.filter((drill) => drill.monthKey === monthKey);
  const doneCount = rows.filter(drillComplete).length;
  const next = rows.find((drill) => !drillComplete(drill)) ?? null;
  const nextLabel = next ? DRILL_LABELS[next.drillType] : null;
  let text: string;
  if (rows.length === 0) {
    text = `No drills scheduled for ${monthLabel(monthKey)}`;
  } else if (!next) {
    text = `All ${rows.length} drills recorded for ${monthLabel(monthKey)}`;
  } else {
    text = `${nextLabel} drill still to record this month · ${doneCount} of ${rows.length} done`;
  }
  return { doneCount, totalCount: rows.length, nextLabel, text };
}

/** One drill row's status in words, for the drills list. */
export function drillRowStatus(drill: EmergencyDrill): string {
  if (!drillComplete(drill)) return "Not yet recorded";
  return `Recorded ${drill.date} · led by ${drill.leaderName}`;
}

// ───────────────────────────── GER status ─────────────────────────────

export interface GerMonthStatus {
  monthCount: number;
  text: string;
}

/** Reports filed at the home this month (by event date). */
export function gerMonthStatus(
  reports: readonly GerReport[],
  monthKey: string,
): GerMonthStatus {
  const monthCount = reports.filter((report) =>
    report.eventDate.startsWith(monthKey),
  ).length;
  const text =
    monthCount === 0
      ? "No reports filed this month"
      : `${monthCount} report${monthCount === 1 ? "" : "s"} filed this month`;
  return { monthCount, text };
}

/** Status word for a report row — the workflow state, in text. */
export const GER_STATUS_LABELS: Record<GerReport["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned for corrections",
};

// ───────────────────────────── Health status ─────────────────────────────

export interface HealthTodayStatus {
  /** Entries across the seven mobile trackers dated today, house-wide. */
  count: number;
  text: string;
}

/**
 * The house's health picture for today: how many tracker entries were
 * logged today across every Individual at the home. `entries` is the
 * flattened per-person entry lists the Health home reads; the count is
 * health.ts's own (todaysHealthEntryCount), never a second tally.
 */
export function healthTodayStatus(
  entries: readonly HealthTrackEntry[],
  todayIso: string,
): HealthTodayStatus {
  const count = todaysHealthEntryCount(entries, todayIso);
  const text =
    count === 0
      ? "No health entries logged today"
      : `${count} health ${count === 1 ? "entry" : "entries"} logged today`;
  return { count, text };
}

// ───────────────────────── House card status ─────────────────────────

export interface HouseCardStatus {
  balanceCents: number;
  /** The ledger's own low-balance state (balance under $100). */
  lowBalance: boolean;
  text: string;
}

/**
 * The home's house card picture: the live balance from the derivation
 * the desktop panel and the phone view share (computeBalanceCents —
 * never a second tally), with the low-balance state stated in words,
 * the same isLowBalance rule the pinned header flags.
 */
export function houseCardStatus(
  entries: readonly HouseCardEntryView[],
): HouseCardStatus {
  const balanceCents = computeBalanceCents([...entries]);
  const lowBalance = isLowBalance(balanceCents);
  const text = lowBalance
    ? `Balance ${formatCents(balanceCents)} · Low balance`
    : `Balance ${formatCents(balanceCents)}`;
  return { balanceCents, lowBalance, text };
}

// ────────────────────── Personal spending status ──────────────────────

export interface PersonalSpendingStatus {
  /** Every accessible Individual's balance added together, in cents. */
  totalCents: number;
  personCount: number;
  text: string;
}

/**
 * The home's personal spending picture: each Individual's balance from
 * the ledger derivation the chart card and the phone view share
 * (computePersonalBalanceCents), combined into one factual line.
 * `entryLists` is one entry list per accessible Individual.
 */
export function personalSpendingStatus(
  entryLists: readonly (readonly PersonalSpendingEntryView[])[],
): PersonalSpendingStatus {
  const totalCents = entryLists.reduce(
    (sum, entries) => sum + computePersonalBalanceCents([...entries]),
    0,
  );
  const personCount = entryLists.length;
  const text =
    personCount === 0
      ? "No Individuals at this home"
      : `${formatCents(totalCents)} across ${personCount} Individual${personCount === 1 ? "" : "s"}`;
  return { totalCents, personCount, text };
}

// ─────────────────── GER notifications (desktop line format) ───────────────────

/**
 * The desktop form's notifications format: one notification per line,
 * "who — name — time". Parse and render are exact mirrors of GerTab's,
 * so a report written on a phone reads identically on the desktop.
 */
export function notificationsToText(
  notifications: readonly GerNotificationMade[],
): string {
  return notifications
    .map((n) => `${n.party} — ${n.name} — ${n.atTime}`)
    .join("\n");
}

export function parseNotificationsText(text: string): GerNotificationMade[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [party = "", name = "", atTime = ""] = line
        .split("—")
        .map((part) => part.trim());
      return { party, name, atTime };
    });
}

/** A new report draft with the quick log's now-defaults filled in. */
export function newGerDraft(input: {
  siteId: string;
  individualId: string;
  reporterName: string;
  todayIso: string;
  nowTime: string;
}): GerReportDraft {
  return {
    siteId: input.siteId,
    individualId: input.individualId,
    linkedIndividualIds: [],
    eventDate: input.todayIso,
    eventTime: input.nowTime,
    location: "",
    eventType: "Other",
    severity: "Moderate",
    description: "",
    immediateActions: "",
    notificationsMade: [],
    witnesses: "",
    reporterName: input.reporterName,
    reporterSignature: "",
    reporterDate: input.todayIso,
  };
}
