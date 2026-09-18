/**
 * Issue #98 — agency-wide metrics: one cross-site rollup panel on the agency
 * Overview dashboard so management sees which homes need attention.
 *
 * The panel adds ONE new section; existing Dashboard panels are untouched.
 * Rows are per accessible site (the `sites` prop already reflects
 * canAccessSite) and are clickable buttons that focus the dashboard on the
 * site — the same affordance as the existing program-site score cards.
 *
 * Data loading (per mount, in parallel):
 * - drills: synchronous from the preloaded workspace payload (no API call).
 * - certificates: one api.certificatesExpiringSoon(60) call, grouped by staff site.
 * - training: one api.listStaffNeedingClearance(siteId) call per site — the
 *   per-staff gate evaluation happens server-side, so this stays a single
 *   light call per site rather than N profile fetches.
 * - med supply: one api.getMedicationSupplyStatus(siteId) call per site,
 *   cached in a ref so re-renders never refetch; skeleton rows show while loading.
 * - shift notes: one api.getSiteShiftNotes(siteId) call per site.
 * Columns are gated per metric by rollupMetricVisibility() — a role only
 * sees metrics its read permissions cover (the APIs enforce the same gates).
 */
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronRight } from "lucide-react";
import { Badge } from "../../components";
import { useData } from "../../data/DataProvider";
import { monthLabel } from "../../data/monthlyChecks";
import { todayIso } from "../../data/chart";
import type {
  ExpiringCertificate,
  MedSupplyStatus,
  StaffClearanceRow,
} from "../../data/types";
import type { SiteShiftNoteView } from "../../data/shiftNotes";
import {
  anyRollupVisible,
  certificateSiteRollup,
  currentMonthKey,
  drillSiteRollup,
  medSiteRollup,
  rollupMetricVisibility,
  shiftNoteSiteRollup,
  toneBadgeStatus,
  trainingSiteRollup,
  worstTone,
  type RollupMetricVisibility,
  type RollupTone,
} from "./siteRollups";

export interface RollupSite {
  id: string;
  name: string;
  program?: string;
  color?: string;
}

interface Props {
  sites: RollupSite[];
  /** Current dashboard site filter (for the selected-row state). */
  site: string;
  onSite: (s: string) => void;
}

type MetricKey = keyof RollupMetricVisibility;

interface LoadedRollups {
  certsBySite: Map<string, ExpiringCertificate[]> | null;
  trainingBySite: Map<string, StaffClearanceRow[]> | null;
  medsBySite: Map<string, MedSupplyStatus> | null;
  notesBySite: Map<string, SiteShiftNoteView[]> | null;
}

const EMPTY: LoadedRollups = {
  certsBySite: null,
  trainingBySite: null,
  medsBySite: null,
  notesBySite: null,
};

