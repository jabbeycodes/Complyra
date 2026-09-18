import { useEffect, useMemo, useRef, useState } from "react";
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
import { can, pageVisible } from "../../data/status";
import { canAccessSite, individualsAtSite } from "../../data/dashboard";
import { metrics } from "../../domain";
import { QA_SECTIONS, QA_ITEM_BY_ID, type QaAudit } from "../../data/qaAudit";
import { SERVICE_TYPE_LABELS } from "../../data/siteReview";
import { agencyStateCode, siteHeroAddressLine } from "../../data/siteAddress";
import { SERVICE_LOG_KIND_LABELS } from "../../data/hmChecklist";
import { monthKeyOf, monthLabel } from "../../data/mileage";
import { inventoryCountdownLabel } from "../../data/medInventory";
import { todayIso } from "../../data/chart";
import {
  asMonthlyCollections,
  monthlyTone,
  siteSafetyView,
  type MonthlyTone,
} from "../../data/monthlyChecks";
import {
  bucketDrillCompletion,
  collectExpiringCerts,
  currentMonthKey,
  drillTileSummary,
  investigationTileSummary,
  medAlertSummary,
  safetyLinesAnswered,
  safetyTileState,
  shiftNoteCoverage,
  trainingClearanceSummary,
} from "./trackables";
import { useSiteTrackables } from "./useSiteTrackables";
import InspectionDrawer from "./InspectionDrawer";
import StartInvestigationForm from "./StartInvestigationForm";
import InvestigationsPanel from "./InvestigationsPanel";
import {
  drawerMetric,
  drawerTitle,
  DrawerBody,
  type DrawerContext,
  type DrawerKind,
} from "./drawerBodies";
import type { InvestigationSourceMetric } from "../../data/investigations";
import {
  formatDrillTypeLabel,
  sortOpenRequirements,
  trainingProgressLine,
} from "./siteDetailCopy";
import type { QaAuditSummary } from "../../data/localApi";
import type {
  MileageTripView,
  ServiceLogEntry,
} from "../../data/types";
import { getSiteDetailTabs, type SiteDetailTabId } from "./siteTabs";
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
  drills: Flame,
  shiftnotes: FileText,
  staff: Users,
};

type TileTone = "ok" | "attention" | "neutral";

interface StripTile {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: TileTone;
  ariaLabel: string;
  drawer?: DrawerKind;
  onClick?: () => void;
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

  const [trips, setTrips] = useState<MileageTripView[] | null>(null);
  const [mileageLoading, setMileageLoading] = useState(false);
  const [mileageError, setMileageError] = useState<string | undefined>();

  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [investigating, setInvestigating] = useState<{
    metric: InvestigationSourceMetric;
    sourceRecordId: string | null;
    sourceLabel: string;
  } | null>(null);
  const [investigationNotice, setInvestigationNotice] = useState("");
  const investigationsRef = useRef<HTMLElement | null>(null);

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
    () =>
      (workspace?.staff ?? [])
        .filter((s) => s.siteId === siteId)
        .map((s) => ({ id: s.id, name: s.name, role: s.role })),
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

  // Eager, permission-gated trackable loading: tiles render without tab
  // clicks. Each fetch mirrors its tab's gate; null = the role can't read.
  const trackables = useSiteTrackables({
    api,
    session,
    siteId,
    siteStaff,
    hasAccess,
  });
  const {
    qaHistory,
    qaDisputes,
    checklists,
    delegations,
    trainingRows,
    medStatus,
    siteNotes,
    investigations,
  } = trackables;

  const canInvestigate = !!session && can(session, "investigations.manage");

  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? "overview";

