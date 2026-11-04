/**
 * Health trackers — structured day-to-day health logs on an Individual's
 * chart, alongside the Health card's appointments and allergies. All kinds
 * share one entry shape with kind-specific detail fields:
 *
 *  - Immunizations: vaccine, dose, date given, next due date.
 *  - Lab results: test, result, and a staff-set abnormal flag.
 *  - Infection tracking: type, where, start/resolution, symptoms, treatment.
 *  - Sleep: hours, quality, interruptions for a night.
 *  - Intake: meals (type, portion eaten, appetite) and fluids (type,
 *    ounces), rolled up into daily totals.
 *  - Elimination: bowel movements (amount, consistency, color, blood/pain
 *    flags — the bowel tracking log), urination, and emesis.
 *  - Vitals: temperature, blood pressure, pulse, respirations, oxygen
 *    saturation, weight, height.
 *  - Seizures: date/time, duration, type/description, triggers, state after.
 *  - Menses: start/end dates, flow, symptoms.
 *  - Skin monitoring: body location, observation, size, follow-up date.
 *  - Blood glucose: reading, time, meal context, symptoms.
 *  - Respiratory: treatment type, date/time, response.
 *
 * Clinically significant entries alert the responsible managers (the home's
 * house manager directly, plus program-manager and nurse broadcasts) — a
 * confirmed infection, a lab result staff flag as abnormal, an overdue
 * immunization, out-of-range vitals or glucose, blood in the stool, skin
 * breakdown or worsening, every seizure, a refused meal, and a day whose
 * recorded fluid intake is very low. Pure domain module: types,
 * validation, gates, alert targets, range math, row mappers.
 */

import { centralTodayIso } from "./menuRecords";
import type { SessionUser } from "./types";

export const HEALTH_TRACK_KINDS = [
  "immunization",
  "lab",
  "infection",
  "sleep",
  "intake",
  "elimination",
  "vitals",
  "seizure",
  "menses",
  "skin",
  "glucose",
  "respiratory",
] as const;
export type HealthTrackKind = (typeof HEALTH_TRACK_KINDS)[number];

export const HEALTH_TRACK_KIND_LABELS: Record<HealthTrackKind, string> = {
  immunization: "Immunizations",
  lab: "Lab results",
  infection: "Infection tracking",
  sleep: "Sleep",
  intake: "Intake — meals & fluids",
  elimination: "Elimination",
  vitals: "Vitals",
  seizure: "Seizures",
  menses: "Menses",
  skin: "Skin monitoring",
  glucose: "Blood glucose",
  respiratory: "Respiratory",
};

export const SLEEP_QUALITIES = ["Good", "Fair", "Poor"] as const;
export type SleepQuality = (typeof SLEEP_QUALITIES)[number];

export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_PORTIONS = ["All", "Most", "Half", "Some", "Refused"] as const;
export type MealPortion = (typeof MEAL_PORTIONS)[number];

export const ELIMINATION_TYPES = ["bowel", "urination", "emesis"] as const;
export type EliminationType = (typeof ELIMINATION_TYPES)[number];

export const BM_CONSISTENCIES = [
  "Formed",
  "Soft",
  "Loose",
  "Watery",
  "Hard",
] as const;
export type BmConsistency = (typeof BM_CONSISTENCIES)[number];

export const ELIMINATION_AMOUNTS = ["Small", "Medium", "Large"] as const;
export type EliminationAmount = (typeof ELIMINATION_AMOUNTS)[number];

export const CONTINENCE_STATES = ["Continent", "Incontinent"] as const;
export type ContinenceState = (typeof CONTINENCE_STATES)[number];

export const MENSES_FLOWS = ["Light", "Moderate", "Heavy"] as const;
export type MensesFlow = (typeof MENSES_FLOWS)[number];

export const SKIN_BODY_LOCATIONS = [
  "Head / face",
  "Neck",
  "Chest",
  "Back",
  "Left arm",
  "Right arm",
  "Left hand",
  "Right hand",
  "Abdomen",
  "Buttocks / sacrum",
  "Left leg",
  "Right leg",
  "Left foot",
  "Right foot",
  "Other",
] as const;
export type SkinBodyLocation = (typeof SKIN_BODY_LOCATIONS)[number];

export const SKIN_OBSERVATIONS = [
  "Redness",
  "Rash",
  "Bruising",
  "Swelling",
  "Open area / breakdown",
  "Dryness",
] as const;
export type SkinObservation = (typeof SKIN_OBSERVATIONS)[number];

