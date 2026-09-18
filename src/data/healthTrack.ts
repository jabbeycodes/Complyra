/**
 * Health Track — per-individual health logging (Complyrer-original).
 *
 * Trackers, grouped for the left-panel "Health Track" shortcuts:
 *   - Meals & fluids (intake): meal portions + fluid ounces
 *   - Elimination: bowel movements, bladder, emesis
 *   - Skin checks: body-location observations with nurse follow-up
 *   - Vitals, Seizures, Menses, Blood sugar
 *
 * This module is pure domain logic: kinds, detail shapes, validation,
 * nurse-alert detection, daily/weekly summaries, and role gates. Storage
 * lives in localApi (MemoryStore) and hostedApi (Supabase); the migration
 * is `supabase/migrations/20260918XXXXXX_health_track.sql`.
 *
 * Wording is Complyrer-original. "Individual" everywhere — never
 * client/patient, never "T-Log".
 */

import { dedupeKeyFor, type NotificationPayload } from "../features/notifications/notify";
import { hasPermission } from "./permissions";

/* ------------------------------------------------------------------ */
/* Kinds and sections                                                  */
/* ------------------------------------------------------------------ */

export const HEALTH_TRACK_KINDS = [
  "meal",
  "fluid",
  "bowel",
  "bladder",
  "emesis",
  "skin",
  "vitals",
  "seizure",
  "menses",
  "blood_sugar",
] as const;

export type HealthTrackKind = (typeof HEALTH_TRACK_KINDS)[number];

export function isHealthTrackKind(value: unknown): value is HealthTrackKind {
  return (HEALTH_TRACK_KINDS as readonly string[]).includes(value as string);
}

export const HEALTH_TRACK_KIND_LABELS: Record<HealthTrackKind, string> = {
  meal: "Meals",
  fluid: "Fluids",
  bowel: "Bowel movements",
  bladder: "Bladder",
  emesis: "Emesis",
  skin: "Skin checks",
  vitals: "Vitals",
  seizure: "Seizures",
  menses: "Menses",
  blood_sugar: "Blood sugar",
};

/** Left-panel shortcut sections → the kinds each one covers. */
export const HEALTH_TRACK_SECTIONS = [
  { key: "meals", label: "Meals & fluids", kinds: ["meal", "fluid"] },
  { key: "elimination", label: "Elimination", kinds: ["bowel", "bladder", "emesis"] },
  { key: "skin", label: "Skin checks", kinds: ["skin"] },
  { key: "vitals", label: "Vitals", kinds: ["vitals"] },
  { key: "seizures", label: "Seizures", kinds: ["seizure"] },
  { key: "menses", label: "Menses", kinds: ["menses"] },
  { key: "blood_sugar", label: "Blood sugar", kinds: ["blood_sugar"] },
] as const;

export type HealthTrackSectionKey = (typeof HEALTH_TRACK_SECTIONS)[number]["key"];

export function sectionForKind(kind: HealthTrackKind): HealthTrackSectionKey {
  const found = HEALTH_TRACK_SECTIONS.find((section) =>
    (section.kinds as readonly string[]).includes(kind),
  );
  return found ? found.key : "meals";
}

/* ------------------------------------------------------------------ */
/* Detail shapes                                                       */
/* ------------------------------------------------------------------ */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export type PortionEaten = "all" | "most" | "half" | "some" | "refused";
export const PORTIONS_EATEN: PortionEaten[] = ["all", "most", "half", "some", "refused"];
export const PORTION_LABELS: Record<PortionEaten, string> = {
  all: "All",
  most: "Most",
  half: "Half",
  some: "Some",
  refused: "Refused",
};

export interface MealDetails {
  mealType: MealType;
  portion: PortionEaten;
  /** What was served / eaten, in the staff member's own words. */
  items: string;
  appetiteNote?: string;
}

export interface FluidDetails {
  fluidType: string;
  ounces: number;
}

export type StoolAmount = "small" | "moderate" | "large";
export const STOOL_AMOUNTS: StoolAmount[] = ["small", "moderate", "large"];

