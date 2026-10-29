/**
 * SchedulingPage — the manager Scheduling tab (founder directive,
 * 2026-10-28). The Overview is compliance-first now, so the "right now"
 * picture and house coverage live here instead: who is clocked in,
 * expected-not-arrived, out today, open shifts today, what needs the
 * viewer's decision (the RightNowStrip, moved unchanged from the
 * Overview), and the selected house's coverage board for the week.
 *
 * Filterable by program site: the picker at the top lists exactly the
 * sites this viewer can see (sitesVisibleTo — the same scoping the
 * Overview uses). A house manager sees their own house preselected and
 * nothing else; program managers and administrators can pick one house
 * or "All sites". Every segment re-scopes to the pick: the strip scopes
 * through its own site filter, and the coverage board is handed the
 * picked site (with no single site picked it shows its own
 * choose-a-site guidance, exactly as it does on the dashboard).
 *
 * Audience is the strip's audience — house managers, program managers,
 * agency administrators — enforced by pageVisible("Scheduling").
 * Read-model only: same stores, same helpers, no new data surface, so
 * the local and hosted paths stay in parity by construction.
 */
import { useMemo, useState } from "react";
import { Building2, CalendarDays } from "lucide-react";
import { useData } from "../../data/DataProvider";
import { sitesVisibleTo } from "../../data/dashboard";
import RightNowStrip from "../overview/RightNowStrip";
import SiteCoverageBoard from "../coverage/SiteCoverageBoard";

interface Props {
  onNavigate: (page: string) => void;
}

export default function SchedulingPage({ onNavigate }: Props) {
  const { session, workspace } = useData();

  const sites = useMemo(
    () =>
      session && workspace
        ? sitesVisibleTo(session, workspace.sites, workspace.staff)
        : [],
    [session, workspace],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const focusSite =
    selected ??
    (sites.length === 1 ? sites[0].name : "All sites");
  const focusedSite =
    focusSite !== "All sites"
      ? (sites.find((s) => s.name === focusSite) ?? null)
      : null;

  if (!session || !workspace) return null;

  return (
    <>
      <div className="dashboard-heading">
        <div className="heading-row">
          <h1>Scheduling</h1>
        </div>
      </div>
      <div className="scope-row">
        <div className="scope-controls">
          <label className="select-shell">
            <Building2 size={16} />
            <select
              aria-label="Filter by program site"
              value={focusSite}
              onChange={(e) => setSelected(e.target.value)}
            >
              {sites.length > 1 && <option>All sites</option>}
              {sites.map((s) => (
                <option key={s.id || s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <span className="scope-divider" />
          <span className="date-label">
            <CalendarDays size={15} />{" "}
            {new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
      <RightNowStrip focusSite={focusSite} sites={sites} onNavigate={onNavigate} />
      <SiteCoverageBoard siteId={focusedSite?.id ?? null} />
    </>
  );
}
