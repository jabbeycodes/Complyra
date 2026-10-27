import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RULE_CATALOG,
  describePickupHours,
  overtimeFlagHours,
  cpiPbsDueOn,
  furthestReminderDay,
  latenessStanding,
  operatingRulesFrom,
  reminderBand,
  overtimeLinesFrom,
  resolveRule,
  type RuleValue,
  type RuleValueRow,
} from "./rules";
import { LocalRulesStore, type LocalRulesActor } from "./rulesStore";

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const migration = readFileSync(join(migrationDir, "20260926120000_rule_settings.sql"), "utf8");
const graceMigration = readFileSync(join(migrationDir, "20261025130000_note_grace_five_minutes.sql"), "utf8");

interface SeedRow {
  key: string;
  category: string;
  label: string;
  help: string;
  valueType: string;
  unit: string;
  platformDefault: RuleValue;
  min: number | undefined;
  max: number | undefined;
  allowedValues: string[];
  siteAdjustable: boolean;
  defaultLock: string;
  sortOrder: number;
}

function parseDefault(raw: string, valueType: string): RuleValue {
  const text = raw.replace(/''/g, "'");
  if (valueType === "boolean") return text === "true";
  if (valueType === "number_list") return JSON.parse(text) as number[];
  if (valueType === "enum") return JSON.parse(text) as string;
  return Number(text);
}

/** The SQL seed is the other copy of RULE_CATALOG. This keeps them from drifting. */
function seedRows(): SeedRow[] {
  const insertAt = migration.indexOf("insert into public.rule_definitions");
  const values = migration.slice(insertAt).split("values\n", 2)[1]?.split("\n\n--", 1)[0] ?? "";
  const row =
    /\('([^']+)', '([^']+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (null|-?\d+(?:\.\d+)?), (null|-?\d+(?:\.\d+)?), '\{([^}]*)\}', (true|false), '(operator|agency)', (\d+)\)/g;
  return [...values.matchAll(row)].map((m) => ({
    key: m[1],
    category: m[2],
    label: m[3].replace(/''/g, "'"),
    help: m[4].replace(/''/g, "'"),
    valueType: m[5],
    unit: m[6].replace(/''/g, "'"),
    platformDefault: parseDefault(m[7], m[5]),
    min: m[8] === "null" ? undefined : Number(m[8]),
    max: m[9] === "null" ? undefined : Number(m[9]),
    allowedValues: m[10] ? m[10].split(",") : [],
    siteAdjustable: m[11] === "true",
    defaultLock: m[12],
    sortOrder: Number(m[13]),
  }));
}

function row(partial: Partial<RuleValueRow> & Pick<RuleValueRow, "key" | "value">): RuleValueRow {
  return {
    id: partial.id ?? "rv-1",
    agencyId: partial.agencyId ?? "agency-1",
    siteId: partial.siteId ?? null,
    key: partial.key,
    value: partial.value,
    lock: partial.lock ?? null,
    effectiveFrom: partial.effectiveFrom ?? "2026-09-01T00:00:00.000Z",
    reason: partial.reason ?? "test",
    setByName: partial.setByName ?? "Operator",
    setAsOperator: partial.setAsOperator ?? true,
    createdAt: partial.createdAt ?? partial.effectiveFrom ?? "2026-09-01T00:00:00.000Z",
  };
}

