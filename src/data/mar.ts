/**
 * Issue #100 — MAR (medication administration record): medication list
 * configuration, monthly administration grid, pill-count countdown wiring,
 * permissions, and validators.
 *
 * ComplyRer's own wording and layout; DMH (Missouri) administration fields
 * recorded per dose: drug, dosage + dosage form, time given, route, and the
 * initials + name of the person who administered. Refused/omitted doses get
 * a reason + nurse notification; PRN doses get reason + effectiveness.
 */
import { todayIso, type Medication } from "./chart";

export type MarAdminStatus = "given" | "refused" | "omitted" | "held";

export interface MarAdministration {
  id: string;
  agencyId: string;
  individualId: string;
  medicationId: string;
  administeredOn: string; // ISO date YYYY-MM-DD
  timeSlot: string; // "HH:MM" 24h
  pillsGiven: number;
  status: MarAdminStatus;
  initials: string;
  administeredByName: string;
  administeredByUserId: string | null;
  reason: string;
  notifyNurse: boolean;
  createdAt: string;
}

export interface MarPrnLog {
  id: string;
  agencyId: string;
  individualId: string;
  medicationId: string;
  givenAt: string; // ISO datetime
  pillsGiven: number;
  reasonGiven: string;
  effectiveness: string;
  initials: string;
  administeredByName: string;
  createdAt: string;
}

export type MarConcernType = "med_error" | "adverse_reaction";

export interface MarConcern {
  id: string;
  agencyId: string;
  individualId: string;
  medicationId: string;
  administrationId: string | null;
  prnLogId: string | null;
  concernType: MarConcernType;
  description: string;
  initials: string;
  flaggedByName: string;
  nurseNotified: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export interface MedicationMarConfig {
  dosageForm: string;
  indication: string;
  instructions: string;
  /** ISO date the order begins (inclusive). */
  beginAt: string | null;
  frequencyLabel: string;
  scheduleRepeat: string;
  /** "HH:MM" 24h time slots for scheduled meds. */
  timeSlots: string[];
  route: string;
  prescriber: string;
  prnCriteria: string;
  status: "active" | "discontinued";
  /** ISO date the order stops (inclusive). */
  discontinuedOn: string | null;
  orderAttachment: { path: string; name: string } | null;
}

export interface MedicationMarView extends Medication {
  mar: MedicationMarConfig;
}

/** DMH medication profile header (9 CSR 10-7.070): allergies, diagnosis, weight, prescribers. */
export interface MedicationProfileHeader {
  allergies: string;
  diagnosis: string;
  weightKg: string;
  prescribers: string[];
}

export function defaultMarConfig(): MedicationMarConfig {
  return {
    dosageForm: "",
    indication: "",
    instructions: "",
    beginAt: null,
    frequencyLabel: "",
    scheduleRepeat: "",
    timeSlots: [],
    route: "",
    prescriber: "",
    prnCriteria: "",
    status: "active",
    discontinuedOn: null,
    orderAttachment: null,
  };
}

/** Merge MAR config defaults over a medication row/view. */
export function medicationMarView(med: Medication): MedicationMarView {
  return { ...med, mar: { ...defaultMarConfig(), ...(med.marConfig ?? {}) } };
}

/* ------------------------------ permissions ------------------------------ */

/** Nurses and staff with medication access configure the MAR. */
export function canConfigureMar(roleKey: string) {
  return ["administrator", "compliance_admin", "program_manager", "nurse"].includes(
    roleKey,
  );
}

/**
 * Staff cleared to pass meds record administrations: HMs update counts and
 * record passes, DSPs record passes. Auditors are in neither set -> read-only.
 */
export function canRecordMarAdministration(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "program_manager",
    "nurse",
    "dsp",
  ].includes(roleKey);
}

/** Resolve a flagged medication concern: nurse / clinical supervisor roles. */
export function canResolveMarConcern(roleKey: string) {
  return ["administrator", "compliance_admin", "program_manager", "nurse"].includes(
    roleKey,
  );
}

/* ------------------------------ validators ------------------------------ */

export interface NewMedicationInput {
  /** Individual the medication belongs to (required on add). */
  individualId: string;
  name: string;
  strength: string;
  kind: Medication["kind"];
  controlled?: boolean;
  pillsPerDay: number;
  remainingPills: number;
  config: Partial<MedicationMarConfig>;
}

