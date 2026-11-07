/**
 * apply-signature open-line count (PR #259 review HOLD): a training line is
 * resolved for staff_sign / hm_countersign only when waived N/A, or when its
 * non-N/A sign-off carries the OWNER's initials event at the CURRENT signoff
 * version. The status column alone never resolves a line. Pure: no network,
 * no database. The SQL twin (private.training_line_initialed /
 * private.med_admin_cleared) is pinned in
 * supabase/tests/training_line_initials_clearance.sql.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingLineFieldName as clientFieldName } from "../../../src/features/signatures/documentPayloads.ts";
import {
  countOpenTrainingLines,
  trainingLineFieldName,
  trainingLineResolved,
  type TrainingLineEventRow,
  type TrainingLineRow,
  type TrainingSignoffRow,
} from "./trainingLines.ts";

const OWNER = "user-owner";
const MANAGER = "user-manager";

function line(id: string, status = "complete"): TrainingLineRow {
  return { id, user_id: OWNER, status };
}
function signoff(requirementId: string, version = 1, na = false): TrainingSignoffRow {
  return { requirement_id: requirementId, na, signoff_version: version };
}
function initials(requirementId: string, version: number, signer = OWNER, kind = "initials"): TrainingLineEventRow {
  return { field_name: `line:${requirementId}:v${version}`, kind, signer_user_id: signer };
}

test("field name matches the client's versioned line field exactly", () => {
  assert.equal(trainingLineFieldName("req-1", 3), "line:req-1:v3");
  assert.equal(trainingLineFieldName("req-1", 3), clientFieldName("req-1", 3));
});

test("(a) a saved sign-off with no initials event stays open even though the status reads complete", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1"), []), false);
  assert.equal(countOpenTrainingLines([line("r1"), line("r2")], [signoff("r1"), signoff("r2")], []), 2);
});

test("(a) a manager save (unstamped) or a manager's initials never resolve the owner's line", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1"), [initials("r1", 1, MANAGER)]), false);
});

test("(a) a non-initials event on the line field does not resolve it", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1"), [initials("r1", 1, OWNER, "signature")]), false);
});

test("(b) the owner's initials at the current version resolve the line", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1", 2), [initials("r1", 2)]), true);
  assert.equal(
    countOpenTrainingLines(
      [line("r1"), line("r2")],
      [signoff("r1"), signoff("r2")],
      [initials("r1", 1), initials("r2", 1)],
    ),
    0,
  );
});

test("(c) a stale-version stamp does not resolve a corrected line", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1", 2), [initials("r1", 1)]), false);
  assert.equal(
    countOpenTrainingLines([line("r1"), line("r2")], [signoff("r1", 2), signoff("r2")], [initials("r1", 1), initials("r2", 1)]),
    1,
  );
});

test("waived N/A lines are resolved without a stamp; an N/A sign-off on a non-waived line is not", () => {
  assert.equal(trainingLineResolved(line("r1", "waived_na"), signoff("r1", 1, true), []), true);
  assert.equal(trainingLineResolved(line("r1", "waived_na"), undefined, []), true);
  assert.equal(trainingLineResolved(line("r1", "pending"), signoff("r1", 1, true), [initials("r1", 1)]), false);
});

test("a line with no sign-off is open regardless of its status column or stray events", () => {
  assert.equal(trainingLineResolved(line("r1", "complete"), undefined, [initials("r1", 1)]), false);
});

test("another line's stamp does not resolve this line", () => {
  assert.equal(trainingLineResolved(line("r1"), signoff("r1"), [initials("r2", 1)]), false);
});
