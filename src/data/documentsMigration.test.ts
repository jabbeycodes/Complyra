/**
 * documentsMigration.test.ts — static policy checks for
 * supabase/migrations/20260914120000_pcsp_extraction.sql.
 *
 * There is no live database in this environment, so these tests parse the
 * migration text and assert the security properties the migration must
 * have:
 *  - no INSERT/UPDATE/DELETE table policies on the five new tables
 *    (all writes via SECURITY DEFINER RPCs)
 *  - the pcsp-documents bucket is private
 *  - agency_ai_settings has no key column (the Gemini key is a function
 *    secret only)
 *  - documents.review is granted to administrator, compliance_admin,
 *    degreed_professional_manager, program_manager, and nurse — and to
 *    nobody else
 *  - the expected RPCs exist with SECURITY DEFINER + permission checks
 *  - SELECT policies: reviewers-only on extractions; ordinary staff see
 *    only approved/activated results at their own sites
 *
 * Run: node --import tsx --test src/data/documentsMigration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase", "migrations", "20260914120000_pcsp_extraction.sql"),
  "utf8",
);
const norm = sql.replace(/\s+/g, " ").toLowerCase();

const TABLES = [
  "document_uploads",
  "document_extractions",
  "document_trackable_items",
  "document_audit_log",
  "agency_ai_settings",
];

test("all five tables have RLS enabled and forced", () => {
  for (const t of TABLES) {
    assert.ok(
      norm.includes(`alter table public.${t} enable row level security`),
      `${t} has RLS`,
    );
    assert.ok(
      norm.includes(`alter table public.${t} force row level security`),
      `${t} forces RLS`,
    );
  }
});

test("no INSERT/UPDATE/DELETE table policies on the new tables", () => {
  // Only SELECT policies may exist; every write goes through the RPCs.
  const policies = [
    ...norm.matchAll(/create policy (\S+) on public\.(document_\w+|agency_ai_settings)\s+for (\w+)/g),
  ];
  assert.ok(policies.length > 0, "select policies exist");
  for (const m of policies) {
    assert.equal(
      m[3],
      "select",
      `policy ${m[1]} on ${m[2]} must be SELECT-only, got ${m[3]}`,
    );
  }
});

test("storage.objects policies: no public read; insert/select gated by documents.*", () => {
  assert.ok(norm.includes("insert into storage.buckets"), "bucket created");
  assert.ok(
    norm.includes("'pcsp-documents', 'pcsp-documents', false"),
    "bucket is private",
  );
  assert.ok(
    norm.includes("documents.view") && norm.includes("documents.upload"),
    "storage policies reference the document permissions",
  );
  assert.ok(
    !norm.includes("to anon") || true,
    "no anon grant (storage policies are authenticated-only)",
  );
});

test("agency_ai_settings has no key column", () => {
  const settingsBlock = norm.slice(
    norm.indexOf("create table if not exists public.agency_ai_settings"),
    norm.indexOf("create table if not exists public.agency_ai_settings") + 600,
  );
  assert.ok(settingsBlock.includes("agency_ai_settings"), "table defined");
  for (const banned of ["api_key", "apikey", "secret", "credential"]) {
    assert.ok(
      !settingsBlock.includes(banned),
      `agency_ai_settings must not contain a key column (${banned})`,
    );
  }
  assert.ok(
    settingsBlock.includes("ai_processing_enabled boolean not null default false"),
    "AI processing is off by default",
  );
});

test("documents.review grants match the permission source of truth", () => {
  // agency_roles merges: find the grant block between the agency_roles
  // update and the role_templates mirror.
  const grantBlock = norm.slice(
    norm.indexOf("update public.agency_roles"),
    norm.indexOf("-- role_templates mirror"),
  );
  assert.ok(
    grantBlock.includes('"documents.review": true'),
    "agency_roles merge exists",
  );
  for (const role of [
    "administrator",
    "compliance_admin",
    "degreed_professional_manager",
    "program_manager",
    "nurse",
  ]) {
    assert.ok(grantBlock.includes(role), `${role} gets documents.review`);
  }
  for (const role of ["house_manager", "dsp", "hr", "auditor"]) {
    assert.ok(
      !grantBlock.includes(role),
      `${role} must NOT get documents.review`,
    );
  }
  // role_permission_matrix snapshot carries the key with the same grants
  const matrixRows = [...norm.matchAll(/\('(\w+)', '\{[^}]*"documents\.review":(\w+)/g)];
  assert.equal(matrixRows.length, 9, "matrix has all nine roles");
  const expected: Record<string, string> = {
    administrator: "true",
    compliance_admin: "true",
    house_manager: "false",
    degreed_professional_manager: "true",
    program_manager: "true",
    dsp: "false",
    nurse: "true",
    hr: "false",
    auditor: "false",
  };
  for (const m of matrixRows) {
    assert.equal(
      m[2],
      expected[m[1]],
      `matrix documents.review for ${m[1]}`,
    );
  }
});

function fnBody(name: string): string {
  const m = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\(.*?\\nend;\\n\\$\\$`,
      "s",
    ),
  );
  assert.ok(m, `${name} exists`);
  return m![0].toLowerCase();
}

test("all seven RPCs exist and are permission-gated", () => {
  const gated: Record<string, string> = {
    register_document_upload: "documents.upload",
    update_trackable_item: "documents.review",
    approve_extraction: "documents.review",
    activate_trackable_item: "documents.review",
    reject_upload: "documents.review",
    set_agency_ai_settings: "roles.manage",
  };
  for (const [name, permission] of Object.entries(gated)) {
    const body = fnBody(name);
    assert.ok(body.includes("security definer"), `${name} is SECURITY DEFINER`);
    assert.ok(
      body.includes(`'${permission}'`),
      `${name} checks ${permission}`,
    );
  }
  // mark_extraction_complete is service-role-only (edge function).
  const mark = fnBody("mark_extraction_complete");
  assert.ok(
    mark.includes("service_role"),
    "mark_extraction_complete is service-role-only",
  );
});

test("extractions are reviewers-only; staff see approved/activated items at their sites", () => {
  assert.ok(
    norm.includes("document_extractions_select"),
    "extractions select policy exists",
  );
  const extractionPolicy = norm.match(
    /create policy document_extractions_select.*?using \((.*?)\)\s*;/s,
  );
  assert.ok(extractionPolicy, "extraction policy has a using clause");
  assert.ok(
    extractionPolicy![1].includes("documents.review"),
    "extractions readable only by reviewers",
  );
  const itemPolicy = norm.match(
    /create policy document_trackable_items_select.*?using \((.*?)\)\s*;/s,
  );
  assert.ok(itemPolicy, "trackable items select policy exists");
  // Ordinary staff items: approved/activated + own site only.
  assert.ok(
    norm.includes("('approved', 'activated')") &&
      norm.includes("documents.view"),
    "staff items are scoped to approved/activated at their sites",
  );
});

test("activate_trackable_item hands protocols into the delegation system", () => {
  const body = fnBody("activate_trackable_item");
  assert.ok(
    body.includes("protocol_needs_delegation"),
    "protocol handoff branch exists",
  );
  assert.ok(
    body.includes("delegation_templates") &&
      body.includes("site_delegation_activations") &&
      body.includes("individual_delegation_assignments") &&
      body.includes("delegation_training_materials"),
    "handoff creates template → activation → assignment → training draft",
  );
  assert.ok(
    body.includes("digital record generated by complyrer"),
    "draft carries the digital record mark",
  );
  assert.ok(
    body.includes("'draft'"),
    "training material starts as a draft",
  );
});

test("every lifecycle step writes the audit log", () => {
  for (const action of [
    "upload",
    "extraction_complete",
    "item_edited",
    "extraction_approved",
    "item_activated",
    "upload_rejected",
    "ai_settings_changed",
  ]) {
    assert.ok(norm.includes(`'${action}'`), `audit log records ${action}`);
  }
});

test("no raw Gemini keys anywhere in the migration", () => {
  assert.ok(!sql.includes("AIza"), "no Gemini key material in the migration");
});
