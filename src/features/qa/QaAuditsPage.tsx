import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarDays, Download, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { Empty, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  CORRECTIVE_ACTION_STATUS_META,
  deriveCorrectiveActionStatus,
  sortCorrectiveActions,
  type CorrectiveAction,
} from "../../data/correctiveActions";
import { can } from "../../data/status";
import { isAgencyWideViewer } from "../../data/dashboard";
import {
  nextQaDueDate,
  qaPeriodLabel,
  qaScheduleTone,
  type QaAudit,
  type QaAuditSchedule,
  type QaRankedSite,
} from "../../data/qaAudit";
import QaAuditDetail from "./QaAuditDetail";
import { loadQaPageData } from "./qaLoad";

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
  const [tab, setTab] = useState<"audits" | "schedules" | "ranking" | "actions">("audits");
  const [audits, setAudits] = useState<QaAudit[]>([]);
  const [schedules, setSchedules] = useState<QaAuditSchedule[]>([]);
  const [ranking, setRanking] = useState<QaRankedSite[]>([]);
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionSiteId, setActionSiteId] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [openAudit, setOpenAudit] = useState<QaAudit | null>(null);
  const [error, setError] = useState("");
  const [sideError, setSideError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSiteId, setNewSiteId] = useState("");
  const [newYear, setNewYear] = useState(String(new Date().getUTCFullYear()));
  const [newQuarter, setNewQuarter] = useState(String(currentQuarter().quarter));
  const [siteFilter, setSiteFilter] = useState("");
  // Schedule editing state
  const [editingSite, setEditingSite] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editAuditor, setEditAuditor] = useState("");

  const canAudit = can(session!, "qa.audit");
  const canSchedule = can(session!, "qa.schedule");
  const canManageActions = can(session!, "correctiveActions.manage");
  // Corrective actions belong to a home (site scope): the create form
  // names the home, and the assignee picker offers only staff whose
  // home that is. Agency-wide managers may also file agency-level
  // actions (no home). The API enforces the same rule server-side.
  const agencyWide = session ? isAgencyWideViewer(session) : false;
  const siteOptions = workspace?.sites ?? [];
  const assigneeOptions = (workspace?.staff ?? []).filter(
    (person) => !actionSiteId || person.siteId === actionSiteId,
  );

  useEffect(() => {
    if (actionSiteId || agencyWide || siteOptions.length === 0) return;
    const home =
      session?.siteId && siteOptions.some((s) => s.id === session.siteId)
        ? session.siteId
        : siteOptions[0].id;
    setActionSiteId(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteOptions.length, agencyWide]);
  const siteName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of workspace?.sites ?? []) map.set(s.id, s.name);
    return (id: string) => map.get(id) ?? "Program site";
  }, [workspace]);

  // The Reviews list loads on its own. Schedules and ranking are
  // heavier, separate reads: under the old Promise.all, a slow or failed
  // ranking call held the whole page on "Loading…" and then blanked the
  // Reviews tab behind one error (simulation batch 16 — QA Review read
  // empty and slow even though reviews existed). Their failures now
  // degrade only their own tabs.
  async function load() {
    setLoading(true);
    setError("");
    setSideError("");
    try {
      const data = await loadQaPageData({
        listAudits: () =>
          api.listQaAudits(siteFilter ? { siteId: siteFilter } : undefined),
        listSchedules: () => api.listQaSchedules(),
        getRanking: () => api.getQaSiteRanking(),
        listCorrectiveActions: () => api.listCorrectiveActions(),
      });
      setAudits(data.audits);
      setActions(sortCorrectiveActions(data.correctiveActions, new Date()));
      if (data.schedules) setSchedules(data.schedules);
      if (data.ranking) setRanking(data.ranking);
      if (!data.schedules || !data.ranking) {
        setSideError("Schedules or site ranking could not be loaded.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // QA-REVIEW: queue due/overdue reminders once per day on page entry.
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

  async function addAction(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setActionBusy(true);
    try {
      await api.addCorrectiveAction({
        title: actionTitle,
        description: actionDescription || null,
        siteId: actionSiteId || null,
        assignedToUserId: actionAssignee || null,
        dueOn: actionDue || null,
      });
      setActionTitle("");
      setActionDescription("");
      setActionAssignee("");
      setActionDue("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function resolveAction(id: string) {
    setError("");
    try {
      await api.resolveCorrectiveAction(id);
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
        title="QA Review"
        description="Quarterly quality reviews of every program site. Items Complyrer can prove from its own records are pre-filled and locked; the auditor scores the rest."
      />
      {error && <p className="form-error">{error}</p>}
      {sideError && tab !== "audits" && (
        <p className="form-error">{sideError}</p>
      )}

      <div className="tabs" role="tablist" aria-label="QA Review views">
        {(["audits", "schedules", "ranking", "actions"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t === "audits"
              ? "Reviews"
              : t === "schedules"
                ? "Schedules"
                : t === "ranking"
                  ? "Site ranking"
                  : "Corrective actions"}
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
                  <span>Site for new review</span>
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
                  <Plus size={16} /> {creating ? "Starting…" : "Start review"}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <Empty title="Loading QA reviews…" text="Fetching QA reviews." />
          ) : audits.length === 0 ? (
            <Empty
              title="No QA reviews yet"
              text="Start the first quarterly QA review for a program site above."
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

      {tab === "actions" && (
        <>
          <p className="muted">
            Follow-up actions raised from QA findings. An action names an owner and a
            due date; it stays open until a manager resolves it.
          </p>
          {canManageActions ? (
            <form className="qa-new-audit" onSubmit={(e) => void addAction(e)}>
              <label>
                <span>Action title</span>
                <input
                  type="text"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="e.g. Re-train night shift on incident reporting"
                  minLength={3}
                  required
                />
              </label>
              <label>
                <span>Description</span>
                <input
                  type="text"
                  value={actionDescription}
                  onChange={(e) => setActionDescription(e.target.value)}
                  placeholder="What needs to happen (optional)"
                />
              </label>
              <label>
                <span>Home</span>
                <select
                  value={actionSiteId}
                  onChange={(e) => {
                    setActionSiteId(e.target.value);
                    setActionAssignee("");
                  }}
                >
                  {agencyWide && <option value="">Agency-wide (no home)</option>}
                  {siteOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Assign to</span>
                <select
                  value={actionAssignee}
                  onChange={(e) => setActionAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} — {person.site}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Due date</span>
                <input
                  type="date"
                  value={actionDue}
                  onChange={(e) => setActionDue(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="button primary"
                disabled={actionBusy || actionTitle.trim().length < 3}
              >
                <Plus size={16} /> {actionBusy ? "Adding…" : "Add corrective action"}
              </button>
            </form>
          ) : (
            <p className="muted">
              You can view corrective actions. An authorized manager can assign and
              resolve them.
            </p>
          )}
          {loading ? (
            <Empty title="Loading corrective actions…" text="Fetching corrective actions." />
          ) : actions.length === 0 ? (
            <Empty
              title="No corrective actions yet"
              text={
                canManageActions
                  ? "Add the first corrective action above when a QA finding needs follow-up."
                  : "No corrective actions are on record for your view."
              }
            />
          ) : (
            <div className="qa-list">
              {actions.map((action) => {
                const status = deriveCorrectiveActionStatus(action, new Date());
                const meta = CORRECTIVE_ACTION_STATUS_META[status];
                return (
                  <div key={action.id} className="qa-row">
                    <span className="qa-row-main">
                      <span className={`qa-status qa-status--${status}`}>
                        <span aria-hidden="true">{meta.icon}</span> {meta.label}
                      </span>
                      <span>
                        <strong>{action.title}</strong>
                        <span className="qa-row-sub">
                          {action.assignedToName ? `Owner: ${action.assignedToName}` : "Unassigned"}
                          {action.siteId ? ` · ${siteName(action.siteId)}` : " · Agency-wide"}
                          {action.dueOn ? ` · Due ${formatDate(action.dueOn)}` : " · No due date"}
                          {action.description ? ` · ${action.description}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="qa-row-side">
                      {canManageActions && status !== "resolved" && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => void resolveAction(action.id)}
                        >
                          Resolve
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
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
