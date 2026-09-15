import { useEffect, useMemo, useState } from "react";
import { Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import type {
  IspShiftAssignment,
  IspShiftPattern,
} from "../../data/types";
import "./ispData.css";

const STANDARD_PATTERNS = [
  { name: "Day", startTime: "07:00", endTime: "15:00", sortOrder: 1 },
  { name: "Evening", startTime: "15:00", endTime: "23:00", sortOrder: 2 },
  { name: "Night", startTime: "23:00", endTime: "07:00", sortOrder: 3 },
];

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ShiftAssignments({
  siteId,
  siteName,
  siteStaff,
}: {
  siteId: string;
  siteName: string;
  siteStaff: { id: string; name: string }[];
}) {
  const isp = useIspApi();
  const { session } = useData();
  const [weekStart, setWeekStart] = useState(mondayOf(todayIso()));
  const [patterns, setPatterns] = useState<IspShiftPattern[]>([]);
  const [assignments, setAssignments] = useState<IspShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<
    Record<string, { userId: string } | undefined>
  >({});

  const canEdit =
    !!session &&
    (can(session, "isp.manage_plan") || session.roleKey === "house_manager");
  // Shift patterns themselves are DPM/admin-owned: an HM can staff their
  // house's shifts but cannot create the shift patterns.
  const canSeedPatterns = !!session && can(session, "isp.manage_plan");

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)),
    [weekStart],
  );

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [pats, assigns] = await Promise.all([
        isp.ispListShiftPatterns(siteId),
        isp.ispListShiftAssignments(siteId, weekStart, addDaysIso(weekStart, 6)),
      ]);
      setPatterns(pats.filter((p) => p.active));
      setAssignments(assigns);
      setPending({});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load assignments.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, weekStart]);

  const assignmentByCell = useMemo(() => {
    const map = new Map<string, IspShiftAssignment[]>();
    for (const a of assignments) {
      const key = `${a.shiftPatternId}|${a.workDate}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [assignments]);

  async function seedStandard() {
    setBusy(true);
    setError("");
    try {
      for (const p of STANDARD_PATTERNS) {
        await isp.ispSaveShiftPattern({ siteId, ...p });
      }
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not seed shift patterns.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addAssignment(patternId: string, workDate: string) {
    const pick = pending[`${patternId}|${workDate}`];
    if (!pick?.userId) return;
    setBusy(true);
    try {
      const saved = await isp.ispSaveShiftAssignment({
        siteId,
        shiftPatternId: patternId,
        workDate,
        userId: pick.userId,
      });
      setAssignments((prev) => [...prev, saved]);
      setPending((prev) => ({ ...prev, [`${patternId}|${workDate}`]: undefined }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the assignment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(id: string) {
    setBusy(true);
    try {
      await isp.ispDeleteShiftAssignment(id);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not remove the assignment.",
      );
    } finally {
      setBusy(false);
    }
  }

  const staffName = (id: string) =>
    siteStaff.find((s) => s.id === id)?.name ?? "Unknown";

  if (loading) return <div className="isp-panel">Loading scheduling…</div>;

  return (
    <div className="isp-wrap">
      <div className="isp-panel">
        <h3>Scheduling — {siteName}</h3>
        <p className="isp-sub">
          Assign staff to each shift pattern for the week. Note expectations
          are created automatically for every individual in the home.
          {!canEdit && " Your role can view this schedule but not change it."}
        </p>
        <div className="isp-picker-row">
          <label>
            Week of
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(mondayOf(e.target.value))}
              style={{ minHeight: 44 }}
            />
          </label>
          <div className="isp-btn-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="isp-btn"
              onClick={() => setWeekStart(mondayOf(todayIso()))}
            >
              This week
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
            {error}
          </p>
        )}

        {patterns.length === 0 ? (
          <div style={{ marginTop: 16 }}>
            <Empty
              title="No shift patterns"
              text="This home has no shift patterns yet. Seed the standard Day / Evening / Night pattern, or ask your DPM to add custom ones."
            />
            {canSeedPatterns && (
              <div className="isp-btn-row">
                <button
                  type="button"
                  className="isp-btn primary"
                  onClick={() => void seedStandard()}
                  disabled={busy}
                >
                  Use standard Day / Evening / Night
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="isp-table-wrap" style={{ marginTop: 16 }}>
            <table className="isp-table">
              <thead>
                <tr>
                  <th>Shift</th>
                  {weekDays.map((d) => (
                    <th key={d}>
                      {new Date(`${d}T00:00:00Z`).toLocaleDateString(
                        undefined,
                        { weekday: "short" },
                      )}
                      <br />
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patterns.map((p) => (
                  <tr key={p.id}>
                    <th>
                      {p.name}
                      <br />
                      <span style={{ fontWeight: 400, fontSize: 13 }}>
                        {p.startTime}–{p.endTime}
                      </span>
                    </th>
                    {weekDays.map((d) => {
                      const key = `${p.id}|${d}`;
                      const cells = assignmentByCell.get(key) ?? [];
                      return (
                        <td key={d}>
                          <div className="isp-list">
                            {cells.map((a) => (
                              <span
                                key={a.id}
                                className="isp-sig-row"
                                style={{ gap: 6 }}
                              >
                                <span className="isp-badge">
                                  {staffName(a.userId)}
                                </span>
                                {canEdit && (
                                  <button
                                    type="button"
                                    className="isp-btn"
                                    style={{
                                      minHeight: 44,
                                      padding: "6px 10px",
                                    }}
                                    onClick={() => void removeAssignment(a.id)}
                                    disabled={busy}
                                    aria-label={`Remove ${staffName(a.userId)} from ${p.name} on ${d}`}
                                  >
                                    Remove
                                  </button>
                                )}
                              </span>
                            ))}
                            {canEdit && (
                              <span
                                className="isp-sig-row"
                                style={{ gap: 6 }}
                              >
                                <select
                                  aria-label={`Staff for ${p.name} on ${d}`}
                                  value={pending[key]?.userId ?? ""}
                                  onChange={(e) =>
                                    setPending((prev) => ({
                                      ...prev,
                                      [key]: { userId: e.target.value },
                                    }))
                                  }
                                  style={{ minHeight: 44, maxWidth: 140 }}
                                >
                                  <option value="">Add…</option>
                                  {siteStaff.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="isp-btn"
                                  style={{
                                    minHeight: 44,
                                    padding: "6px 10px",
                                  }}
                                  onClick={() => void addAssignment(p.id, d)}
                                  disabled={busy || !pending[key]?.userId}
                                >
                                  Add
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
