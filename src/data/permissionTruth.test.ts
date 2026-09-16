/**
 * permissionTruth.test.ts — cross-layer consistency for the single permission
 * source of truth (Workstream 4).
 *
 * These tests bind the layers together:
 *   1. TS canonical module (src/data/permissions.ts)
 *   2. SQL seed (supabase/migrations/20260914040000_permission_source_of_truth.sql)
 *   3. Consolidated guard call sites (hostedApi, localApi, RolesAccessPage,
 *      AssignRoleControl, InviteMemberForm)
 *
 * Run: node --import tsx --test src/data/permissionTruth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSION_KEYS,
  PERMISSION_REGISTRY,
  ROLE_KEYS,
  ROLE_TEMPLATE_BY_KEY,
  assertNoDrift,
  canEditRoleTemplates,
  canGrantRole,
} from "./permissions";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const MIGRATION_PATH = join(
  repoRoot,
  "supabase",
  "migrations",
  "20260914040000_permission_source_of_truth.sql",
);

// Newer migrations may refresh the role_permission_matrix seed with regenerated
// maps (e.g. 20260914070000_audit_readiness.sql adds correctiveActions.manage).
// The exact-match checks below always target the LATEST seed refresh, while the
// original migration is still verified for role-key coverage (frozen history).
const LATEST_SEED_MIGRATION_PATH = join(
  repoRoot,
  "supabase",
  "migrations",
  "20260915024000_integrated_permissions.sql",
);

// Files whose permission guards were consolidated onto the canonical module.
const CONSOLIDATED_SOURCES = [
  "src/data/permissions.ts",
  "src/data/hostedApi.ts",
  "src/data/localApi.ts",
  "src/features/RolesAccessPage.tsx",
  "src/features/AssignRoleControl.tsx",
  "src/features/InviteMemberForm.tsx",
] as const;

// Program Manager merge migration (2026-09-16): refreshes the canonical
// program_manager row with the wider former-DPM permission pack and migrates
// any lingering degreed_professional_manager memberships/agency roles.
const MERGE_MIGRATION_PATH = join(
  repoRoot,
  "supabase",
  "migrations",
  "20260916060000_merge_dpm_program_manager.sql",
);

test("truth: all 8 role keys exist in ROLE_TEMPLATE_BY_KEY with full maps", () => {
  assert.deepEqual([...ROLE_KEYS].sort(), [
    "administrator",
    "auditor",
    "compliance_admin",
    "dsp",
    "house_manager",
    "hr",
    "nurse",
    "program_manager",
  ]);
  for (const key of ROLE_KEYS) {
    const template = ROLE_TEMPLATE_BY_KEY[key];
    assert.ok(template, `template for ${key}`);
    // Every template map covers every permission key exactly once.
    assert.deepEqual(Object.keys(template.permissions).sort(), [...PERMISSION_KEYS].sort());
    for (const perm of PERMISSION_KEYS) {
      assert.equal(
        typeof template.permissions[perm],
        "boolean",
        `${key}.${perm} must be boolean`,
      );
    }
  }
});

test("truth: registry metadata exists for every permission key", () => {
  for (const key of PERMISSION_KEYS) {
    const entry = PERMISSION_REGISTRY[key];
    assert.ok(entry, `registry entry for ${key}`);
    assert.equal(entry.key, key);
    assert.ok(entry.description.length > 0);
    assert.ok(Array.isArray(entry.defaultRoles));
  }
});

test("truth: grant-rule contract holds across layers", () => {
  // administrator -> administrator allowed; hr -> administrator denied
  assert.equal(canGrantRole("administrator", "administrator"), true);
  assert.equal(canGrantRole("hr", "administrator"), false);
  assert.equal(canGrantRole("dsp", "administrator"), false);
  // compliance_admin -> compliance_admin allowed; hr -> compliance_admin denied
  assert.equal(canGrantRole("compliance_admin", "compliance_admin"), true);
  assert.equal(canGrantRole("hr", "compliance_admin"), false);
  // template editing stays with administrator / compliance_admin
  assert.equal(canEditRoleTemplates("administrator"), true);
  assert.equal(canEditRoleTemplates("compliance_admin"), true);
  assert.equal(canEditRoleTemplates("hr"), false);
  assert.equal(canEditRoleTemplates("house_manager"), false);
  assert.equal(canEditRoleTemplates("dsp"), false);
});

test("truth: migration seed contains every role key and every permission key", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  for (const roleKey of ROLE_KEYS) {
    assert.ok(
      sql.includes(`('${roleKey}',`),
      `migration seeds role_key ${roleKey}`,
    );
  }
  // Every permission key must appear as a JSON key inside the LATEST seeded map.
  const latest = readFileSync(LATEST_SEED_MIGRATION_PATH, "utf8");
  for (const permKey of PERMISSION_KEYS) {
    assert.ok(
      latest.includes(`"${permKey}":`),
      `latest seed contains permission ${permKey}`,
    );
  }
});

test("truth: migration seed JSON matches the canonical template maps exactly", () => {
  const seedSql = readFileSync(LATEST_SEED_MIGRATION_PATH, "utf8");
  const mergeSql = readFileSync(MERGE_MIGRATION_PATH, "utf8");
  assert.ok(
    mergeSql.includes("degreed_professional_manager"),
    "merge migration migrates the retired degreed_professional_manager key",
  );
  for (const roleKey of ROLE_KEYS) {
    const canonical = JSON.stringify(ROLE_TEMPLATE_BY_KEY[roleKey].permissions);
    // The seed rows were generated from the canonical module, so the exact
    // serialized map must appear verbatim in migration text. Program
    // Manager's latest refresh is the DPM-merge migration (2026-09-16);
    // every other role still matches the 2026-09-15 seed refresh.
    const sql = roleKey === "program_manager" ? mergeSql : seedSql;
    assert.ok(
      sql.includes(canonical),
      `latest migration row for ${roleKey} matches ROLE_TEMPLATE_BY_KEY exactly`,
    );
  }
});

test("truth: migration verifies Phase 0 hierarchy enforcement objects", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.ok(
    sql.includes("private.can_grant_role_key(uuid, text)"),
    "migration checks private.can_grant_role_key(uuid, text)",
  );
  assert.ok(
    sql.includes("private.guard_last_administrator()"),
    "migration checks private.guard_last_administrator()",
  );
  assert.ok(
    sql.includes("memberships_guard_last_administrator"),
    "migration checks trigger memberships_guard_last_administrator",
  );
  assert.ok(
    sql.includes("agency_roles_audit_update"),
    "migration checks trigger agency_roles_audit_update",
  );
  assert.ok(
    sql.match(/raise\s+exception/i),
    "migration raises on missing Phase 0 objects",
  );
});

test("truth: no-drift — every permission-like string in consolidated sources is declared", () => {
  // Scan ONLY permission contexts: hasPermission(session, "x") call sites and
  // permissions["x"] subscripts in the consolidated files, plus every quoted
  // dotted string in the canonical module itself. (Audit event names such as
  // "member.role_assigned" look dotted but are not permission keys, so a
  // blanket scan would false-positive.)
  const found = new Set<string>();
  const callPattern = /hasPermission\(\s*[^,]+,\s*"([^"]+)"\)/g;
  const subscriptPattern = /permissions\[(?:"([^"]+)"|'([^']+)')\]/g;
  for (const rel of CONSOLIDATED_SOURCES) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    let match: RegExpExecArray | null;
    callPattern.lastIndex = 0;
    while ((match = callPattern.exec(text)) !== null) found.add(match[1]);
    subscriptPattern.lastIndex = 0;
    while ((match = subscriptPattern.exec(text)) !== null) {
      found.add(match[1] ?? match[2]);
    }
  }
  const canonical = readFileSync(join(repoRoot, "src/data/permissions.ts"), "utf8");
  const dotted = /"([a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*)"/g;
  let m: RegExpExecArray | null;
  dotted.lastIndex = 0;
  while ((m = dotted.exec(canonical)) !== null) found.add(m[1]);
  // Sanity: the scan actually found the keys we expect to be referenced.
  assert.ok(found.has("members.invite"), "scan sees members.invite");
  assert.ok(found.has("roles.manage"), "scan sees roles.manage");
  assert.ok(found.has("certificates.manage"), "scan sees certificates.manage");
  assert.doesNotThrow(
    () => assertNoDrift([...found]),
    "every referenced permission string is declared in PERMISSION_KEYS",
  );
});

test("truth: the phase0 security migration itself is untouched", () => {
  const phase0 = readdirSync(join(repoRoot, "supabase", "migrations")).filter((f) =>
    f.includes("phase0_security"),
  );
  assert.deepEqual(phase0, ["20260913191500_phase0_security.sql"]);
  const sql = readFileSync(
    join(repoRoot, "supabase", "migrations", phase0[0]),
    "utf8",
  );
  assert.ok(
    sql.includes("create or replace function private.can_grant_role_key"),
    "Phase 0 grant-hierarchy function still defined",
  );
  assert.ok(
    sql.includes("create or replace function private.guard_last_administrator"),
    "Phase 0 last-administrator guard still defined",
  );
  assert.ok(
    sql.includes("create trigger memberships_guard_last_administrator"),
    "Phase 0 memberships trigger still defined",
  );
  assert.ok(
    sql.includes("create trigger agency_roles_audit_update"),
    "Phase 0 agency_roles audit trigger still defined",
  );
});