export const SKIN_CHANGES = ["New", "Unchanged", "Improving", "Worse"] as const;
export type SkinChange = (typeof SKIN_CHANGES)[number];

export const GLUCOSE_CONTEXTS = [
  "Before meal",
  "After meal",
  "Bedtime",
  "Random",
] as const;
export type GlucoseContext = (typeof GLUCOSE_CONTEXTS)[number];

/** A finished day below this many recorded fluid ounces alerts managers. */
export const LOW_FLUID_DAILY_OZ = 32;
/** Glucose alert thresholds (mg/dL). */
export const GLUCOSE_LOW_MG_DL = 70;
export const GLUCOSE_HIGH_MG_DL = 250;

export interface HealthTrackEntry {
  id: string;
  agencyId: string;
  individualId: string;
  kind: HealthTrackKind;
  /** Primary date of the record (given on / collected on / started / night of). */
  occurredOn: string;
  /** One-line title derived from the kind's detail fields. */
  title: string;
  /** Kind-specific fields (see the per-kind detail interfaces below). */
  details: Record<string, string>;
  /** Staff-flagged as clinically significant (drives the manager alert). */
  flaggedAbnormal: boolean;
  note: string;
  recordedByUserId: string;
  createdAt: string;
}

export interface ImmunizationDetails {
  vaccineName: string;
  doseLabel: string;
  nextDueOn: string;
}

export interface LabDetails {
  testName: string;
  resultValue: string;
  unit: string;
  referenceRange: string;
}

export interface InfectionDetails {
  infectionType: string;
  bodySite: string;
  resolvedOn: string;
  symptoms: string;
  treatment: string;
  confirmedPositive: string; // "yes" | "no"
}

export interface SleepDetails {
  hoursSlept: string;
  quality: SleepQuality | "";
  interruptions: string;
}

export interface IntakeDetails {
  entryType: "meal" | "fluid" | "";
  mealType: MealType | "";
  portion: MealPortion | "";
  appetiteNote: string;
  fluidType: string;
  fluidOz: string;
}

export interface EliminationDetails {
  entryType: EliminationType | "";
  timeOfDay: string;
  amount: EliminationAmount | "";
  consistency: BmConsistency | "";
  color: string;
  bloodPresent: string; // "yes" | "no"
  painNoted: string; // "yes" | "no"
  continence: ContinenceState | "";
}

export interface VitalsDetails {
  temperatureF: string;
  systolic: string;
  diastolic: string;
  pulse: string;
  respirations: string;
  oxygenSaturation: string;
  weightLb: string;
  heightIn: string;
}

export interface SeizureDetails {
  timeOfDay: string;
  seizureType: string;
  durationMinutes: string;
  triggers: string;
  postEventState: string;
}

export interface MensesDetails {
  endOn: string;
  flow: MensesFlow | "";
  symptoms: string;
}

export interface SkinDetails {
  bodyLocation: SkinBodyLocation | "";
  observation: SkinObservation | "";
  changeSinceLast: SkinChange | "";
  sizeDescription: string;
  description: string;
  followUpOn: string;
}

export interface GlucoseDetails {
  timeOfDay: string;
  readingMgDl: string;
  context: GlucoseContext | "";
  symptoms: string;
}

export interface RespiratoryDetails {
  timeOfDay: string;
  treatmentType: string;
  response: string;
}

export interface HealthTrackEntryDraft {
  kind: HealthTrackKind;
  occurredOn: string;
  details: Record<string, string>;
  flaggedAbnormal?: boolean;
  note?: string;
}

/**
 * A preserved earlier version of a health tracker entry. Every change
 * keeps the version it replaced; a correction (the cross-home path, or
 * any change made through the correction form) also carries the
 * rationale, which stays on the record permanently.
 */
export interface HealthTrackEntryHistory {
  id: string;
  entryId: string;
  agencyId: string;
  individualId: string;
  kind: HealthTrackKind;
  occurredOn: string;
  title: string;
  details: Record<string, string>;
  flaggedAbnormal: boolean;
  note: string;
  recordedByUserId: string;
  entryCreatedAt: string;
  replacedByUserId: string | null;
  replacedAt: string;
  isCorrection: boolean;
  correctionRationale: string | null;
}

// ───────────────────────────── Permission gates ─────────────────────────────

