/**
 * Per-agency rule settings (Operator console · Rules).
 *
 * RULE_CATALOG mirrors the rule_definitions seed in
 * supabase/migrations/20260926120000_rule_settings.sql (a unit test keeps
 * them in sync). Values are resolved site -> agency -> platform default, as
 * of a moment in time; changes are never retroactive.
 */

export type RuleValueType = "number" | "boolean" | "enum" | "number_list";
export type RuleLock = "operator" | "agency";
export type RuleValue = number | boolean | string | number[];

export interface RuleDefinition {
  key: string;
  category: RuleCategory;
  label: string;
  help: string;
  valueType: RuleValueType;
  unit: string;
  platformDefault: RuleValue;
  min?: number;
  max?: number;
  allowedValues?: string[];
  siteAdjustable: boolean;
  defaultLock: RuleLock;
  sortOrder: number;
}

export type RuleCategory =
  | "documentation"
  | "medication"
  | "prn"
  | "accountability"
  | "overtime"
  | "recognition"
  | "expirations"
  | "onboarding"
  | "delegations";

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  documentation: "Documentation",
  medication: "Medication",
  prn: "PRN",
  accountability: "Accountability",
  overtime: "Hours & overtime",
  recognition: "Recognition",
  expirations: "Expirations",
  onboarding: "Onboarding",
  delegations: "Delegations",
};

const def = (d: Omit<RuleDefinition, "siteAdjustable"> & { siteAdjustable?: boolean }): RuleDefinition => ({
  siteAdjustable: false,
  ...d,
});

