import { ArrowUpRight } from "lucide-react";
import { Avatar, Badge, Empty, formatDate } from "../../components";
import { QA_SECTIONS } from "../../data/qaAudit";
import {
  INVESTIGATION_SOURCE_LABELS,
  type InvestigationSourceMetric,
} from "../../data/investigations";
import { trainingProgressLine } from "./siteDetailCopy";
import type {
  CertExpiryRow,
  DrillBucket,
  QaDisputeRowLike,
  TrainingRowLike,
} from "./drawerTypes";

export type DrawerKind =
  | "requirements-ready"
  | "requirements-open"
  | "individuals"
  | "staff"
  | "qa"
  | "drills"
  | "safety"
  | "training"
  | "certificates"
  | "meds"
  | "shiftnotes"
  | "qa_disputes";

export function drawerMetric(kind: DrawerKind): InvestigationSourceMetric {
  switch (kind) {
    case "requirements-ready":
    case "requirements-open":
      return "requirements";
    case "individuals":
    case "staff":
      return "general";
    case "qa":
      return "qa_score";
    case "drills":
      return "drills";
    case "safety":
      return "safety";
    case "training":
      return "training";
    case "certificates":
      return "certificates";
    case "meds":
      return "meds";
    case "shiftnotes":
      return "shiftnotes";
    case "qa_disputes":
      return "qa_disputes";
  }
}

export function drawerTitle(kind: DrawerKind): string {
  switch (kind) {
    case "requirements-ready":
      return "Readiness — open requirements";
    case "requirements-open":
      return "Open requirements";
    case "individuals":
      return "Individuals at this home";
    case "staff":
      return "Staff at this home";
    case "qa":
      return "QA review score";
    case "drills":
      return "Emergency drills — this month";
    case "safety":
      return "Home safety report — this month";
    case "training":
      return "Training & in-ratio clearance";
    case "certificates":
      return "Certificates expiring within 60 days";
    case "meds":
      return "Medication supply alerts";
    case "shiftnotes":
      return "Shift notes — this month";
    case "qa_disputes":
      return "QA disputes under review";
  }
}

export interface RequirementLike {
  id: string;
  title: string;
  person: string;
  due?: string;
  status: string;
}

export interface PersonLike {
  id: string;
  name: string;
  color?: string;
  photoUrl?: string | null;
}

export interface StaffLike {
  id: string;
  name: string;
  role: string;
  username?: string | null;
  email?: string | null;
}

export interface QaDetailLike {
  periodLabel: string;
  pct: number | null;
  sections: Array<{ id: string; title: string; pct: number | null }>;
  criticalFails: number;
}

export interface MedAlertLike {
  id: string;
  individualId: string;
  individualName: string;
  medicationName: string;
  strength: string;
  status: string;
  countdownLabel: string;
}

export interface ShiftNoteLike {
  id: string;
  individualName: string;
  noteDate: string;
  shift: string;
  programName: string;
  staffName: string;
  summary?: string | null;
}

export interface DrawerContext {
  siteName: string;
  requirements: RequirementLike[];
  individuals: PersonLike[];
  staff: StaffLike[];
  qa: QaDetailLike | null;
  drillBuckets: DrillBucket[];
  drillMonthLabel: string;
  safetyState: string;
  safetyAnswered: number;
  safetyTotal: number;
  trainingRows: TrainingRowLike[];
  certRows: CertExpiryRow[];
  medAlerts: MedAlertLike[];
  medCheckedOn: string | null;
  shiftNotes: ShiftNoteLike[];
  shiftMonthLabel: string;
  disputes: QaDisputeRowLike[];
  onOpenIndividual: (name: string) => void;
  /** Open the investigation form for a tile or a single record. */
  onInvestigate: (metric: InvestigationSourceMetric, sourceRecordId: string | null, sourceLabel: string) => void;
  canInvestigate: boolean;
}

function InvestigateButton({
  metric,
  recordId,
  label,
  onInvestigate,
}: {
  metric: InvestigationSourceMetric;
  recordId: string | null;
  label: string;
  onInvestigate: DrawerContext["onInvestigate"];
}) {
  return (
    <button
      type="button"
      className="text-button drawer-investigate"
      onClick={() => onInvestigate(metric, recordId, label)}
      aria-label={`Start investigation: ${INVESTIGATION_SOURCE_LABELS[metric]} — ${label}`}
    >
      Investigate
    </button>
  );
}