/** DSP/HM/PM/nurse record health entries. */
export function canRecordHealthEntry(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "dsp" ||
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** Oversight roles may correct another recorder's entry (with a rationale). */
export function canCorrectHealthTrackEntry(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** Read access rides the chart gates; auditors see everything, read-only. */
export function canViewHealthTrack(session: SessionUser | null): boolean {
  if (!session) return false;
  if (session.permissions["individuals.view"] !== true) return false;
  return session.roleKey !== "hr";
}

// ───────────────────────────── Titles & validation ─────────────────────────────

/** Parse a detail field as a number; null when blank or not numeric. */
export function detailNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** An intake entry is a fluid unless it says so; default is a meal. */
export function intakeEntryType(
  details: Record<string, string>,
): "meal" | "fluid" {
  return details.entryType === "fluid" ? "fluid" : "meal";
}

/** An elimination entry defaults to a bowel movement. */
export function eliminationEntryType(
  details: Record<string, string>,
): EliminationType {
  return (ELIMINATION_TYPES as readonly string[]).includes(details.entryType)
    ? (details.entryType as EliminationType)
    : "bowel";
}

export function healthTrackTitle(
  kind: HealthTrackKind,
  details: Record<string, string>,
): string {
  switch (kind) {
    case "immunization": {
      const dose = details.doseLabel?.trim();
      return dose
        ? `${details.vaccineName ?? "Immunization"} — ${dose}`
        : details.vaccineName || "Immunization";
    }
    case "lab": {
      const result = [details.resultValue, details.unit]
        .filter((part) => part?.trim())
        .join(" ");
      return result
        ? `${details.testName ?? "Lab result"}: ${result}`
        : details.testName || "Lab result";
    }
    case "infection": {
      const site = details.bodySite?.trim();
      return site
        ? `${details.infectionType ?? "Infection"} (${site})`
        : details.infectionType || "Infection";
    }
    case "sleep": {
      const hours = details.hoursSlept?.trim();
      return hours ? `Slept ${hours} hours` : "Sleep record";
    }
    case "intake": {
      if (intakeEntryType(details) === "fluid") {
        const oz = details.fluidOz?.trim();
        const name = details.fluidType?.trim() || "Fluid";
        return oz ? `${name} — ${oz} oz` : name;
      }
      const meal = details.mealType?.trim() || "Meal";
      const portion = details.portion?.trim();
      return portion ? `${meal} — ate ${portion.toLowerCase()}` : meal;
    }
    case "elimination": {
      const type = eliminationEntryType(details);
      if (type === "urination") {
        const state = details.continence?.trim();
        return state ? `Urination — ${state.toLowerCase()}` : "Urination";
      }
      if (type === "emesis") {
        const amount = details.amount?.trim();
        return amount ? `Emesis — ${amount.toLowerCase()}` : "Emesis";
      }
      const parts = [details.amount, details.consistency]
        .filter((part) => part?.trim())
        .map((part) => part!.toLowerCase());
      return parts.length
        ? `Bowel movement — ${parts.join(", ")}`
        : "Bowel movement";
    }
    case "vitals": {
      const parts: string[] = [];
      if (details.temperatureF?.trim()) {
        parts.push(`Temp ${details.temperatureF.trim()}°F`);
      }
      if (details.systolic?.trim() || details.diastolic?.trim()) {
        parts.push(
          `BP ${details.systolic?.trim() || "—"}/${details.diastolic?.trim() || "—"}`,
        );
      }
      if (details.pulse?.trim()) parts.push(`Pulse ${details.pulse.trim()}`);
      if (details.oxygenSaturation?.trim()) {
        parts.push(`O2 ${details.oxygenSaturation.trim()}%`);
      }
      return parts.length ? parts.join(" · ") : "Vitals check";
    }
    case "seizure": {
      const type = details.seizureType?.trim() || "Seizure";
      const minutes = details.durationMinutes?.trim();
      return minutes ? `${type} — ${minutes} min` : type;
    }
    case "menses": {
      const flow = details.flow?.trim();
      return flow ? `Menses — ${flow.toLowerCase()} flow` : "Menses";
    }
    case "skin": {
      const location = details.bodyLocation?.trim() || "Skin check";
      const observation = details.observation?.trim();
      return observation
        ? `${location} — ${observation.toLowerCase()}`
        : location;
    }
    case "glucose": {
      const reading = details.readingMgDl?.trim();
      const context = details.context?.trim();
      const base = reading ? `Glucose ${reading} mg/dL` : "Blood glucose";
      return context ? `${base} — ${context.toLowerCase()}` : base;
    }
    case "respiratory": {
      return details.treatmentType?.trim() || "Respiratory treatment";
    }
  }
}

export function validateHealthTrackDraft(draft: HealthTrackEntryDraft): string[] {
  const errors: string[] = [];
  if (!HEALTH_TRACK_KINDS.includes(draft.kind)) {
    errors.push("Choose a tracker.");
  }
  if (!draft.occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) {
    errors.push("The record date must be a calendar date (YYYY-MM-DD).");
  }
  const d = draft.details ?? {};
  if (draft.kind === "immunization") {
    if (!d.vaccineName?.trim()) errors.push("Name the vaccine.");
    if (
      d.nextDueOn &&
      !/^\d{4}-\d{2}-\d{2}$/.test(d.nextDueOn)
    ) {
      errors.push("The next due date must be a calendar date (YYYY-MM-DD).");
    }
  }
  if (draft.kind === "lab") {
    if (!d.testName?.trim()) errors.push("Name the lab test.");
    if (!d.resultValue?.trim()) errors.push("Enter the result.");
  }
  if (draft.kind === "infection") {
    if (!d.infectionType?.trim()) errors.push("Name the infection.");
  }
  if (draft.kind === "sleep") {
    const hours = Number(d.hoursSlept);
    if (d.hoursSlept?.trim() && (Number.isNaN(hours) || hours < 0 || hours > 24)) {
      errors.push("Hours slept must be between 0 and 24.");
    }
    if (d.quality && !SLEEP_QUALITIES.includes(d.quality as SleepQuality)) {
      errors.push("Choose a sleep quality (Good, Fair, or Poor).");
    }
  }
  const badNumber = (
    value: string | undefined,
    label: string,
    min: number,
    max: number,
  ) => {
    if (!value?.trim()) return;
    const n = Number(value);
    if (Number.isNaN(n) || n < min || n > max) {
      errors.push(`${label} must be between ${min} and ${max}.`);
    }
  };
  const badTime = (value: string | undefined) => {
    if (value?.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())) {
      errors.push("The time must be a time of day (HH:MM).");
    }
  };
  if (draft.kind === "intake") {
    if (
      d.entryType &&
      d.entryType !== "meal" &&
      d.entryType !== "fluid"
    ) {
      errors.push("Choose whether the entry is a meal or a fluid.");
    }
    if (intakeEntryType(d) === "meal") {
      if (!d.mealType?.trim()) errors.push("Choose the meal.");
      if (
        d.mealType &&
        !(MEAL_TYPES as readonly string[]).includes(d.mealType)
      ) {
        errors.push("Choose a meal (Breakfast, Lunch, Dinner, or Snack).");
      }
      if (!d.portion?.trim()) errors.push("Record how much was eaten.");
      if (
        d.portion &&
        !(MEAL_PORTIONS as readonly string[]).includes(d.portion)
      ) {
        errors.push("Choose a portion (All, Most, Half, Some, or Refused).");
      }
    } else {
      if (!d.fluidType?.trim()) errors.push("Name the fluid.");
      const oz = detailNumber(d.fluidOz);
      if (!d.fluidOz?.trim() || oz === null || oz <= 0 || oz > 128) {
        errors.push("Fluid amount must be between 0 and 128 ounces.");
      }
    }
  }
  if (draft.kind === "elimination") {
    const type = eliminationEntryType(d);
    badTime(d.timeOfDay);
    if (type === "bowel") {
      if (
        d.consistency &&
        !(BM_CONSISTENCIES as readonly string[]).includes(d.consistency)
      ) {
        errors.push(
          "Choose a consistency (Formed, Soft, Loose, Watery, or Hard).",
        );
      }
      if (d.bloodPresent && d.bloodPresent !== "yes" && d.bloodPresent !== "no") {
        errors.push("Record whether blood was present (yes or no).");
      }
      if (d.painNoted && d.painNoted !== "yes" && d.painNoted !== "no") {
        errors.push("Record whether pain was noted (yes or no).");
      }
    }
    if (
      d.amount &&
      !(ELIMINATION_AMOUNTS as readonly string[]).includes(d.amount)
    ) {
      errors.push("Choose an amount (Small, Medium, or Large).");
    }
    if (
      type === "urination" &&
      d.continence &&
      !(CONTINENCE_STATES as readonly string[]).includes(d.continence)
    ) {
      errors.push("Choose whether the person was continent or incontinent.");
    }
  }
  if (draft.kind === "vitals") {
    const any =
      d.temperatureF?.trim() ||
      d.systolic?.trim() ||
      d.diastolic?.trim() ||
      d.pulse?.trim() ||
      d.respirations?.trim() ||
      d.oxygenSaturation?.trim() ||
      d.weightLb?.trim() ||
      d.heightIn?.trim();
    if (!any) errors.push("Enter at least one vital sign.");
    badNumber(d.temperatureF, "Temperature", 80, 115);
    badNumber(d.systolic, "Systolic blood pressure", 40, 300);
    badNumber(d.diastolic, "Diastolic blood pressure", 20, 200);
    badNumber(d.pulse, "Pulse", 20, 250);
    badNumber(d.respirations, "Respirations", 4, 60);
    badNumber(d.oxygenSaturation, "Oxygen saturation", 50, 100);
    badNumber(d.weightLb, "Weight", 30, 1500);
    badNumber(d.heightIn, "Height", 24, 96);
  }
  if (draft.kind === "seizure") {
    if (!d.seizureType?.trim()) {
      errors.push("Describe the seizure type.");
    }
    badTime(d.timeOfDay);
    badNumber(d.durationMinutes, "Duration", 0, 1440);
  }
  if (draft.kind === "menses") {
    if (d.flow && !(MENSES_FLOWS as readonly string[]).includes(d.flow)) {
      errors.push("Choose a flow (Light, Moderate, or Heavy).");
    }
    if (d.endOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.endOn)) {
        errors.push("The end date must be a calendar date (YYYY-MM-DD).");
      } else if (
        /^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn) &&
        d.endOn < draft.occurredOn
      ) {
        errors.push("The end date cannot be before the start date.");
      }
    }
  }
  if (draft.kind === "skin") {
    if (!d.bodyLocation?.trim()) errors.push("Choose where on the body.");
    if (
      d.bodyLocation &&
      !(SKIN_BODY_LOCATIONS as readonly string[]).includes(d.bodyLocation)
    ) {
      errors.push("Choose a body location from the list.");
    }
    if (!d.observation?.trim()) errors.push("Record what was observed.");
    if (
      d.observation &&
      !(SKIN_OBSERVATIONS as readonly string[]).includes(d.observation)
    ) {
      errors.push("Choose an observation from the list.");
    }
    if (
      d.changeSinceLast &&
      !(SKIN_CHANGES as readonly string[]).includes(d.changeSinceLast)
    ) {
      errors.push("Choose how the area changed since the last check.");
    }
    if (
      d.followUpOn &&
      !/^\d{4}-\d{2}-\d{2}$/.test(d.followUpOn)
    ) {
      errors.push("The follow-up date must be a calendar date (YYYY-MM-DD).");
    }
  }
  if (draft.kind === "glucose") {
    badTime(d.timeOfDay);
    const reading = detailNumber(d.readingMgDl);
    if (!d.readingMgDl?.trim() || reading === null) {
      errors.push("Enter the glucose reading.");
    } else if (reading < 20 || reading > 600) {
      errors.push("The glucose reading must be between 20 and 600 mg/dL.");
    }
    if (
      d.context &&
      !(GLUCOSE_CONTEXTS as readonly string[]).includes(d.context)
    ) {
      errors.push(
        "Choose a context (Before meal, After meal, Bedtime, or Random).",
      );
    }
  }
  if (draft.kind === "respiratory") {
    if (!d.treatmentType?.trim()) errors.push("Name the treatment.");
    badTime(d.timeOfDay);
  }
  return errors;
}

