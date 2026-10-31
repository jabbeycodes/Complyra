/**
 * landing.test.ts — simulation batch 25: where the Training surface
 * lands per role. Oversight roles (PM/HM/admin) and hr.view_staff
 * holders open on the staff roster; everyone else opens on their own
 * record.
 *
 * Run: node --import tsx --test src/features/training/landing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingLandingMode } from "./gate";

test("oversight roles land on the roster even without hr.view_staff", () => {
  // The batch-25 repro: the PM's stored template carries no
  // hr.view_staff, yet she must land on the staff picker, not her own
  // uncleared record.
  for (const roleKey of ["program_manager", "house_manager", "administrator"]) {
    assert.equal(
      trainingLandingMode({ canViewStaff: false, roleKey }),
      "roster",
      roleKey,
    );
  }
});

test("hr.view_staff holders land on the roster whatever their role", () => {
  assert.equal(trainingLandingMode({ canViewStaff: true, roleKey: "hr" }), "roster");
  assert.equal(trainingLandingMode({ canViewStaff: true, roleKey: "dsp" }), "roster");
});

test("staff roles land on their own record", () => {
  for (const roleKey of ["dsp", "nurse", "auditor", "compliance_admin"]) {
    assert.equal(
      trainingLandingMode({ canViewStaff: false, roleKey }),
      "own",
      roleKey,
    );
  }
});
