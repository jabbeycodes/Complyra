/**
 * Static tests for supabase/migrations/20261031290000_compliance_template_narrowing.sql
 * (WAVE-7V, founder decision 2026-11-02): the compliance_admin default
 * template narrows to read-and-audit in every layer —
 *   PART 1: role_permission_matrix refreshed with the canonical maps;
 *   PART 2: role_templates compliance row set to the narrowed map;
 *   PART 3: agency_roles backfill deletes ONLY the removed keys from
 *           existing compliance rows, preserving everything else.
 * No live database here — parse the migration text, like
 * correctiveActionsMigration.test.ts. The pgTAP suite
 * supabase/tests/compliance_template_narrowing.sql pins the applied state.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_KEYS, ROLE_TEMPLATE_BY_KEY } from "./permissions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase", "migrations", "20261031290000_compliance_template_narrowing.sql"),
  "utf8",
);
const norm = sql.replace(/\s+/g, " ").toLowerCase();

/** The founder REMOVE list (2026-11-02) — the only keys the backfill deletes. */
const REMOVE_KEYS = [
  "acknowledgments.manage",
  "behavior.plan",
  "behavior.record",
  "certificates.manage",
  "correctiveActions.manage",
  "delegation.acknowledge",
  "delegation.activate",
  "delegation.assign",
  "delegation.templates.manage",
  "delegation.training.approve",
  "delegation.training.review",
  "documents.upload",
  "ger.create",
  "health.record",
  "lifeEvents.record",
  "members.assign_roles",
  "members.invite",
  "members.reset_password",
  "recognition.manage",
  "recognition.rate_hm",
  "recognition.review_dsp",
  "requirements.approve",
  "roles.manage",
  "sites.create",
];

test("the matrix refresh upserts the canonical map for all eight roles", () => {
  assert.ok(norm.includes("insert into public.role_permission_matrix(role_key,permissions) values"));
  assert.ok(norm.includes("on conflict(role_key) do update set permissions=excluded.permissions"));
  for (const role of [
    "administrator",
    "compliance_admin",
    "house_manager",
    "program_manager",
    "dsp",
    "nurse",
    "hr",
    "auditor",
  ]) {
    assert.ok(norm.includes(`('${role}',`), `matrix row for ${role}`);
    assert.ok(
      sql.includes(JSON.stringify(ROLE_TEMPLATE_BY_KEY[role as keyof typeof ROLE_TEMPLATE_BY_KEY].permissions)),
      `canonical map for ${role} appears verbatim`,
    );
  }
});

test("the compliance matrix row's true keys are exactly the founder keep list", () => {
  const row = sql.match(/\('compliance_admin', '(\{.*?\})'::jsonb\)/);
  assert.ok(row, "compliance_admin matrix row present");
  const map = JSON.parse(row[1]) as Record<string, boolean>;
  assert.deepEqual(
    Object.keys(map).sort(),
    [...PERMISSION_KEYS].sort(),
    "the row is a complete canonical map",
  );
  assert.deepEqual(
    PERMISSION_KEYS.filter((key) => map[key]).sort(),
    PERMISSION_KEYS.filter((key) => ROLE_TEMPLATE_BY_KEY.compliance_admin.permissions[key]).sort(),
    "true keys match the TS template",
  );
  for (const key of REMOVE_KEYS) {
    assert.equal(map[key], false, `${key} is false in the narrowed map`);
  }
});

test("role_templates compliance row is set to the same narrowed map", () => {
  const canonical = JSON.stringify(ROLE_TEMPLATE_BY_KEY.compliance_admin.permissions);
  assert.ok(
    norm.includes("update public.role_templates set permissions ="),
    "role_templates update present",
  );
  assert.ok(
    sql.includes(`set permissions = '${canonical}'::jsonb`),
    "role_templates receives the canonical narrowed map verbatim",
  );
  assert.ok(norm.includes("where key = 'compliance_admin'"), "scoped to compliance_admin");
});

test("the agency_roles backfill deletes exactly the REMOVE keys and nothing else", () => {
  assert.ok(norm.includes("update public.agency_roles set permissions = permissions - array["), "delete-based backfill");
  assert.ok(norm.includes("where template_key = 'compliance_admin'"), "scoped to compliance rows");
  const arrayMatch = sql.match(/permissions - array\[([\s\S]*?)\]/);
  assert.ok(arrayMatch, "delete array present");
  const deleted = [...arrayMatch[1].matchAll(/'([a-zA-Z._]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(deleted, [...REMOVE_KEYS].sort(), "exactly the founder REMOVE list is deleted");
  // The backfill must not touch any other role's rows or reset kept values:
  assert.ok(!norm.includes("insert into public.agency_roles"), "no agency_roles inserts");
  assert.ok(!/update public\.agency_roles[\s\S]*?template_key = '(?!compliance_admin)/.test(norm), "no other template_key is updated");
});

test("the migration is idempotent in shape (pure overwrites and deletions)", () => {
  assert.ok(!norm.includes("delete from"), "no row deletions");
  assert.ok(!norm.includes("drop "), "no drops");
  assert.ok(!norm.includes("alter table"), "no schema changes");
});
