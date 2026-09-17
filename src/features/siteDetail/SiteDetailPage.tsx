import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CarFront,
  ClipboardCheck,
  Download,
  FileText,
  GraduationCap,
  MapPin,
  Phone,
  Pill,
  Printer,
  User,
  Users,
} from "lucide-react";
import { Avatar, Badge, Empty, formatDate } from "../../components";
import StatusMixDonut from "../../components/StatusMixDonut";
import { useData } from "../../data/DataProvider";
import { can, pageVisible } from "../../data/status";
import { canAccessSite, individualsAtSite } from "../../data/dashboard";
import { metrics } from "../../domain";
import { QA_SECTIONS, type QaAudit } from "../../data/qaAudit";
import { SERVICE_TYPE_LABELS } from "../../data/siteReview";
import { agencyStateCode, siteHeroAddressLine } from "../../data/siteAddress";
import { SERVICE_LOG_KIND_LABELS } from "../../data/hmChecklist";
import { openPrintable } from "../../data/openFile";
import { monthKeyOf, monthLabel } from "../../data/mileage";
import { inventoryCountdownLabel } from "../../data/medInventory";
import { todayIso } from "../../data/chart";
import { sortOpenRequirements, trainingProgressLine } from "./siteDetailCopy";
import type { QaAuditSummary } from "../../data/localApi";
import type {
  HmWeeklyChecklist,
  MedSupplyStatus,
  MileageTripView,
  ServiceLogEntry,
  StaffCertificate,
  StaffTrainingProfile,
} from "../../data/types";
import type { SiteDelegationActivation } from "../../delegation/delegation";
import type { SiteShiftNoteView } from "../../data/shiftNotes";
import { getSiteDetailTabs, canSeeSiteChecklists, canSeeSiteDrills, type SiteDetailTabId } from "./siteTabs";
import SiteDrillsSchedule from "./SiteDrillsSchedule";
import SiteQaReview from "../qa/SiteQaReview";
import SiteMonthlyChecks from "../SiteMonthlyChecks";
import "./siteDetail.css";

interface SiteDetailPageProps {
  siteId: string;
  onBack: () => void;
  onOpenIndividual: (name: string) => void;
  /** Open the matching full page so site tabs stay a summary, not a gutted copy. */
  onOpenPage?: (page: string) => void;
}

/** Defensive read of the finalized score snapshot (shape owned by the audit workflow). */
export function auditScoreDisplay(scoreJson: unknown): string | null {
  if (typeof scoreJson === "number" && Number.isFinite(scoreJson)) {
    return `${Math.round(scoreJson)}%`;
  }
  if (scoreJson && typeof scoreJson === "object") {
    const o = scoreJson as Record<string, unknown>;
    for (const key of ["overall", "overallScore", "percent", "score"]) {
      const v = o[key];
      if (typeof v === "number" && Number.isFinite(v)) return `${Math.round(v)}%`;
    }
  }
  return null;
}

export function auditPeriodLabel(
  audit: QaAuditSummary | { quarter: number; year: number },
): string {
  return `Q${audit.quarter} ${audit.year}`;
}

const TAB_ICONS: Record<SiteDetailTabId, typeof Building2> = {
  overview: Building2,
  individuals: User,
  audits: ClipboardCheck,
  checklists: ClipboardCheck,
  training: GraduationCap,
  medications: Pill,
  mileage: CarFront,
  shiftnotes: FileText,
  staff: Users,
};

interface TrainingRow {
  userId: string;
  name: string;
  role: string;
  profile: StaffTrainingProfile | null;
  expiringCerts: StaffCertificate[];
  failed: boolean;
}

