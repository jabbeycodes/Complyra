/**
 * HR Binder Board + template editor host (New Hire Binder build 2,
 * 2026-10-30).
 *
 * The board is the HR chase view over every staff member's binder: who
 * is incomplete, what exactly they are missing, and whose uploaded
 * documents are waiting on HR's own verification. Every number comes
 * from build 1's derivation (deriveBinder + binderGaps) — the board
 * never recomputes a status its own way, so a row here can never
 * disagree with the binder itself.
 *
 * Permissions mirror the Binder tab: HR/admin see the whole agency,
 * team viewers (hub.view_team) see the staff list the hub already
 * scopes for them, auditors read. The template editor is HR/admin
 * only (certificates.manage or the administrator/HR roles — the same
 * gate the template table's RLS write policy uses).
 *
 * Visual restyle (2026-10-30): the board leads with the platform's
 * compliance-donut grammar — an agency donut, pressure-point stat
 * tiles, section completion bars, and a gap breakdown — over the same
 * derived rows, and the staff table became a card grid. Presentation
 * only: binderBoardStats aggregates the rows' DerivedBinder objects;
 * filters, sorting, chase lists, and the Open binder jump behave
 * exactly as before.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Settings2 } from "lucide-react";
import { useData } from "../../data/DataProvider";
import { todayIso } from "../../data/chart";
import type { ComplianceEvidence } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import { hasPermission, ROLE_TEMPLATE_BY_KEY } from "../../data/permissions";
import { documentHasReadableContent } from "../../data/starterDocuments";
import type { SessionUser } from "../../data/types";
import {
  BINDER_STATUS_LABELS,
  binderGaps,
  deriveBinder,
  mostUrgentBinderGap,
  type BinderEvidence,
  type DerivedBinder,
  type DerivedBinderItem,
} from "../../data/newHireBinder";
import type { HubSite, HubStaffEntry } from "../employeeHub/EmployeeHubPage";
import { BinderTemplateEditor } from "./BinderTemplateEditor";
import BinderDonut from "./BinderDonut";
import {
  binderDonutSegments,
  binderGapBreakdown,
  binderSectionCompletion,
  binderStatusCounts,
  summarizeBinderBoard,
} from "./binderBoardStats";

const STATUS_BADGE: Record<string, string> = {
  verified: "badge on-track",
  on_file: "badge on-track",
  due_soon: "badge due-soon",
  in_progress: "badge due-soon",
  missing: "badge overdue",
  returned: "badge overdue",
  expired: "badge expired",
  informational: "badge",
};

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface BoardRow {
  entry: HubStaffEntry;
  derived: DerivedBinder;
  gaps: DerivedBinderItem[];
  urgent: DerivedBinderItem | null;
}

type BoardFilter = "all" | "incomplete" | "awaiting";

export function BinderBoardTab({
  session,
  store,
  staffList,
  sites,
  onOpenBinder,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
  onOpenBinder: (staffId: string) => void;
}) {
  const { api } = useData();
  const isAuditor = session.roleKey === "auditor";
  const canEditTemplates =
    !isAuditor &&
    (hasPermission(session, "certificates.manage") ||
      session.roleKey === "administrator" ||
      session.roleKey === "hr");

  const [view, setView] = useState<"board" | "templates">("board");
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [docs, acks] = await Promise.all([
          store.listDocuments().catch(() => []),
          store.listDocumentAcks().catch(() => []),
        ]);
        const titleById = new Map(docs.map((d) => [d.id, d.title]));
        const loaded = await Promise.all(
          staffList.map(async (entry) => {
            const [binderRow, wallet, contactRow, evidence, profile] =
              await Promise.all([
                store.getBinder(entry.userId, entry.roleKey),
                store.listBinderDocuments(entry.userId),
                store.getEmergencyContact(entry.userId),
                store
                  .getComplianceEvidence(entry.userId)
                  .catch(
                    (): ComplianceEvidence => ({
                      certs: [],
                      trainings: [],
                      delegations: [],
                      docAcks: [],
                    }),
                  ),
                api.getStaffTrainingProfile(entry.userId).catch(() => null),
              ]);
            const bundle: BinderEvidence = {
              certificates: evidence.certs.map((c) => ({
                certName: c.name,
                expiresOn: c.expiresOn,
              })),
              trainingProfile: profile,
              documentAcks: acks
                .filter((a) => a.staffId === entry.userId)
                .map((a) => ({
                  docKey: titleById.get(a.docId) ?? a.docId,
                  ackedAt: a.ackedAt,
                })),
              libraryDocuments: docs.map((d) => ({
                title: d.title,
                hasContent: documentHasReadableContent(d),
              })),
              walletDocuments: wallet,
              emergencyContact: contactRow,
            };
            const derived = deriveBinder(binderRow, bundle, todayIso());
            return {
              entry,
              derived,
              gaps: binderGaps(derived),
              urgent: mostUrgentBinderGap(derived),
            } satisfies BoardRow;
          }),
        );
        if (cancelled) return;
        loaded.sort(
          (a, b) =>
            a.derived.percentComplete - b.derived.percentComplete ||
            b.gaps.length - a.gaps.length ||
            a.entry.fullName.localeCompare(b.entry.fullName),
        );
        setRows(loaded);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the binder board."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, api, staffList]);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (filter === "incomplete") return rows.filter((r) => r.gaps.length > 0);
    if (filter === "awaiting")
      return rows.filter((r) => r.derived.awaitingVerification > 0);
    return rows;
  }, [rows, filter]);

  const totals = useMemo(() => {
    if (!rows) return { incomplete: 0, awaiting: 0 };
    return {
      incomplete: rows.filter((r) => r.gaps.length > 0).length,
      awaiting: rows.reduce((n, r) => n + r.derived.awaitingVerification, 0),
    };
  }, [rows]);

  // Dashboard aggregates over EVERY in-scope binder (the filters below
  // narrow only the card grid, exactly as the summary line always did).
  const summary = useMemo(
    () => (rows ? summarizeBinderBoard(rows.map((r) => r.derived)) : null),
    [rows],
  );
  const sectionRows = useMemo(
    () => (rows ? binderSectionCompletion(rows.map((r) => r.derived)) : []),
    [rows],
  );
  const gapData = useMemo(
    () =>
      rows
        ? binderGapBreakdown(rows.map((r) => r.derived))
        : { slices: [], totalGaps: 0 },
    [rows],
  );

  const siteName = (siteId: string | null) =>
    sites.find((s) => s.id === siteId)?.name ?? "No home assigned";
  const roleName = (roleKey: string) =>
    ROLE_TEMPLATE_BY_KEY[roleKey as keyof typeof ROLE_TEMPLATE_BY_KEY]?.name ??
    roleKey;

  return (
    <section className="hub-card" aria-label="Binder board">
      <div className="hub-row">
        <div>
          <h2>Binder Board</h2>
          <p className="hub-sub">
            Every staff member's new hire binder at a glance — who is
            incomplete, exactly what they are missing, and which uploads
            are waiting on HR verification.
            {isAuditor ? " Read-only — auditor view." : ""}
          </p>
        </div>
        {canEditTemplates && (
          <div className="binder-board-views" role="group" aria-label="Board views">
            <button
              className={`hub-btn${view === "board" ? " primary" : ""}`}
              onClick={() => setView("board")}
            >
              Board
            </button>
            <button
              className={`hub-btn${view === "templates" ? " primary" : ""}`}
              onClick={() => setView("templates")}
            >
              <Settings2 size={15} /> Templates
            </button>
          </div>
        )}
      </div>

      {view === "templates" && canEditTemplates ? (
        <BinderTemplateEditor store={store} />
      ) : (
        <>
          {error && (
            <div className="hub-error" role="alert">
              {error}
            </div>
          )}
          {!rows && !error && <p>Loading binders…</p>}
          {rows && (
            <>
              <p className="binder-board-summary">
                {rows.length} staff · {totals.incomplete} incomplete ·{" "}
                {totals.awaiting} document{totals.awaiting === 1 ? "" : "s"}{" "}
                awaiting verification
              </p>
              {summary && rows.length > 0 && (
                <>
                  <div className="binder-dash">
                    <BinderDonut
                      segments={binderDonutSegments(summary.counts)}
                      total={summary.counts.total}
                      percent={summary.percent}
                      label="Agency binder completion"
                    />
                    <div className="binder-dash-side">
                      <p className="binder-dash-caption">
                        <strong>{summary.percent}%</strong> —{" "}
                        {summary.counts.satisfied} of {summary.counts.total}{" "}
                        required items satisfied · {summary.fullyComplete} of{" "}
                        {summary.staffCount} staff fully complete
                      </p>
                      <div className="binder-stat-grid">
                        <div className="binder-stat">
                          <strong>{summary.awaitingVerification}</strong>
                          <span>Documents awaiting verification</span>
                        </div>
                        <div className="binder-stat">
                          <strong>{summary.expiredItems}</strong>
                          <span>Expired items</span>
                        </div>
                        <div className="binder-stat">
                          <strong>{summary.missingItems}</strong>
                          <span>Missing items</span>
                        </div>
                        <div className="binder-stat">
                          <strong>
                            {summary.fullyComplete} of {summary.staffCount}
                          </strong>
                          <span>Staff fully complete</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="binder-charts">
                    <div className="binder-chart-block">
                      <h3>Completion by section</h3>
                      <ul className="binder-bars">
                        {sectionRows.map((row) => (
                          <li className="binder-bar-row" key={row.key}>
                            <span className="binder-bar-label">{row.title}</span>
                            {row.total > 0 ? (
                              <>
                                <div className="progress-track" aria-hidden="true">
                                  <span style={{ width: `${row.percent}%` }} />
                                </div>
                                <span className="binder-bar-count">
                                  {row.satisfied} of {row.total} · {row.percent}%
                                </span>
                              </>
                            ) : (
                              <>
                                <span aria-hidden="true" />
                                <span className="binder-bar-count">
                                  No required items
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="binder-chart-block">
                      <h3>Where the gaps are</h3>
                      {gapData.totalGaps === 0 ? (
                        <p className="binder-chart-note">
                          No gaps — every binder is complete.
                        </p>
                      ) : (
                        <ul className="binder-bars">
                          {gapData.slices.map((slice) => (
                            <li className="binder-bar-row" key={slice.key}>
                              <span className="binder-bar-label">
                                {slice.label}
                              </span>
                              <div className="progress-track" aria-hidden="true">
                                <span
                                  className="progress-fill clay"
                                  style={{ width: `${slice.percent}%` }}
                                />
                              </div>
                              <span className="binder-bar-count">
                                {slice.count} · {slice.percent}% of gaps
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              )}
              <div className="hub-chip-row binder-board-filters" role="group" aria-label="Board filters">
                <button
                  className={`hub-chip${filter === "all" ? " selected" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  All staff
                </button>
                <button
                  className={`hub-chip${filter === "incomplete" ? " selected" : ""}`}
                  onClick={() => setFilter("incomplete")}
                >
                  Incomplete only
                </button>
                <button
                  className={`hub-chip${filter === "awaiting" ? " selected" : ""}`}
                  onClick={() => setFilter("awaiting")}
                >
                  Awaiting verification
                </button>
              </div>

              <div className="binder-cards">
                {visible.map((row) => {
                  const expanded = expandedId === row.entry.userId;
                  return (
                    <BoardCard
                      key={row.entry.userId}
                      row={row}
                      expanded={expanded}
                      roleLabel={roleName(row.entry.roleKey)}
                      homeLabel={siteName(row.entry.siteId)}
                      onToggle={() =>
                        setExpandedId(expanded ? null : row.entry.userId)
                      }
                      onOpenBinder={() => onOpenBinder(row.entry.userId)}
                    />
                  );
                })}
              </div>
              {visible.length === 0 && (
                <p className="binder-board-empty">
                  {filter === "all"
                    ? "No staff to show."
                    : filter === "incomplete"
                      ? "Every binder is complete — nothing to chase."
                      : "No documents are awaiting verification."}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function BoardCard({
  row,
  expanded,
  roleLabel,
  homeLabel,
  onToggle,
  onOpenBinder,
}: {
  row: BoardRow;
  expanded: boolean;
  roleLabel: string;
  homeLabel: string;
  onToggle: () => void;
  onOpenBinder: () => void;
}) {
  const { entry, derived, gaps, urgent } = row;
  const counts = binderStatusCounts(derived);
  return (
    <article className="binder-person-card">
      <div className="binder-person-head">
        <span className="binder-board-name">{entry.fullName}</span>
        <span className="binder-board-meta">
          {roleLabel} · {homeLabel}
        </span>
      </div>
      <div className="binder-person-main">
        <BinderDonut
          segments={binderDonutSegments(counts)}
          total={counts.total}
          percent={derived.percentComplete}
          variant="mini"
          label={`${entry.fullName}'s binder`}
        />
        <div className="binder-person-facts">
          <p className="binder-person-score">
            <strong>{derived.percentComplete}%</strong> complete
            <span className="binder-board-meta">
              {derived.satisfiedItems} of {derived.totalItems} required items
            </span>
          </p>
          <p className="binder-person-line">
            {gaps.length === 0 ? (
              <span className="badge on-track">None missing</span>
            ) : (
              <span className="badge overdue">{gaps.length} missing</span>
            )}
          </p>
          <p className="binder-person-line">
            {derived.awaitingVerification === 0
              ? "No documents awaiting verification"
              : `${derived.awaitingVerification} document${derived.awaitingVerification === 1 ? "" : "s"} awaiting verification`}
          </p>
        </div>
      </div>
      <div className="binder-person-urgent">
        {urgent ? (
          <>
            <span className="binder-board-urgent">{urgent.item.label}</span>
            <span className="binder-board-meta">{urgent.note}</span>
          </>
        ) : (
          "Nothing outstanding"
        )}
      </div>
      <div className="binder-person-actions">
        <button
          className="hub-btn"
          aria-expanded={expanded}
          onClick={onToggle}
          disabled={gaps.length === 0}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Chase list
        </button>
        <button className="hub-btn primary" onClick={onOpenBinder}>
          <FolderOpen size={15} /> Open binder
        </button>
      </div>
      {expanded && (
        <div className="binder-board-chase">
          <div className="binder-board-chase-head">
            <strong>
              {gaps.length} item{gaps.length === 1 ? "" : "s"} to chase
            </strong>
          </div>
          <ul className="hub-list">
            {gaps.map((gap) => (
              <li className="hub-list-item" key={gap.item.key}>
                <div className="hub-item-main">
                  <span className="hub-item-title">{gap.item.label}</span>
                  <span className="hub-item-sub">{gap.note}</span>
                </div>
                <span className={STATUS_BADGE[gap.status]}>
                  {BINDER_STATUS_LABELS[gap.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