/** A correction is a full corrected draft plus the reason it was made. */
export function validateHealthCorrection(
  draft: HealthTrackEntryDraft,
  rationale: string,
): string[] {
  const errors = validateHealthTrackDraft(draft);
  if (!rationale?.trim()) {
    errors.push("State the reason for the correction — it stays on the record.");
  }
  return errors;
}

// ───────────────────────────── Clinical significance & alerts ─────────────────────────────

/** Plain-language concerns in a vitals reading (empty when all in range). */
export function vitalsConcerns(details: Record<string, string>): string[] {
  const concerns: string[] = [];
  const temp = detailNumber(details.temperatureF);
  if (temp !== null) {
    if (temp >= 100.4) concerns.push("Fever");
    else if (temp <= 95) concerns.push("Low temperature");
  }
  const systolic = detailNumber(details.systolic);
  const diastolic = detailNumber(details.diastolic);
  if (
    (systolic !== null && (systolic >= 140 || systolic < 90)) ||
    (diastolic !== null && (diastolic >= 90 || diastolic < 60))
  ) {
    concerns.push("Blood pressure out of range");
  }
  const pulse = detailNumber(details.pulse);
  if (pulse !== null && (pulse > 100 || pulse < 60)) {
    concerns.push("Pulse out of range");
  }
  const respirations = detailNumber(details.respirations);
  if (respirations !== null && (respirations > 20 || respirations < 12)) {
    concerns.push("Breathing rate out of range");
  }
  const oxygen = detailNumber(details.oxygenSaturation);
  if (oxygen !== null && oxygen < 92) {
    concerns.push("Low oxygen saturation");
  }
  return concerns;
}