/**
 * The records behind each dashboard tile. Every row a manager can act on
 * carries an "Investigate" button that opens the investigation form with
 * the tile's metric key plus that record's id/label.
 */
export function DrawerBody({ kind, ctx }: { kind: DrawerKind; ctx: DrawerContext }) {
  const metric = drawerMetric(kind);
  const { canInvestigate, onInvestigate } = ctx;

  if (kind === "requirements-ready" || kind === "requirements-open") {
    if (ctx.requirements.length === 0) {
      return (
        <Empty
          mark="none"
          title="Nothing open"
          text="Every requirement at this home is compliant."
        />
      );
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.requirements.map((item) => (
          <li key={item.id} className="record-row">
            <div>
              <strong>{item.title}</strong>
              <span className="muted">
                {" "}
                · {item.person}
                {item.due ? ` · due ${formatDate(item.due)}` : ""}
              </span>
            </div>
            <div className="drawer-row-actions">
              <Badge status={item.status} />
              {canInvestigate && (
                <InvestigateButton
                  metric={metric}
                  recordId={item.id}
                  label={item.title}
                  onInvestigate={onInvestigate}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "individuals") {
    if (ctx.individuals.length === 0) {
      return (
        <Empty mark="none" title="No individuals" text="No one is placed at this home yet." />
      );
    }
    return (
      <ul className="drawer-cards">
        {ctx.individuals.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="panel drawer-card"
              onClick={() => ctx.onOpenIndividual(p.name)}
              aria-label={`Open chart for ${p.name}`}
            >
              <Avatar name={p.name} color={p.color} src={p.photoUrl} />
              <span>{p.name}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "staff") {
    if (ctx.staff.length === 0) {
      return <Empty mark="none" title="No staff" text="No staff are assigned to this home yet." />;
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.staff.map((s) => (
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
            {canInvestigate && (
              <InvestigateButton
                metric={metric}
                recordId={s.id}
                label={s.name}
                onInvestigate={onInvestigate}
              />
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "qa") {
    if (!ctx.qa || ctx.qa.pct === null) {
      return (
        <Empty mark="none" title="No QA review" text="No finalized QA review for this home yet." />
      );
    }
    return (
      <div className="drawer-qa">
        <div className="drawer-qa-head">
          <strong>{ctx.qa.pct}%</strong>
          <span>{ctx.qa.periodLabel}</span>
        </div>
        <ul className="qa-badge-sections drawer-list">
          {ctx.qa.sections.map((s) =>
            s.pct === null ? null : (
              <li key={s.id}>
                <span>{s.title}</span>
                <strong>{s.pct}%</strong>
              </li>
            ),
          )}
        </ul>
        {ctx.qa.criticalFails > 0 && (
          <p className="qa-badge-critical">
            {ctx.qa.criticalFails} critical item{ctx.qa.criticalFails === 1 ? "" : "s"} failed
          </p>
        )}
      </div>
    );
  }

  if (kind === "drills") {
    return (
      <ul className="record-list drawer-list">
        {ctx.drillBuckets.map((b) => (
          <li key={b.type} className="record-row">
            <div>
              <strong>{b.label} drill</strong>
              <span className="muted">
                {" "}
                · {ctx.drillMonthLabel}
                {b.drillDate ? ` · logged ${formatDate(b.drillDate)}` : " · not logged"}
              </span>
            </div>
            <div className="drawer-row-actions">
              <Badge status={b.done ? "Complete" : "Needs attention"} />
              {canInvestigate && (
                <InvestigateButton
                  metric={metric}
                  recordId={b.drillId}
                  label={`${b.label} drill · ${ctx.drillMonthLabel}`}
                  onInvestigate={onInvestigate}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "safety") {
    return (
      <div className="drawer-safety">
        <p>
          <strong>{ctx.safetyState}</strong>
          {ctx.safetyTotal > 0 && (
            <span className="muted">
              {" "}
              · {ctx.safetyAnswered} of {ctx.safetyTotal} lines checked · {ctx.drillMonthLabel}
            </span>
          )}
          {ctx.safetyTotal === 0 && (
            <span className="muted"> · no report started for {ctx.drillMonthLabel}</span>
          )}
        </p>
      </div>
    );
  }

  if (kind === "training") {
    if (ctx.trainingRows.length === 0) {
      return <Empty mark="none" title="No staff" text="No staff are assigned to this home." />;
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.trainingRows.map((row) => (
          <li key={row.userId} className="record-row">
            <div>
              <strong>{row.name}</strong>
              <span className="muted"> · {row.role}</span>
              <p className="muted">
                {trainingProgressLine(row.profile, row.failed)}
                {row.profile && !row.profile.clearedForInRatio ? " · not cleared for in-ratio" : ""}
              </p>
            </div>
            <div className="drawer-row-actions">
              {row.profile && (
                <Badge status={row.profile.clearedForInRatio ? "Complete" : "Needs attention"} />
              )}
              {canInvestigate && (
                <InvestigateButton
                  metric={metric}
                  recordId={row.userId}
                  label={`${row.name} — training`}
                  onInvestigate={onInvestigate}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "certificates") {
    if (ctx.certRows.length === 0) {
      return (
        <Empty
          mark="none"
          title="No expiring certificates"
          text="No certificates expire within the next 60 days."
        />
      );
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.certRows.map((row) => (
          <li key={row.cert.id} className="record-row">
            <div>
              <strong>
                {row.name} · {row.cert.certName}
              </strong>
              <span className="muted">
                {" "}
                · expires {formatDate(row.cert.expiresOn)}
                {row.daysLeft < 0
                  ? ` · expired ${Math.abs(row.daysLeft)} day${Math.abs(row.daysLeft) === 1 ? "" : "s"} ago`
                  : ` · ${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} left`}
              </span>
            </div>
            <div className="drawer-row-actions">
              <Badge status={row.daysLeft < 0 ? "Needs attention" : "Due soon"} />
              {canInvestigate && (
                <InvestigateButton
                  metric={metric}
                  recordId={row.cert.id}
                  label={`${row.name} — ${row.cert.certName} expires ${row.cert.expiresOn}`}
                  onInvestigate={onInvestigate}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "meds") {
    if (ctx.medAlerts.length === 0) {
      return (
        <Empty
          mark="none"
          title="Stocked"
          text={
            ctx.medCheckedOn
              ? `Everything stocked as of ${formatDate(ctx.medCheckedOn)}.`
              : "Medication supply status is not available for this home."
          }
        />
      );
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.medAlerts.map((alert) => (
          <li key={alert.id} className="record-row">
            <div>
              <strong>
                {alert.individualName} · {alert.medicationName}
              </strong>
              <span className="muted">
                {" "}
                · {alert.strength} · {alert.countdownLabel}
              </span>
            </div>
            <div className="drawer-row-actions">
              <Badge
                status={
                  alert.status === "out" || alert.status === "critical"
                    ? "Needs attention"
                    : "Due soon"
                }
              />
              {canInvestigate && (
                <InvestigateButton
                  metric={metric}
                  recordId={alert.id}
                  label={`${alert.individualName} — ${alert.medicationName}`}
                  onInvestigate={onInvestigate}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "shiftnotes") {
    if (ctx.shiftNotes.length === 0) {
      return (
        <Empty
          mark="none"
          title="No shift notes"
          text={`No shift notes entered for ${ctx.shiftMonthLabel}.`}
        />
      );
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.shiftNotes.map((note) => (
          <li key={note.id} className="record-row">
            <div>
              <strong>
                {note.individualName} · {note.noteDate} · {note.shift}
              </strong>
              <span className="muted">
                {" "}
                · {note.programName} · {note.staffName}
              </span>
              {note.summary && <p className="muted">{note.summary}</p>}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "qa_disputes") {
    if (ctx.disputes.length === 0) {
      return (
        <Empty
          mark="none"
          title="No open disputes"
          text="No QA findings are currently under dispute."
        />
      );
    }
    return (
      <ul className="record-list drawer-list">
        {ctx.disputes.map((row) => (
          <li key={row.item.key} className="record-row">
            <div>
              <strong>
                {row.item.individualName ? `${row.item.individualName} — ` : ""}
                {row.itemId}
              </strong>
              <span className="muted">
                {" "}
                · {row.auditLabel}
                {row.item.disputeRaisedAt ? ` · raised ${formatDate(row.item.disputeRaisedAt.slice(0, 10))}` : ""}
                {row.item.disputeRaisedByName ? ` by ${row.item.disputeRaisedByName}` : ""}
              </span>
              {row.item.disputeNote && <p className="muted">{row.item.disputeNote}</p>}
            </div>
            {canInvestigate && (
              <InvestigateButton
                metric={metric}
                recordId={row.auditId}
                label={`${row.itemId} · ${row.auditLabel}`}
                onInvestigate={onInvestigate}
              />
            )}
          </li>
        ))}
      </ul>
    );
  }

  return null;
}
