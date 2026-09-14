/**
 * CommandCenter — the audit-readiness command center.
 *
 * Answers, from REAL workspace data:
 *   - Are we compliant? (agency + per-site score cards)
 *   - What puts us at risk? (risk list)
 *   - What is due next? (deadline timeline)
 *   - Are we ready for DMH review? (DMH readiness checklist)
 *   - What needs management attention today? (attention feed)
 *   - Corrective actions, missing requirements, the workflow library,
 *     and the score trend.
 *
 * Every fact traces to an API call in the default `CommandCenter` wrapper.
 * Where Complyrer does not yet track the evidence (e.g. FCSR dates, training
 * completion dates), the UI shows "Unknown" — never a guessed status.
 *
 * `CommandCenterView` is the pure presentational component: it takes loaded
 * data as props so UI/accessibility tests can render every section without
 * a live API.
 */
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data/DataProvider";
import { hasPermission } from "../data/permissions";
import {
  computeComplianceScore,
  computeSiteScores,
  mergeFacts,
  type ScoreFacts,
} from "../data/complianceScore";
import { collectRisks, riskCounts, type RiskContext } from "../data/riskRegistry";
import {
  buildTimeline,
  dueNext,
  TIMELINE_KIND_META,
  TIMELINE_URGENCY_META,
  type TimelineFacts,
} from "../data/deadlineTimeline";
import {
  ATTENTION_KIND_META,
  buildAttentionFeed,
} from "../data/attentionFeed";
import {
  evaluateReadiness,
  readinessByCategory,
  readinessCounts,
  readinessPercent,
  READINESS_STATUS_META,
} from "../data/auditReadiness";
import {
  DMH_REGULATORY_BASIS_NOTE,
  DMH_SOURCE_CAVEAT,
} from "../data/dmhRequirements";
import { findMissing, missingBySite } from "../data/missingRequirements";
import { WORKFLOW_TEMPLATES } from "../data/workflows";
import {
  CORRECTIVE_ACTION_STATUS_META,
  deriveCorrectiveActionStatus,
  sortCorrectiveActions,
  type CorrectiveAction,
} from "../data/correctiveActions";
import type { ScoreSnapshot } from "../data/complianceScore";
import type {
  ExpiringCertificate,
  HmWeeklyChecklist,
  StaffClearanceRow,
} from "../data/types";
import type { WorkspaceSite, WorkspaceView } from "../data/localApi";
import "./CommandCenter.css";

/** Everything the view needs, already loaded. */
export interface CommandCenterData {
  actions: CorrectiveAction[];
  certs: ExpiringCertificate[];
  clearance: StaffClearanceRow[];
  checklists: HmWeeklyChecklist[];
  snapshots: ScoreSnapshot[];
  staff: WorkspaceView["staff"];
  sites: WorkspaceSite[];
  requirements: WorkspaceView["requirements"];
  individuals: WorkspaceView["individuals"];
}

export interface AddActionInput {
  title: string;
  assignedToUserId: string | null;
  dueOn: string | null;
}

/**
 * Build per-site score facts from loaded data. Exported so the wrapper can
 * compute the agency score (for snapshot recording) with the same logic the
 * view renders.
 */