test("the TypeScript catalog matches the SQL seed", () => {
  const seeded = seedRows().map((row) => {
    if (row.key !== "documentation.note_grace_minutes") return row;
    const help = graceMigration.match(/help = '([^']*(?:''[^']*)*)'/)?.[1]?.replace(/''/g, "'");
    const nextDefault = graceMigration.match(new RegExp("platform_default = '(-?\\d+(?:\\.\\d+)?)'::jsonb"));
    assert.ok(help && nextDefault, "the later migration sets the 5-minute note grace");
    return { ...row, help, platformDefault: Number(nextDefault[1]) };
  });
  assert.equal(seeded.length, RULE_CATALOG.length, "every catalog row is in the migration");
  for (const definition of RULE_CATALOG) {
    const sql = seeded.find((s) => s.key === definition.key);
    assert.ok(sql, definition.key);
    assert.equal(sql.category, definition.category);
    assert.equal(sql.label, definition.label);
    assert.equal(sql.help, definition.help);
    assert.equal(sql.valueType, definition.valueType);
    assert.equal(sql.unit, definition.unit);
    assert.deepEqual(sql.platformDefault, definition.platformDefault);
    assert.equal(sql.min, definition.min);
    assert.equal(sql.max, definition.max);
    assert.deepEqual(sql.allowedValues, definition.allowedValues ?? []);
    assert.equal(sql.siteAdjustable, definition.siteAdjustable);
    assert.equal(sql.defaultLock, definition.defaultLock);
    assert.equal(sql.sortOrder, definition.sortOrder);
  }
});

test("a setting resolves site, then agency, then the platform default", () => {
  const rows = [
    row({ key: "overtime.weekly_limit_hours", value: 45, effectiveFrom: "2026-09-01T00:00:00.000Z" }),
    row({
      id: "rv-site",
      key: "overtime.weekly_limit_hours",
      value: 48,
      siteId: "site-1",
      effectiveFrom: "2026-09-10T00:00:00.000Z",
    }),
  ];
  const at = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(resolveRule(rows, "overtime.weekly_limit_hours", { agencyId: "agency-1", at }).value, 45);
  assert.equal(resolveRule(rows, "overtime.weekly_limit_hours", { agencyId: "agency-1", siteId: "site-1", at }).value, 48);
  assert.equal(resolveRule(rows, "overtime.weekly_limit_hours", { agencyId: "other", at }).value, 40);
  assert.equal(
    resolveRule(rows, "overtime.weekly_limit_hours", { agencyId: "agency-1", at: new Date("2026-08-01T00:00:00.000Z") }).value,
    40,
  );
});

test("overtime lines fall back to the platform defaults", () => {
  const lines = overtimeLinesFrom([]);
  assert.deepEqual(lines, { weeklyLimitHours: 40, toleranceHours: 1, approachingHours: 36, weekStartsOn: "sunday" });
  assert.equal(overtimeFlagHours(lines), 41);
  assert.match(describePickupHours(lines), /anything past 41 hours needs/);
  assert.match(describePickupHours({ ...lines, weekStartsOn: "monday", weeklyLimitHours: 45 }), /Monday–Sunday/);
  assert.match(describePickupHours({ ...lines, weekStartsOn: "monday", weeklyLimitHours: 45 }), /past 46 hours/);
});

test("an agency administrator cannot change a locked setting", async () => {
  const actor: LocalRulesActor = {
    userId: "admin",
    fullName: "Ada Admin",
    isOperator: false,
    adminOfAgencyId: "agency-rules-test",
    memberOfAgencyIds: ["agency-rules-test"],
  };
  const store = new LocalRulesStore(actor, () => new Date("2026-09-25T12:00:00.000Z"));
  await assert.rejects(
    store.setRule({ agencyId: "agency-rules-test", key: "overtime.weekly_limit_hours", value: 45, reason: "Contract" }),
    /locked by Complyrer/,
  );
  await store.setRule({ agencyId: "agency-rules-test", key: "overtime.approaching_hours", value: 32, reason: "Earlier heads-up" });
  assert.equal(store.effectiveNow("agency-rules-test").find((r) => r.key === "overtime.approaching_hours")?.value, 32);
});

test("operating rules use catalog defaults until an agency saves a value", () => {
  const defaults = operatingRulesFrom(null);
  assert.equal(defaults.medWindowBeforeMinutes, 60);
  assert.equal(defaults.noteGraceMinutes, 5);
  assert.equal(defaults.blockEarlyRecording, true);
  assert.equal(defaults.delegationsExpire, false);
  const saved = operatingRulesFrom([
    { key: "medication.window_before_minutes", value: 30, lock: "agency", source: "agency" },
    { key: "delegations.expire", value: true, lock: "agency", source: "agency" },
  ]);
  assert.equal(saved.medWindowBeforeMinutes, 30);
  assert.equal(saved.medWindowAfterMinutes, 60);
  assert.equal(saved.delegationsExpire, true);
  assert.deepEqual(saved.certificationReminderDays, [60, 30, 7]);
});

test("reminder bands, lateness, and CPI due dates follow the saved numbers", () => {
  assert.equal(reminderBand(45, [60, 30, 7]), 60);
  assert.equal(reminderBand(70, [60, 30, 7]), null);
  assert.equal(reminderBand(0, [60, 30, 7]), 7);
  assert.equal(furthestReminderDay([60, 30, 7]), 60);
  const standing = latenessStanding(8, {
    pointsPerLateItem: 1,
    warningLevels: [5, 8, 9],
    writeupThreshold: 10,
  });
  assert.equal(standing.points, 8);
  assert.equal(standing.warningAt, 8);
  assert.equal(standing.writeup, false);
  assert.equal(latenessStanding(10, { pointsPerLateItem: 1, warningLevels: [5], writeupThreshold: 10 }).writeup, true);
  assert.equal(cpiPbsDueOn("2026-10-01", 30), "2026-10-31");
});
