import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarDays, Download, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { Empty, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import {
  nextQaDueDate,
  qaPeriodLabel,
  qaScheduleTone,
  type QaAudit,
  type QaAuditSchedule,
  type QaRankedSite,
} from "../../data/qaAudit";
import QaAuditDetail from "./QaAuditDetail";

function currentQuarter(today = new Date()): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const year = today.getUTCFullYear();
  const quarter = Math.min(4, Math.floor(today.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, quarter };
}

function TrendIcon({ trend }: { trend: number | null }) {
  if (trend === null || trend === 0) return <span className="qa-trend qa-trend--flat">—</span>;
  return trend > 0 ? (
    <span className="qa-trend qa-trend--up">
      <TrendingUp size={16} aria-label={`Up ${trend} points`} /> +{trend}
    </span>
  ) : (
    <span className="qa-trend qa-trend--down">
      <TrendingDown size={16} aria-label={`Down ${Math.abs(trend)} points`} /> {trend}
    </span>
  );
}

export default function QaAuditsPage() {
  const { api, session, workspace, refresh } = useData();
  const [tab, setTab] = useState<"audits" | "schedules" | "ranking">("audits");
  const [audits, setAudits] = useState<QaAudit[]>([]);
  const [schedules, setSchedules] = useState<QaAuditSchedule[]>([]);
  const [ranking, setRanking] = useState<QaRankedSite[]>([]);
  const [openAudit, setOpenAudit] = useState<QaAudit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSiteId, setNewSiteId] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getUTCFullYear()));
  const [newQuarter, setNewQuarter] = useState(String(Math.floor(new Date().getMonth() / 3) + 1));
  const [siteFilter, setSiteFilter] = useState("");
  // Schedule editing state
  const [editingSite, setEditingSite] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editAuditor, setEditAuditor] = useState("");

  const canAudit = can(session!, "qa.audit");
  const canSchedule = can(session!, "qa.schedule");
  const siteName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of workspace?.sites ?? []) map.set(s.id, s.name);
    return (id: string) => map.get(id) ?? "Program site";
  }, [workspace]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [a, s, r] = await Promise.all([
        api.listQaAudits(siteFilter ? { siteId: siteFilter } : undefined),
        api.listQaSchedules(),
        api.getQaSiteRanking(),
      ]);
      setAudits(a);
      setSchedules(s);
      setRanking(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // QA-AUDIT: queue due/overdue reminders once per day on page entry.
    if (can(session!, "qa.schedule")) {
      api.sweepQaScheduleReminders().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteFilter]);

  if (!session) return null;
  const sites = workspace?.sites ?? [];
  const auditors = (workspace?.staff ?? []).filter((s) =>
    ["auditor", "administrator", "compliance_admin"].includes(s.roleKey),
  );

  async function startAudit() {
    if (!newSiteId) return;
    setError("");
    setCreating(true);
    try {
      const audit = await api.createQaAudit(newSiteId, Number(newYear), Number(newQuarter) as 1 | 2 | 3 | 4);
      await refresh();
      setOpenAudit(audit);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function saveSchedule(siteId: string) {
    setError("");
    try {
      await api.upsertQaSchedule({
        siteId,
        nextDue: editDue,
        assignedAuditorId: editAuditor || null,
        assignedAuditorName: auditors.find((a) => a.id === editAuditor)?.name ?? null,
      });
      setEditingSite("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sweepReminders() {
    setError("");
    try {
      const n = await api.sweepQaScheduleReminders();
      await load();
      setError(n === 0 ? "" : `${n} reminder${n === 1 ? "" : "s"} queued.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (openAudit) {
    return (
      <QaAuditDetail
        audit={openAudit}
        siteName={siteName(openAudit.siteId)}
        onBack={() => setOpenAudit(null)}
        onChanged={(updated) => {
          setOpenAudit(updated);
          void load();
        }}
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const { year: cy, quarter: cq } = currentQuarter();

  return (
    <div>
      <PageHeading
        eyebrow="Compliance"
        title="QA audits"
        description="Quarterly quality reviews of every program site. Items Complyrer can prove from its own records are pre-filled and locked; the auditor scores the rest."
      />
      {error && <p className="form-error">{error}</p>}

      <div className="tabs" role="tablist" aria-label="QA audit views">
        {(["audits", "schedules", "ranking"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t === "audits" ? "Audits" : t === "schedules" ? "Schedules" : "Site ranking"}
          </button>
        ))}
      </div>

      {tab === "audits" && (
        <>
          <div className="qa-filter-row">
            <label>
              <span>Site</span>
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {canAudit && (
              <div className="qa-new-audit">
                <label>
                  <span>Site</span>
                  <select value={newSiteId} onChange={(e) => setNewSiteId(e.target.value)}>
                    <option value="">Choose a site…</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Year</span>
                  <input
                    value={newYear}
                    inputMode="numeric"
                    onChange={(e) => setNewYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <label>
                  <span>Quarter</span>
                  <select value={newQuarter} onChange={(e) => setNewQuarter(e.target.value)}>
                    <option value="1">Q1</option>
                    <option value="2">Q2</option>
                    <option value="3">Q3</option>
                    <option value="4">Q4</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={creating || !newSiteId || newYear.length !== 4}
                  onClick={() => void startAudit()}
                >
                  <Plus size={16} /> {creating ? "Starting…" : "Start audit"}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <Empty title="Loading audits…" text="Fetching QA audits." />
          ) : audits.length === 0 ? (
            <Empty
              title="No QA audits yet"
              text="Start the first quarterly audit for a program site above."
            />
          ) : (
            <div className="qa-list">
              {audits.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="qa-row"
                  onClick={() => setOpenAudit(a)}
                >
                  <span className="qa-row-main">
                    <BadgeCheck size={18} aria-hidden />
                    <span>
                      <strong>{siteName(a.siteId)}</strong>
                      <span className="qa-row-sub">
                        {qaPeriodLabel(a.year, a.quarter)} · {a.auditorName ?? "Unassigned"}
                      </span>
                    </span>
                  </span>
                  <span className="qa-row-side">
                    {a.score?.pct !== null && a.score?.pct !== undefined && (
                      <strong className={a.score.criticalFails.length > 0 ? "qa-critical" : ""}>
                        {a.score.pct}%
                      </strong>
                    )}
                    <span className={`qa-status qa-status--${a.status}`}>
                      {a.status === "finalized" ? "Finalized" : "In progress"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "schedules" && (
        <>
          <div className="qa-filter-row">
            <p className="muted">
              One audit per site per quarter by default. Finalizing an audit rolls its
              schedule forward automatically.
            </p>
            {canSchedule && (
              <button type="button" className="button" onClick={() => void sweepReminders()}>
                <CalendarDays size={16} /> Send due reminders
              </button>
            )}
          </div>
          <div className="qa-list">
            {sites.map((s) => {
              const sched = schedules.find((x) => x.siteId === s.id);
              const tone = sched ? qaScheduleTone(sched.nextDue, today) : "current";
              const editing = editingSite === s.id;
              return (
                <div key={s.id} className="qa-row">
                  <span className="qa-row-main">
                    <CalendarDays size={18} aria-hidden />
                    <span>
                      <strong>{s.name}</strong>
                      <span className="qa-row-sub">
                        {sched ? (
                          <>
                            Next due {formatDate(sched.nextDue)}
                            {sched.assignedAuditorName
                              ? ` · Auditor: ${sched.assignedAuditorName}`
                              : " · No auditor assigned"}
                          </>
                        ) : (
                          "No schedule yet"
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="qa-row-side">
                    {sched && tone !== "current" && (
                      <span className={`qa-tone qa-tone--${tone}`}>
                        {tone === "overdue" ? "Overdue" : "Due soon"}
                      </span>
                    )}
                    {canSchedule &&
                      (editing ? (
                        <span className="qa-schedule-edit">
                          <input
                            type="date"
                            value={editDue}
                            onChange={(e) => setEditDue(e.target.value)}
                            aria-label="Next due date"
                          />
                          <select
                            value={editAuditor}
                            onChange={(e) => setEditAuditor(e.target.value)}
                            aria-label="Assigned auditor"
                          >
                            <option value="">No auditor</option>
                            {auditors.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="button primary"
                            disabled={!editDue}
                            onClick={() => void saveSchedule(s.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setEditingSite("")}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            setEditingSite(s.id);
                            setEditDue(
                              sched?.nextDue ?? nextQaDueDate(`${cy}-${String(cq * 3).padStart(2, "0")}-01`),
                            );
                            setEditAuditor(sched?.assignedAuditorId ?? "");
                          }}
                        >
                          {sched ? "Edit" : "Schedule"}
                        </button>
                      ))}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "ranking" && (
        <>
          <p className="muted">
            Program sites ordered by their latest QA score. Ties break by improvement
            trend, then fewer critical failures.
          </p>
          {loading ? (
            <Empty title="Loading ranking…" text="Computing site scores." />
          ) : (
            <div className="qa-list">
              {ranking.map((r) => (
                <div key={r.siteId} className="qa-row">
                  <span className="qa-row-main">
                    <span className="qa-rank">#{r.rank}</span>
                    <span>
                      <strong>{r.siteName}</strong>
                      <span className="qa-row-sub">
                        {r.finalizedAt
                          ? `Last audit ${formatDate(r.finalizedAt.slice(0, 10))}`
                          : "Never audited"}
                        {r.criticalFails > 0 &&
                          ` · ${r.criticalFails} critical failure${r.criticalFails === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </span>
                  <span className="qa-row-side">
                    <TrendIcon trend={r.trend} />
                    <strong className={r.criticalFails > 0 ? "qa-critical" : ""}>
                      {r.score === null ? "—" : `${r.score}%`}
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="qa-record-mark">
        <Download size={14} aria-hidden /> Digital record generated by Complyrer
      </div>
    </div>
  );
}