const TIME_SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertTimeSlot(slot: string) {
  if (!TIME_SLOT_RE.test(slot)) {
    throw new Error(`Time slot "${slot}" must be HH:MM in 24-hour format.`);
  }
}

/** Narrowed, validated medication input: the MAR config is complete. */
export type ValidatedMedicationInput = Omit<NewMedicationInput, "config"> & {
  config: MedicationMarConfig;
};

export function validateMedicationInput(input: NewMedicationInput): ValidatedMedicationInput {
  const name = input.name.trim();
  const strength = input.strength.trim();
  if (!name) throw new Error("Enter the medication name.");
  if (!strength) throw new Error("Enter the strength (for example, 10 mg).");
  if (input.kind !== "scheduled" && input.kind !== "prn") {
    throw new Error("Choose scheduled or PRN.");
  }
  if (!Number.isFinite(input.pillsPerDay) || input.pillsPerDay < 0) {
    throw new Error("Enter a nonnegative pills-per-day count.");
  }
  if (!Number.isFinite(input.remainingPills) || input.remainingPills < 0) {
    throw new Error("Enter a nonnegative starting pill count.");
  }
  const config = { ...defaultMarConfig(), ...input.config };
  const slots = [...new Set(config.timeSlots.map((slot) => slot.trim()).filter(Boolean))].sort();
  for (const slot of slots) assertTimeSlot(slot);
  if (input.kind === "scheduled") {
    if (slots.length === 0) throw new Error("Scheduled medications need at least one time slot.");
    if (input.pillsPerDay <= 0) throw new Error("Scheduled medications need pills per day above zero.");
  }
  if (config.beginAt && config.beginAt > todayIso()) {
    throw new Error("The begin date cannot be in the future.");
  }
  if (config.status === "discontinued" && !config.discontinuedOn) {
    throw new Error("Set the discontinued date when marking a medication discontinued.");
  }
  if (config.discontinuedOn && config.beginAt && config.discontinuedOn < config.beginAt) {
    throw new Error("The discontinued date cannot be before the begin date.");
  }
  return {
    ...input,
    name,
    strength,
    controlled: input.controlled ?? false,
    config: { ...config, timeSlots: slots },
  };
}

export interface NewMarAdministrationInput {
  medicationId: string;
  administeredOn: string;
  timeSlot: string;
  pillsGiven?: number;
  status?: MarAdminStatus;
  initials: string;
  reason?: string;
  notifyNurse?: boolean;
}

export function validateMarAdministration(
  input: NewMarAdministrationInput,
  beginAt: string | null,
  today = todayIso(),
): ValidatedMarAdministrationInput {
  if (!input.medicationId) throw new Error("Choose a medication.");
  const administeredOn = input.administeredOn.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(administeredOn)) {
    throw new Error("Use a valid administration date.");
  }
  if (administeredOn > today) {
    throw new Error("Administrations cannot be dated in the future.");
  }
  if (beginAt && administeredOn < beginAt.slice(0, 10)) {
    throw new Error("The administration date is before the medication begin date.");
  }
  assertTimeSlot(input.timeSlot);
  const initials = input.initials.trim();
  if (!initials) throw new Error("Initials are required — the person who administered records it.");
  const status = input.status ?? "given";
  if (!["given", "refused", "omitted", "held"].includes(status)) {
    throw new Error("Choose given, refused, omitted, or held.");
  }
  const pillsGiven = input.pillsGiven ?? 1;
  if (!Number.isFinite(pillsGiven) || pillsGiven <= 0) {
    throw new Error("Enter a positive pill count for the dose.");
  }
  const reason = (input.reason ?? "").trim();
  if (status !== "given" && !reason) {
    throw new Error("Write the reason for a refused, omitted, or held dose.");
  }
  const notifyNurse =
    input.notifyNurse ?? (status === "refused" || status === "omitted");
  return {
    ...input,
    administeredOn,
    initials,
    status,
    pillsGiven,
    reason,
    notifyNurse,
  };
}

export interface NewPrnAdministrationInput {
  medicationId: string;
  givenAt: string; // ISO datetime
  pillsGiven: number;
  reasonGiven: string;
  effectiveness: string;
  initials?: string;
}