export default function SiteRollupPanel({ sites, site, onSite }: Props) {
  const { api, session, workspace } = useData();
  const [data, setData] = useState<LoadedRollups>(EMPTY);
  const [failed, setFailed] = useState<Set<MetricKey>>(new Set());
  // Med-supply cache: one status per site id; avoids refetching on re-render.
  const medCache = useRef(new Map<string, MedSupplyStatus>());

  const visibility = session ? rollupMetricVisibility(session) : null;

  useEffect(() => {
    const vis: RollupMetricVisibility | null = visibility;
    if (!session || !workspace || !vis) return;
    // From here on, vis is non-null; keep a narrowed alias for closures.
    const gates: RollupMetricVisibility = vis;
    let cancelled = false;
    const fail = (key: MetricKey) =>
      setFailed((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

    async function load() {
      const siteIds = sites.map((s) => s.id);
      const jobs: Promise<void>[] = [];

      if (gates.certificates) {
        jobs.push(
          api
            .certificatesExpiringSoon(60)
            .then((rows) => {
              if (cancelled) return;
              const staffSite = new Map(
                workspace!.staff.map((row) => [row.id, row.siteId]),
              );
              const bySite = new Map<string, ExpiringCertificate[]>();
              for (const cert of rows) {
                const certSiteId = staffSite.get(cert.userId);
                if (!certSiteId) continue; // cannot attribute to a site
                const list = bySite.get(certSiteId) ?? [];
                list.push(cert);
                bySite.set(certSiteId, list);
              }
              setData((d) => ({ ...d, certsBySite: bySite }));
            })
            .catch(() => fail("certificates")),
        );
      }
      if (gates.training) {
        jobs.push(
          (async () => {
            try {
              const entries = await Promise.all(
                siteIds.map(async (siteId) => {
                  const rows = await api.listStaffNeedingClearance(siteId);
                  return [siteId, rows] as const;
                }),
              );
              if (!cancelled)
                setData((d) => ({
                  ...d,
                  trainingBySite: new Map(entries),
                }));
            } catch {
              fail("training");
            }
          })(),
        );
      }
      if (gates.meds) {
        jobs.push(
          (async () => {
            try {
              const entries = await Promise.all(
                siteIds.map(async (siteId) => {
                  const cached = medCache.current.get(siteId);
                  if (cached) return [siteId, cached] as const;
                  const status = await api.getMedicationSupplyStatus(siteId);
                  medCache.current.set(siteId, status);
                  return [siteId, status] as const;
                }),
              );
              if (!cancelled)
                setData((d) => ({ ...d, medsBySite: new Map(entries) }));
            } catch {
              fail("meds");
            }
          })(),
        );
      }
      if (gates.shiftNotes) {
        jobs.push(
          (async () => {
            try {
              const entries = await Promise.all(
                siteIds.map(async (siteId) => {
                  const notes = await api.getSiteShiftNotes(siteId);
                  return [siteId, notes] as const;
                }),
              );
              if (!cancelled)
                setData((d) => ({ ...d, notesBySite: new Map(entries) }));
            } catch {
              fail("shiftNotes");
            }
          })(),
        );
      }
      await Promise.allSettled(jobs);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // Load once per session; the workspace payload (drills, staff, due day)
    // is read synchronously during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, session?.agencyId]);

  if (!session || !workspace || !visibility || !anyRollupVisible(visibility)) {
    return null;
  }

  const visible: RollupMetricVisibility = {
    drills: visibility.drills && !failed.has("drills"),
    training: visibility.training && !failed.has("training") && data.trainingBySite !== null,
    certificates:
      visibility.certificates && !failed.has("certificates") && data.certsBySite !== null,
    meds: visibility.meds && !failed.has("meds") && data.medsBySite !== null,
    shiftNotes:
      visibility.shiftNotes && !failed.has("shiftNotes") && data.notesBySite !== null,
  };
  const columns = (Object.keys(visible) as MetricKey[]).filter((k) => visible[k]);
  if (columns.length === 0) return null; // every permitted metric failed to load
  const loading =
    (visibility.training && !failed.has("training") && data.trainingBySite === null) ||
    (visibility.certificates && !failed.has("certificates") && data.certsBySite === null) ||
    (visibility.meds && !failed.has("meds") && data.medsBySite === null) ||
    (visibility.shiftNotes && !failed.has("shiftNotes") && data.notesBySite === null);

  const monthKey = currentMonthKey(todayIso());
  const dueDay = workspace.monthlyDue.drillDay;
  const today = todayIso();
  const individualsBySite = new Map<string, number>();
  for (const row of workspace.individuals) {
    if (row.siteId) individualsBySite.set(row.siteId, (individualsBySite.get(row.siteId) ?? 0) + 1);
  }

  const columnLabels: Record<MetricKey, string> = {
    drills: "Drills",
    training: "Training",
    certificates: "Certificates",
    meds: "Med supply",
    shiftNotes: "Shift notes",
  };

  interface RowMetric {
    key: MetricKey;
    label: string;
    detail?: string;
    tone: RollupTone;
  }

  const rows = sites.map((s) => {
    const metrics: RowMetric[] = [];
    if (visible.drills) {
      const r = drillSiteRollup(workspace.monthly.drills, s.id, monthKey, today, dueDay);
      metrics.push({
        key: "drills",
        label: r.label,
        detail: r.missingLabels.length ? `Missing: ${r.missingLabels.join(", ")}` : undefined,
        tone: r.tone,
      });
    }
    if (visible.training) {
      const r = trainingSiteRollup(data.trainingBySite!.get(s.id) ?? []);
      metrics.push({ key: "training", label: r.label, tone: r.tone });
    }
    if (visible.certificates) {
      const r = certificateSiteRollup(data.certsBySite!.get(s.id) ?? []);
      metrics.push({ key: "certificates", label: r.label, tone: r.tone });
    }
    if (visible.meds) {
      const status = data.medsBySite!.get(s.id);
      if (status) {
        const r = medSiteRollup(status);
        metrics.push({ key: "meds", label: r.label, tone: r.tone });
      }
    }
    if (visible.shiftNotes) {
      const r = shiftNoteSiteRollup(
        data.notesBySite!.get(s.id) ?? [],
        monthKey,
        individualsBySite.get(s.id) ?? 0,
      );
      metrics.push({ key: "shiftNotes", label: r.label, tone: r.tone });
    }
    return { site: s, metrics, tone: worstTone(metrics.map((m) => m.tone)) };
  });

  return (
    <section className="panel site-rollup-panel" aria-label="Agency-wide site rollup">
      <div className="panel-heading">
        <div>
          <h2>Agency rollup</h2>
          <p>
            Cross-site attention view · {monthLabel(monthKey)}. Open a row to
            focus this dashboard on that home.
          </p>
        </div>
      </div>
      {sites.length === 0 ? (
        <div className="rollup-empty">
          <p>No program sites assigned to you yet.</p>
        </div>
      ) : loading ? (
        <div className="rollup-scroll" aria-busy="true" aria-label="Loading site rollup">
          <div
            className="rollup-grid"
            style={{ "--rollup-cols": columns.length } as React.CSSProperties}
          >
            <div className="rollup-head" aria-hidden="true">
              <span>Home</span>
              {columns.map((key) => (
                <span key={key}>{columnLabels[key]}</span>
              ))}
              <span>Status</span>
              <span />
            </div>
            {[0, 1, 2].map((i) => (
              <div className="rollup-row is-skeleton" key={i} aria-hidden="true">
                <span className="rollup-site">
                  <span className="skeleton-bar" />
                </span>
                {columns.map((key) => (
                  <span key={key} className="rollup-cell">
                    <span className="skeleton-bar" />
                  </span>
                ))}
                <span className="rollup-cell">
                  <span className="skeleton-bar" />
                </span>
                <span />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rollup-scroll">
          <div
            className="rollup-grid"
            style={{ "--rollup-cols": columns.length } as React.CSSProperties}
            role="table"
            aria-label={`Site rollup for ${monthLabel(monthKey)}`}
          >
            <div className="rollup-head" role="row" aria-hidden="true">
              <span role="columnheader">Home</span>
              {columns.map((key) => (
                <span key={key} role="columnheader">
                  {columnLabels[key]}
                </span>
              ))}
              <span role="columnheader">Status</span>
              <span />
            </div>
            {rows.map(({ site: s, metrics, tone }) => {
              const selected = site === s.name;
              return (
                <button
                  type="button"
                  key={s.id}
                  role="row"
                  className={`rollup-row tone-${tone}${selected ? " selected" : ""}`}
                  aria-label={`${s.name} site rollup: ${toneBadgeStatus(tone)}`}
                  onClick={() => onSite(selected ? "All sites" : s.name)}
                  title={`${s.name} — open to focus this dashboard`}
                >
                  <span className="rollup-site" role="cell">
                    <span className={`house-icon ${s.color ?? "purple"}`}>
                      <Building2 size={16} />
                    </span>
                    <span>
                      <strong>{s.name}</strong>
                      {s.program ? <small>{s.program}</small> : null}
                    </span>
                  </span>
                  {metrics.map((m) => (
                    <span
                      key={m.key}
                      className={`rollup-cell tone-${m.tone}`}
                      role="cell"
                      title={m.detail ?? m.label}
                    >
                      {m.label}
                    </span>
                  ))}
                  <span className="rollup-status" role="cell">
                    <Badge status={toneBadgeStatus(tone)} />
                  </span>
                  <ChevronRight size={16} className="rollup-chevron" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
