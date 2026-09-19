/**
 * Static policy tests for the GER workflow hardening migration:
 *   supabase/migrations/20260918130000_ger_workflow_hardening.sql
 * (which supersedes the coarse policies in 20260918120000_ger_reports.sql).
 *
 * There is no live database in this environment, so these tests parse the
 * migration text and assert the security properties the RLS policies,
 * workflow trigger, and RPCs must have (mirrored by the pgTAP suite in
 * supabase/tests/ger_workflow_security.sql, which runs against a real
 * Postgres in CI):
 *  - authenticated gets table privileges on ger_reports (RLS policies alone
 *    are not enough — without the grant every request fails with
 *    "permission denied for table ger_reports")
 *  - reads are site-scoped through private.can_access_ger_site, never
 *    agency-wide; the auditor exception is explicit
 *  - no delete policy exists, so direct deletes are rejected by RLS
 *  - inserts are draft-only, self-authored, and require ger.create
 *  - the workflow trigger makes approved reports final, locks ownership
 *    and site, gates status transitions, and blocks review-field forgery
 *  - the four workflow RPCs exist and are executable by authenticated only
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const harden = readFileSync(
  join(root, "supabase", "migrations", "20260918130000_ger_workflow_hardening.sql"),
  "utf8",
);
const norm = harden.replace(/\s+/g, " ").toLowerCase();

test("ger_reports grants table privileges to authenticated", () => {
  assert.ok(
    norm.includes(
      "grant select, insert, update, delete on public.ger_reports to authenticated",
    ),
    "authenticated needs table privileges or every request fails with permission denied",
  );
});

test("ger reads are site-scoped, never agency-wide", () => {
  assert.ok(
    norm.includes("create policy ger_reports_select on public.ger_reports"),
    "select policy exists",
  );
  assert.ok(
    norm.includes("private.can_access_ger_site(agency_id, site_id)"),
    "select is scoped to the caller's authorized sites",
  );
  // The hardening migration must drop the original agency-wide select policy.
  assert.ok(
    norm.includes("drop policy if exists ger_reports_select on public.ger_reports"),
    "original coarse select policy is removed",
  );
});

test("auditor read exception is explicit", () => {
  const m = norm.match(
    /create or replace function private\.can_access_ger_site\(.*?end;\s*\$\$/s,
  );
  assert.ok(m, "can_access_ger_site exists");
  const body = m![0];
  assert.ok(
    body.includes("'administrator', 'compliance_admin', 'program_manager', 'auditor'"),
    "agency-wide roles are enumerated explicitly, including the auditor exception",
  );
  assert.ok(
    body.includes("m.site_id = p_site_id"),
    "everyone else is locked to their assigned home",
  );
});

test("no direct delete policy exists for ger_reports", () => {
  assert.ok(
    norm.includes("drop policy if exists ger_reports_delete on public.ger_reports"),
    "any delete policy is dropped",
  );
  assert.ok(
    !/create policy ger_reports_delete/.test(norm),
    "no delete policy is recreated, so direct deletes are rejected by RLS",
  );
});

test("inserts are draft-only, self-authored, and require ger.create", () => {
  const m = norm.match(
    /create policy ger_reports_insert on public\.ger_reports for insert to authenticated with check \((.*?)\);/s,
  );
  assert.ok(m, "insert policy exists");
  const check = m![1];
  assert.ok(check.includes("status = 'draft'"), "inserts must be drafts");
  assert.ok(
    check.includes("created_by_user_id = auth.uid()"),
    "inserts must be self-authored",
  );
  assert.ok(check.includes("reviewer_id is null"), "no reviewer on insert");
  assert.ok(
    check.includes("private.has_permission(agency_id, 'ger.create')"),
    "inserts require ger.create",
  );
  assert.ok(
    check.includes("private.can_access_ger_site(agency_id, site_id)"),
    "inserts are site-scoped",
  );
});

test("workflow trigger makes approved reports final and gates transitions", () => {
  assert.ok(
    norm.includes("create trigger ger_reports_workflow_guard"),
    "workflow guard trigger exists",
  );
  assert.ok(
    norm.includes("raise exception 'approved event reports are final.'"),
    "approved reports are immutable",
  );
  assert.ok(
    norm.includes(
      "raise exception 'event report ownership and site cannot be changed.'",
    ),
    "agency/site/authorship cannot be moved",
  );
  assert.ok(
    norm.includes("raise exception 'invalid event report workflow transition.'"),
    "illegal status transitions are rejected",
  );
  assert.ok(
    norm.includes("raise exception 'the reviewer must be the signed-in user.'"),
    "reviewer identity cannot be forged",
  );
  assert.ok(
    norm.includes(
      "raise exception 'review fields may only change through a review decision.'",
    ),
    "review fields cannot be edited directly",
  );
  assert.ok(
    norm.includes("raise exception 'only a reviewer may edit a submitted event report.'"),
    "submitted reports are reviewer-only",
  );
  assert.ok(
    norm.includes("raise exception 'complete all required fields before submitting.'"),
    "submission requires a complete report, even via direct status update",
  );
});

test("workflow RPCs exist and are executable by authenticated only", () => {
  for (const fn of [
    "create_ger_report",
    "update_ger_report_body",
    "submit_ger_report",
    "review_ger_report",
  ]) {
    assert.ok(
      norm.includes(`create or replace function public.${fn}(`),
      `${fn} exists`,
    );
    assert.ok(
      norm.includes(`revoke all on function public.${fn}(`),
      `${fn} is revoked from public`,
    );
  }
  assert.ok(
    norm.includes("grant execute on function public.create_ger_report(jsonb)"),
    "RPCs are granted to authenticated",
  );
});

test("review RPC sets the reviewer from the session", () => {
  const m = norm.match(
    /create or replace function public\.review_ger_report\(.*?end;\s*\$\$/s,
  );
  assert.ok(m, "review_ger_report exists");
  assert.ok(
    m![0].includes("reviewer_id=auth.uid()"),
    "the reviewer is always the signed-in user",
  );
});