/** Consistency in plain words — no clinical scale names. */
export type BowelConsistency = "formed" | "soft" | "loose" | "watery";
export const BOWEL_CONSISTENCIES: BowelConsistency[] = ["formed", "soft", "loose", "watery"];
export const BOWEL_CONSISTENCY_LABELS: Record<BowelConsistency, string> = {
  formed: "Formed",
  soft: "Soft",
  loose: "Loose",
  watery: "Watery",
};

export interface BowelDetails {
  amount: StoolAmount;
  consistency: BowelConsistency;
  color: string;
  blood: boolean;
  pain: boolean;
  notes?: string;
}

export interface BladderDetails {
  continent: boolean;
  amount: StoolAmount;
  notes?: string;
}

export interface EmesisDetails {
  amount: StoolAmount;
  description?: string;
}

export type SkinObservation =
  | "redness"
  | "rash"
  | "bruising"
  | "swelling"
  | "open_area"
  | "dryness"
  | "other";
export const SKIN_OBSERVATIONS: SkinObservation[] = [
  "redness",
  "rash",
  "bruising",
  "swelling",
  "open_area",
  "dryness",
  "other",
];
export const SKIN_OBSERVATION_LABELS: Record<SkinObservation, string> = {
  redness: "Redness",
  rash: "Rash",
  bruising: "Bruising",
  swelling: "Swelling",
  open_area: "Open area / breakdown",
  dryness: "Dryness",
  other: "Other",
};

/** Plain-language body-location picker for skin checks. */
export const BODY_LOCATIONS = [
  "Head",
  "Face",
  "Neck",
  "Left shoulder",
  "Right shoulder",
  "Left upper arm",
  "Right upper arm",
  "Left forearm",
  "Right forearm",
  "Left hand",
  "Right hand",
  "Chest",
  "Abdomen",
  "Back",
  "Lower back",
  "Buttocks",
  "Left thigh",
  "Right thigh",
  "Left knee",
  "Right knee",
  "Left shin",
  "Right shin",
  "Left foot",
  "Right foot",
  "Other",
] as const;

export interface SkinDetails {
  bodyLocation: string;
  observation: SkinObservation;
  /** Size in plain words, e.g. "about the size of a quarter". */
  size?: string;
  description: string;
  followUpDate?: string;
  /** True when the issue is new or getting worse since the last check. */
  worsening: boolean;
}

export interface VitalsDetails {
  tempF?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  respirations?: number;
  o2Sat?: number;
  weightLb?: number;
}

export interface SeizureDetails {
  durationMinutes?: number;
  description: string;
  triggers?: string;
  postEventState?: string;
}

export type MensesFlow = "light" | "moderate" | "heavy";
export const MENSES_FLOWS: MensesFlow[] = ["light", "moderate", "heavy"];

export interface MensesDetails {
  /** ISO yyyy-mm-dd. */
  startDate: string;
  /** ISO yyyy-mm-dd, when the cycle ends. */
  endDate?: string;
  flow: MensesFlow;
  symptoms?: string;
}

export type BloodSugarContext = "before_meal" | "after_meal" | "bedtime" | "other";
export const BLOOD_SUGAR_CONTEXTS: BloodSugarContext[] = [
  "before_meal",
  "after_meal",
  "bedtime",
  "other",
];
export const BLOOD_SUGAR_CONTEXT_LABELS: Record<BloodSugarContext, string> = {
  before_meal: "Before meal",
  after_meal: "After meal",
  bedtime: "Bedtime",
  other: "Other",
};

export interface BloodSugarDetails {
  readingMgDl: number;
  context: BloodSugarContext;
  symptoms?: string;
}

export interface HealthTrackDetailsMap {
  meal: MealDetails;
  fluid: FluidDetails;
  bowel: BowelDetails;
  bladder: BladderDetails;
  emesis: EmesisDetails;
  skin: SkinDetails;
  vitals: VitalsDetails;
  seizure: SeizureDetails;
  menses: MensesDetails;
  blood_sugar: BloodSugarDetails;
}

