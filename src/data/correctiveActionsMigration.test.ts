/**
 * Static tests for supabase/migrations/20261031170000_hm_corrective_actions_seed.sql
 * (simulation batch 7 + reviewer HOLD fix-up): the house_manager pack
 * gains correctiveActions.manage in every layer the seed touches —
 * seeded ONLY where the key is absent, never overwriting a stored
 * value — and corrective_actions gains its site scope (columns,
 * backfill, the in-scope helper, scoped policies, placement guard).
 * No live database here — parse the migration text, like
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

test("a stored value is never overwritten (reviewer HOLD point 2)", () => {
  // The original draft flipped house_manager copies to true even where
  // an agency had deliberately set the key. The reviewer required:
  // seed only missing keys, preserve stored values. The only writes to
  // permissions anywhere in the file are the canonical matrix upsert
  // and the two missing-key merges (stored side wins per key).
  assert.ok(
    !norm.includes("|| '{\"correctiveactions.manage\":true}'"),
    "no per-key overwrite statement remains",
  );
  assert.ok(
    !norm.includes("is distinct from 'true'"),
    "no flip guard remains",
  );
  const writes = norm.match(/set permissions\s*=/g) ?? [];
  assert.equal(writes.length, 3, "matrix upsert + two merges, nothing else writes permissions");
});

test("corrective_actions gains site + QA-audit columns with a backfill", () => {
  assert.ok(norm.includes("add column if not exists site_id uuid null"));
  assert.ok(norm.includes("add column if not exists qa_audit_id uuid null"));
  assert.ok(norm.includes("references public.qa_audits (id)"));
  // Backfill order: the linked audit's site, then the creator's home.
  const auditFill = norm.indexOf("set site_id = qa.site_id");
  const creatorFill = norm.indexOf("set site_id = m.site_id");
  assert.ok(auditFill > -1 && creatorFill > auditFill, "audit backfill precedes creator backfill");
  assert.ok(
    norm.includes("m.user_id = ca.created_by_user_id"),
    "creator backfill keys off the creator's membership",
  );
});

test("the site scope is enforced in RLS through one helper (reviewer HOLD point 1)", () => {
  assert.ok(
    norm.includes("create or replace function private.corrective_action_in_scope("),
    "scope helper created",
  );
  assert.ok(
    norm.includes("private.can_read_site(p_agency_id, p_site_id)"),
    "site reach goes through can_read_site",
  );
  for (const policy of [
    "corrective_actions_select",
    "corrective_actions_write",
    "corrective_actions_visible",
  ]) {
    assert.ok(norm.includes(`drop policy if exists ${policy}`), `${policy} replaced`);
    assert.ok(norm.includes(`create policy ${policy}`), `${policy} recreated`);
  }
  assert.ok(
    norm.includes("private.has_permission(agency_id, 'correctiveactions.manage')"),
    "writes still require the permission",
  );
});

test("the identity guard judges assignee placement with ACTIVE assignments", () => {
  assert.ok(
    norm.includes("create or replace function private.corrective_action_identity_guard()"),
    "guard replaced",
  );
  assert.ok(
    norm.includes("assign corrective actions to staff who work at that home."),
    "cross-site assignee is refused at the database boundary",
  );
  assert.ok(
    norm.includes("a.ends_on is null or a.ends_on >= current_date"),
    "ended assignments do not place an assignee at a home",
  );
  assert.ok(
    norm.includes("a.starts_on <= current_date"),
    "future assignments do not place an assignee at a home",
  );
});

test("the migration is wrapped in a transaction", () => {
  assert.ok(norm.startsWith("-- hm corrective actions") || norm.includes("begin;"));
  assert.ok(norm.includes("begin;"));
  assert.ok(norm.trimEnd().endsWith("commit;"));
});