  // Mileage stays tab-scoped: it is month-keyed, not a dashboard trackable.
  useEffect(() => {
    if (!hasAccess || activeTab !== "mileage") return;
    let alive = true;
    setMileageLoading(true);
    setMileageError(undefined);
    api
      .listMileageTrips(siteId, month)
      .then((rows) => {
        if (alive) setTrips(rows);
      })
      .catch((err) => {
        if (alive)
          setMileageError(err instanceof Error ? err.message : "Could not load this section.");
      })
      .finally(() => {
        if (alive) setMileageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, hasAccess, activeTab, siteId, month]);


  // ---- tile data ------------------------------------------------------

  const thisMonth = currentMonthKey();
  const thisMonthLabel = monthLabel(thisMonth);

  const drillBuckets = useMemo(
    () => bucketDrillCompletion(siteDrills, thisMonth),
    [siteDrills, thisMonth],
  );
  const drillSummary = drillTileSummary(drillBuckets);

  const safetyReport = useMemo(
    () =>
      workspace
        ? siteSafetyView(asMonthlyCollections(workspace.monthly), siteId, thisMonth)
        : undefined,
    [workspace, siteId, thisMonth],
  );
  const safetyState = safetyTileState(safetyReport);
  const safetyLines = safetyLinesAnswered(safetyReport);
  const safetyTone: MonthlyTone = safetyState === "complete"
    ? "current"
    : monthlyTone(false, todayIso(), thisMonth, workspace?.monthlyDue.safetyDay);

  const trainingSummary = useMemo(
    () => (trainingRows ? trainingClearanceSummary(trainingRows) : null),
    [trainingRows],
  );
  const certRows = useMemo(
    () => (trainingRows ? collectExpiringCerts(trainingRows) : null),
    [trainingRows],
  );
  const medSummary = medAlertSummary(medStatus);
  const shiftCoverage = useMemo(
    () => (siteNotes ? shiftNoteCoverage(siteNotes, thisMonth) : null),
    [siteNotes, thisMonth],
  );
  const invSummary = useMemo(
    () => (investigations ? investigationTileSummary(investigations) : null),
    [investigations],
  );
  const latestQa = qaHistory?.[0] ?? null;
  const latestQaScore = latestQa?.score ?? null;
  const latestQaPct = latestQaScore?.pct;
  const siteRequirements = (workspace?.requirements ?? []).filter(
    (r) => r.site === siteName,
  );
  const siteReqMetrics = metrics(siteRequirements);
  const sortedOpenRequirements = useMemo(
    () => sortOpenRequirements(openRequirements),
    [openRequirements],
  );

  const qaDetail = useMemo(
    () =>
      latestQa && latestQaScore
        ? {
            periodLabel: auditPeriodLabel(latestQa),
            pct: latestQaScore.pct,
            sections: QA_SECTIONS.map((s) => ({
              id: s.id,
              title: s.title,
              pct: latestQaScore.sections[s.id]?.pct ?? null,
            })),
            criticalFails: latestQaScore.criticalFails.length,
          }
        : null,
    [latestQa, latestQaScore],
  );

  const canSeeDrills = !!session && pageVisible(session, "Individuals");
  const canSeeSafety =
    !!session &&
    (pageVisible(session, "Weekly checklist") ||
      pageVisible(session, "Checklist assignments"));
  const canSeeTraining =
    !!session && (pageVisible(session, "Training") || pageVisible(session, "Delegations"));
  const canSeeMeds = !!session && pageVisible(session, "Supply forecast");
  const canSeeShiftNotes = !!session && pageVisible(session, "ShiftNotes");
  const canSeeQa =
    !!session &&
    (can(session, "audit.read") || can(session, "qa.audit") || can(session, "audit.export"));

  const toneToClass = (tone: TileTone) =>
    tone === "attention" ? "site-tile-attention" : tone === "neutral" ? "site-tile-neutral" : "";

  const stripTiles: StripTile[] = [];
  if (canSeeDrills) {
    stripTiles.push({
      key: "drills",
      label: "Emergency drills",
      value: `${drillSummary.done}/${drillSummary.total}`,
      sub:
        drillSummary.missing === 0
          ? `${thisMonthLabel} · all complete`
          : `${thisMonthLabel} · ${drillSummary.missing} missing`,
      tone: drillSummary.missing > 0 ? "attention" : "ok",
      ariaLabel: `Emergency drills ${thisMonthLabel}: ${drillSummary.done} of ${drillSummary.total} complete. Open drill detail.`,
      drawer: "drills",
    });
  }
  if (canSeeSafety) {
    const safetyLabel =
      safetyState === "complete" ? "Complete" : safetyState === "in_progress" ? "In progress" : "Not started";
    const toneWord = safetyTone === "current" ? "on track" : safetyTone === "due_soon" ? "due soon" : "overdue";
    stripTiles.push({
      key: "safety",
      label: "Home safety report",
      value: safetyLabel,
      sub:
        safetyLines.total > 0
          ? `${thisMonthLabel} · ${safetyLines.answered}/${safetyLines.total} lines · ${toneWord}`
          : `${thisMonthLabel} · ${toneWord}`,
      tone: safetyTone === "overdue" ? "attention" : safetyTone === "due_soon" ? "neutral" : safetyState === "complete" ? "ok" : "neutral",
      ariaLabel: `Home safety report ${thisMonthLabel}: ${safetyLabel}. Open safety detail.`,
      drawer: "safety",
    });
  }
  if (canSeeTraining && trainingSummary) {
    stripTiles.push({
      key: "training",
      label: "Training & in-ratio",
      value: `${trainingSummary.cleared}/${trainingSummary.total}`,
      sub:
        trainingSummary.notCleared > 0
          ? `${trainingSummary.notCleared} not cleared for in-ratio`
          : "everyone cleared",
      tone: trainingSummary.notCleared > 0 ? "attention" : "ok",
      ariaLabel: `Training and in-ratio clearance: ${trainingSummary.cleared} of ${trainingSummary.total} staff cleared. Open training detail.`,
      drawer: "training",
    });
  }
  if (canSeeTraining && certRows) {
    stripTiles.push({
      key: "certificates",
      label: "Certificates",
      value: `${certRows.length}`,
      sub: "expiring within 60 days",
      tone: certRows.length > 0 ? "attention" : "ok",
      ariaLabel: `${certRows.length} certificates expiring within 60 days. Open certificate detail.`,
      drawer: "certificates",
    });
  }
  if (canSeeMeds && medStatus) {
    stripTiles.push({
      key: "meds",
      label: "Medication supply",
      value: medSummary.allClear ? "Stocked" : `${medSummary.attention}`,
      sub: medSummary.allClear
        ? `${medSummary.total} meds · all stocked`
        : `${medSummary.attention} need attention`,
      tone: medSummary.attention > 0 ? "attention" : "ok",
      ariaLabel: `Medication supply: ${medSummary.allClear ? "all stocked" : `${medSummary.attention} need attention`}. Open supply detail.`,
      drawer: "meds",
    });
  }
  if (canSeeShiftNotes && shiftCoverage) {
    stripTiles.push({
      key: "shiftnotes",
      label: "Shift notes",
      value: `${shiftCoverage.length}`,
      sub: `${thisMonthLabel}`,
      tone: "neutral",
      ariaLabel: `${shiftCoverage.length} shift notes in ${thisMonthLabel}. Open shift note detail.`,
      drawer: "shiftnotes",
    });
  }
  if (canSeeQa && qaDisputes) {
    stripTiles.push({
      key: "qa_disputes",
      label: "QA disputes",
      value: `${qaDisputes.length}`,
      sub: "under dispute",
      tone: qaDisputes.length > 0 ? "attention" : "ok",
      ariaLabel: `${qaDisputes.length} QA findings under dispute. Open dispute detail.`,
      drawer: "qa_disputes",
    });
  }
  if (canInvestigate && invSummary) {
    stripTiles.push({
      key: "investigations",
      label: "Open investigations",
      value: `${invSummary.open}`,
      sub: invSummary.overdue > 0 ? `${invSummary.overdue} overdue` : "open",
      tone: invSummary.overdue > 0 ? "attention" : "neutral",
      ariaLabel: `${invSummary.open} open investigations${invSummary.overdue > 0 ? `, ${invSummary.overdue} overdue` : ""}. Go to investigations.`,
      onClick: () =>
        investigationsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    });
  }

  // ---- drawer ----------------------------------------------------------

  const drawerCtx: DrawerContext = useMemo(
    () => ({
      siteName,
      requirements: sortedOpenRequirements.map((r) => ({
        id: r.id,
        title: r.title,
        person: r.person,
        due: r.due,
        status: r.status,
      })),
      individuals: siteIndividuals.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        photoUrl: p.photoUrl,
      })),
      staff: siteStaff.map((s) => {
        const full = (workspace?.staff ?? []).find((row) => row.id === s.id);
        return {
          id: s.id,
          name: s.name,
          role: s.role,
          username: full?.username ?? null,
          email: full?.email ?? null,
        };
      }),
      qa: qaDetail,
      drillBuckets,
      drillMonthLabel: thisMonthLabel,
      safetyState:
        safetyState === "complete"
          ? "Complete"
          : safetyState === "in_progress"
            ? "In progress"
            : "Not started",
      safetyAnswered: safetyLines.answered,
      safetyTotal: safetyLines.total,
      trainingRows: (trainingRows ?? []).map((r) => ({
        userId: r.userId,
        name: r.name,
        role: r.role,
        profile: r.profile
          ? {
              clearedForInRatio: r.profile.clearedForInRatio,
              counts: r.profile.counts,
            }
          : null,
        failed: r.failed,
      })),
      certRows: certRows ?? [],
      medAlerts: (medStatus?.alerts ?? []).map((alert) => ({
        id: alert.id,
        individualId: alert.individualId,
        individualName:
          siteIndividuals.find((row) => row.id === alert.individualId)?.name ?? "Individual",
        medicationName: alert.medicationName,
        strength: alert.strength,
        status: alert.status,
        countdownLabel: inventoryCountdownLabel(alert),
      })),
      medCheckedOn: medStatus?.checkedOn ?? null,
      shiftNotes: (shiftCoverage ?? []).map((n) => ({
        id: n.id,
        individualName: n.individualName,
        noteDate: n.noteDate,
        shift: n.shift,
        programName: n.programName,
        staffName: n.staffName,
        summary: n.summary ?? null,
      })),
      shiftMonthLabel: thisMonthLabel,
      disputes: (qaDisputes ?? []).map((row) => ({
        auditId: row.auditId,
        auditLabel: row.auditLabel,
        itemId: QA_ITEM_BY_ID[row.item.itemId]?.text ?? row.item.itemId,
        item: row.item,
      })),
      onOpenIndividual,
      onInvestigate: (metric, sourceRecordId, sourceLabel) => {
        setInvestigationNotice("");
        setInvestigating({ metric, sourceRecordId, sourceLabel });
      },
      canInvestigate,
    }),
    [
      siteName,
      sortedOpenRequirements,
      siteIndividuals,
      siteStaff,
      workspace,
      qaDetail,
      drillBuckets,
      thisMonthLabel,
      safetyState,
      safetyLines,
      trainingRows,
      certRows,
      medStatus,
      shiftCoverage,
      qaDisputes,
      onOpenIndividual,
      canInvestigate,
    ],
  );

  const closeDrawer = () => {
    setDrawer(null);
    setInvestigating(null);
    setInvestigationNotice("");
  };

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

  const drawerMetricKey = drawer ? drawerMetric(drawer) : null;

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
            <button
              type="button"
              className="site-hero-score site-tile-button"
              onClick={() => setDrawer("requirements-ready")}
              aria-label={`Readiness ${siteReqMetrics.score} percent. View open requirements.`}
            >
              <strong>
                {siteReqMetrics.score}
                <small>%</small>
              </strong>
              <span>Ready</span>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${siteReqMetrics.score}%` }} />
              </div>
            </button>
            <button
              type="button"
              className="site-hero-stat site-tile-button"
              onClick={() => setDrawer("individuals")}
              aria-label={`${siteIndividuals.length} individuals. View roster.`}
            >
              <strong>{siteIndividuals.length}</strong>
              <span>Individuals</span>
            </button>
            <button
              type="button"
              className="site-hero-stat site-tile-button"
              onClick={() => setDrawer("staff")}
              aria-label={`${siteStaff.length} staff. View roster.`}
            >
              <strong>{siteStaff.length}</strong>
              <span>Staff</span>
            </button>
            <button
              type="button"
              className="site-hero-stat site-tile-button"
              onClick={() => setDrawer("requirements-open")}
              aria-label={`${openRequirements.length} open requirements. View open requirements.`}
            >
              <strong>{openRequirements.length}</strong>
              <span>Open</span>
            </button>
            <button
              type="button"
              className="site-hero-stat site-tile-button"
              onClick={() => setDrawer("qa")}
              aria-label={
                latestQaPct != null && latestQa
                  ? `QA review ${auditPeriodLabel(latestQa)}: ${latestQaPct} percent. View score detail.`
                  : "QA review: none yet. View score detail."
              }
            >
              <strong>{latestQaPct ?? "None"}</strong>
              <span>{latestQa ? auditPeriodLabel(latestQa) : "QA review"}</span>
            </button>
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

      {stripTiles.length > 0 && (
        <section className="site-strip" aria-label={`${site.name} trackables`}>
          {stripTiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={`site-hero-stat site-tile-button site-strip-tile ${toneToClass(tile.tone)}`}
              aria-label={tile.ariaLabel}
              onClick={() => {
                if (tile.drawer) setDrawer(tile.drawer);
                else if (tile.onClick) tile.onClick();
              }}
            >
              <strong>{tile.value}</strong>
              <span>{tile.label}</span>
              <span className="site-strip-sub">{tile.sub}</span>
            </button>
          ))}
        </section>
      )}

      {canInvestigate && (
        <InvestigationsPanel
          siteName={site.name}
          investigations={investigations}
          onChanged={() => trackables.refreshInvestigations()}
          sectionRef={investigationsRef}
        />
      )}

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
        {mileageError && activeTab === "mileage" && (
          <div className="panel site-detail-error" role="alert">
            {mileageError}
          </div>
        )}

        {activeTab === "overview" && (
          <>
            {openRequirements.length > 0 && (
              <div className="panel">
                <h2>Needs attention</h2>
                <ul className="record-list">
                  {sortedOpenRequirements
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

        {activeTab === "audits" && (
          <div className="panel">
            <h2>QA Review</h2>
            <div className="site-qa-body">
              <SiteQaReview siteId={siteId} siteName={site.name} />
            </div>
          </div>
        )}

        {activeTab === "checklists" && (
          <>
            <div className="panel">
              <h2>HM weekly checklists</h2>
              {!checklists?.length && (
                <Empty
                  mark="none"
                  title="No checklists"
                  text="No weekly checklists filed for this home yet."
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
              {onOpenPage &&
                !!checklists?.length &&
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
              <h2>Weekly service logs</h2>
              <p className="muted section-note">
                Service logs are a separate record from the weekly checklist.
              </p>
              {serviceLogs.length === 0 && (
                <Empty
                  mark="none"
                  title="No service logs"
                  text="No service log entries filed for this home yet."
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
            <SiteMonthlyChecks siteId={siteId} />
          </>
        )}

        {activeTab === "training" && (
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

        {activeTab === "medications" && (
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
            {mileageLoading && <p className="muted">Loading…</p>}
            {!mileageLoading && (!trips || trips.length === 0) && (
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

        {activeTab === "drills" && (
          <div className="panel">
            <h2>Emergency drills</h2>
            {siteDrills.length === 0 && (
              <Empty
                mark="none"
                title="No drills"
                text="No emergency drills recorded for this home yet."
              />
            )}
            {siteDrills.length > 0 && (
              <ul className="record-list">
                {siteDrills.map((d) => {
                  const dateLabel = d.date?.trim()
                    ? formatDate(d.date)
                    : "Not logged";
                  return (
                  <li key={d.id} className="record-row">
                    <div>
                      <strong>{formatDrillTypeLabel(d.drillType)} drill</strong>
                      <span className="muted">
                        {" "}
                        · {dateLabel}
                        {d.evacTime ? ` · evacuated in ${d.evacTime}` : ""}
                        {d.leaderName ? ` · led by ${d.leaderName}` : ""}
                      </span>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Issue #80: the Documents tab becomes Shift notes. Standalone
            document uploads stay reachable via the Documents page. */}
        {activeTab === "shiftnotes" && (
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
                {siteStaff.map((s) => {
                  const full = (workspace?.staff ?? []).find((row) => row.id === s.id);
                  return (
                  <li key={s.id} className="record-row">
                    <div>
                      <span className="person-cell">
                        <Avatar name={s.name} small />
                        <strong>{s.name}</strong>
                      </span>
                      <p className="muted">
                        {s.role}
                        {full?.username || full?.email ? ` · ${full.username || full.email}` : ""}
                      </p>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      <InspectionDrawer
        title={drawer ? drawerTitle(drawer) : null}
        subtitle={
          drawer && canInvestigate
            ? `${site.name} · tap Investigate on any record to start a follow-up`
            : undefined
        }
        onClose={closeDrawer}
        footer={
          drawer && investigating ? (
            <StartInvestigationForm
              siteId={siteId}
              sourceMetric={investigating.metric}
              sourceRecordId={investigating.sourceRecordId}
              sourceLabel={investigating.sourceLabel}
              staff={siteStaff}
              onCancel={() => setInvestigating(null)}
              onCreated={(created) => {
                setInvestigating(null);
                setInvestigationNotice(
                  `Investigation started${created.assignedToName ? ` — owner: ${created.assignedToName}` : ""}.`,
                );
                void trackables.refreshInvestigations();
              }}
            />
          ) : drawer && canInvestigate ? (
            <>
              {investigationNotice && (
                <p className="inspection-notice" role="status">
                  {investigationNotice}
                </p>
              )}
              <button
                type="button"
                className="button primary"
                onClick={() =>
                  setInvestigating({
                    metric: drawerMetricKey ?? "general",
                    sourceRecordId: null,
                    sourceLabel: "",
                  })
                }
              >
                Start investigation
              </button>
            </>
          ) : undefined
        }
      >
        {drawer && <DrawerBody kind={drawer} ctx={drawerCtx} />}
      </InspectionDrawer>
    </div>
  );
}