export const RULE_CATALOG: RuleDefinition[] = [
  def({ key: "documentation.note_grace_minutes", category: "documentation", label: "Note grace after shift end", help: "Notes are due before the shift ends; this much grace before a late deduction.", valueType: "number", unit: "minutes", platformDefault: 30, min: 0, max: 240, defaultLock: "operator", sortOrder: 10 }),
  def({ key: "medication.window_before_minutes", category: "medication", label: "MAR window before the dose time", help: "A dose may be given this early.", valueType: "number", unit: "minutes", platformDefault: 60, min: 0, max: 180, defaultLock: "operator", sortOrder: 10 }),
  def({ key: "medication.window_after_minutes", category: "medication", label: "MAR window after the dose time", help: "A dose given within this is on time.", valueType: "number", unit: "minutes", platformDefault: 60, min: 0, max: 180, defaultLock: "operator", sortOrder: 20 }),
  def({ key: "medication.block_early_recording", category: "medication", label: "Block recording before the window", help: "Recording a dose earlier than the window is blocked.", valueType: "boolean", unit: "", platformDefault: true, defaultLock: "operator", sortOrder: 30 }),
  def({ key: "medication.late_recording_after_hours", category: "medication", label: "Late-recording deduction after", help: "Hours after the window closes before recording costs a point.", valueType: "number", unit: "hours", platformDefault: 8, min: 0, max: 48, defaultLock: "operator", sortOrder: 40 }),
  def({ key: "medication.unrecorded_reminder_minutes", category: "medication", label: "Unrecorded-dose reminder interval", help: "Reminders to the staff member and manager repeat this often.", valueType: "number", unit: "minutes", platformDefault: 60, min: 5, max: 480, defaultLock: "agency", sortOrder: 50 }),
  def({ key: "medication.refusals_before_rn", category: "medication", label: "Refusals in a row before RN is notified", help: "", valueType: "number", unit: "refusals", platformDefault: 2, min: 1, max: 10, defaultLock: "agency", sortOrder: 60 }),
  def({ key: "prn.followup_minutes", category: "prn", label: "PRN follow-up due after", help: "Effectiveness follow-up is due this long after a PRN.", valueType: "number", unit: "minutes", platformDefault: 60, min: 5, max: 480, defaultLock: "agency", sortOrder: 10 }),
  def({ key: "prn.reminder_repeat_minutes", category: "prn", label: "PRN follow-up reminder interval", help: "Everyone on shift is reminded this often until it is recorded.", valueType: "number", unit: "minutes", platformDefault: 15, min: 5, max: 120, defaultLock: "agency", sortOrder: 20 }),
  def({ key: "prn.frequency_review_count", category: "prn", label: "PRN uses in 7 days before RN review", help: "", valueType: "number", unit: "uses", platformDefault: 3, min: 1, max: 20, defaultLock: "agency", sortOrder: 30 }),
  def({ key: "accountability.points_per_late_item", category: "accountability", label: "Deduction per late item", help: "Late note, late-recorded med, or late clock-in.", valueType: "number", unit: "points", platformDefault: 1, min: 1, max: 5, defaultLock: "operator", sortOrder: 10 }),
  def({ key: "accountability.writeup_threshold", category: "accountability", label: "Write-up at", help: "A lateness balance of minus this many points flags a write-up.", valueType: "number", unit: "points", platformDefault: 10, min: 3, max: 50, defaultLock: "operator", sortOrder: 20 }),
  def({ key: "accountability.warning_levels", category: "accountability", label: "Warn staff at", help: "Balances (as positive numbers) that trigger a warning banner.", valueType: "number_list", unit: "points", platformDefault: [5, 8, 9], min: 1, max: 50, defaultLock: "agency", sortOrder: 30 }),
  def({ key: "accountability.late_clock_in_minutes", category: "accountability", label: "Late clock-in after", help: "Clocking in more than this late costs a point.", valueType: "number", unit: "minutes", platformDefault: 15, min: 0, max: 120, defaultLock: "operator", sortOrder: 40 }),
  def({ key: "accountability.reset_after_writeup", category: "accountability", label: "Reset balance after a write-up", help: "An issued write-up resets the balance to 0 (history kept).", valueType: "boolean", unit: "", platformDefault: true, defaultLock: "operator", sortOrder: 50 }),
  def({ key: "accountability.dispute_window_days", category: "accountability", label: "Days to dispute a deduction", help: "", valueType: "number", unit: "days", platformDefault: 7, min: 0, max: 60, defaultLock: "agency", sortOrder: 60 }),
  def({ key: "overtime.weekly_limit_hours", category: "overtime", label: "Weekly hours limit", help: "Staff may work up to this many hours in the work week.", valueType: "number", unit: "hours", platformDefault: 40, min: 1, max: 80, defaultLock: "operator", sortOrder: 10 }),
  def({ key: "overtime.tolerance_hours", category: "overtime", label: "Overtime tolerance", help: "Only flag overtime past the limit plus this much (1 hour: 30 minutes over is ignored).", valueType: "number", unit: "hours", platformDefault: 1, min: 0, max: 8, defaultLock: "operator", sortOrder: 20 }),
  def({ key: "overtime.approaching_hours", category: "overtime", label: "Approaching-overtime notice at", help: "Heads-up to the staff member and managers.", valueType: "number", unit: "hours", platformDefault: 36, min: 1, max: 80, defaultLock: "agency", sortOrder: 30 }),
  def({ key: "overtime.week_starts_on", category: "overtime", label: "Work week starts on", help: "", valueType: "enum", unit: "", platformDefault: "sunday", allowedValues: ["sunday", "monday"], defaultLock: "operator", sortOrder: 40 }),
  def({ key: "recognition.monthly_cap_per_manager", category: "recognition", label: "Recognition points a manager can award per month", help: "", valueType: "number", unit: "points", platformDefault: 20, min: 1, max: 500, defaultLock: "agency", sortOrder: 10 }),
  def({ key: "expirations.order_reminder_days", category: "expirations", label: "Medication and physician order reminders", help: "Days before an order's stop or renewal date.", valueType: "number_list", unit: "days", platformDefault: [30, 14, 7], min: 1, max: 365, defaultLock: "agency", sortOrder: 10 }),
  def({ key: "expirations.certification_reminder_days", category: "expirations", label: "Certification expiry reminders", help: "Days before a certification expires (staff + HR).", valueType: "number_list", unit: "days", platformDefault: [60, 30, 7], min: 1, max: 365, defaultLock: "agency", sortOrder: 20 }),
  def({ key: "onboarding.cpi_pbs_due_days", category: "onboarding", label: "Days to finish CPI and PBS after hire", help: "", valueType: "number", unit: "days", platformDefault: 30, min: 1, max: 180, defaultLock: "agency", sortOrder: 10 }),
  def({ key: "delegations.expire", category: "delegations", label: "Delegations expire", help: "Off: a delegation stays active until the RN rescinds it.", valueType: "boolean", unit: "", platformDefault: false, defaultLock: "operator", sortOrder: 10 }),
];

export const RULE_BY_KEY = new Map(RULE_CATALOG.map((d) => [d.key, d]));

/** One row of rule_values history. */
export interface RuleValueRow {
  id: string;
  agencyId: string;
  siteId: string | null;
  key: string;
  value: RuleValue | null;
  lock: RuleLock | null;
  effectiveFrom: string;
  reason: string;
  setByName: string;
  setAsOperator: boolean;
  createdAt: string;
}

