import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, RefreshCw } from "lucide-react";
import { Badge, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import "./hmChecklist.css";
import { downloadBlob } from "../../data/openFile";
import { todayIso } from "../../data/chart";
import type { HmWeeklyChecklist } from "../../data/types";
import {
  CHECKLIST_DEADLINE_TEXT,
  deadlineMondayIso,
  deadlinePassed,
  formatShortDate,
  weekOfSundayIso,
  weekRangeLabel,
} from "../../data/hmChecklist";

function statusBadge(status: HmWeeklyChecklist["status"]) {
  if (status === "open") return "Open";
  if (status === "submitted") return "Submitted";
  if (status === "overdue") return "Overdue";
  return "Locked";
}

/** Sundays for the week picker: 3 past, current, 1 future. */
function weekOptions(): string[] {
  const current = weekOfSundayIso(todayIso());
  const [y, m, d] = current.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  return [-3, -2, -1, 0, 1].map((offset) => {
    const d2 = new Date(base);
    d2.setUTCDate(d2.getUTCDate() + offset * 7);
    return d2.toISOString().slice(0, 10);
  });
}

export default function ChecklistAssigner() {
  const { api, session, workspace, refresh } = useData();
  const [lists, setLists] = useState<HmWeeklyChecklist[]>([]);
  const [week, setWeek] = useState(weekOfSundayIso(todayIso()));
  const [siteId, setSiteId] = useState("");
  const [hmUserId, setHmUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const hms = useMemo(
    () => workspace?.staff.filter((s) => s.roleKey === "house_manager") ?? [],
    [workspace],
  );
  const weeks = useMemo(weekOptions, []);
  const bySite = useMemo(() => {
    const map = new Map<string, HmWeeklyChecklist>();
    for (const c of lists) {
      if (c.weekOf === week) map.set(c.siteId, c);
    }
    return map;
  }, [lists, week]);
  const hmName = (userId: string) =>
    workspace?.staff.find((s) => s.id === userId)?.name ?? "—";
  const pastDue = deadlinePassed(week);

  async function load(nextWeek = week) {
    setError("");
    try {
      const rows = await api.listWeeklyChecklists({ weekOf: nextWeek });
      setLists(rows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session || !workspace) return null;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await refresh();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function download(checklistId: string) {
    const file = await api.exportWeeklyChecklistPdf(checklistId);
    downloadBlob(file.name, file.blob);
  }

  return (
    <div aria-labelledby="checklist-assigner-heading">
      <PageHeading
        title="Checklist assignments"
        description="Assign the weekly checklist to house managers. It auto-renews every Sunday; the prior week locks. Turn in Monday by 4pm."
      />
      {error && <p className="form-error">{error}</p>}

      <section className="panel" aria-label="Assign a checklist">
        <div className="panel-heading">
          <div>
            <h2 id="checklist-assigner-heading">New assignment</h2>
            <p>Only house managers can receive a checklist.</p>
          </div>
        </div>
        <div className="form-row">
          <label>
            Home
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Select a home…</option>
              {workspace.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            House manager
            <select
              value={hmUserId}
              onChange={(e) => setHmUserId(e.target.value)}
            >
              <option value="">Select an HM…</option>
              {hms.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.site ? ` · ${s.site}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Week (Sunday)
            <select value={week} onChange={(e) => { setWeek(e.target.value); setLoading(true); load(e.target.value); }}>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {weekRangeLabel(w)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel-actions">
          <button
            className="button primary"
            disabled={!siteId || !hmUserId || !week}
            onClick={() =>
              run(() =>
                api.assignWeeklyChecklist({ siteId, hmUserId, weekOf: week }),
              )
            }
          >
            <ClipboardList size={16} /> Assign checklist
          </button>
          <button
            className="button secondary"
            onClick={() =>
              run(async () => {
                const result = await api.rolloverWeeklyChecklists();
                setNotice(
                  result.created === 0 && result.locked === 0
                    ? "Rollover ran — everything is already current."
                    : `Rollover complete: ${result.created} opened, ${result.locked} locked overdue.`,
                );
              })
            }
          >
            <RefreshCw size={16} /> Run weekly rollover
          </button>
        </div>
        {notice && <p className="muted">{notice}</p>}
      </section>

      <section className="panel" aria-label="Assignment status board">
        <div className="panel-heading">
          <div>
            <h2>Status · week of {weekRangeLabel(week)}</h2>
            <p>
              {CHECKLIST_DEADLINE_TEXT} (
              {formatShortDate(deadlineMondayIso(week))})
              {pastDue ? " — deadline passed" : ""}
            </p>
          </div>
        </div>
        {loading && <p>Loading…</p>}
        {!loading && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Home</th>
                  <th>Assigned HM</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workspace.sites.map((site) => {
                  const c = bySite.get(site.id);
                  return (
                    <tr key={site.id}>
                      <td>{site.name}</td>
                      <td>{c ? hmName(c.assignedToUserId) : "—"}</td>
                      <td>
                        {c ? (
                          <Badge
                            status={
                              c.status === "open" && pastDue
                                ? "Overdue"
                                : statusBadge(c.status)
                            }
                          />
                        ) : (
                          <span className="muted">Not assigned</span>
                        )}
                      </td>
                      <td>
                        {c?.submittedAt
                          ? formatShortDate(c.submittedAt.slice(0, 10))
                          : "—"}
                      </td>
                      <td>
                        {c && (
                          <button
                            className="button secondary small"
                            onClick={() => run(() => download(c.id))}
                          >
                            <Download size={14} /> PDF
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