export function validatePrnAdministration(
  input: NewPrnAdministrationInput,
  today = todayIso(),
): NewPrnAdministrationInput {
  if (!input.medicationId) throw new Error("Choose a PRN medication.");
  const givenAt = new Date(input.givenAt);
  if (Number.isNaN(givenAt.getTime())) throw new Error("Use a valid date and time.");
  if (input.givenAt.slice(0, 10) > today) {
    throw new Error("PRN doses cannot be logged in the future.");
  }
  if (!Number.isFinite(input.pillsGiven) || input.pillsGiven <= 0) {
    throw new Error("Enter a positive pill count for the PRN dose.");
  }
  const reasonGiven = input.reasonGiven.trim();
  if (!reasonGiven) throw new Error("Write the reason the PRN was given (include a pain scale for pain).");
  const effectiveness = input.effectiveness.trim();
  if (!effectiveness) throw new Error("Describe the dose's effectiveness — how effective was the dose?");
  return { ...input, reasonGiven, effectiveness };
}

/** Narrowed, validated MAR administration input: optional fields are resolved. */
export type ValidatedMarAdministrationInput = Omit<
  NewMarAdministrationInput,
  "pillsGiven" | "status" | "reason" | "notifyNurse"
> & {
  pillsGiven: number;
  status: MarAdminStatus;
  reason: string;
  notifyNurse: boolean;
};

export interface NewMarConcernInput {
  medicationId: string;
  administrationId?: string | null;
  prnLogId?: string | null;
  concernType: MarConcernType;
  description: string;
  initials: string;
}

export function validateMarConcern(input: NewMarConcernInput): ValidatedMarConcernInput {
  if (!input.medicationId) throw new Error("Choose a medication.");
  if (input.concernType !== "med_error" && input.concernType !== "adverse_reaction") {
    throw new Error("Choose a medication error or an adverse reaction.");
  }
  const description = input.description.trim();
  if (!description) throw new Error("Describe the concern so the nurse can act on it.");
  const initials = input.initials.trim();
  if (!initials) throw new Error("Initials are required on a concern flag.");
  return {
    ...input,
    administrationId: input.administrationId ?? null,
    prnLogId: input.prnLogId ?? null,
    description,
    initials,
  };
}

/** Narrowed, validated MAR concern input: linked record ids are null-normalized. */
export type ValidatedMarConcernInput = Omit<NewMarConcernInput, "administrationId" | "prnLogId"> & {
  administrationId: string | null;
  prnLogId: string | null;
};

/* --------------------------- monthly grid builder --------------------------- */

export interface MarGridCell {
  day: number; // 1..N
  administration: MarAdministration | null;
  prnLog: MarPrnLog | null;
}

export interface MarGridRow {
  medicationId: string;
  medicationName: string;
  timeSlot: string | null; // null = PRN row
  prn: boolean;
  cells: MarGridCell[];
}

export interface MarMonthGrid {
  monthKey: string; // "YYYY-MM"
  year: number;
  month: number; // 1..12
  daysInMonth: number;
  rows: MarGridRow[];
}