export interface EffectiveRule {
  key: string;
  value: RuleValue;
  lock: RuleLock;
  source: "default" | "agency" | "site";
}

/** Resolve one setting from history as of `at` (site -> agency -> default). */
export function resolveRule(
  rows: RuleValueRow[],
  key: string,
  opts: { agencyId: string; siteId?: string | null; at?: Date } ,
): EffectiveRule {
  const definition = RULE_BY_KEY.get(key);
  if (!definition) throw new Error(`Unknown setting: ${key}`);
  const at = (opts.at ?? new Date()).toISOString();
  const inForce = rows
    .filter((r) => r.agencyId === opts.agencyId && r.key === key && r.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt));
  const siteRow = opts.siteId ? inForce.find((r) => r.siteId === opts.siteId && r.value !== null) : undefined;
  const agencyRow = inForce.find((r) => r.siteId === null && r.value !== null);
  const lockRow = rows
    .filter((r) => r.agencyId === opts.agencyId && r.key === key && r.lock)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    key,
    value: (siteRow ?? agencyRow)?.value ?? definition.platformDefault,
    lock: lockRow?.lock ?? definition.defaultLock,
    source: siteRow ? "site" : agencyRow ? "agency" : "default",
  };
}

export function resolveAllRules(rows: RuleValueRow[], agencyId: string, siteId?: string | null, at?: Date): EffectiveRule[] {
  return RULE_CATALOG.map((d) => resolveRule(rows, d.key, { agencyId, siteId, at }));
}

/** Plain-language problem with a proposed value, or null. Mirrors set_rule_value. */
export function validateRuleValue(definition: RuleDefinition, value: unknown): string | null {
  const range = `between ${definition.min ?? "…"} and ${definition.max ?? "…"}`;
  const inRange = (n: number) =>
    (definition.min === undefined || n >= definition.min) && (definition.max === undefined || n <= definition.max);
  switch (definition.valueType) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return `${definition.label} must be a number.`;
      return inRange(value) ? null : `${definition.label} must be ${range}.`;
    case "boolean":
      return typeof value === "boolean" ? null : `${definition.label} must be on or off.`;
    case "enum":
      return typeof value === "string" && (definition.allowedValues ?? []).includes(value)
        ? null
        : `${definition.label} must be one of: ${(definition.allowedValues ?? []).join(", ")}.`;
    case "number_list":
      if (!Array.isArray(value) || value.length === 0) return `${definition.label} must be a list of numbers.`;
      return value.every((n) => typeof n === "number" && Number.isFinite(n) && inRange(n))
        ? null
        : `${definition.label} must be numbers ${range}.`;
  }
}

