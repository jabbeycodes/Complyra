/**
 * QA Review "Start review" gate (simulation wave 4A follow-up).
 *
 * The start control was gated on qa.audit — the scoring permission held
 * by the read-only auditor role — so the auditor was the only non-admin
 * role who saw it, while the Program Manager who runs the QA program
 * (qa.schedule) saw nothing. Both QA surfaces and both APIs now key
 * creation on qa.schedule. These tests pin the per-role matrix against
 * the seeded role templates and pin the gate expressions in the page
 * and API sources so the gate cannot silently drift back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_TEMPLATES, type RoleKey } from "../../data/permissions";
import { can } from "../../data/status";
import type { SessionUser } from "../../data/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function sessionFor(roleKey: RoleKey): SessionUser {
  const template = ROLE_TEMPLATES.find((row) => row.key === roleKey);
  assert.ok(template, `template for ${roleKey}`);
  return {
    userId: `user-${roleKey}`,
    roleKey,
    permissions: template.permissions,
  } as unknown as SessionUser;
}

test("start-review gate (qa.schedule) per role template", () => {
  const expected: Record<RoleKey, boolean> = {
    administrator: true,
    program_manager: true,
    compliance_admin: false,
    house_manager: false,
    dsp: false,
    nurse: false,
    hr: false,
    auditor: false,
  };
  for (const [roleKey, allowed] of Object.entries(expected)) {
    assert.equal(
      can(sessionFor(roleKey as RoleKey), "qa.schedule"),
      allowed,
      `${roleKey} ${allowed ? "can" : "cannot"} start a QA review`,
    );
  }
  // Scoring stays on qa.audit: the auditor keeps it, the PM does not get
  // it as a side effect of the creation fix.
  assert.equal(can(sessionFor("auditor"), "qa.audit"), true);
  assert.equal(can(sessionFor("program_manager"), "qa.audit"), false);
});

test("both QA surfaces gate the start control on qa.schedule", () => {
  const page = readFileSync(join(root, "src/features/qa/QaAuditsPage.tsx"), "utf8");
  assert.match(page, /canStartReview = can\(session!, "qa\.schedule"\)/);
  assert.match(page, /\{canStartReview && \(\s*<div className="qa-new-audit">/);
  assert.doesNotMatch(page, /can\(session!, "qa\.audit"\)/);

  const site = readFileSync(join(root, "src/features/qa/SiteQaReview.tsx"), "utf8");
  assert.match(site, /canStartReview = !!session && can\(session, "qa\.schedule"\)/);
  assert.match(site, /\{canStartReview && \(/);
});

test("both APIs refuse creation without qa.schedule", () => {
  const local = readFileSync(join(root, "src/data/localApi.ts"), "utf8");
  assert.match(local, /assertCan\(session, "qa\.schedule"\);\s*\n\s*this\.assertQaSite\(session, siteId\)/);

  const hosted = readFileSync(join(root, "src/data/hostedApi.ts"), "utf8");
  assert.match(hosted, /this\.requirePermission\(session, "qa\.schedule"\);\s*\n\s*if \(session\.roleKey === "house_manager"/);
});
