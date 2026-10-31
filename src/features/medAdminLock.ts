/**
 * UI half of the medication-administration clearance gate
 * (see ../data/medClearance). Returns true only when the signed-in user
 * is a DSP whose own training profile has loaded and is NOT cleared —
 * the exact state the Training page renders as NOT CLEARED. While the
 * profile is loading (or if it fails to load) the controls stay as they
 * were: the API gate is the enforcement of record, so an uncleared write
 * still cannot land, and a cleared DSP never sees a false lock flash.
 */
import { useEffect, useState } from "react";
import type { ComplyraApi } from "../data/localApi";
import type { SessionUser } from "../data/types";
import { medAdminLocked, roleRequiresMedClearance } from "../data/medClearance";

export function useMedAdminLock(
  api: ComplyraApi,
  session: SessionUser | null,
): boolean {
  const userId = session?.userId ?? null;
  const roleKey = session?.roleKey ?? null;
  const [cleared, setCleared] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId || !roleKey || !roleRequiresMedClearance(roleKey)) {
      setCleared(null);
      return;
    }
    let live = true;
    setCleared(null);
    api
      .getStaffTrainingProfile(userId)
      .then((profile) => {
        if (live) setCleared(profile.clearedForInRatio);
      })
      .catch(() => {
        // Leave clearance unknown: controls render as before and the API
        // refuses an uncleared write with the plain reason.
        if (live) setCleared(null);
      });
    return () => {
      live = false;
    };
  }, [api, userId, roleKey]);

  return medAdminLocked(roleKey ?? "", cleared);
}