/** Parse what an operator typed into a typed value (lists: "30, 14, 7"). */
export function parseRuleInput(definition: RuleDefinition, raw: string | boolean): RuleValue | null {
  if (definition.valueType === "boolean") return typeof raw === "boolean" ? raw : raw === "true";
  const text = String(raw).trim();
  if (definition.valueType === "enum") return text;
  if (definition.valueType === "number") {
    if (text === "") return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  const parts = text.split(/[,\s]+/).filter(Boolean).map(Number);
  return parts.length && parts.every(Number.isFinite) ? parts : null;
}

export function formatRuleValue(definition: RuleDefinition, value: RuleValue | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (definition.valueType === "boolean") return value ? "On" : "Off";
  if (definition.valueType === "enum") return String(value).replace(/^\w/, (c) => c.toUpperCase());
  const unit = definition.unit ? ` ${definition.unit}` : "";
  if (Array.isArray(value)) return `${value.join(", ")}${unit}`;
  return `${value}${unit}`;
}

/* ------------------------- typed readers for consumers ------------------------- */

export interface OvertimeLines {
  /** Weekly hours staff may work (default 40). */
  weeklyLimitHours: number;
  /** Only flag overtime past limit + tolerance (default 1 → 41h). */
  toleranceHours: number;
  /** Heads-up from this many hours (default 36). */
  approachingHours: number;
  weekStartsOn: "sunday" | "monday";
}

export const DEFAULT_OVERTIME_LINES: OvertimeLines = {
  weeklyLimitHours: 40,
  toleranceHours: 1,
  approachingHours: 36,
  weekStartsOn: "sunday",
};

/** Overtime settings from effective rules (defaults when missing). */
export function overtimeLinesFrom(effective: EffectiveRule[] | null | undefined): OvertimeLines {
  const get = (key: string) => effective?.find((r) => r.key === key)?.value;
  const num = (key: string, fallback: number) => {
    const v = get(key);
    return typeof v === "number" ? v : fallback;
  };
  const start = get("overtime.week_starts_on");
  return {
    weeklyLimitHours: num("overtime.weekly_limit_hours", DEFAULT_OVERTIME_LINES.weeklyLimitHours),
    toleranceHours: num("overtime.tolerance_hours", DEFAULT_OVERTIME_LINES.toleranceHours),
    approachingHours: num("overtime.approaching_hours", DEFAULT_OVERTIME_LINES.approachingHours),
    weekStartsOn: start === "monday" ? "monday" : "sunday",
  };
}

export function overtimeFlagHours(lines: OvertimeLines): number {
  return lines.weeklyLimitHours + lines.toleranceHours;
}

/** Settings the product actually reads. Missing rows use the catalog default. */
export interface OperatingRules {
  noteGraceMinutes: number;
  medWindowBeforeMinutes: number;
  medWindowAfterMinutes: number;
  blockEarlyRecording: boolean;
  prnFollowupMinutes: number;
  prnReminderRepeatMinutes: number;
  prnFrequencyReviewCount: number;
  refusalsBeforeRn: number;
  lateRecordingAfterHours: number;
  /** How often an unmarked dose past its window is mentioned again. */
  unrecordedReminderMinutes: number;
  pointsPerLateItem: number;
  writeupThreshold: number;
  warningLevels: number[];
  lateClockInMinutes: number;
  /** An issued write-up returns the balance to 0. The events stay. */
  resetAfterWriteup: boolean;
  disputeWindowDays: number;
  recognitionMonthlyCap: number;
  orderReminderDays: number[];
  certificationReminderDays: number[];
  cpiPbsDueDays: number;
  /** When true, a past expiresOn ends a delegation. Default false: the nurse rescinds it. */
  delegationsExpire: boolean;
}

export const DEFAULT_OPERATING_RULES: OperatingRules = {
  noteGraceMinutes: 30,
  medWindowBeforeMinutes: 60,
  medWindowAfterMinutes: 60,
  blockEarlyRecording: true,
  prnFollowupMinutes: 60,
  prnReminderRepeatMinutes: 15,
  prnFrequencyReviewCount: 3,
  refusalsBeforeRn: 2,
  lateRecordingAfterHours: 8,
  unrecordedReminderMinutes: 60,
  pointsPerLateItem: 1,
  writeupThreshold: 10,
  warningLevels: [5, 8, 9],
  lateClockInMinutes: 15,
  resetAfterWriteup: true,
  disputeWindowDays: 7,
  recognitionMonthlyCap: 20,
  orderReminderDays: [30, 14, 7],
  certificationReminderDays: [60, 30, 7],
  cpiPbsDueDays: 30,
  delegationsExpire: false,
};

function ruleNumber(effective: EffectiveRule[] | null | undefined, key: string, fallback: number): number {
  const value = effective?.find((row) => row.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ruleBoolean(effective: EffectiveRule[] | null | undefined, key: string, fallback: boolean): boolean {
  const value = effective?.find((row) => row.key === key)?.value;
  return typeof value === "boolean" ? value : fallback;
}

function ruleNumberList(effective: EffectiveRule[] | null | undefined, key: string, fallback: number[]): number[] {
  const value = effective?.find((row) => row.key === key)?.value;
  if (!Array.isArray(value) || value.length === 0) return fallback;
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) return fallback;
  return value;
}

/** Clinical and documentation settings from effective rules. */
export function operatingRulesFrom(effective: EffectiveRule[] | null | undefined): OperatingRules {
  const defaults = DEFAULT_OPERATING_RULES;
  return {
    noteGraceMinutes: ruleNumber(effective, "documentation.note_grace_minutes", defaults.noteGraceMinutes),
    medWindowBeforeMinutes: ruleNumber(effective, "medication.window_before_minutes", defaults.medWindowBeforeMinutes),
    medWindowAfterMinutes: ruleNumber(effective, "medication.window_after_minutes", defaults.medWindowAfterMinutes),
    blockEarlyRecording: ruleBoolean(effective, "medication.block_early_recording", defaults.blockEarlyRecording),
    prnFollowupMinutes: ruleNumber(effective, "prn.followup_minutes", defaults.prnFollowupMinutes),
    prnReminderRepeatMinutes: ruleNumber(effective, "prn.reminder_repeat_minutes", defaults.prnReminderRepeatMinutes),
    prnFrequencyReviewCount: ruleNumber(effective, "prn.frequency_review_count", defaults.prnFrequencyReviewCount),
    refusalsBeforeRn: ruleNumber(effective, "medication.refusals_before_rn", defaults.refusalsBeforeRn),
    lateRecordingAfterHours: ruleNumber(effective, "medication.late_recording_after_hours", defaults.lateRecordingAfterHours),
    unrecordedReminderMinutes: ruleNumber(effective, "medication.unrecorded_reminder_minutes", defaults.unrecordedReminderMinutes),
    pointsPerLateItem: ruleNumber(effective, "accountability.points_per_late_item", defaults.pointsPerLateItem),
    writeupThreshold: ruleNumber(effective, "accountability.writeup_threshold", defaults.writeupThreshold),
    warningLevels: ruleNumberList(effective, "accountability.warning_levels", defaults.warningLevels),
    lateClockInMinutes: ruleNumber(effective, "accountability.late_clock_in_minutes", defaults.lateClockInMinutes),
    resetAfterWriteup: ruleBoolean(effective, "accountability.reset_after_writeup", defaults.resetAfterWriteup),
    disputeWindowDays: ruleNumber(effective, "accountability.dispute_window_days", defaults.disputeWindowDays),
    recognitionMonthlyCap: ruleNumber(effective, "recognition.monthly_cap_per_manager", defaults.recognitionMonthlyCap),
    orderReminderDays: ruleNumberList(effective, "expirations.order_reminder_days", defaults.orderReminderDays),
    certificationReminderDays: ruleNumberList(effective, "expirations.certification_reminder_days", defaults.certificationReminderDays),
    cpiPbsDueDays: ruleNumber(effective, "onboarding.cpi_pbs_due_days", defaults.cpiPbsDueDays),
    delegationsExpire: ruleBoolean(effective, "delegations.expire", defaults.delegationsExpire),
  };
}

/** Furthest day in a reminder list. Empty lists fall back to 60. */
export function furthestReminderDay(days: number[]): number {
  const usable = days.filter((day) => Number.isFinite(day) && day >= 0);
  return usable.length > 0 ? Math.max(...usable) : 60;
}

/**
 * The reminder threshold the person is inside, or null when the date is
 * still further out than every threshold. 45 days with [60, 30, 7] is the
 * 60-day reminder.
 */
export function reminderBand(daysRemaining: number, thresholds: number[]): number | null {
  if (daysRemaining < 0) return null;
  const sorted = [...thresholds].filter((day) => Number.isFinite(day) && day >= 0).sort((a, b) => a - b);
  if (sorted.length === 0 || daysRemaining > sorted[sorted.length - 1]) return null;
  return sorted.find((day) => day >= daysRemaining) ?? null;
}

/** Points already lost, the warning level that applies, and whether a write-up is due. */
export function latenessStanding(
  lateItems: number,
  rules: Pick<OperatingRules, "pointsPerLateItem" | "warningLevels" | "writeupThreshold">,
): { points: number; warningAt: number | null; writeup: boolean } {
  const points = Math.max(0, lateItems) * rules.pointsPerLateItem;
  const warningAt = [...rules.warningLevels].filter((level) => level <= points).sort((a, b) => b - a)[0] ?? null;
  return { points, warningAt, writeup: points >= rules.writeupThreshold };
}

/** Hire date plus the agency's CPI/PBS window, as a calendar date. */
export function cpiPbsDueOn(hiredOn: string, dueDays: number): string {
  const [year, month, day] = hiredOn.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + dueDays);
  return date.toISOString().slice(0, 10);
}

/** Whole hours stay whole ("41"); fractions keep two digits ("41.5"). */
export function formatHours(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function workWeekRangeLabel(startsOn: OvertimeLines["weekStartsOn"]): string {
  return startsOn === "monday" ? "Monday–Sunday" : "Sunday–Saturday";
}

/**
 * Staff-facing sentence for open shifts and the weekly-hours list.
 * Defaults match the platform catalog so screens stay correct before rules load.
 */
export function describePickupHours(lines: OvertimeLines = DEFAULT_OVERTIME_LINES): string {
  const flag = formatHours(overtimeFlagHours(lines));
  const limit = formatHours(lines.weeklyLimitHours);
  const tolerance =
    lines.toleranceHours <= 0
      ? ""
      : lines.toleranceHours === 1
        ? " (up to an hour over is fine)"
        : ` (up to ${formatHours(lines.toleranceHours)} hours over is fine)`;
  return `The work week runs ${workWeekRangeLabel(lines.weekStartsOn)}. You can work up to ${limit} hours a week${tolerance}; anything past ${flag} hours needs your manager's approval.`;
}
