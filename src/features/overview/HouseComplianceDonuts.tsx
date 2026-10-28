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
 */
import { ShieldCheck } from "lucide-react";
import { useData } from "../../data/DataProvider";
import type { Requirement } from "../../domain";
import { Badge } from "../../components";
import StatusMixDonut from "../../components/StatusMixDonut";
import { houseComplianceRows } from "./houseCompliance";

const MANAGER_ROLES = new Set(["house_manager", "program_manager", "administrator"]);

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
  const { session } = useData();
  if (!session || !MANAGER_ROLES.has(session.roleKey)) return null;

  const rows = houseComplianceRows(sites, allItems, focusSite);
  if (!rows.length) return null;

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
              <Badge status={row.overdue ? "Needs attention" : "On track"} />
            </div>
            <p className="house-compliance-score">
              <strong>{row.score}%</strong> current · {row.done} of {row.total}{" "}
              complete
              {row.overdue > 0
                ? ` · ${row.overdue} need${row.overdue === 1 ? "s" : ""} attention`
                : " · nothing overdue"}
              {row.dueSoon > 0 ? ` · ${row.dueSoon} due soon` : ""}
            </p>
            {row.total + row.review > 0 ? (
              <StatusMixDonut items={row.items} />
            ) : (
              <p className="house-compliance-empty">
                No requirements are tracked for this house yet.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