export function buildScoreFactsForData(data: CommandCenterData): ScoreFacts[] {
  const staffSite = new Map<string, { siteId: string | null; siteName: string }>();
  for (const person of data.staff) {
    staffSite.set(person.id, { siteId: person.siteId, siteName: person.site });
  }
  const siteNameById = new Map<string, string>();
  for (const site of data.sites) siteNameById.set(site.id, site.name);

  const bySite = new Map<string, ScoreFacts>();
  const get = (siteId: string | null, siteName: string): ScoreFacts => {
    const key = siteId ?? `name:${siteName}`;
    let facts = bySite.get(key);
    if (!facts) {
      facts = {
        siteId,
        siteName,
        requirements: [],
        certificates: [],
        checklists: [],
        training: [],
        medications: [],
      };
      bySite.set(key, facts);
    }
    return facts;
  };

  for (const req of data.requirements) {
    const facts = get(null, req.site);
    facts.requirements.push(
      req.status === "Overdue" ? "overdue" : req.status === "Due soon" ? "due" : "ok",
    );
  }

  for (const cert of data.certs) {
    const site = staffSite.get(cert.userId);
    const facts = get(site?.siteId ?? null, site?.siteName ?? "Unassigned");
    facts.certificates.push(
      cert.daysRemaining < 0 ? "expired" : cert.daysRemaining <= 30 ? "expiring" : "ok",
    );
  }

  for (const row of data.clearance) {
    const site = staffSite.get(row.userId);
    const facts = get(site?.siteId ?? null, site?.siteName ?? "Unassigned");
    facts.training.push(
      row.overdueCount > 0 ? "overdue" : row.pendingCount > 0 ? "incomplete" : "complete",
    );
  }

  for (const list of data.checklists) {
    const facts = get(list.siteId, siteNameById.get(list.siteId) ?? "Unknown site");
    facts.checklists.push(
      list.status === "submitted"
        ? "submitted"
        : list.status === "overdue" || list.late
          ? "late"
          : "due",
    );
  }

  return [...bySite.values()];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function bandMeta(band: string): { icon: string; label: string; className: string } {
  if (band === "compliant") return { icon: "✓", label: "Compliant", className: "cc-badge-ok" };
  if (band === "at-risk") return { icon: "!", label: "At risk", className: "cc-badge-warn" };
  return { icon: "✕", label: "Non-compliant", className: "cc-badge-bad" };
}

function riskMeta(severity: string): { icon: string; className: string } {
  if (severity === "critical") return { icon: "⬤", className: "cc-sev-critical" };
  if (severity === "warning") return { icon: "⬤", className: "cc-sev-high" };
  return { icon: "⬤", className: "cc-sev-low" };
}

export interface CommandCenterViewProps {
  data: CommandCenterData;
  canManage: boolean;
  onAddAction: (input: AddActionInput) => Promise<void>;
  onResolveAction: (id: string) => Promise<void>;
}

/** Pure presentational command center — every section renders from props. */
export function CommandCenterView({
  data,
  canManage,
  onAddAction,
  onResolveAction,
}: CommandCenterViewProps) {
  const { actions, certs, clearance, checklists, snapshots } = data;

  // Corrective-action form state (UI only).
  const [formTitle, setFormTitle] = useState("");
  const [formAssignee, setFormAssignee] = useState("");
  const [formDue, setFormDue] = useState("");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const staffSite = useMemo(() => {
    const map = new Map<string, { siteId: string | null; siteName: string }>();
    for (const person of data.staff) {
      map.set(person.id, { siteId: person.siteId, siteName: person.site });
    }
    return map;
  }, [data.staff]);

  const siteNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of data.sites) map.set(site.id, site.name);
    return map;
  }, [data.sites]);

  /* ---------------- score ---------------- */

  const siteFacts = useMemo(() => buildScoreFactsForData(data), [data]);

  const agencyScore = useMemo(() => {
    if (siteFacts.length === 0) return null;
    return computeComplianceScore(mergeFacts(siteFacts));
  }, [siteFacts]);

  const perSiteScores = useMemo(() => computeSiteScores(siteFacts), [siteFacts]);

  /* ---------------- risks, timeline, attention ---------------- */

  const riskContext: RiskContext = useMemo(
    () => ({
      now: new Date(),
      certificates: certs.map((cert) => ({
        id: cert.id,
        userId: cert.userId,
        staffName: cert.staffName,
        kind: cert.certName,
        expiresOn: cert.expiresOn,
        daysRemaining: cert.daysRemaining,
      })),
      checklists: checklists.map((list) => ({
        id: list.id,
        siteId: list.siteId,
        siteName: siteNameById.get(list.siteId) ?? "Unknown site",
        weekOf: list.weekOf,
        dueAt: list.dueAt ?? null,
        submitted: list.status === "submitted",
        late: list.late ?? list.status === "overdue",
      })),
      training: clearance
        .filter((row) => row.overdueCount > 0 || row.pendingCount > 0)
        .map((row) => ({
          id: row.userId,
          staffName: row.fullName,
          title: "Training clearance",
          status: (row.overdueCount > 0 ? "overdue" : "incomplete") as
            | "overdue"
            | "incomplete",
          dueOn: null,
        })),
      medications: [],
      requirements: data.requirements
        .filter((req) => req.status === "Overdue" || req.status === "Due soon")
        .map((req) => ({
          id: req.id,
          title: req.title,
          person: req.person,
          site: req.site,
          status: req.status as "Overdue" | "Expired",
        })),
      correctiveActions: actions.map((action) => ({
        id: action.id,
        title: action.title,
        assignedToName: action.assignedToName ?? undefined,
        dueOn: action.dueOn,
        overdue: deriveCorrectiveActionStatus(action, new Date()) === "overdue",
      })),
    }),
    [certs, checklists, clearance, actions, data.requirements, siteNameById],
  );

  const risks = useMemo(() => collectRisks(riskContext), [riskContext]);
  const riskTally = useMemo(() => riskCounts(risks), [risks]);

  const timelineFacts: TimelineFacts = useMemo(
    () => ({
      now: new Date(),
      certificates: certs.map((cert) => ({
        id: cert.id,
        userId: cert.userId,
        staffName: cert.staffName,
        kind: cert.certName,
        expiresOn: cert.expiresOn,
      })),
      trainings: [],
      planRenewals: [],
      checklists: checklists
        .filter((list) => list.status !== "submitted" && list.dueAt)
        .map((list) => ({
          id: list.id,
          siteName: siteNameById.get(list.siteId) ?? "Unknown site",
          checklistTitle: "Weekly checklist",
          dueOn: (list.dueAt as string).slice(0, 10),
          submitted: false,
        })),
      medications: [],
      correctiveActions: actions.map((action) => ({
        id: action.id,
        title: action.title,
        assignedToName: action.assignedToName ?? undefined,
        dueOn: action.dueOn,
        status: deriveCorrectiveActionStatus(action, new Date()),
      })),
      providerRecertification: null,
    }),
    [certs, checklists, actions, siteNameById],
  );

  const timeline = useMemo(() => buildTimeline(timelineFacts), [timelineFacts]);
  const nextUp = useMemo(() => dueNext(timelineFacts, 5), [timelineFacts]);
  const attention = useMemo(
    () => buildAttentionFeed({ riskContext, timelineFacts }),
    [riskContext, timelineFacts],
  );

  /* ---------------- DMH readiness (honest evidence) ---------------- */

  const readiness = useMemo(
    () =>
      evaluateReadiness({
        providerCertificate: null,
        administrator: null,
        staffTraining: [],
        medAides: [],
        incidents: [],
        correctiveActions: actions,
        pocSurveyExitOn: null,
        pocSubmittedOn: null,
        pocFinalCorrectionOn: null,
      }),
    [actions],
  );
  const readinessTotal = useMemo(() => readinessCounts(readiness), [readiness]);
  const readinessScore = useMemo(() => readinessPercent(readiness), [readiness]);
  const readinessByCat = useMemo(() => readinessByCategory(readiness), [readiness]);

  /* ---------------- missing requirements ---------------- */

  const missing = useMemo(() => {
    const certKinds = [...new Set(certs.map((cert) => cert.certName))];
    return findMissing({
      now: new Date(),
      staff: data.staff.map((person) => ({
        userId: person.id,
        name: person.name,
        siteName: person.site,
      })),
      requiredCertificateKinds: certKinds,
      certificates: certs.map((cert) => ({
        userId: cert.userId,
        staffName: cert.staffName,
        kind: cert.certName,
        expiresOn: cert.expiresOn,
      })),
      requiredTrainingTopics: [],
      trainings: [],
      individuals: data.individuals.map((person) => ({
        id: person.id,
        name: person.name,
        siteName: person.site,
      })),
      requiredIndividualDocuments: [],
      individualDocuments: [],
      checklists: checklists.map((list) => ({
        siteName: siteNameById.get(list.siteId) ?? "Unknown site",
        checklistTitle: "Weekly checklist",
        dueOn: list.dueAt ? list.dueAt.slice(0, 10) : todayIso(),
        submitted: list.status === "submitted",
      })),
    });
  }, [certs, data.staff, data.individuals, checklists, siteNameById]);
  const missingRollup = useMemo(() => missingBySite(missing), [missing]);

  /* ---------------- corrective-action handlers ---------------- */

  async function handleAddAction(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    const title = formTitle.trim();
    if (!title) {
      setFormError("Give the corrective action a title.");
      return;
    }
    setFormBusy(true);
    try {
      await onAddAction({
        title,
        assignedToUserId: formAssignee || null,
        dueOn: formDue || null,
      });
      setFormTitle("");
      setFormAssignee("");
      setFormDue("");
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not add the corrective action.",
      );
    } finally {
      setFormBusy(false);
    }
  }

  /* ---------------- trend chart ---------------- */

  const chart = useMemo(() => {
    if (snapshots.length === 0) return null;
    const width = 320;
    const height = 120;
    const pad = 12;
    const xFor = (i: number) =>
      snapshots.length === 1
        ? width / 2
        : pad + (i * (width - pad * 2)) / (snapshots.length - 1);
    const yFor = (score: number) =>
      height - pad - (score / 100) * (height - pad * 2);
    const points = snapshots.map((snap, i) => `${xFor(i)},${yFor(snap.score)}`).join(" ");
    return { width, height, points, xFor, yFor };
  }, [snapshots]);

  /* ---------------- render ---------------- */

  const scoreBand = agencyScore ? bandMeta(agencyScore.band) : null;

  return (
    <div className="cc-wrap">
      <header className="cc-header">
        <div>
          <h1 className="cc-title">Audit readiness</h1>
          <p className="cc-subtitle">
            Are we compliant? What puts us at risk? What is due next? What needs
            attention today?
          </p>
        </div>
        <div className="cc-score-card" aria-live="polite">
          <span className="cc-score-label">Agency score</span>
          {agencyScore && scoreBand ? (
            <>
              <span className="cc-score-number">{agencyScore.score}</span>
              <span className={`cc-badge ${scoreBand.className}`}>
                <span aria-hidden="true">{scoreBand.icon}</span>
                <span>{scoreBand.label}</span>
              </span>
              <span className="cc-score-facts">
                {agencyScore.factCount} facts checked · {riskTally.critical} critical ·{" "}
                {riskTally.warning} warnings
              </span>
            </>
          ) : (
            <span className="cc-score-facts">Not enough connected data to score yet.</span>
          )}
        </div>
      </header>

      {/* Management attention feed */}
      <section className="cc-section" aria-labelledby="cc-attention">
        <h2 id="cc-attention" className="cc-section-title">
          What needs attention today
          <span className="cc-count">{attention.length}</span>
        </h2>
        {attention.length === 0 ? (
          <p className="cc-empty">Nothing overdue or due today. The day is clear.</p>
        ) : (
          <ul className="cc-list">
            {attention.slice(0, 6).map((item) => {
              const meta = ATTENTION_KIND_META[item.kind];
              const sev = riskMeta(item.severity);
              return (
                <li key={item.id} className="cc-item">
                  <span className={`cc-sev ${sev.className}`} aria-hidden="true">
                    {sev.icon}
                  </span>
                  <div className="cc-item-body">
                    <span className="cc-item-title">{item.title}</span>
                    <span className="cc-item-detail">
                      {item.detail} · {meta.label}
                      {item.personName ? ` · ${item.personName}` : ""}
                      {item.siteName ? ` · ${item.siteName}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Due next */}
      <section className="cc-section" aria-labelledby="cc-duenext">
        <h2 id="cc-duenext" className="cc-section-title">Due next</h2>
        {nextUp.length === 0 ? (
          <p className="cc-empty">No dated deadlines on record.</p>
        ) : (
          <ul className="cc-list">
            {nextUp.map((item) => {
              const kindMeta = TIMELINE_KIND_META[item.kind];
              const urgencyMeta = TIMELINE_URGENCY_META[item.urgency];
              return (
                <li key={item.id} className="cc-item">
                  <span className={`cc-urgency cc-urgency-${item.urgency}`} aria-hidden="true">
                    {urgencyMeta.icon}
                  </span>
                  <div className="cc-item-body">
                    <span className="cc-item-title">{item.title}</span>
                    <span className="cc-item-detail">
                      {item.detail} · {kindMeta.label} ·{" "}
                      <strong className={`cc-urgency-text cc-urgency-${item.urgency}`}>
                        {urgencyMeta.icon} {urgencyMeta.label}
                      </strong>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Per-site scores */}
      <section className="cc-section" aria-labelledby="cc-sites">
        <h2 id="cc-sites" className="cc-section-title">Scores by site</h2>
        {perSiteScores.length === 0 ? (
          <p className="cc-empty">No site facts yet.</p>
        ) : (
          <div className="cc-grid">
            {perSiteScores.map((site) => {
              const meta = bandMeta(site.band);
              return (
                <article key={site.siteId ?? site.siteName} className="cc-card">
                  <h3 className="cc-card-title">{site.siteName ?? "Unknown site"}</h3>
                  <p className="cc-card-score">
                    <span className="cc-score-number cc-score-number-sm">{site.score}</span>
                    <span className={`cc-badge ${meta.className}`}>
                      <span aria-hidden="true">{meta.icon}</span>
                      <span>{meta.label}</span>
                    </span>
                  </p>
                  <p className="cc-card-facts">{site.factCount} facts checked</p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Risks */}
      <section className="cc-section" aria-labelledby="cc-risks">
        <h2 id="cc-risks" className="cc-section-title">
          What puts us at risk
          <span className="cc-count">{risks.length}</span>
        </h2>
        <p className="cc-section-note">
          {riskTally.critical} critical · {riskTally.warning} warning · {riskTally.info} info
        </p>
        {risks.length === 0 ? (
          <p className="cc-empty">No risks flagged from current data.</p>
        ) : (
          <ul className="cc-list">
            {risks.slice(0, 10).map((risk) => {
              const sev = riskMeta(risk.severity);
              return (
                <li key={risk.id} className="cc-item">
                  <span className={`cc-sev ${sev.className}`} aria-hidden="true">
                    {sev.icon}
                  </span>
                  <div className="cc-item-body">
                    <span className="cc-item-title">
                      {risk.title}
                      <span className={`cc-sev-label ${sev.className}`}>{risk.severity}</span>
                    </span>
                    <span className="cc-item-detail">
                      {risk.detail}
                      {risk.personName ? ` · ${risk.personName}` : ""}
                      {risk.siteName ? ` · ${risk.siteName}` : ""} · {risk.sourceLabel}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Corrective actions */}
      <section className="cc-section" aria-labelledby="cc-actions">
        <h2 id="cc-actions" className="cc-section-title">
          Corrective actions
          <span className="cc-count">{actions.length}</span>
        </h2>
        {canManage ? (
          <form className="cc-form" onSubmit={handleAddAction}>
            <label className="cc-field">
              <span>Action title</span>
              <input
                type="text"
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="e.g. Re-train night shift on incident reporting"
                minLength={3}
                required
              />
            </label>
            <label className="cc-field">
              <span>Assign to</span>
              <select value={formAssignee} onChange={(event) => setFormAssignee(event.target.value)}>
                <option value="">Unassigned</option>
                {data.staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} — {person.site}
                  </option>
                ))}
              </select>
            </label>
            <label className="cc-field">
              <span>Due date</span>
              <input
                type="date"
                value={formDue}
                onChange={(event) => setFormDue(event.target.value)}
              />
            </label>
            <button type="submit" className="cc-button cc-button-primary" disabled={formBusy}>
              {formBusy ? "Adding…" : "Add corrective action"}
            </button>
            {formError && (
              <p className="cc-form-error" role="alert">
                {formError}
              </p>
            )}
          </form>
        ) : (
          <p className="cc-section-note">
            You can view corrective actions; managing them needs the correctiveActions.manage
            permission.
          </p>
        )}
        {actions.length === 0 ? (
          <p className="cc-empty">No corrective actions on record.</p>
        ) : (
          <ul className="cc-list">
            {actions.map((action) => {
              const status = deriveCorrectiveActionStatus(action, new Date());
              const meta = CORRECTIVE_ACTION_STATUS_META[status];
              return (
                <li key={action.id} className="cc-item">
                  <span className={`cc-badge cc-status-${status}`}>
                    <span aria-hidden="true">{meta.icon}</span>
                    <span>{meta.label}</span>
                  </span>
                  <div className="cc-item-body">
                    <span className="cc-item-title">{action.title}</span>
                    <span className="cc-item-detail">
                      {action.assignedToName ? `Owner: ${action.assignedToName}` : "Unassigned"}
                      {action.dueOn ? ` · Due ${action.dueOn}` : " · No due date"}
                    </span>
                  </div>
                  {canManage && status !== "resolved" && (
                    <button
                      type="button"
                      className="cc-button"
                      onClick={() => onResolveAction(action.id)}
                    >
                      Resolve
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* DMH readiness */}
      <section className="cc-section" aria-labelledby="cc-readiness">
        <h2 id="cc-readiness" className="cc-section-title">DMH review readiness</h2>
        <p className="cc-section-note">{DMH_REGULATORY_BASIS_NOTE}</p>
        <p className="cc-section-note cc-caveat">{DMH_SOURCE_CAVEAT}</p>
        <p className="cc-section-note" aria-live="polite">
          {readinessScore === null ? (
            <>Not enough evidence connected yet to compute readiness.</>
          ) : (
            <>
              <strong>{readinessScore}%</strong> ready · {readinessTotal.met} met ·{" "}
              {readinessTotal["at-risk"]} at risk · {readinessTotal.unmet} unmet ·{" "}
              {readinessTotal.unknown} unknown
            </>
          )}
        </p>
        {readinessByCat.map((group) => (
          <details key={group.key} className="cc-details">
            <summary className="cc-details-summary">
              {group.label}
              <span className="cc-count">
                {group.items.filter((item) => item.status === "met").length}/{group.items.length}{" "}
                met
              </span>
            </summary>
            <ul className="cc-list">
              {group.items.map((item) => {
                const meta = READINESS_STATUS_META[item.status];
                return (
                  <li key={item.requirement.id} className="cc-item">
                    <span className={`cc-badge cc-status-${item.status}`}>
                      <span aria-hidden="true">{meta.icon}</span>
                      <span>{meta.label}</span>
                    </span>
                    <div className="cc-item-body">
                      <span className="cc-item-title">{item.requirement.title}</span>
                      <span className="cc-item-detail">
                        {item.requirement.cite} · {item.detail}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </section>

      {/* Missing requirements */}
      <section className="cc-section" aria-labelledby="cc-missing">
        <h2 id="cc-missing" className="cc-section-title">
          Missing requirements
          <span className="cc-count">{missing.length}</span>
        </h2>
        {missing.length === 0 ? (
          <p className="cc-empty">No gaps found in connected data.</p>
        ) : (
          <div className="cc-grid">
            {missingRollup.map((rollup) => (
              <article key={rollup.siteName} className="cc-card">
                <h3 className="cc-card-title">{rollup.siteName}</h3>
                <ul className="cc-list cc-list-compact">
                  {rollup.items.slice(0, 5).map((item) => (
                    <li key={item.id} className="cc-item cc-item-compact">
                      <span className="cc-badge cc-badge-bad" aria-hidden="true">
                        <span>✕</span>
                      </span>
                      <div className="cc-item-body">
                        <span className="cc-item-title">
                          {item.what}
                          {item.expired ? " (expired)" : " (missing)"}
                        </span>
                        <span className="cc-item-detail">
                          {item.ownerName}
                          {item.contextName ? ` · ${item.contextName}` : ""} · {item.kind}
                        </span>
                      </div>
                    </li>
                  ))}
                  {rollup.items.length > 5 && (
                    <li className="cc-item cc-item-compact">
                      <span className="cc-item-detail">
                        +{rollup.items.length - 5} more
                      </span>
                    </li>
                  )}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Workflow library */}
      <section className="cc-section" aria-labelledby="cc-workflows">
        <h2 id="cc-workflows" className="cc-section-title">Workflow library</h2>
        <p className="cc-section-note">
          Ready-made wording for the notices, reminders, and escalations Complyrer sends.
        </p>
        <div className="cc-grid">
          {WORKFLOW_TEMPLATES.map((template) => (
            <article key={template.id} className="cc-card">
              <h3 className="cc-card-title">{template.name}</h3>
              <p className="cc-card-facts">{template.description}</p>
              <p className="cc-card-facts">
                Trigger: {template.trigger} · {template.action} · Audience: {template.audience}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Score trend */}
      <section className="cc-section" aria-labelledby="cc-trend">
        <h2 id="cc-trend" className="cc-section-title">Score trend</h2>
        {chart ? (
          <figure className="cc-chart">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label={`Compliance score trend: latest score ${snapshots[snapshots.length - 1].score} of 100 across ${snapshots.length} snapshots.`}
              className="cc-chart-svg"
            >
              <line
                x1={chart.xFor(0)}
                y1={chart.yFor(90)}
                x2={chart.xFor(snapshots.length - 1)}
                y2={chart.yFor(90)}
                className="cc-chart-threshold"
              />
              <polyline points={chart.points} className="cc-chart-line" />
              {snapshots.map((snap, i) => (
                <circle
                  key={snap.id ?? i}
                  cx={chart.xFor(i)}
                  cy={chart.yFor(snap.score)}
                  r={4}
                  className="cc-chart-dot"
                >
                  <title>{`${snap.computedAt.slice(0, 10)}: ${snap.score}`}</title>
                </circle>
              ))}
            </svg>
            <figcaption className="cc-chart-caption">
              Daily agency score snapshots. Dashed line marks 90 (compliant).
            </figcaption>
          </figure>
        ) : (
          <p className="cc-empty">
            The trend appears after the first snapshot is saved — it is recorded
            each day the command center loads.
          </p>
        )}
      </section>

      {/* Full timeline */}
      <section className="cc-section" aria-labelledby="cc-timeline">
        <h2 id="cc-timeline" className="cc-section-title">
          All upcoming deadlines
          <span className="cc-count">{timeline.length}</span>
        </h2>
        {timeline.length === 0 ? (
          <p className="cc-empty">No dated deadlines on record.</p>
        ) : (
          <ul className="cc-list">
            {timeline.map((item) => {
              const kindMeta = TIMELINE_KIND_META[item.kind];
              const urgencyMeta = TIMELINE_URGENCY_META[item.urgency];
              return (
                <li key={item.id} className="cc-item">
                  <span className="cc-item-date">{item.dueOn}</span>
                  <div className="cc-item-body">
                    <span className="cc-item-title">{item.title}</span>
                    <span className="cc-item-detail">
                      {item.detail} · {kindMeta.label} ·{" "}
                      {item.daysRemaining < 0
                        ? `${Math.abs(item.daysRemaining)} days overdue`
                        : item.daysRemaining === 0
                          ? "due today"
                          : `${item.daysRemaining} days remaining`}
                    </span>
                  </div>
                  <span className={`cc-badge cc-urgency-badge cc-urgency-${item.urgency}`}>
                    <span aria-hidden="true">{urgencyMeta.icon}</span>
                    <span>{urgencyMeta.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Data-loading wrapper: fetches from the API, then renders the view. */
export default function CommandCenter() {
  const { api, session, workspace } = useData();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<CommandCenterData | null>(null);

  const canManage = Boolean(
    session && hasPermission(session, "correctiveActions.manage"),
  );

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [actions, certs, clearance, checklists, snapshots] = await Promise.all([
        api.listCorrectiveActions(),
        api.certificatesExpiringSoon(120),
        api.listStaffNeedingClearance().catch(() => [] as StaffClearanceRow[]),
        api.listWeeklyChecklists().catch(() => [] as HmWeeklyChecklist[]),
        api.listComplianceSnapshots(null, 30).catch(() => [] as ScoreSnapshot[]),
      ]);
      setData({
        actions: sortCorrectiveActions(actions, new Date()),
        certs,
        clearance,
        checklists,
        snapshots,
        staff: workspace?.staff ?? [],
        sites: workspace?.sites ?? [],
        requirements: workspace?.requirements ?? [],
        individuals: workspace?.individuals ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the command center.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Record today's agency snapshot once data is loaded (managers only).
  useEffect(() => {
    if (!data || !canManage || data.snapshots.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const facts = buildScoreFactsForData(data);
        if (facts.length === 0) return;
        const score = computeComplianceScore(mergeFacts(facts));
        await api.saveComplianceSnapshot({ siteId: null, result: score });
        if (!cancelled) {
          const rows = await api.listComplianceSnapshots(null, 30);
          setData((current) => (current ? { ...current, snapshots: rows } : current));
        }
      } catch {
        // Snapshots are nice-to-have; never break the command center.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data !== null, canManage]);

  async function handleAddAction(input: AddActionInput) {
    const created = await api.addCorrectiveAction({
      title: input.title,
      assignedToUserId: input.assignedToUserId,
      dueOn: input.dueOn,
    });
    setData((current) =>
      current
        ? { ...current, actions: sortCorrectiveActions([...current.actions, created], new Date()) }
        : current,
    );
  }

  async function handleResolveAction(id: string) {
    const updated = await api.resolveCorrectiveAction(id);
    setData((current) =>
      current
        ? {
            ...current,
            actions: sortCorrectiveActions(
              current.actions.map((row) => (row.id === id ? updated : row)),
              new Date(),
            ),
          }
        : current,
    );
  }

  if (loading) {
    return (
      <div className="cc-wrap" aria-busy="true">
        <p className="cc-loading">Loading the command center…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="cc-wrap" role="alert">
        <p className="cc-error">{error || "Could not load the command center."}</p>
        <button type="button" className="cc-button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
      <CommandCenterView
        data={data}
        canManage={canManage}
        onAddAction={handleAddAction}
        onResolveAction={handleResolveAction}
      />
    </>
  );
}
