/**
 * HouseComplianceDonuts — the first content on the manager Overview
 * (founder directive, 2026-10-28: "Manager overview should have the donut
 * charts first on top to show their house's compliance. The platform is
 * compliance first.").
 *
 * One status-mix donut per house the viewer manages, drawn by the same
 * StatusMixDonut component the Overview's Status mix panel uses, fed by
 * that house's requirements only (houseCompliance.ts slices; domain's
 * `metrics` scores — no new compliance math). Every donut travels with
 * text: the house's percent current, its complete/total counts, and how
 * much needs attention, so nothing rides on color alone. Tapping a house
 * focuses the Overview on it, like the site compliance cards below.
 *
 * Audience: the manager roles — house managers (their home), program
 * managers and agency administrators (the homes they can see, narrowed by
 * the Overview's site filter). Other roles keep the Overview they had;
 * the panel renders nothing for them.
 *
 * Under each house's donut, a team compliance line rolls up the house
 * staff's own readiness (teamCompliance.ts): how many are fully current
 * and how many need attention — the manager lever beside the house score.
 */
import { ShieldCheck } from "lucide-react";
import { useData } from "../../data/DataProvider";
import type { Requirement } from "../../domain";
import { Badge } from "../../components";
import StatusMixDonut from "../../components/StatusMixDonut";
import { houseComplianceRows } from "./houseCompliance";
import { useTeamComplianceBySite } from "./teamCompliance";
import { HOUSE_DONUT_ROLES as MANAGER_ROLES } from "../personalCompliance/personalCompliance";

interface Props {
  sites: { id: string; name: string }[];
  allItems: Requirement[];
  /** The Overview's site filter: "All sites" or a site name. */
  focusSite: string;
  onSite: (siteName: string) => void;
}

export default function HouseComplianceDonuts({
  sites,
  allItems,
  focusSite,
  onSite,
}: Props) {
  const { session, workspace } = useData();
  const isManager = Boolean(session && MANAGER_ROLES.has(session.roleKey));
  const rows = isManager ? houseComplianceRows(sites, allItems, focusSite) : [];
  // Team compliance per house (the manager lever): each staff member's own
  // readiness roll-up, counted for the houses on screen. Loaded for the
  // same narrowed set of houses the donuts show.
  const teamBySite = useTeamComplianceBySite(
    isManager ? session : null,
    (workspace?.staff ?? []).map((s) => ({
      userId: s.id,
      roleKey: s.roleKey,
      siteId: s.siteId,
    })),
    rows.map((row) => ({ id: row.siteId, name: row.siteName })),
  );
  if (!isManager || !rows.length) return null;

  return (
    <section className="panel house-compliance" aria-label="House compliance">
      <div className="panel-heading">
        <div>
          <h2>
            <ShieldCheck size={16} /> House compliance
          </h2>
          <p>
            Compliance first —{" "}
            {rows.length === 1
              ? "how your house stands today."
              : "how each of your houses stands today."}
          </p>
        </div>
      </div>
      <div className="house-compliance-grid">
        {rows.map((row) => (
          <div className="house-compliance-card" key={row.siteId || row.siteName}>
            <div className="house-compliance-head">
              <button
                type="button"
                className="house-compliance-name"
                onClick={() => onSite(row.siteName)}
                aria-label={`Focus the overview on ${row.siteName}`}
              >
                {row.siteName}
              </button>
              {row.total + row.review > 0 && (
                <Badge status={row.overdue ? "Needs attention" : "On track"} />
              )}
            </div>
            {row.total + row.review > 0 ? (
              <>
                <p className="house-compliance-score">
                  <strong>{row.score}%</strong> current · {row.done} of{" "}
                  {row.total} complete
                  {row.overdue > 0
                    ? ` · ${row.overdue} need${row.overdue === 1 ? "s" : ""} attention`
                    : " · nothing overdue"}
                  {row.dueSoon > 0 ? ` · ${row.dueSoon} due soon` : ""}
                </p>
                <StatusMixDonut items={row.items} />
              </>
            ) : (
              <p className="house-compliance-empty">
                No requirements are tracked for this house yet.
              </p>
            )}
            {(() => {
              const team = teamBySite.get(row.siteId);
              if (!team || team.total === 0) return null;
              return (
                <p className="house-compliance-team">
                  Team compliance: {team.fullyCurrent} of {team.total} staff
                  fully current · {team.needAttention} need
                  {team.needAttention === 1 ? "s" : ""} attention
                </p>
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}
