/**
 * Static policy tests for supabase/migrations/20260914070000_delegation_templates.sql.
 *
 * There is no live database in this environment, so these tests parse the
 * migration text and assert the security properties the RLS policies and
 * RPCs must have:
 *  - site-scoped reads for activations and assignments
 *  - reviewers-only direct reads on training materials (drafts never exposed)
 *  - staff read published content only through the redacted RPC
 *  - individual/site consistency on assignment
 *  - own-signature enforcement
 *  - HM/DPM-only roster reads
 *  - idempotent, accurately-counted overdue sweep
 *  - correct permission reseeds (HM/DSP/RN get delegation.acknowledge)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase", "migrations", "20260914070000_delegation_templates.sql"),
  "utf8",
);
const norm = sql.replace(/\s+/g, " ").toLowerCase();
const raw = sql.toLowerCase();

function fnBody(name: string): string {
  const m = raw.match(
    new RegExp(
      `create or replace function public\\.${name}\\(.*?\\nend;\\n\\$\\$`,
      "s",
    ),
  );
  assert.ok(m, `${name} exists`);
  return m![0];
}

function policy(name: string): string {
  const m = norm.match(
    new RegExp(`create policy ${name}.*?using \\((.*?)\\)\\s*;`, "s"),
  );
  assert.ok(m, `policy ${name} exists`);
  return m![1];
}

test("all five delegation tables have RLS enabled", () => {
  for (const t of [
    "delegation_templates",
    "site_delegation_activations",
    "individual_delegation_assignments",
    "delegation_training_materials",
    "delegation_acknowledgments",
  ]) {
    assert.ok(
      norm.includes(`alter table public.${t} enable row level security`),
      `${t} has RLS`,
    );
  }
});

test("activations and assignments are readable only at the reader's site", () => {
  const act = policy("site_delegation_activations_select");
  const asg = policy("individual_delegation_assignments_select");
  assert.ok(
    act.includes("private.has_site(agency_id, site_id)"),
    "activations are site-scoped",
  );
  assert.ok(
    asg.includes("private.has_site(agency_id, site_id)"),
    "assignments are site-scoped",
  );
  assert.ok(
    !act.includes("private.has_agency(agency_id)"),
    "activations are not agency-wide",
  );
});

test("training materials are directly readable by reviewers only", () => {
  const p = policy("delegation_training_materials_select");
  assert.ok(p.includes("delegation.training.review"), "reviewers can read");
  assert.ok(p.includes("delegation.training.approve"), "approvers can read");
  assert.ok(!p.includes("status = 'published'"), "published rows are not world-readable");
});

test("the staff-facing RPC never returns draft_content", () => {
  const body = fnBody("get_published_training_material");
  assert.ok(!body.includes("draft_content"), "redacted RPC omits draft_content");
  assert.ok(body.includes("published_content"), "redacted RPC returns published_content");
  assert.ok(body.includes("private.has_site"), "redacted RPC is site-scoped");
});

test("assignment enforces individual/site consistency", () => {
  const body = fnBody("assign_delegation");
  assert.ok(
    body.includes("v_ind.site_id <> v_act.site_id"),
    "assignment rejects individuals from other sites",
  );
});

test("signing enforces own-signature after opening, exactly once", () => {
  const body = fnBody("sign_delegation_ack");
  assert.ok(body.includes("staff_id = auth.uid()"), "signs own row only");
  assert.ok(body.includes("opened_at is null"), "must open before signing");
  assert.ok(body.includes("signed_at is not null"), "cannot sign twice");
  assert.ok(
    body.includes("return to_jsonb(v_ack)"),
    "returns a single JSON object, not an array",
  );
});

test("acknowledgment roster is limited to managers and reviewers", () => {
  const p = policy("delegation_acknowledgments_select");
  assert.ok(p.includes("staff_id = auth.uid()"), "staff see their own row");
  assert.ok(p.includes("delegation.training.review"), "reviewers see the roster");
  assert.ok(p.includes("delegation.activate"), "activators see the roster");
  assert.ok(p.includes("house_manager"), "site HM sees the roster");
  assert.ok(!p.includes("delegation.templates.view"), "plain template viewers do not");
});

test("overdue sweep is idempotent and returns the actual inserted count", () => {
  const body = fnBody("sweep_delegation_ack_overdue");
  assert.ok(body.includes("returns integer"), "sweep returns a count");
  assert.ok(
    body.includes("on conflict (agency_id, dedupe_key) do nothing"),
    "sweep inserts are dedupe-safe",
  );
  assert.ok(body.includes("return v_count"), "sweep returns the counted inserts");
  assert.ok(
    body.includes("interval '7 days'"),
    "sweep uses the seven-day due window",
  );
});

test("permission reseeds grant acknowledge to HM, DSP, and RN", () => {
  // Each UPDATE ... WHERE key = .../'...'/ statement is one reseed block.
  const blocks = norm.split("update public.role_templates").slice(1);
  const forKeys = (want: string) =>
    blocks.find((b) => b.includes(want) && b.includes('"delegation.acknowledge": true'));
  assert.ok(
    forKeys("where key in ('house_manager', 'dsp')"),
    "house_manager and dsp get delegation.acknowledge = true",
  );
  assert.ok(
    forKeys("where key = 'nurse'"),
    "nurse gets delegation.acknowledge = true",
  );
  assert.ok(
    forKeys("where key = 'degreed_professional_manager'")?.includes('"delegation.activate": true'),
    "DPM keeps delegation.activate",
  );
});

test("template library is global: common rows use agency_id null", () => {
  assert.ok(
    norm.includes("agency_id is null") && norm.includes("or (select private.has_agency(agency_id))"),
    "common templates are readable by every agency",
  );
  const seeds = norm.match(/\(null, '/g) ?? [];
  assert.equal(seeds.length, 8, "eight common templates are seeded");
});

test("every write path goes through RPCs: no insert/update/delete policies", () => {
  const writePolicies = norm.match(/create policy \w+ on public\.(delegation_templates|site_delegation_activations|individual_delegation_assignments|delegation_training_materials|delegation_acknowledgments)\s+for (insert|update|delete)/g);
  assert.equal(writePolicies, null, "no direct write policies exist");
});

test("all eleven RPCs exist and are security definer", () => {
  for (const fn of [
    "activate_delegation_template",
    "assign_delegation",
    "submit_delegation_review",
    "approve_delegation_material",
    "open_delegation_material",
    "get_published_training_material",
    "sign_delegation_ack",
    "sweep_delegation_ack_overdue",
    "deactivate_delegation_activation",
    "end_delegation_assignment",
    "create_delegation_template",
    "update_delegation_template",
    "save_delegation_training_draft",
  ]) {
    const m = norm.match(
      new RegExp(`create or replace function public\\.${fn}\\(.*?security definer`, "s"),
    );
    assert.ok(m, `${fn} exists and is security definer`);
  }
});

test("create_delegation_template is permission-gated and returns one row", () => {
  const body = fnBody("create_delegation_template");
  assert.ok(
    body.includes("private.has_permission(p_agency_id, 'delegation.templates.manage')"),
    "create requires delegation.templates.manage in the target agency",
  );
  assert.ok(
    body.includes("insert into public.delegation_templates"),
    "create inserts into delegation_templates",
  );
  assert.ok(
    body.includes("return to_jsonb(v_tpl)"),
    "create returns a single JSON object, not an array",
  );
  assert.ok(
    body.includes("template name is required"),
    "create rejects a blank name",
  );
});

test("update_delegation_template is permission-gated and bumps updated_at", () => {
  const body = fnBody("update_delegation_template");
  assert.ok(
    body.includes("'delegation.templates.manage'"),
    "update requires delegation.templates.manage",
  );
  assert.ok(
    body.includes("v_tpl.agency_id is null"),
    "update handles common-library (agency_id null) templates",
  );
  assert.ok(
    body.includes("delegation template not found"),
    "update reports a missing template",
  );
  assert.ok(
    body.includes("updated_at = now()"),
    "update refreshes updated_at",
  );
  assert.ok(
    body.includes("return to_jsonb(v_tpl)"),
    "update returns a single JSON object, not an array",
  );
});

test("save_delegation_training_draft is permission-gated and draft-only", () => {
  const body = fnBody("save_delegation_training_draft");
  assert.ok(
    body.includes("private.has_permission(v_mat.agency_id, 'delegation.training.review')"),
    "draft save requires delegation.training.review",
  );
  assert.ok(
    body.includes("v_mat.status not in ('draft', 'in_review')"),
    "published material cannot be edited as a draft",
  );
  assert.ok(
    body.includes("only a draft or in-review material can be edited"),
    "draft save reports the lifecycle guard",
  );
  assert.ok(
    body.includes("digital record generated by complyrer"),
    "draft save stamps the digital-record mark server-side",
  );
  assert.ok(
    body.includes("return to_jsonb(v_mat)"),
    "draft save returns a single JSON object, not an array",
  );
});

test("hosted API performs the three writes through the new RPCs", () => {
  const api = readFileSync(
    join(root, "src", "data", "hostedApi.ts"),
    "utf8",
  );
  for (const rpc of [
    "create_delegation_template",
    "update_delegation_template",
    "save_delegation_training_draft",
  ]) {
    assert.ok(
      api.includes(`"${rpc}"`),
      `hosted API calls the ${rpc} RPC`,
    );
  }
  assert.ok(
    !/\.from\("delegation_templates"\)\s*\.\s*(insert|update)/.test(api),
    "no direct delegation_templates insert/update remains in the hosted API",
  );
  assert.ok(
    !/\.from\("delegation_training_materials"\)\s*\.\s*(insert|update|delete)/.test(api),
    "no direct delegation_training_materials write remains in the hosted API",
  );
});
