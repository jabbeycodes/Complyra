/**
 * Static tests for supabase/migrations/20261031170000_hm_corrective_actions_seed.sql
 * (simulation batch 7): the house_manager pack gains correctiveActions.manage
 * in every layer the seed touches, and the flip is scoped to that one
 * role + key. No live database here — parse the migration text, like
 * delegationMigration.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase", "migrations", "20261031170000_hm_corrective_actions_seed.sql"),
  "utf8",
);
const norm = sql.replace(/\s+/g, " ").toLowerCase();

test("the seed refresh upserts the canonical matrix for all eight roles", () => {
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
  }
});

test("house_manager's canonical map carries correctiveActions.manage:true", () => {
  const hm = norm.match(/\('house_manager', '(.*?)'::jsonb\)/);
  assert.ok(hm, "house_manager row present");
  assert.ok(
    hm[1].includes('"correctiveactions.manage":true'),
    "HM map grants correctiveActions.manage",
  );
  const dsp = norm.match(/\('dsp', '(.*?)'::jsonb\)/);
  assert.ok(dsp && dsp[1].includes('"correctiveactions.manage":false'), "DSP stays out");
});

test("missing keys merge into templates and agency roles; existing choices win", () => {
  assert.ok(
    norm.includes("update public.role_templates t set permissions=m.permissions || t.permissions"),
    "role_templates merge",
  );
  assert.ok(
    norm.includes("update public.agency_roles a set permissions=m.permissions || a.permissions"),
    "agency_roles merge",
  );
});

test("the deliberate flip is scoped to house_manager + this one key", () => {
  const flips = norm.match(/set permissions = [at]\.permissions \|\| '\{"correctiveactions\.manage":true\}'::jsonb/g);
  assert.equal(flips?.length, 2, "one flip for role_templates, one for agency_roles");
  assert.ok(norm.includes("where t.key = 'house_manager'"), "template flip is HM-only");
  assert.ok(
    norm.includes("where a.template_key = 'house_manager'"),
    "agency_roles flip is HM-only",
  );
});

test("the migration is wrapped in a transaction", () => {
  assert.ok(norm.startsWith("-- hm corrective actions") || norm.includes("begin;"));
  assert.ok(norm.includes("begin;"));
  assert.ok(norm.trimEnd().endsWith("commit;"));
});
