import { useEffect, useState } from "react";
import type { StaffTrainingProfile } from "../../data/types";

/**
 * Scheduling clearance warning (simulation batch 59): an uncleared DSP
 * could be put on a shift with nothing said. Assignment surfaces warn —
 * they never block: trainees legitimately shadow shifts, and the hard
 * gate lives on medication actions (medClearance, PR #215). The warning
 * uses the SAME clearance computation as the training profile:
 * getStaffTrainingProfile().clearedForInRatio, which the APIs derive
 * from evaluateInRatioGate in ./gate.
 */
export const CLEARANCE_WARNING_TEXT =
  "Not training-cleared yet: this staff member has not finished the training clearance to work alone (in-ratio). You can still assign this shift — for example to shadow a cleared staff member — but medication actions stay locked until they are cleared.";

/**
 * Pure rule, pinned by tests: warn only for a DSP whose loaded training
 * profile says not cleared. No profile yet (still loading or failed)
 * shows nothing — a warning must never flash on a cleared staffer.
 * Nurses, house managers, and every other role are never warned.
 */
export function clearanceWarningFor(
  profile: Pick<StaffTrainingProfile, "clearedForInRatio"> | null | undefined,
  roleKey: string | null | undefined,
): string | null {
  if (roleKey !== "dsp") return null;
  if (!profile) return null;
  return profile.clearedForInRatio ? null : CLEARANCE_WARNING_TEXT;
}

interface TrainingProfileApi {
  getStaffTrainingProfile(userId: string): Promise<StaffTrainingProfile>;
}

/**
 * Loads the assignee's training profile when (and only when) the
 * assignee is a DSP, and returns the warning to show beside the picker.
 */
export function useAssigneeClearanceWarning(
  api: TrainingProfileApi | null | undefined,
  assigneeUserId: string | null | undefined,
  assigneeRoleKey: string | null | undefined,
): string | null {
  const [profile, setProfile] = useState<StaffTrainingProfile | null>(null);
  const shouldFetch = Boolean(api && assigneeUserId && assigneeRoleKey === "dsp");
  useEffect(() => {
    setProfile(null);
    if (!shouldFetch || !api || !assigneeUserId) return;
    let cancelled = false;
    api
      .getStaffTrainingProfile(assigneeUserId)
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, assigneeUserId, shouldFetch]);
  return clearanceWarningFor(profile, assigneeRoleKey);
}