export default function SiteDetailPage({
  siteId,
  onBack,
  onOpenIndividual,
  onOpenPage,
}: SiteDetailPageProps) {
  const { api, session, workspace } = useData();
  const tabs = useMemo(() => getSiteDetailTabs(session), [session]);
  const [tab, setTab] = useState<SiteDetailTabId>("overview");
  const [month, setMonth] = useState(() => monthKeyOf(todayIso()));
  // Issue #94: month filters for the rebuilt Checklists tab.
  const [checklistMonth, setChecklistMonth] = useState<string | "all">("all");
  const [serviceLogMonth, setServiceLogMonth] = useState<string | "all">("all");
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");

  const [qaHistory, setQaHistory] = useState<QaAudit[] | null>(null);
  const [checklists, setChecklists] = useState<HmWeeklyChecklist[] | null>(null);
  const [delegations, setDelegations] = useState<SiteDelegationActivation[] | null>(null);
  const [trainingRows, setTrainingRows] = useState<TrainingRow[] | null>(null);
  const [medStatus, setMedStatus] = useState<MedSupplyStatus | null>(null);
  const [trips, setTrips] = useState<MileageTripView[] | null>(null);
  const [siteNotes, setSiteNotes] = useState<SiteShiftNoteView[] | null>(null);
  const [loading, setLoading] = useState<Partial<Record<SiteDetailTabId, boolean>>>({});
  const [tabError, setTabError] = useState<Partial<Record<SiteDetailTabId, string>>>({});

  const site = workspace?.sites.find((s) => s.id === siteId) ?? null;
  const siteName = site?.name ?? "";
  const siteAddressLine = site
    ? siteHeroAddressLine({
        name: site.name,
        address: site.address,
        city: site.city,
        zip: site.zip,
        stateCode: agencyStateCode(null, session?.agencyCode),
      })
    : "";
  const siteIndividuals = useMemo(
    () => individualsAtSite(workspace?.individuals ?? [], site),
    [workspace, site],
  );
  const siteStaff = useMemo(
    () => (workspace?.staff ?? []).filter((s) => s.siteId === siteId),
    [workspace, siteId],
  );
  const openRequirements = useMemo(
    () =>
      (workspace?.requirements ?? []).filter(
        (r) => r.site === siteName && r.status !== "Compliant",
      ),
    [workspace, siteName],
  );
  const siteDrills = useMemo(
    () =>
      (workspace?.monthly?.drills ?? [])
        .filter((d) => d.siteId === siteId)
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [workspace, siteId],
  );

  const hasAccess = !!session && !!site && !!workspace && canAccessSite(session, siteId);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? "overview";

  const loadTab = useCallback(
    async (tabId: SiteDetailTabId, monthKey: string) => {
      if (!hasAccess) return;
      setLoading((prev) => ({ ...prev, [tabId]: true }));
      setTabError((prev) => ({ ...prev, [tabId]: undefined }));
      try {
        if (tabId === "overview" || tabId === "audits") {
          if (qaHistory === null) {
            // Latest finalized QA Review scores power the Overview badge.
            // Read-gated: no audit.read, no score.
            if (
              session &&
              (can(session, "audit.read") ||
                can(session, "qa.audit") ||
                can(session, "audit.export"))
            ) {
              try {
                setQaHistory(await api.getQaSiteHistory(siteId));
              } catch {
                setQaHistory([]);
              }
            } else {
              setQaHistory([]);
            }
          }
        }
        if (tabId === "checklists" && checklists === null) {
          setChecklists(await api.listWeeklyChecklists({ siteId }));
        }
        if (tabId === "training") {
          if (delegations === null) {
            setDelegations(await api.listSiteDelegationActivations({ siteId }));
          }
          if (trainingRows === null) {
            const rows: TrainingRow[] = await Promise.all(
              siteStaff.map(async (member) => {
                try {
                  const [profile, certs] = await Promise.all([
                    api.getStaffTrainingProfile(member.id),
                    api.listCertificates(member.id),
                  ]);
                  const expiring = certs
                    .filter((c) => {
                      const days = Math.round(
                        (new Date(c.expiresOn).getTime() - Date.now()) / 86400000,
                      );
                      return days <= 60;
                    })
                    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
                  return {
                    userId: member.id,
                    name: member.name,
                    role: member.role,
                    profile,
                    expiringCerts: expiring,
                    failed: false,
                  };
                } catch {
                  return {
                    userId: member.id,
                    name: member.name,
                    role: member.role,
                    profile: null,
                    expiringCerts: [],
                    failed: true,
                  };
                }
              }),
            );
            setTrainingRows(rows);
          }
        }
        if (tabId === "medications" && medStatus === null) {
          setMedStatus(await api.getMedicationSupplyStatus(siteId));
        }
        if (tabId === "mileage") {
          setTrips(await api.listMileageTrips(siteId, monthKey));
        }
        if (tabId === "shiftnotes" && siteNotes === null) {
          setSiteNotes(await api.getSiteShiftNotes(siteId));
        }
      } catch (err) {
        setTabError((prev) => ({
          ...prev,
          [tabId]: err instanceof Error ? err.message : "Could not load this section.",
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [tabId]: false }));
      }
    },
    [
      api,
      hasAccess,
      session,
      siteId,
      siteStaff,
      qaHistory,
      checklists,
      delegations,
      siteNotes,
      medStatus,
      trainingRows,
    ],
  );

  useEffect(() => {
    if (hasAccess) void loadTab(activeTab, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hasAccess, siteId]);

  useEffect(() => {
    if (activeTab === "mileage" && hasAccess) void loadTab("mileage", month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  if (!site || !workspace || !session || !canAccessSite(session, siteId)) {
    return (
      <div>
        <button type="button" className="button" onClick={onBack}>
          <ArrowLeft size={16} /> Back to sites
        </button>
        <Empty
          title="Site not available"
          text="You don't have access to this program site, or it no longer exists."
        />
      </div>
    );
  }

  const latestQa = qaHistory?.[0] ?? null;
  const latestQaScore = latestQa?.score ?? null;
  const latestQaPct = latestQaScore?.pct;
  const siteRequirements = (workspace.requirements ?? []).filter(
    (r) => r.site === siteName,
  );
  const siteReqMetrics = metrics(siteRequirements);

  const selectTab = (id: SiteDetailTabId) => {
    setTab(id);
    document
      .getElementById(`sited-tab-${id}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onTabKeyDown = (e: React.KeyboardEvent, id: SiteDetailTabId) => {
    const idx = tabs.findIndex((t) => t.id === id);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      const nextId = tabs[next].id;
      setTab(nextId);
      document.getElementById(`sited-tab-${nextId}`)?.focus();
    }
  };

  const serviceLogs: Array<ServiceLogEntry & { weekOf: string }> = (checklists ?? [])
    .flatMap((c) => c.serviceLogs.map((log) => ({ ...log, weekOf: c.weekOf })))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  // Issue #94: month filters for HM checklists and service logs.
  const checklistMonths = useMemo(
    () =>
      [...new Set((checklists ?? []).map((c) => c.weekOf.slice(0, 7)))].sort().reverse(),
    [checklists],
  );
  const serviceLogMonths = useMemo(
    () => [...new Set(serviceLogs.map((l) => l.weekOf.slice(0, 7)))].sort().reverse(),
    [serviceLogs],
  );
  const filteredChecklists = useMemo(
    () =>
      (checklists ?? []).filter(
        (c) => checklistMonth === "all" || c.weekOf.slice(0, 7) === checklistMonth,
      ),
    [checklists, checklistMonth],
  );
  const filteredServiceLogs = useMemo(
    () =>
      serviceLogs.filter(
        (l) => serviceLogMonth === "all" || l.weekOf.slice(0, 7) === serviceLogMonth,
      ),
    [serviceLogs, serviceLogMonth],
  );

  async function exportTabSection(
    kind: "checklists" | "serviceLogs",
    mode: "download" | "print",
    monthKey: string | "all",
  ) {
    const key = `${kind}:${mode}`;
    setExportBusy(key);
    setExportError("");
    try {
      const file =
        kind === "checklists"
          ? await api.downloadHmChecklists({
              siteId,
              monthKey: monthKey === "all" ? null : monthKey,
            })
          : await api.downloadServiceLogs({
              siteId,
              monthKey: monthKey === "all" ? null : monthKey,
            });
      await openPrintable(file.name, file.blob, mode);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Could not prepare the document.",
      );
    } finally {
      setExportBusy(null);
    }
  }

  if (!site) {
    return (
      <div className="site-detail">
        <button type="button" className="text-button site-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to sites
        </button>
        <p>That site is not in this workspace.</p>
      </div>
    );
  }

  return (
    <div className="site-detail">
      <button type="button" className="text-button site-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to sites
      </button>

      <header className="panel site-hero">
        <div className="site-hero-top">
          <div className="site-detail-title">
            <h1>{site.name}</h1>
            <p className="site-hero-address">
              {siteAddressLine ? (
                <>
                  <MapPin size={14} />
                  <span className="site-hero-address-text">{siteAddressLine}</span>
                </>
              ) : null}
              <span className="program-tag">{site.program}</span>
            </p>
            {site.sitePhone && (
              <p className="site-hero-phone">
                <Phone size={14} /> {site.sitePhone}
              </p>
            )}
          </div>
          <Badge status={openRequirements.length ? "Needs attention" : "On track"} />
        </div>
        <div className="site-hero-dash">
          <StatusMixDonut items={siteRequirements} />
          <div className="site-hero-scores site-hero-kpis" aria-label={`${site.name} status`}>
            <div className="site-hero-score">
              <strong>
                {siteReqMetrics.score}
                <small>%</small>
              </strong>
              <span>Ready</span>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${siteReqMetrics.score}%` }} />
              </div>
            </div>
            <div className="site-hero-stat">
              <strong>{siteIndividuals.length}</strong>
              <span>Individuals</span>
            </div>
            <div className="site-hero-stat">
              <strong>{siteStaff.length}</strong>
              <span>Staff</span>
            </div>
            <div className="site-hero-stat">
              <strong>{openRequirements.length}</strong>
              <span>Open</span>
            </div>
            <div className="site-hero-stat">
              <strong>{latestQaPct ?? "None"}</strong>
              <span>{latestQa ? auditPeriodLabel(latestQa) : "QA review"}</span>
            </div>
          </div>
        </div>
        <div className="site-hero-people" aria-label="Individuals in this house">
          {siteIndividuals.length === 0 ? (
            <p className="site-hero-empty">No one is placed at this home yet.</p>
          ) : (
            siteIndividuals.map((p) => (
              <button
                key={p.id}
                type="button"
                className="site-hero-person"
                onClick={() => onOpenIndividual(p.name)}
              >
                <Avatar name={p.name} color={p.color} src={p.photoUrl} />
                <span>{p.name.split(" ")[0]}</span>
              </button>
            ))
          )}
        </div>
      </header>

      <div className="site-detail-tabstrip">
      <div
        className="tabs site-detail-tabs"
        role="tablist"
        aria-label={`${site.name} sections`}
      >
        {tabs.map((t) => {
          const Icon = TAB_ICONS[t.id];
          const selected = t.id === activeTab;
          return (
            <button
              key={t.id}
              id={`sited-tab-${t.id}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`sited-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "selected" : ""}
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, t.id)}
            >
              <Icon className="site-tab-icon" size={15} aria-hidden="true" /> {t.label}
            </button>
          );
        })}
      </div>
      </div>

      <section
        id={`sited-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`sited-tab-${activeTab}`}
        className="site-detail-panel"
      >
        {tabError[activeTab] && (
          <div className="panel site-detail-error" role="alert">
            {tabError[activeTab]}
          </div>
        )}
        {loading[activeTab] && (
          <div className="panel">
            <p className="muted">Loading…</p>
          </div>
        )}

        {activeTab === "overview" && !loading.overview && (
          <>
            {openRequirements.length > 0 && (
              <div className="panel">
                <h2>Needs attention</h2>
                <ul className="record-list">
                  {sortOpenRequirements(openRequirements)
                    .slice(0, 8)
                    .map((item) => (
                      <li key={item.id} className="record-row">
                        <div>
                          <strong>{item.title}</strong>
                          <span className="muted">
                            {" "}
                            · {item.person}
                            {item.due ? ` · due ${formatDate(item.due)}` : ""}
                          </span>
                        </div>
                        <Badge status={item.status} />
                      </li>
                    ))}
                </ul>
                {openRequirements.length > 8 && (
                  <p className="muted site-detail-note">
                    {openRequirements.length - 8} more open item
                    {openRequirements.length - 8 === 1 ? "" : "s"}.
                  </p>
                )}
                {onOpenPage && pageVisible(session, "Requirements") && (
                  <div className="site-panel-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => onOpenPage("Requirements")}
                    >
                      Open requirements
                    </button>
                  </div>
                )}
              </div>
            )}
            {latestQaPct != null && (
              <div className="panel qa-review-badge">
                <h2>QA Review score</h2>
                <div className="site-kpi-grid">
                  <div>
                    <strong>{latestQaPct}%</strong>
                    <span>{latestQa ? auditPeriodLabel(latestQa) : "Latest review"}</span>
                  </div>
                </div>
                {latestQaScore && (
                  <ul className="qa-badge-sections">
                    {QA_SECTIONS.map((s) => {
                      const sec = latestQaScore.sections[s.id];
                      if (!sec || sec.pct === null) return null;
                      return (
                        <li key={s.id}>
                          <span>{s.title}</span>
                          <strong>{sec.pct}%</strong>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {latestQaScore && latestQaScore.criticalFails.length > 0 && (
                  <p className="qa-badge-critical site-detail-note">
                    {latestQaScore.criticalFails.length} critical item
                    {latestQaScore.criticalFails.length === 1 ? "" : "s"} failed
                  </p>
                )}
              </div>
            )}
            <div className="panel">
              <h2>Site facts</h2>
              <dl className="fact-list">
                <div>
                  <dt>Program</dt>
                  <dd>{SERVICE_TYPE_LABELS[site.serviceType] ?? site.serviceType}</dd>
                </div>
                <div>
                  <dt>House manager</dt>
                  <dd>{site.manager || "—"}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {siteAddressLine ||
                      site.address ||
                      [site.city, site.county, site.zip].filter(Boolean).join(", ") ||
                      "—"}
                    {site.county ? ` · ${site.county} County` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Staffing</dt>
                  <dd>
                    {site.staffed24h ? "Staffed 24 hours" : "Not staffed 24 hours"}
                    {site.overnightSleepStaff ? " · overnight sleep staff" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Water</dt>
                  <dd>
                    {site.wellWater
                      ? `Well water${site.lastWaterTestOn ? ` · last tested ${formatDate(site.lastWaterTestOn)}` : ""}`
                      : "Municipal water"}
                  </dd>
                </div>
                {(site.contactName || site.contactPhone) && (
                  <div>
                    <dt>Site contact</dt>
                    <dd>
                      {[site.contactName, site.contactPhone].filter(Boolean).join(" · ")}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </>
        )}

        {activeTab === "individuals" && (
          <div className="card-grid">
            {siteIndividuals.length === 0 && (
              <Empty
                mark="none"
                title="No individuals"
                text="No one is placed at this home yet."
              />
            )}
            {siteIndividuals.map((p) => (
              <button
                key={p.id}
                type="button"
                className="panel person-card"
                onClick={() => onOpenIndividual(p.name)}
              >
                <div className="person-card-top">
                  <Avatar name={p.name} color={p.color} src={p.photoUrl} />
                  <ArrowUpRight size={18} />
                </div>
                <h2>{p.name}</h2>
                <p className="site-person-open">Open chart</p>
              </button>
            ))}
          </div>
        )}

        {activeTab === "audits" && !loading.audits && (
          <div className="panel">
            <h2>QA Review</h2>
            <div className="site-qa-body">
              <SiteQaReview siteId={siteId} siteName={site.name} />
            </div>
          </div>
        )}

        {activeTab === "checklists" && !loading.checklists && (
          <>
            {/* Issue #94: Drills FIRST. Visible to everyone who can open the
                site detail page (the OLD Drills-tab gate) — it must not
                inherit the checklist-permissions gate below. */}
            {canSeeSiteDrills(session) && (
              <SiteDrillsSchedule
                siteId={siteId}
                siteName={site.name}
                drills={siteDrills}
              />
            )}
            {canSeeSiteChecklists(session) && (
              <>
                {/* Issue #94: the drills schedule leads this tab, so the monthly
                    drills logging block is hidden here (drill recording stays
                    on the Monthly checks page). */}
                <SiteMonthlyChecks siteId={siteId} showDrills={false} />
                <div className="panel">
                  <div className="panel-heading">
                    <h2>HM weekly checklists</h2>
                    <div className="drill-toolbar">
                      <label>
                        Month
                        <select
                          aria-label="Checklists month filter"
                          value={checklistMonth}
                          onChange={(e) =>
                            setChecklistMonth(e.target.value as string | "all")
                          }
                        >
                          <option value="all">All months</option>
                          {checklistMonths.map((key) => (
                            <option key={key} value={key}>
                              {monthLabel(key)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="button"
                        disabled={exportBusy !== null}
                        onClick={() =>
                          void exportTabSection("checklists", "download", checklistMonth)
                        }
                      >
                        <Download size={16} /> Download
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={exportBusy !== null}
                        onClick={() =>
                          void exportTabSection("checklists", "print", checklistMonth)
                        }
                      >
                        <Printer size={16} /> Print
                      </button>
                    </div>
                  </div>
                  {exportError && (
                    <p className="form-error" role="alert">
                      {exportError}
                    </p>
                  )}
                  {!filteredChecklists.length && (
                    <Empty
                      mark="none"
                      title="No checklists"
                      text={
                        checklistMonth === "all"
                          ? "No weekly checklists filed for this home yet."
                          : `No weekly checklists filed for ${monthLabel(checklistMonth)}.`
                      }
                      actions={
                        onOpenPage &&
                        (pageVisible(session, "Weekly checklist") ||
                          pageVisible(session, "Checklist assignments")) ? (
                          <button
                            type="button"
                            className="button primary"
                            onClick={() =>
                              onOpenPage(
                                pageVisible(session, "Weekly checklist")
                                  ? "Weekly checklist"
                                  : "Checklist assignments",
                              )
                            }
                          >
                            Start weekly checklist
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                  {!!filteredChecklists.length && (
                    <ul className="record-list">
                      {filteredChecklists.map((c) => (
                        <li key={c.id} className="record-row">
                          <div>
                            <strong>Week of {formatDate(c.weekOf)}</strong>
                            <span className="muted">
                              {" "}
                              · {c.items.filter((i) => i.answer).length}/{c.items.length} items answered
                            </span>
                          </div>
                          <Badge
                            status={
                              c.status === "submitted"
                                ? "Complete"
                                : c.status === "overdue" || c.late
                                  ? "Needs attention"
                                  : "On track"
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {onOpenPage &&
                    !!filteredChecklists.length &&
                    (pageVisible(session, "Weekly checklist") ||
                      pageVisible(session, "Checklist assignments")) && (
                      <div className="site-panel-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() =>
                            onOpenPage(
                              pageVisible(session, "Weekly checklist")
                                ? "Weekly checklist"
                                : "Checklist assignments",
                            )
                          }
                        >
                          Open weekly checklist
                        </button>
                      </div>
                    )}
                </div>
                <div className="panel">
                  <div className="panel-heading">
                    <h2>Weekly service logs</h2>
                    <div className="drill-toolbar">
                      <label>
                        Month
                        <select
                          aria-label="Service logs month filter"
                          value={serviceLogMonth}
                          onChange={(e) =>
                            setServiceLogMonth(e.target.value as string | "all")
                          }
                        >
                          <option value="all">All months</option>
                          {serviceLogMonths.map((key) => (
                            <option key={key} value={key}>
                              {monthLabel(key)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="button"
                        disabled={exportBusy !== null}
                        onClick={() =>
                          void exportTabSection("serviceLogs", "download", serviceLogMonth)
                        }
                      >
                        <Download size={16} /> Download
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={exportBusy !== null}
                        onClick={() =>
                          void exportTabSection("serviceLogs", "print", serviceLogMonth)
                        }
                      >
                        <Printer size={16} /> Print
                      </button>
                    </div>
                  </div>
                  {exportError && (
                    <p className="form-error" role="alert">
                      {exportError}
                    </p>
                  )}
                  <p className="muted section-note">
                    Service logs are a separate record from the weekly checklist.
                  </p>
                  {filteredServiceLogs.length === 0 && (
                    <Empty
                      mark="none"
                      title="No service logs"
                      text={
                        serviceLogMonth === "all"
                          ? "No service log entries filed for this home yet."
                          : `No service log entries filed for ${monthLabel(serviceLogMonth)}.`
                      }
                      actions={
                        onOpenPage && pageVisible(session, "Weekly checklist") ? (
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => onOpenPage("Weekly checklist")}
                          >
                            File a service log
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                  {filteredServiceLogs.length > 0 && (
                    <ul className="record-list">
                      {filteredServiceLogs.map((log) => (
                        <li key={log.id} className="record-row">
                          <div>
                            <strong>{SERVICE_LOG_KIND_LABELS[log.kind] ?? log.kind}</strong>
                            <span className="muted"> · week of {formatDate(log.weekOf)}</span>
                            <p>{log.detail}</p>
                            {(log.staffName || log.dateTime) && (
                              <span className="muted">
                                {[log.staffName, log.dateTime ? formatDate(log.dateTime) : ""]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "training" && !loading.training && (
          <>
            <div className="panel">
              <h2>Active delegations at this home</h2>
              {!delegations?.length && (
                <Empty
                  mark="none"
                  title="No delegations"
                  text="No delegation templates are activated for this home."
                />
              )}
              {!!delegations?.length && (
                <ul className="record-list">
                  {delegations.map((d) => (
                    <li key={d.id} className="record-row">
                      <div>
                        <strong>{d.templateName}</strong>
                        <span className="muted">
                          {" "}
                          · {d.templateCategory} · activated {formatDate(d.activatedAt)}
                        </span>
                      </div>
                      <Badge status={d.status === "active" ? "On track" : d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel">
              <h2>Staff training &amp; certificates</h2>
              {!trainingRows?.length && (
                <Empty mark="none" title="No staff" text="No staff are assigned to this home." />
              )}
              {!!trainingRows?.length && (
                <ul className="record-list">
                  {trainingRows.map((row) => (
                    <li key={row.userId} className="record-row">
                      <div>
                        <strong>{row.name}</strong>
                        <span className="muted"> · {row.role}</span>
                        {row.failed ? (
                          <p className="muted">Training record unavailable.</p>
                        ) : (
                          <>
                            <p className="muted">
                              {trainingProgressLine(row.profile, false)}
                              {row.profile && !row.profile.clearedForInRatio
                                ? " · not cleared for in-ratio"
                                : ""}
                            </p>
                            {row.expiringCerts.length > 0 && (
                              <p className="muted">
                                {row.expiringCerts.length} certificate
                                {row.expiringCerts.length === 1 ? "" : "s"} expiring within 60 days
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      {row.profile && (
                        <Badge
                          status={row.profile.clearedForInRatio ? "Complete" : "Needs attention"}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {onOpenPage &&
                (pageVisible(session, "Training") || pageVisible(session, "Delegations")) && (
                  <div className="site-panel-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        onOpenPage(pageVisible(session, "Training") ? "Training" : "Delegations")
                      }
                    >
                      Open training
                    </button>
                  </div>
                )}
            </div>
          </>
        )}

        {activeTab === "medications" && !loading.medications && (
          <div className="panel">
            <h2>Medication supply</h2>
            {!medStatus && (
              <Empty
                mark="none"
                title="No data"
                text="Medication supply status is not available for this home."
              />
            )}
            {medStatus && (
              <>
                <div className="site-kpi-grid">
                  <div>
                    <strong>{medStatus.totalMeds}</strong>
                    <span>Medications</span>
                  </div>
                  <div>
                    <strong>{medStatus.okCount}</strong>
                    <span>Stock OK</span>
                  </div>
                  <div>
                    <strong>{medStatus.lowCount}</strong>
                    <span>Running low</span>
                  </div>
                  <div>
                    <strong>{medStatus.criticalCount + medStatus.outCount}</strong>
                    <span>Critical / out</span>
                  </div>
                </div>
                <p className="muted site-detail-note">
                  Checked {formatDate(medStatus.checkedOn)}
                  {medStatus.allClear ? " · everything stocked" : " · needs attention"}
                  {medStatus.summary ? ` · ${medStatus.summary}` : ""}
                </p>
                {!medStatus.allClear && medStatus.alerts.length > 0 && (
                  <ul className="record-list">
                    {medStatus.alerts.map((alert) => {
                      const person =
                        siteIndividuals.find((row) => row.id === alert.individualId)?.name ??
                        "Individual";
                      return (
                        <li key={alert.id} className="record-row">
                          <div>
                            <strong>
                              {person} · {alert.medicationName}
                            </strong>
                            <span className="muted">
                              {" "}
                              · {alert.strength} · {inventoryCountdownLabel(alert)}
                            </span>
                          </div>
                          <Badge
                            status={
                              alert.status === "out" || alert.status === "critical"
                                ? "Needs attention"
                                : "Due soon"
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
                {onOpenPage && pageVisible(session, "Supply forecast") && (
                  <div className="site-panel-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => onOpenPage("Supply forecast")}
                    >
                      Open supply forecast
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "mileage" && (
          <div className="panel">
            <div className="panel-heading">
              <h2>Mileage log</h2>
              <input
                type="month"
                aria-label="Mileage month"
                value={month}
                max={monthKeyOf(todayIso())}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
            </div>
            {loading.mileage && <p className="muted">Loading…</p>}
            {!loading.mileage && (!trips || trips.length === 0) && (
              <Empty
                mark="none"
                title="No trips"
                text={`No mileage trips logged for ${monthLabel(month)}. Open the full mileage log to print or add trips.`}
              />
            )}
            {!!trips?.length && (
              <ul className="record-list">
                {trips.map((t) => (
                  <li key={t.id} className="record-row">
                    <div>
                      <strong>{formatDate(t.tripDate)}</strong>
                      <span className="muted">
                        {" "}
                        · {t.miles} mi · {t.reason}
                        {t.driverName ? ` · ${t.driverName}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {onOpenPage && pageVisible(session, "Mileage") && (
              <div className="site-panel-actions">
                <button type="button" className="button" onClick={() => onOpenPage("Mileage")}>
                  Open mileage log
                </button>
              </div>
            )}
          </div>
        )}

        {/* Issue #94: the standalone Drills tab is gone — drills live as the
            first section of the Checklists tab (SiteDrillsSchedule). */}

        {/* Issue #80: the Documents tab becomes Shift notes. Standalone
            document uploads stay reachable via the Documents page. */}
        {activeTab === "shiftnotes" && !loading.shiftnotes && (
          <div className="panel">
            <h2>Shift notes</h2>
            <p className="stack-help">
              Notes staff entered against approved ISP programs for Individuals
              at this home. To enter a note, open the Individual's chart.
            </p>
            {!siteNotes?.length && (
              <Empty
                mark="quiet"
                title="No shift notes yet"
                text="No notes have been entered for this home yet."
                actions={
                  onOpenPage && pageVisible(session, "Documents") ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => onOpenPage("Documents")}
                    >
                      Open documents
                    </button>
                  ) : undefined
                }
              />
            )}
            {!!siteNotes?.length && (
              <ul className="record-list">
                {siteNotes.map((note) => (
                  <li key={note.id} className="record-row">
                    <div>
                      <strong>
                        {note.individualName} · {note.noteDate} · {note.shift}
                      </strong>
                      <span className="muted">
                        {" "}
                        · {note.programName} · {note.staffName}
                        {note.scores.length > 0 &&
                          ` · ${note.scores.length} task${note.scores.length === 1 ? "" : "s"} scored`}
                      </span>
                      {note.summary && <p className="muted">{note.summary}</p>}
                    </div>
                    <Badge status={note.shift} />
                  </li>
                ))}
              </ul>
            )}
            {onOpenPage && !!siteNotes?.length && pageVisible(session, "Documents") && (
              <div className="site-panel-actions">
                <button type="button" className="button" onClick={() => onOpenPage("Documents")}>
                  Open documents
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "staff" && (
          <div className="panel">
            <h2>Staff at this home</h2>
            {siteStaff.length === 0 && (
              <Empty
                mark="none"
                title="No staff"
                text="No staff are assigned to this home yet."
              />
            )}
            {siteStaff.length > 0 && (
              <ul className="record-list">
                {siteStaff.map((s) => (
                  <li key={s.id} className="record-row">
                    <div>
                      <span className="person-cell">
                        <Avatar name={s.name} small />
                        <strong>{s.name}</strong>
                      </span>
                      <p className="muted">
                        {s.role}
                        {s.username || s.email ? ` · ${s.username || s.email}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
