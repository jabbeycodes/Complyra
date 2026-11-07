/**
 * Server-side training-line eligibility (Wave 4B fix-up, PR #259 HOLD).
 *
 * A training line is RESOLVED for an authorization decision (the staff_sign /
 * hm_countersign open-line count here, private.med_admin_cleared in SQL) only
 * when:
 *   - it is waived N/A (status 'waived_na'), or
 *   - it carries a non-N/A sign-off AND the line's OWNER has stamped an
 *     e-initials event for that sign-off's CURRENT version: field
 *     `line:<requirementId>:v<signoffVersion>`, kind 'initials', signed by the
 *     requirement's user_id, on the sheet `staff:<userId>:<siteId>`.
 *
 * training_requirements.status = 'complete' alone is NOT enough: migration
 * 20261105120000 completes the column as soon as a sign-off is written, and
 * the e-initials stamp lands after that write (or never — a manager save, a
 * failed / timed-out stamp, a dropped connection). That state is "Needs
 * re-initialing" in the UI and must not clear anyone server-side.
 *
 * Pure so the rule is unit-tested in Node; the SQL twin is
 * private.training_line_initialed in 20261105120000.
 */

export interface TrainingLineRow {
  id: string;
  user_id: string;
  status: string;
}

export interface TrainingSignoffRow {
  requirement_id: string;
  na: boolean;
  signoff_version: number;
}

export interface TrainingLineEventRow {
  field_name: string;
  kind: string;
  signer_user_id: string;
}

export function trainingLineFieldName(requirementId: string, version: number): string {
  return `line:${requirementId}:v${version}`;
}

/** True when the line counts as done for clearance / sheet signing. */
export function trainingLineResolved(
  line: TrainingLineRow,
  signoff: TrainingSignoffRow | undefined,
  events: TrainingLineEventRow[],
): boolean {
  if (line.status === "waived_na") return true;
  if (!signoff || signoff.na) return false;
  const field = trainingLineFieldName(line.id, signoff.signoff_version);
  return events.some(
    (event) =>
      event.field_name === field &&
      event.kind === "initials" &&
      event.signer_user_id === line.user_id,
  );
}

/** Number of lines NOT resolved under trainingLineResolved. */
export function countOpenTrainingLines(
  lines: TrainingLineRow[],
  signoffs: TrainingSignoffRow[],
  events: TrainingLineEventRow[],
): number {
  const signoffByLine = new Map(signoffs.map((row) => [row.requirement_id, row]));
  return lines.filter(
    (line) => !trainingLineResolved(line, signoffByLine.get(line.id), events),
  ).length;
}
