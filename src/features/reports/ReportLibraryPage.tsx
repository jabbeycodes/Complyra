import { useEffect, useMemo, useState } from "react";
import { Download, Printer, Search } from "lucide-react";
import { useData } from "../../data/DataProvider";
import { openPrintable } from "../../data/openFile";
import { todayIso } from "../../data/chart";
import { monthKeyFrom } from "../../data/monthlyChecks";
import { Empty, PageHeading } from "../../components";
import {
  canAccessReportLibrary,
  reportsForRole,
  type ReportDefinition,
} from "./reportLibrary";
import {
  listReportRecordOptions,
  REPORT_RUNNERS,
  type ReportRecordOption,
  type ReportRunContext,
  type ReportScopeSelection,
} from "./reportRunners";

/**
 * Report Library — one catalog over the reports that already exist across
 * the app. Pick a report, set its scope (home / Individual / dates), and
 * download or print it. Every run goes through the same builder or API
 * download as the report's home surface (see reportRunners.ts).
 */

function daysAgoIso(days: number): string {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function ReportLibraryPage({
  presetSiteId = null,
}: {
  /** When opened from a home's detail view, the catalog starts scoped to it. */
  presetSiteId?: string | null;
}) {
  const { api, session, workspace } = useData();
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All reports");

  const entries = useMemo(
    () => (session ? reportsForRole(session.roleKey) : []),
    [session],
  );
  const modules = useMemo(
    () => ["All reports", ...new Set(entries.map((entry) => entry.module))],
    [entries],
  );
  const visible = entries.filter((entry) => {
    if (moduleFilter !== "All reports" && entry.module !== moduleFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.module.toLowerCase().includes(q)
    );
  });
  const groups = useMemo(() => {
    const out: { module: string; entries: ReportDefinition[] }[] = [];
    for (const entry of visible) {
      const group = out.find((row) => row.module === entry.module);
      if (group) group.entries.push(entry);
      else out.push({ module: entry.module, entries: [entry] });
    }
    return out;
  }, [visible]);

  if (!session || !workspace) return null;

  if (!canAccessReportLibrary(session.roleKey)) {
    return (
      <>
        <PageHeading title="Report Library" />
        <section className="panel">
          <Empty
            mark="quiet"
            title="Report Library is not available for your role"
            text="It is available to agency administrators, program and house managers, nurses, and auditors."
          />
        </section>
      </>
    );
  }

  const ctx: ReportRunContext = { api, session, workspace };

  return (
    <>
      <PageHeading
        title="Report Library"
        description="Every report in the app, in one place — printed output is the same stamped record each home surface produces."
      />

      <div className="report-library-tools">
        <label className="report-library-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports — try “mileage” or “drills”"
            aria-label="Search reports"
          />
        </label>
        <div className="tabs" role="tablist" aria-label="Report groups">
          {modules.map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={moduleFilter === name}
              className={moduleFilter === name ? "selected" : ""}
              onClick={() => setModuleFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <section className="panel">
          <Empty mark="quiet" title="No reports match" text="Try a different search or group." />
        </section>
      )}

      {groups.map((group) => (
        <section key={group.module} className="report-library-group">
          <h2>{group.module}</h2>
          <div className="report-library-grid">
            {group.entries.map((entry) => (
              <ReportEntryCard
                key={entry.id}
                def={entry}
                ctx={ctx}
                presetSiteId={presetSiteId}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ReportEntryCard({
  def,
  ctx,
  presetSiteId,
}: {
  def: ReportDefinition;
  ctx: ReportRunContext;
  presetSiteId: string | null;
}) {
  const { workspace } = ctx;
  const has = (kind: ReportDefinition["scopes"][number]) => def.scopes.includes(kind);
  const siteOptional = has("agency"); // agency reports may run for all homes
  const sites = workspace.sites;
  const [siteId, setSiteId] = useState<string>(
    presetSiteId ?? (siteOptional ? "" : (sites[0]?.id ?? "")),
  );
  const individuals = useMemo(
    () =>
      workspace.individuals.filter((person) => !siteId || person.siteId === siteId),
    [workspace.individuals, siteId],
  );
  const [individualId, setIndividualId] = useState<string>("");
  const [recordId, setRecordId] = useState<string>("");
  const [recordOptions, setRecordOptions] = useState<ReportRecordOption[]>([]);
  const [staffUserId, setStaffUserId] = useState<string>("");
  const [monthKey, setMonthKey] = useState<string>(() => monthKeyFrom(todayIso()));
  const [allMonths, setAllMonths] = useState(false);
  const [year, setYear] = useState<number>(() => Number(todayIso().slice(0, 4)));
  const [from, setFrom] = useState<string>(() => daysAgoIso(13));
  const [to, setTo] = useState<string>(() => todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Keep the Individual pick inside the chosen home.
  useEffect(() => {
    if (individualId && !individuals.some((person) => person.id === individualId)) {
      setIndividualId(individuals[0]?.id ?? "");
    }
    if (!individualId && individuals.length > 0) {
      setIndividualId(individuals[0].id);
    }
  }, [individuals, individualId]);

  // Load the record picker for this entry whenever its inputs change.
  const recordDeps = `${siteId}|${individualId}`;
  useEffect(() => {
    if (!def.recordKind) return;
    let live = true;
    listReportRecordOptions(ctx, def, { siteId: siteId || null, individualId: individualId || null })
      .then((options) => {
        if (!live) return;
        setRecordOptions(options);
        setRecordId((current) =>
          options.some((option) => option.id === current) ? current : (options[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (live) setRecordOptions([]);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, def.recordKind, recordDeps]);

  async function run(mode: "download" | "print") {
    setBusy(true);
    setError("");
    setDone("");
    try {
      const scope: ReportScopeSelection = {
        siteId: siteId || null,
        individualId: individualId || null,
        recordId: recordId || null,
        staffUserId: staffUserId || null,
        from,
        to,
        monthKey: allMonths ? null : monthKey,
        year,
      };
      const file = await REPORT_RUNNERS[def.id](ctx, scope);
      await openPrintable(file.name, file.blob, mode);
      setDone(mode === "print" ? "Sent to print." : "Downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That report could not be built.");
    } finally {
      setBusy(false);
    }
  }

  const monthOptional = (def.id === "hm-checklists" || def.id === "service-logs");

  return (
    <article className="panel report-card">
      <h3>{def.title}</h3>
      <p className="muted">{def.description}</p>

      <div className="report-card-controls">
        {has("site") && (
          <label>
            Home
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {siteOptional && <option value="">All homes</option>}
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {has("individual") && (
          <label>
            Individual
            <select value={individualId} onChange={(event) => setIndividualId(event.target.value)}>
              {individuals.length === 0 && <option value="">No Individuals in this home</option>}
              {individuals.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {has("staff") && (
          <label>
            Staff member
            <select value={staffUserId} onChange={(event) => setStaffUserId(event.target.value)}>
              <option value="">Choose a staff member</option>
              {workspace.staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.role}
                </option>
              ))}
            </select>
          </label>
        )}

        {has("record") && (
          <label>
            {def.recordKind === "packet"
              ? "Packet"
              : def.recordKind === "weeklyChecklist"
                ? "Week"
                : def.recordKind === "qaAudit"
                  ? "Audit"
                  : def.recordKind === "appointment"
                    ? "Appointment"
                    : def.recordKind === "delegation"
                      ? "Delegation"
                      : "Checklist"}
            <select value={recordId} onChange={(event) => setRecordId(event.target.value)}>
              {recordOptions.length === 0 && <option value="">Nothing on file yet</option>}
              {recordOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {has("month") && (
          <label>
            Month
            <input
              type="month"
              value={monthKey}
              disabled={monthOptional && allMonths}
              onChange={(event) => setMonthKey(event.target.value)}
            />
          </label>
        )}
        {has("month") && monthOptional && (
          <label className="report-card-check">
            <input
              type="checkbox"
              checked={allMonths}
              onChange={(event) => setAllMonths(event.target.checked)}
            />
            All months
          </label>
        )}

        {has("year") && (
          <label>
            Year
            <input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
        )}

        {has("dateRange") && (
          <>
            <label>
              From
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </>
        )}
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {done && !error && <p className="quiet-note">{done}</p>}

      <div className="report-card-actions">
        <button className="button primary" disabled={busy} onClick={() => void run("download")}>
          <Download size={16} /> Download PDF
        </button>
        <button className="button" disabled={busy} onClick={() => void run("print")}>
          <Printer size={16} /> Print
        </button>
      </div>
    </article>
  );
}
