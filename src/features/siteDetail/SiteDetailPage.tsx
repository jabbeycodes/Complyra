import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CarFront,
  ClipboardCheck,
  FileText,
  Flame,
  GraduationCap,
  MapPin,
  Phone,
  Pill,
  User,
  Users,
} from "lucide-react";
import { Avatar, Badge, Empty, formatDate } from "../../components";
import StatusMixDonut from "../../components/StatusMixDonut";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { canAccessSite, individualsAtSite } from "../../data/dashboard";
import { metrics } from "../../domain";
import { QA_SECTIONS, type QaAudit } from "../../data/qaAudit";
import { SERVICE_TYPE_LABELS } from "../../data/siteReview";
import { SERVICE_LOG_KIND_LABELS } from "../../data/hmChecklist";
import { monthKeyOf, monthLabel } from "../../data/mileage";
import { todayIso } from "../../data/chart";
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
import type { DocumentUpload } from "../../data/documents";
import { getSiteDetailTabs, type SiteDetailTabId } from "./siteTabs";
import SiteQaReview from "../qa/SiteQaReview";
import "./siteDetail.css";

interface SiteDetailPageProps {
  siteId: string;
  onBack: () => void;
  onOpenIndividual: (name: string) => void;
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
  drills: Flame,
  documents: FileText,
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
}: SiteDetailPageProps) {
  const { api, session, workspace } = useData();
  const tabs = useMemo(() => getSiteDetailTabs(session), [session]);
  const [tab, setTab] = useState<SiteDetailTabId>("overview");
  const [month, setMonth] = useState(() => monthKeyOf(todayIso()));

  const [qaHistory, setQaHistory] = useState<QaAudit[] | null>(null);
  const [checklists, setChecklists] = useState<HmWeeklyChecklist[] | null>(null);
  const [delegations, setDelegations] = useState<SiteDelegationActivation[] | null>(null);
  const [trainingRows, setTrainingRows] = useState<TrainingRow[] | null>(null);
  const [medStatus, setMedStatus] = useState<MedSupplyStatus | null>(null);
  const [trips, setTrips] = useState<MileageTripView[] | null>(null);
  const [documents, setDocuments] = useState<DocumentUpload[] | null>(null);
  const [loading, setLoading] = useState<Partial<Record<SiteDetailTabId, boolean>>>({});
  const [tabError, setTabError] = useState<Partial<Record<SiteDetailTabId, string>>>({});

  const site = workspace?.sites.find((s) => s.id === siteId) ?? null;
  const siteName = site?.name ?? "";
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
        if (tabId === "documents" && documents === null) {
          const all = await api.listDocumentUploads();
          setDocuments(all.filter((d) => d.siteId === siteId));
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
      documents,
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

  return (
    <div className="site-detail">
      <button type="button" className="button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to sites
      </button>

      <header className="panel site-hero">
        <div className="site-hero-top">
          <div className="site-detail-title">
            <h1>{site.name}</h1>
            <p>
              <MapPin size={14} /> {site.address}
              <span className="program-tag">{site.program}</span>
            </p>
            {site.sitePhone && (
              <p>
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
              <strong>{latestQaPct ?? "—"}</strong>
              <span>{latestQa ? auditPeriodLabel(latestQa) : "QA"}</span>
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
            <div className="stat-grid">
              {/* QA-REVIEW-BADGE (2026-09-14): overnight module — keep the
                  section breakdown here. Headcount lives in the site hero. */}
              <div className="panel stat-card qa-review-badge">
                <strong>{latestQaPct ?? "—"}</strong>
                <span>
                  QA Review score
                  {latestQa ? ` (${auditPeriodLabel(latestQa)})` : ""}
                </span>
                <span className="qa-badge-caption">
                  Projects this home's compliance score
                </span>
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
                  <span className="qa-badge-critical">
                    ⚠ {latestQaScore.criticalFails.length} critical item
                    {latestQaScore.criticalFails.length === 1 ? "" : "s"} failed
                  </span>
                )}
              </div>
            </div>
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
                    {[site.city, site.county, site.zip].filter(Boolean).join(", ") || "—"}
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
              <Empty title="No individuals" text="No one is placed at this home yet." />
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
              </button>
            ))}
          </div>
        )}

        {activeTab === "audits" && !loading.audits && (
          <SiteQaReview siteId={siteId} siteName={site.name} />
        )}

        {activeTab === "checklists" && !loading.checklists && (
          <>
            <div className="panel">
              <h2>HM weekly checklists</h2>
              {!checklists?.length && (
                <Empty title="No checklists" text="No weekly checklists filed for this home yet." />
              )}
              {!!checklists?.length && (
                <ul className="record-list">
                  {checklists.map((c) => (
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
            </div>
            <div className="panel">
              <h2>Weekly service logs</h2>
              <p className="muted section-note">
                Service logs are a separate record from the weekly checklist.
              </p>
              {serviceLogs.length === 0 && (
                <Empty title="No service logs" text="No service log entries filed for this home yet." />
              )}
              {serviceLogs.length > 0 && (
                <ul className="record-list">
                  {serviceLogs.map((log) => (
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

        {activeTab === "training" && !loading.training && (
          <>
            <div className="panel">
              <h2>Active delegations at this home</h2>
              {!delegations?.length && (
                <Empty title="No delegations" text="No delegation templates are activated for this home." />
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
                <Empty title="No staff" text="No staff are assigned to this home." />
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
                          <p className="muted">
                            {row.profile
                              ? `${row.profile.counts.complete}/${row.profile.counts.required} training items complete`
                              : "No training checklist started"}
                            {row.profile && !row.profile.clearedForInRatio
                              ? " · not cleared for in-ratio"
                              : ""}
                            {row.expiringCerts.length > 0 &&
                              ` · ${row.expiringCerts.length} certificate${row.expiringCerts.length === 1 ? "" : "s"} expiring soon`}
                          </p>
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
            </div>
          </>
        )}

        {activeTab === "medications" && !loading.medications && (
          <div className="panel">
            <h2>Medication supply</h2>
            {!medStatus && (
              <Empty title="No data" text="Medication supply status is not available for this home." />
            )}
            {medStatus && (
              <>
                <div className="stat-grid">
                  <div className="panel stat-card">
                    <strong>{medStatus.totalMeds}</strong>
                    <span>Medications</span>
                  </div>
                  <div className="panel stat-card">
                    <strong>{medStatus.okCount}</strong>
                    <span>Stock OK</span>
                  </div>
                  <div className="panel stat-card">
                    <strong>{medStatus.lowCount}</strong>
                    <span>Running low</span>
                  </div>
                  <div className="panel stat-card">
                    <strong>{medStatus.criticalCount + medStatus.outCount}</strong>
                    <span>Critical / out</span>
                  </div>
                </div>
                <p className="muted">
                  Checked {formatDate(medStatus.checkedOn)}
                  {medStatus.allClear ? " · everything stocked" : " · needs attention"}
                </p>
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
                title="No trips"
                text={`No mileage trips logged for ${monthLabel(month)}.`}
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
          </div>
        )}

        {activeTab === "drills" && (
          <div className="panel">
            <h2>Fire drill log</h2>
            {siteDrills.length === 0 && (
              <Empty title="No drills" text="No emergency drills recorded for this home yet." />
            )}
            {siteDrills.length > 0 && (
              <ul className="record-list">
                {siteDrills.map((d) => (
                  <li key={d.id} className="record-row">
                    <div>
                      <strong>{d.drillType} drill</strong>
                      <span className="muted">
                        {" "}
                        · {d.date ? formatDate(d.date) : "date not set"}
                        {d.evacTime ? ` · evacuated in ${d.evacTime}` : ""}
                        {d.leaderName ? ` · led by ${d.leaderName}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === "documents" && !loading.documents && (
          <div className="panel">
            <h2>Site documents</h2>
            {!documents?.length && (
              <Empty title="No documents" text="No documents filed for this home yet." />
            )}
            {!!documents?.length && (
              <ul className="record-list">
                {documents.map((d) => (
                  <li key={d.id} className="record-row">
                    <div>
                      <strong>{d.originalFilename}</strong>
                      <span className="muted">
                        {" "}
                        · {d.documentType} · uploaded {formatDate(d.uploadedAt)}
                      </span>
                    </div>
                    <Badge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === "staff" && (
          <div className="panel">
            <h2>Staff at this home</h2>
            {siteStaff.length === 0 && (
              <Empty title="No staff" text="No staff are assigned to this home yet." />
            )}
            {siteStaff.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Team member</th>
                      <th>Role</th>
                      <th>Username</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteStaff.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <span className="person-cell">
                            <Avatar name={s.name} small />
                            <strong>{s.name}</strong>
                          </span>
                        </td>
                        <td>{s.role}</td>
                        <td>{s.username || s.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
