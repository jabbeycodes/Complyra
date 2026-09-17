import { useCallback, useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type {
  IspProgramView,
  IspScoringMethod,
  ShiftNoteView,
} from "../../data/shiftNotes";

export interface IspChartData {
  programs: IspProgramView[];
  scoringMethods: IspScoringMethod[];
  notes: ShiftNoteView[];
}

/**
 * Issue #80 — loads one Individual's ISP programs (approve-gated by role),
 * agency scoring methods, and recent shift notes. Sections reload after every
 * mutation so config and entry never drift.
 */
export function useIspData(
  api: ComplyraApi,
  individualId: string,
  enabled: boolean,
): {
  data: IspChartData | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<IspChartData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setData(await api.getIspData(individualId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, individualId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

/** The plan year staff note against: the current calendar year. */
export function currentPlanYear(): string {
  return String(new Date().getFullYear());
}
