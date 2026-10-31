/**
 * Mobile home compliance band — the visualization the founder asked
 * never to leave off a homepage (2026-10-31): the personal compliance
 * donut and its status-mix bar, plus each house's compliance donut for
 * the roles with house scope, pinned to the top of mobile Home directly
 * after the greeting, before the shift strip and the tiles.
 *
 * Every figure is the desktop Overview's own: the personal roll-up from
 * usePersonalCompliance (the readiness roll-up behind Employee Hub →
 * My Compliance) and house rows from complianceBand.ts, which slices
 * houseComplianceRows exactly as the desktop Overview does. Nothing is
 * scored here.
 *
 * Doors: the personal block opens My Hub at its My Compliance section
 * (the full breakdown); a house card scopes the whole mobile home to
 * that house, the shell's per-site view.
 */
import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import type { WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import ReadinessDonut from "../personalCompliance/ReadinessDonut";
import { personalComplianceSegments } from "../personalCompliance/personalCompliance";
import {
  usePersonalCompliance,
  type PersonalComplianceState,
} from "../personalCompliance/usePersonalCompliance";
import {
  bandHouseRows,
  houseHasDonut,
  houseSlices,
  houseSliceTotal,
  segmentBarParts,
  type HouseSlice,
} from "./complianceBand";
import type { HouseComplianceRow } from "../overview/houseCompliance";

/* ------------------------------ personal ------------------------------ */

export function MobileComplianceBandPersonal({
  state,
  onOpen,
}: {
  state: PersonalComplianceState;
  onOpen: () => void;
}) {
  const { loading, error, summary } = state;
  const hasData = summary.total > 0 && !loading && !error;
  const parts = hasData ? segmentBarParts(summary) : [];
  return (
    <button
      type="button"
      className="msh-band-personal"
      onClick={onOpen}
      aria-label={
        hasData
          ? `My compliance: ${summary.percentCurrent}% current, ${summary.current} of ${summary.total} complete. Open my compliance in My Hub`
          : "My compliance. Open my compliance in My Hub"
      }
    >
      <span className="msh-band-personal-main">
        {hasData ? (
          <ReadinessDonut
            segments={personalComplianceSegments(summary)}
            total={summary.total}
            variant="mini"
          />
        ) : (
          <span className="msh-band-icon" aria-hidden="true">
            <ShieldCheck size={26} />
          </span>
        )}
        <span className="msh-band-copy">
          <span className="msh-band-title">
            My compliance
            <span className="msh-chevron" aria-hidden="true">
              ›
            </span>
          </span>
          {error ? (
            <small role="alert">{error}</small>
          ) : loading ? (
            <small>Loading your compliance…</small>
          ) : summary.total === 0 ? (
            <small>
              No compliance items yet — nothing is tracking against your
              role right now.
            </small>
          ) : (
            <>
              <strong className="msh-band-percent">
                {summary.percentCurrent}% current
              </strong>
              <small>
                {summary.current} of {summary.total} complete
                {summary.attentionCount > 0
                  ? ` · ${summary.attentionCount} need${summary.attentionCount === 1 ? "s" : ""} attention`
                  : " · nothing needs attention"}
              </small>
            </>
          )}
        </span>
      </span>
      {hasData && (
        <>
          <span className="msh-band-bar" aria-hidden="true">
            {parts
              .filter((part) => part.count > 0)
              .map((part) => (
                <span
                  key={part.key}
                  className="msh-band-bar-seg"
                  style={{ width: `${part.percent}%`, background: part.color }}
                />
              ))}
          </span>
          <span className="msh-band-bar-legend">
            {parts.map((part) => (
              <span key={part.key} className="msh-band-bar-item">
                <span
                  className="msh-band-dot"
                  aria-hidden="true"
                  style={{ background: part.color }}
                />
                {part.label} {part.count} · {Math.round(part.percent)}%
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  );
}

/* ------------------------------- houses ------------------------------- */

const RING_R = 36;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The house donut at phone size — the StatusMixDonut ring (same radius,
 * track, slice colors, and center total) drawn from the same statusMix
 * counts, sized to sit in a mini card.
 */
function HouseMiniDonut({ slices }: { slices: HouseSlice[] }) {
  const total = houseSliceTotal(slices);
  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = total ? (slice.count / total) * RING_C : 0;
    const arc = { ...slice, length, offset };
    offset -= length;
    return arc;
  });
  const summary = slices
    .map((slice) => {
      const pct = total ? Math.round((slice.count / total) * 100) : 0;
      return `${slice.label} ${slice.count} (${pct}%)`;
    })
    .join(", ");
  return (
    <svg
      className="msh-band-house-chart"
      viewBox="0 0 96 96"
      width="76"
      height="76"
      role="img"
      aria-label={`Requirement status mix. ${summary}`}
    >
      <circle
        cx="48"
        cy="48"
        r={RING_R}
        fill="none"
        stroke="#e8dcc8"
        strokeWidth="14"
      />
      {arcs.map((arc) =>
        arc.length <= 0 ? null : (
          <circle
            key={arc.key}
            cx="48"
            cy="48"
            r={RING_R}
            fill="none"
            stroke={arc.color}
            strokeWidth="14"
            strokeDasharray={`${arc.length} ${RING_C}`}
            strokeDashoffset={arc.offset}
            strokeLinecap="butt"
            transform="rotate(-90 48 48)"
          />
        ),
      )}
      <text x="48" y="46" textAnchor="middle" className="status-mix-total">
        {total}
      </text>
      <text
        x="48"
        y="60"
        textAnchor="middle"
        className="status-mix-total-label"
      >
        items
      </text>
    </svg>
  );
}

export function MobileComplianceBandHouse({
  row,
  onOpen,
}: {
  row: HouseComplianceRow;
  onOpen: (siteId: string) => void;
}) {
  const hasDonut = houseHasDonut(row);
  return (
    <button
      type="button"
      className="msh-band-house"
      onClick={() => onOpen(row.siteId)}
      aria-label={
        hasDonut
          ? `${row.siteName}: ${row.score}% current, ${row.done} of ${row.total} complete. Switch the mobile view to this home`
          : `${row.siteName}: no requirements tracked yet. Switch the mobile view to this home`
      }
    >
      <span className="msh-band-house-name">{row.siteName}</span>
      {hasDonut ? (
        <>
          <HouseMiniDonut slices={houseSlices(row)} />
          <span className="msh-band-house-score">
            <strong>{row.score}%</strong> current
          </span>
          <small>
            {row.done} of {row.total} complete
          </small>
          <small className="msh-status-text">
            {row.overdue > 0
              ? `${row.overdue} need${row.overdue === 1 ? "s" : ""} attention`
              : "Nothing overdue"}
            {row.dueSoon > 0 ? ` · ${row.dueSoon} due soon` : ""}
          </small>
        </>
      ) : (
        <span className="msh-band-house-empty">
          No requirements are tracked for this house yet.
        </span>
      )}
    </button>
  );
}

/* -------------------------------- band -------------------------------- */

export default function MobileComplianceBand({
  session,
  workspace,
  onOpenCompliance,
  onOpenSite,
}: {
  session: SessionUser;
  workspace: WorkspaceView;
  /** Opens My Hub at its My Compliance section. */
  onOpenCompliance: () => void;
  /** Scopes the mobile home to the tapped house. */
  onOpenSite: (siteId: string) => void;
}) {
  const personal = usePersonalCompliance(session);
  const houses = useMemo(
    () =>
      bandHouseRows(
        session,
        workspace.sites,
        workspace.staff,
        workspace.requirements,
      ),
    [session, workspace],
  );
  return (
    <section className="msh-band" aria-label="Compliance">
      <MobileComplianceBandPersonal state={personal} onOpen={onOpenCompliance} />
      {houses !== null &&
        (houses.length === 0 ? (
          <p className="msh-band-note">No houses in your scope yet.</p>
        ) : (
          <div className="msh-band-houses" role="group" aria-label="House compliance">
            {houses.map((row) => (
              <MobileComplianceBandHouse
                key={row.siteId || row.siteName}
                row={row}
                onOpen={onOpenSite}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
