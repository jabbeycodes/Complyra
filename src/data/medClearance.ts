/**
 * Medication-administration clearance gate.
 *
 * Simulation batches 40 + 50 (confirmed on desktop and phone): a brand-new
 * hire whose Training status is NOT CLEARED could open a medication chart
 * and record doses — MAR marks, PRN doses, PRN follow-ups, and dose
 * exceptions were all open. Medication administration is the highest-risk
 * action in the app, so it is gated on the SAME clearance computation that
 * renders the NOT CLEARED state: `evaluateInRatioGate`
 * (features/training/gate.ts) as surfaced by
 * `getStaffTrainingProfile().clearedForInRatio` in both APIs. There is no
 * parallel flag and no med-specific clearance model in the codebase — the
 * in-ratio gate is the one clearance source of truth.
 *
 * Who is gated: only the `dsp` role. The in-ratio gate is the new-hire
 * training state for front-line staff; roles whose work is clinical or
 * program oversight (administrator, house_manager, program_manager, nurse,
 * compliance_admin) are never subject to it, cleared or not. A DSP with no
 * training record at all is NOT cleared (`clearedForInRatio` is false when
 * no requirements exist), so an unstarted hire is locked too.
 *
 * Enforcement layers:
 * - UI: the med surfaces consult `useMedAdminLock` and hide/disable the
 *   administration controls, showing MED_ADMIN_CLEARANCE_MESSAGE.
 * - Both APIs refuse the write (LocalApi + HostedApi share this rule).
 * - Database: migration 20261031240000 mirrors the gate in
 *   `private.med_admin_cleared` for the paths a direct PostgREST/RPC call
 *   could otherwise bypass (the record_prn_dose RPC and the dose-table
 *   RLS policies) — the same TS↔SQL mirror pattern the codebase already
 *   uses for MAR corrections (canCorrectDoseMark ↔ med_dose_marks_update).
 *
 * NOT gated: viewing charts/forecasts, and medication counts/deliveries
 * (a supervised inventory task recorded by manager/RN/PM roles).
 */

/** Plain reason shown wherever medication actions are locked. */
export const MED_ADMIN_CLEARANCE_MESSAGE =
  "Medication actions unlock when your training is cleared";

/** Roles subject to the new-hire training gate before administering meds. */
export function roleRequiresMedClearance(roleKey: string): boolean {
  return roleKey === "dsp";
}

/**
 * The lock decision every layer shares.
 *
 * `clearedForInRatio === null` means "clearance not loaded yet" (UI still
 * fetching the profile): not locked — the API gate behind the UI remains
 * the enforcement of record, so a slow profile load never flashes a lock
 * at a cleared DSP and never lets an uncleared write through.
 */
export function medAdminLocked(
  roleKey: string,
  clearedForInRatio: boolean | null,
): boolean {
  return roleRequiresMedClearance(roleKey) && clearedForInRatio === false;
}