/** A glucose reading outside the alert thresholds (mg/dL). */
export function glucoseOutOfRange(details: Record<string, string>): boolean {
  const reading = detailNumber(details.readingMgDl);
  return (
    reading !== null &&
    (reading < GLUCOSE_LOW_MG_DL || reading > GLUCOSE_HIGH_MG_DL)
  );
}

/** A meal entry where the person ate nothing. */
export function isRefusedMeal(details: Record<string, string>): boolean {
  return intakeEntryType(details) === "meal" && details.portion === "Refused";
}

/**
 * Whether recording this entry should alert the responsible managers right
 * away: a staff abnormal flag on any kind, a confirmed infection, every
 * seizure, a refused meal, blood in the stool, out-of-range vitals or
 * glucose, and skin breakdown or a skin area getting worse.
 * (Time-based alerts — immunization overdue, very-low daily fluid intake —
 * are handled by the sweeps in the API layer.)
 */
export function healthEntryNeedsAlert(entry: {
  kind: HealthTrackKind;
  details: Record<string, string>;
  flaggedAbnormal: boolean;
}): boolean {
  if (entry.flaggedAbnormal) return true;
  const d = entry.details;
  switch (entry.kind) {
    case "infection":
      return d.confirmedPositive === "yes";
    case "seizure":
      return true;
    case "intake":
      return isRefusedMeal(d);
    case "elimination":
      return eliminationEntryType(d) === "bowel" && d.bloodPresent === "yes";
    case "vitals":
      return vitalsConcerns(d).length > 0;
    case "skin":
      return (
        d.observation === "Open area / breakdown" || d.changeSinceLast === "Worse"
      );
    case "glucose":
      return glucoseOutOfRange(d);
    default:
      return false;
  }
}