export type HealthTrackDetails<K extends HealthTrackKind = HealthTrackKind> =
  HealthTrackDetailsMap[K];

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export interface HealthTrackEntry {
  id: string;
  agencyId: string;
  individualId: string;
  siteId: string;
  kind: HealthTrackKind;
  /** ISO datetime of when the event happened / was observed. */
  occurredAt: string;
  details: HealthTrackDetails;
  recordedByUserId: string;
  recordedByName: string;
  /** True when the entry needs nurse attention (see detectHealthAlert). */
  flagForNurse: boolean;
  flagReason: string | null;
  nurseReviewedAt: string | null;
  nurseReviewedBy: string | null;
  nurseNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddHealthTrackInput<K extends HealthTrackKind = HealthTrackKind> {
  individualId: string;
  kind: K;
  occurredAt: string;
  details: HealthTrackDetails<K>;
}

export interface UpdateHealthTrackInput {
  occurredAt?: string;
  details?: HealthTrackDetails;
}

export interface HealthTrackFilters {
  individualId?: string;
  siteId?: string;
  kinds?: HealthTrackKind[];
  /** ISO yyyy-mm-dd, inclusive. */
  from?: string;
  /** ISO yyyy-mm-dd, inclusive. */
  to?: string;
  flaggedOnly?: boolean;
  /** Flagged and not yet reviewed by a nurse. */
  needsNurseReview?: boolean;
}

/** yyyy-mm-dd portion of an ISO datetime. */
export function dayKeyOf(isoDatetime: string): string {
  return isoDatetime.slice(0, 10);
}
/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate a detail payload for the given kind. Returns human-readable
 * error strings (empty = valid). Never throws on malformed input.
 */
export function validateHealthTrackInput(
  kind: HealthTrackKind,
  details: unknown,
): string[] {
  const errors: string[] = [];
  const d = (details ?? {}) as Record<string, unknown>;
  const requireText = (field: string, label: string) => {
    if (!isNonEmptyString(d[field])) errors.push(`${label} is required.`);
  };
  const requireNumber = (field: string, label: string, min?: number, max?: number) => {
    if (!isFiniteNumber(d[field])) {
      errors.push(`${label} must be a number.`);
      return;
    }
    const value = d[field] as number;
    if (min != null && value < min) errors.push(`${label} looks too low — check the value.`);
    if (max != null && value > max) errors.push(`${label} looks too high — check the value.`);
  };
  const requireOneOf = (field: string, label: string, allowed: readonly string[]) => {
    if (!(allowed as readonly unknown[]).includes(d[field])) {
      errors.push(`Pick a ${label.toLowerCase()}.`);
    }
  };

  switch (kind) {
    case "meal":
      requireOneOf("mealType", "Meal", MEAL_TYPES);
      requireOneOf("portion", "Portion eaten", PORTIONS_EATEN);
      requireText("items", "What was served");
      break;
    case "fluid":
      requireText("fluidType", "Drink type");
      requireNumber("ounces", "Ounces", 0.5, 64);
      break;
    case "bowel":
      requireOneOf("amount", "Amount", STOOL_AMOUNTS);
      requireOneOf("consistency", "Consistency", BOWEL_CONSISTENCIES);
      requireText("color", "Color");
      break;
    case "bladder":
      if (typeof d.continent !== "boolean") errors.push("Say whether the individual was continent.");
      requireOneOf("amount", "Amount", STOOL_AMOUNTS);
      break;
    case "emesis":
      requireOneOf("amount", "Amount", STOOL_AMOUNTS);
      break;
    case "skin":
      requireText("bodyLocation", "Body location");
      requireOneOf("observation", "Observation", SKIN_OBSERVATIONS);
      requireText("description", "Description");
      if (typeof d.worsening !== "boolean") errors.push("Say whether this is new or getting worse.");
      break;
    case "vitals": {
      const anyVital =
        ["tempF", "bpSystolic", "bpDiastolic", "pulse", "respirations", "o2Sat", "weightLb"].some(
          (field) => d[field] != null && d[field] !== "",
        );
      if (!anyVital) errors.push("Record at least one vital sign.");
      if (d.tempF != null && d.tempF !== "") requireNumber("tempF", "Temperature (°F)", 90, 110);
      if (d.bpSystolic != null && d.bpSystolic !== "") requireNumber("bpSystolic", "Systolic BP", 50, 280);
      if (d.bpDiastolic != null && d.bpDiastolic !== "") requireNumber("bpDiastolic", "Diastolic BP", 30, 180);
      if (d.pulse != null && d.pulse !== "") requireNumber("pulse", "Pulse", 25, 220);
      if (d.respirations != null && d.respirations !== "") requireNumber("respirations", "Respirations", 6, 60);
      if (d.o2Sat != null && d.o2Sat !== "") requireNumber("o2Sat", "O2 saturation (%)", 70, 100);
      if (d.weightLb != null && d.weightLb !== "") requireNumber("weightLb", "Weight (lb)", 20, 600);
      break;
    }
    case "seizure":
      requireText("description", "What the seizure looked like");
      if (d.durationMinutes != null && d.durationMinutes !== "") {
        requireNumber("durationMinutes", "Duration (minutes)", 0, 600);
      }
      break;
    case "menses":
      requireText("startDate", "Start date");
      requireOneOf("flow", "Flow", MENSES_FLOWS);
      break;
    case "blood_sugar":
      requireNumber("readingMgDl", "Blood sugar reading", 20, 900);
      requireOneOf("context", "Reading context", BLOOD_SUGAR_CONTEXTS);
      break;
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Nurse-alert detection                                               */
/* ------------------------------------------------------------------ */

export interface HealthAlert {
  flagged: boolean;
  reason: string | null;
}

const FEVER_F = 100.4;
const LOW_TEMP_F = 95;
const HIGH_SYS = 180;
const LOW_SYS = 90;
const HIGH_DIA = 110;
const HIGH_PULSE = 120;
const LOW_PULSE = 50;
const LOW_O2 = 92;
const LOW_SUGAR = 70;
const HIGH_SUGAR = 300;

/**
 * Decide whether an entry needs nurse attention. Thresholds are plain and
 * conservative; the reason string names the finding in plain words.
 */
export function detectHealthAlert(
  kind: HealthTrackKind,
  details: HealthTrackDetails,
): HealthAlert {
  const reasons: string[] = [];
  switch (kind) {
    case "vitals": {
      const v = details as VitalsDetails;
      if (v.tempF != null && v.tempF >= FEVER_F) reasons.push(`Fever (${v.tempF}°F)`);
      else if (v.tempF != null && v.tempF <= LOW_TEMP_F)
        reasons.push(`Low body temperature (${v.tempF}°F)`);
      if (v.bpSystolic != null && (v.bpSystolic >= HIGH_SYS || v.bpSystolic <= LOW_SYS))
        reasons.push(
          `Blood pressure out of range (${v.bpSystolic}/${v.bpDiastolic ?? "?"})`,
        );
      else if (v.bpDiastolic != null && v.bpDiastolic >= HIGH_DIA)
        reasons.push(`Blood pressure out of range (${v.bpSystolic ?? "?"} / ${v.bpDiastolic})`);
      if (v.pulse != null && (v.pulse >= HIGH_PULSE || v.pulse <= LOW_PULSE))
        reasons.push(`Pulse out of range (${v.pulse})`);
      if (v.o2Sat != null && v.o2Sat < LOW_O2) reasons.push(`Low oxygen saturation (${v.o2Sat}%)`);
      break;
    }
    case "bowel":
      if ((details as BowelDetails).blood) reasons.push("Blood seen in stool");
      break;
    case "skin": {
      const s = details as SkinDetails;
      if (s.observation === "open_area") reasons.push("Open skin area / breakdown");
      if (s.worsening) reasons.push("Skin issue is new or getting worse");
      break;
    }
    case "seizure":
      reasons.push("Seizure recorded");
      break;
    case "meal":
      if ((details as MealDetails).portion === "refused") reasons.push("Meal refused");
      break;
    case "blood_sugar": {
      const reading = (details as BloodSugarDetails).readingMgDl;
      if (reading < LOW_SUGAR) reasons.push(`Low blood sugar (${reading} mg/dL)`);
      else if (reading > HIGH_SUGAR) reasons.push(`High blood sugar (${reading} mg/dL)`);
      break;
    }
    default:
      break;
  }
  return reasons.length > 0
    ? { flagged: true, reason: reasons.join("; ") }
    : { flagged: false, reason: null };
}

/**
 * Day-level intake check: when two or more meals are logged for one day and
 * every one was refused, the day's intake is effectively nothing — page the
 * nurse even though each refused meal already flagged on its own. Returns the
 * reason string, or null when the day's intake is not a concern.
 */
export function detectDailyIntakeAlert(
  dayEntries: HealthTrackEntry[],
): string | null {
  const meals = dayEntries.filter((entry) => entry.kind === "meal");
  if (meals.length < 2) return null;
  const allRefused = meals.every(
    (entry) => (entry.details as MealDetails).portion === "refused",
  );
  return allRefused
    ? `Very low intake today — all ${meals.length} meals refused`
    : null;
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export interface HealthDaySummary {
  date: string;
  entriesCount: number;
  mealsLogged: number;
  mealsRefused: number;
  /** Total fluid ounces logged that day. */
  fluidsOz: number;
  bmCount: number;
  flaggedCount: number;
}

export function summarizeHealthDay(
  entries: HealthTrackEntry[],
  dateIso: string,
): HealthDaySummary {
  const day = entries.filter((entry) => dayKeyOf(entry.occurredAt) === dateIso);
  let mealsLogged = 0;
  let mealsRefused = 0;
  let fluidsOz = 0;
  let bmCount = 0;
  let flaggedCount = 0;
  for (const entry of day) {
    if (entry.kind === "meal") {
      mealsLogged += 1;
      if ((entry.details as MealDetails).portion === "refused") mealsRefused += 1;
    } else if (entry.kind === "fluid") {
      fluidsOz += (entry.details as FluidDetails).ounces || 0;
    } else if (entry.kind === "bowel") {
      bmCount += 1;
    }
    if (entry.flagForNurse) flaggedCount += 1;
  }
  return {
    date: dateIso,
    entriesCount: day.length,
    mealsLogged,
    mealsRefused,
    fluidsOz: Math.round(fluidsOz * 10) / 10,
    bmCount,
    flaggedCount,
  };
}

/** Seven daily summaries starting at weekStartIso (yyyy-mm-dd, inclusive). */
export function summarizeHealthWeek(
  entries: HealthTrackEntry[],
  weekStartIso: string,
): HealthDaySummary[] {
  const out: HealthDaySummary[] = [];
  const [y, m, d] = weekStartIso.split("-").map(Number);
  for (let i = 0; i < 7; i += 1) {
    // Build each day key from local date parts (matching the date pickers'
    // local yyyy-mm-dd) instead of `toISOString()`, which shifts the day for
    // users east of UTC.
    const day = new Date(y, m - 1, d + i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(day.getDate()).padStart(2, "0")}`;
    out.push(summarizeHealthDay(entries, key));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Filtering and sorting                                               */
/* ------------------------------------------------------------------ */

export function healthEntryMatches(entry: HealthTrackEntry, filters: HealthTrackFilters): boolean {
  if (filters.individualId && entry.individualId !== filters.individualId) return false;
  if (filters.siteId && entry.siteId !== filters.siteId) return false;
  if (filters.kinds && filters.kinds.length > 0 && !filters.kinds.includes(entry.kind))
    return false;
  const day = dayKeyOf(entry.occurredAt);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  if (filters.flaggedOnly && !entry.flagForNurse) return false;
  if (filters.needsNurseReview && !(entry.flagForNurse && !entry.nurseReviewedAt)) return false;
  return true;
}

export function sortHealthEntriesDesc(entries: HealthTrackEntry[]): HealthTrackEntry[] {
  return [...entries].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt),
  );
}
/* ------------------------------------------------------------------ */
/* Role gates                                                          */
/* ------------------------------------------------------------------ */

/**
 * Who may open Health Track at all. Auditors see QA Review and scores only;
 * HR never sees clinical records — both stay out.
 */
export function canSeeHealthTrack(roleKey: string | undefined): boolean {
  return (
    roleKey === "administrator" ||
    roleKey === "compliance_admin" ||
    roleKey === "program_manager" ||
    roleKey === "house_manager" ||
    roleKey === "dsp" ||
    roleKey === "nurse"
  );
}

type HealthSession = Parameters<typeof hasPermission>[0];

/** DSPs and house managers record entries during care (permission health.record). */
export function canRecordHealthTrack(session: HealthSession): boolean {
  return hasPermission(session, "health.record");
}

/** Nurses (and program managers) review flagged entries (health.review). */
export function canReviewHealthTrack(session: HealthSession): boolean {
  return hasPermission(session, "health.review");
}

/* ------------------------------------------------------------------ */
/* Abnormal-finding alerts: every manager assigned to the individual    */
/* ------------------------------------------------------------------ */

/**
 * Targets for an abnormal health finding: the home's house manager(s)
 * (direct user alerts), plus program-manager and nurse role broadcasts —
 * mirroring the GER submit-alert pattern. One payload per target, deduped
 * on entry id + target. Callers queue every payload after the entry is
 * stored.
 */
export interface HealthAlertTargetInput {
  agencyId: string;
  entryId: string;
  individualName: string;
  siteName: string;
  kind: HealthTrackKind;
  reason: string;
  occurredAt: string;
  /** Active house-manager user ids for the entry's site. */
  hmUserIds: string[];
}

function healthAlertPayloads(
  input: HealthAlertTargetInput,
  title: string,
  body: string,
  dedupeParts: Array<string | number>,
): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];
  const seen = new Set<string>();
  for (const userId of input.hmUserIds) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    payloads.push({
      agencyId: input.agencyId,
      userId,
      roleKey: null,
      type: "incident.followup",
      title,
      body,
      deepLink: `/health/${input.entryId}`,
      entityType: "health_entry",
      entityId: input.entryId,
      dedupeKey: dedupeKeyFor("incident.followup", "health", ...dedupeParts, userId),
    });
  }
  for (const roleKey of ["program_manager", "nurse"] as const) {
    payloads.push({
      agencyId: input.agencyId,
      userId: null,
      roleKey,
      type: "incident.followup",
      title,
      body,
      deepLink: `/health/${input.entryId}`,
      entityType: "health_entry",
      entityId: input.entryId,
      dedupeKey: dedupeKeyFor("incident.followup", "health", ...dedupeParts, roleKey),
    });
  }
  return payloads;
}

/**
 * Abnormal findings alert every manager assigned to the individual: the
 * home's house manager(s) directly, plus program-manager and nurse role
 * broadcasts — via the existing "incident.followup" notification type.
 */
export function healthTrackAlertTargets(
  input: HealthAlertTargetInput,
): NotificationPayload[] {
  const kindLabel = HEALTH_TRACK_KIND_LABELS[input.kind];
  return healthAlertPayloads(
    input,
    `Health alert: ${kindLabel}`,
    `${input.reason} — ${input.individualName} (${input.siteName}) on ` +
      `${input.occurredAt.slice(0, 10)}. Review the entry and follow up.`,
    [input.entryId],
  );
}

/**
 * Day-level very-low-intake alert targets: the same manager set as
 * per-entry alerts, deduped on individual + day instead of entry id so the
 * day's alert pages once no matter how many refused meals are logged.
 */
export function dailyIntakeAlertTargets(
  input: HealthAlertTargetInput & { day: string; individualId: string },
): NotificationPayload[] {
  return healthAlertPayloads(
    input,
    "Health alert: very low intake",
    `${input.reason} — ${input.individualName} (${input.siteName}) on ` +
      `${input.day}. Review the day's intake and follow up.`,
    ["daily-intake", input.individualId, input.day],
  );
}