export function monthKeyFor(date = todayIso()): string {
  return date.slice(0, 7);
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Build the monthly administration grid: one row per (scheduled medication x
 * time slot), plus one row per PRN medication showing initials on days given.
 * Meds only appear for days inside [beginAt, discontinuedOn].
 */
export function marGridForMonth(input: {
  meds: MedicationMarView[];
  administrations: MarAdministration[];
  prnLogs: MarPrnLog[];
  monthKey: string;
}): MarMonthGrid {
  const { meds, administrations, prnLogs, monthKey } = input;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error("Use a valid month (YYYY-MM).");
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;

  const inRange = (day: number, beginAt: string | null, discontinuedOn: string | null) => {
    const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
    if (beginAt && iso < beginAt.slice(0, 10)) return false;
    if (discontinuedOn && iso > discontinuedOn.slice(0, 10)) return false;
    return true;
  };

  const rows: MarGridRow[] = [];
  for (const med of meds) {
    const beginAt = med.mar.beginAt?.slice(0, 10) ?? null;
    const discontinuedOn =
      med.mar.status === "discontinued" ? med.mar.discontinuedOn?.slice(0, 10) ?? null : null;
    if (med.kind === "prn") {
      const logs = prnLogs.filter((log) => log.medicationId === med.id);
      const byDay = new Map<number, MarPrnLog>();
      for (const log of logs) {
        const on = log.givenAt.slice(0, 10);
        if (on < monthStart || on > monthEnd) continue;
        const day = Number(on.slice(8, 10));
        if (!inRange(day, beginAt, discontinuedOn)) continue;
        if (!byDay.has(day)) byDay.set(day, log);
      }
      rows.push({
        medicationId: med.id,
        medicationName: med.name,
        timeSlot: null,
        prn: true,
        cells: Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          return {
            day,
            administration: null,
            prnLog: inRange(day, beginAt, discontinuedOn) ? (byDay.get(day) ?? null) : null,
          };
        }),
      });
      continue;
    }
    for (const slot of med.mar.timeSlots) {
      const matching = administrations.filter(
        (row) =>
          row.medicationId === med.id &&
          row.timeSlot === slot &&
          row.administeredOn >= monthStart &&
          row.administeredOn <= monthEnd,
      );
      const byDay = new Map<number, MarAdministration>();
      for (const row of matching) byDay.set(Number(row.administeredOn.slice(8, 10)), row);
      rows.push({
        medicationId: med.id,
        medicationName: med.name,
        timeSlot: slot,
        prn: false,
        cells: Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const inWindow = inRange(day, beginAt, discontinuedOn);
          return {
            day,
            administration: inWindow ? (byDay.get(day) ?? null) : null,
            prnLog: null,
          };
        }),
      });
    }
  }
  return { monthKey, year, month, daysInMonth, rows };
}

/* ------------------------------ signature log ------------------------------ */

/** initials -> full name across administrations and PRN logs, sorted by initials. */
export function collectMarSignatureLog(
  administrations: MarAdministration[],
  prnLogs: MarPrnLog[],
): Array<{ initials: string; name: string }> {
  const names = new Map<string, string>();
  for (const row of administrations) {
    const key = row.initials.trim().toUpperCase();
    if (key && !names.has(key)) names.set(key, row.administeredByName.trim());
  }
  for (const row of prnLogs) {
    const key = row.initials.trim().toUpperCase();
    if (key && !names.has(key)) names.set(key, row.administeredByName.trim());
  }
  return [...names.entries()]
    .map(([initials, name]) => ({ initials, name }))
    .sort((a, b) => a.initials.localeCompare(b.initials));
}

/* ---------------------- countdown credited-back wiring ---------------------- */

/**
 * Convert non-given MAR administrations into credited-back pills for the
 * deterministic inventory projection: the projection assumes every scheduled
 * day consumed pills, so a refused/omitted/held dose credits those pills back.
 */
export function creditedBackForAdministrations(
  administrations: MarAdministration[],
): Array<{ date: string; pills: number }> {
  return administrations
    .filter((row) => row.status !== "given" && row.pillsGiven > 0)
    .map((row) => ({ date: row.administeredOn.slice(0, 10), pills: row.pillsGiven }));
}

/**
 * Accessible time-slot label for grid cells, tooltips, and form headings.
 * PRN rows have no fixed time slot — they render as "PRN", never a broken
 * "12:undefined AM".
 */
export function marTimeSlotLabel(timeSlot: string | null | undefined): string {
  if (!timeSlot) return "PRN";
  const [h, m] = timeSlot.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "PRN";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Normalize a native date-input value for the medication begin date:
 * "" -> null (no begin date), otherwise the YYYY-MM-DD value. Native date
 * inputs only ever yield "" or a valid calendar date, so anything else is
 * treated as unset rather than persisted.
 */
export function normalizeBeginDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function marAdminStatusLabel(status: MarAdminStatus): string {
  return status === "given"
    ? "Given"
    : status === "refused"
      ? "Refused"
      : status === "omitted"
        ? "Omitted"
        : "Held";
}

export function marConcernTypeLabel(type: MarConcernType): string {
  return type === "med_error" ? "Medication error" : "Adverse reaction";
}

/** Derive staff initials from a full name (first + last initial, uppercased). */
export function initialsForName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
