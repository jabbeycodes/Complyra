/**
 * The signed-in person's own shift today, for the mobile home's "Your
 * shift" strip. One read of the accountability engine over today's
 * Central window at the picked home; a failed read hides the strip
 * rather than picturing numbers that were not actually read (the same
 * rule the tracking hook follows). Refetches when the shell returns to
 * the home view, via the shared refresh key.
 */
import { useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { zonedWallTimeMs } from "../../data/dueItems";
import type { ShiftAccountability } from "../../data/shiftAccountability";
import { addIsoDays } from "../coverage/coverageWeek";
import { centralTodayIso } from "./mar";
import { pickYourShift } from "./scheduling";

export function useYourShift(input: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string | null;
  refreshKey: number;
}): { acc: ShiftAccountability | null } {
  const { api, session, siteId, refreshKey } = input;
  const [acc, setAcc] = useState<ShiftAccountability | null>(null);

  useEffect(() => {
    if (!siteId) {
      setAcc(null);
      return;
    }
    let live = true;
    void (async () => {
      const todayIso = centralTodayIso();
      const fromIso = new Date(
        zonedWallTimeMs(todayIso, 0, "America/Chicago"),
      ).toISOString();
      const toIso = new Date(
        zonedWallTimeMs(addIsoDays(todayIso, 1), 0, "America/Chicago"),
      ).toISOString();
      const rows = await api
        .getShiftAccountability(siteId, fromIso, toIso)
        .catch(() => [] as ShiftAccountability[]);
      if (!live) return;
      setAcc(pickYourShift(rows, session.userId, todayIso, new Date()));
    })();
    return () => {
      live = false;
    };
  }, [api, session, siteId, refreshKey]);

  return { acc };
}