// ───────────────────────────── Daily intake totals ─────────────────────────────

export interface DailyIntakeTotal {
  date: string;
  fluidOz: number;
  mealCount: number;
  refusedMeals: number;
}

/** Roll one person's intake entries up per calendar day, newest first. */
export function dailyIntakeTotals(
  entries: Array<Pick<HealthTrackEntry, "kind" | "occurredOn" | "details">>,
): DailyIntakeTotal[] {
  const byDate = new Map<string, DailyIntakeTotal>();
  for (const entry of entries) {
    if (entry.kind !== "intake") continue;
    const row = byDate.get(entry.occurredOn) ?? {
      date: entry.occurredOn,
      fluidOz: 0,
      mealCount: 0,
      refusedMeals: 0,
    };
    if (intakeEntryType(entry.details) === "fluid") {
      row.fluidOz += detailNumber(entry.details.fluidOz) ?? 0;
    } else {
      row.mealCount += 1;
      if (isRefusedMeal(entry.details)) row.refusedMeals += 1;
    }
    byDate.set(entry.occurredOn, row);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Finished days (before today) where intake was recorded but the fluid
 * total is very low — the day a manager should hear about. Days with no
 * intake entries at all are skipped: nothing recorded is a documentation
 * question, not a low-intake finding.
 */
export function lowFluidDays(
  entries: Array<Pick<HealthTrackEntry, "kind" | "occurredOn" | "details">>,
  today: string = centralTodayIso(),
): Array<{ date: string; fluidOz: number }> {
  return dailyIntakeTotals(entries)
    .filter((row) => row.date < today && row.fluidOz < LOW_FLUID_DAILY_OZ)
    .map((row) => ({ date: row.date, fluidOz: row.fluidOz }));
}

/** HM direct + PM/nurse broadcasts for a low-fluid day, deduped per day. */
export function lowFluidAlertTargets(input: {
  individualId: string;
  date: string;
  houseManagerUserIds: string[];
}): HealthAlertTarget[] {
  const base = `incident.followup:health:low-fluid:${input.individualId}:${input.date}`;
  const targets: HealthAlertTarget[] = [];
  for (const userId of [...new Set(input.houseManagerUserIds)]) {
    targets.push({
      userId,
      roleKey: null,
      dedupeKey: `${base}:hm:${userId}`,
    });
  }
  targets.push({
    userId: null,
    roleKey: "program_manager",
    dedupeKey: `${base}:role:program_manager`,
  });
  targets.push({
    userId: null,
    roleKey: "nurse",
    dedupeKey: `${base}:role:nurse`,
  });
  return targets;
}

/** An immunization whose next due date has passed, with no newer dose logged. */
export function isImmunizationOverdue(
  entry: Pick<HealthTrackEntry, "kind" | "details" | "occurredOn">,
  siblings: ReadonlyArray<
    Pick<HealthTrackEntry, "kind" | "details" | "occurredOn">
  > = [],
  now: Date = new Date(),
): boolean {
  if (entry.kind !== "immunization") return false;
  const due = entry.details.nextDueOn;
  if (!due) return false;
  if (due >= centralTodayIso(now)) return false;
  // A later dose of the same vaccine supersedes this row's next-due date, so
  // an older entry is no longer overdue once a newer dose has been recorded.
  const vaccine = entry.details.vaccineName?.trim().toLowerCase();
  const hasNewerDose = siblings.some(
    (other) =>
      other !== entry &&
      other.kind === "immunization" &&
      other.details.vaccineName?.trim().toLowerCase() === vaccine &&
      other.occurredOn > entry.occurredOn,
  );
  return !hasNewerDose;
}

export interface HealthAlertTarget {
  userId: string | null;
  roleKey: "program_manager" | "nurse" | null;
  dedupeKey: string;
}

/** HM directly + PM/nurse broadcasts, deduped per entry + target. */
export function healthAlertTargets(input: {
  entryId: string;
  houseManagerUserIds: string[];
}): HealthAlertTarget[] {
  const targets: HealthAlertTarget[] = [];
  for (const userId of [...new Set(input.houseManagerUserIds)]) {
    targets.push({
      userId,
      roleKey: null,
      dedupeKey: `incident.followup:health:${input.entryId}:hm:${userId}`,
    });
  }
  targets.push({
    userId: null,
    roleKey: "program_manager",
    dedupeKey: `incident.followup:health:${input.entryId}:role:program_manager`,
  });
  targets.push({
    userId: null,
    roleKey: "nurse",
    dedupeKey: `incident.followup:health:${input.entryId}:role:nurse`,
  });
  return targets;
}

// ───────────────────────────── DB row mapping ─────────────────────────────

export function buildHealthTrackRow(input: {
  agencyId: string;
  individualId: string;
  recordedByUserId: string;
  draft: HealthTrackEntryDraft;
}): Record<string, unknown> {
  const d = input.draft;
  return {
    agency_id: input.agencyId,
    individual_id: input.individualId,
    kind: d.kind,
    occurred_on: d.occurredOn,
    title: healthTrackTitle(d.kind, d.details ?? {}),
    details: d.details ?? {},
    flagged_abnormal: d.flaggedAbnormal === true,
    note: (d.note ?? "").trim(),
    recorded_by_user_id: input.recordedByUserId,
  };
}

export function healthTrackEntryFromRow(
  row: Record<string, unknown>,
): HealthTrackEntry {
  const kind = row.kind as string;
  const details = (row.details as Record<string, string> | null) ?? {};
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    kind: (HEALTH_TRACK_KINDS as readonly string[]).includes(kind)
      ? (kind as HealthTrackKind)
      : "lab",
    occurredOn: row.occurred_on as string,
    title: (row.title as string | null) ?? healthTrackTitle(
      (kind as HealthTrackKind) ?? "lab",
      details,
    ),
    details,
    flaggedAbnormal: row.flagged_abnormal === true,
    note: (row.note as string | null) ?? "",
    recordedByUserId: row.recorded_by_user_id as string,
    createdAt: row.created_at as string,
  };
}
