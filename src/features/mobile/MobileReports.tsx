import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ComplyraApi, WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { openPrintable } from "../../data/openFile";
import { centralTodayIso } from "./mar";
import { monthKeyFrom } from "../../data/monthlyChecks";
import {
  canAccessReportLibrary,
  reportsForRole,
  type ReportDefinition,
} from "../reports/reportLibrary";
import {
  listReportRecordOptions,
  REPORT_RUNNERS,
  type ReportRecordOption,
  type ReportRunContext,
  type ReportScopeSelection,
} from "../reports/reportRunners";

/**
 * Mobile Report Library — the desktop Report Library catalog as a
 * phone view: the same role-filtered entries (reportsForRole), the
 * same scope controls each entry declares, and the same runners
 * (REPORT_RUNNERS) producing the same stamped output through
 * openPrintable. Nothing is rebuilt or re-gated here: the catalog's
 * role lists are the gate, exactly as on the desktop page. Site scope
 * follows the workspace the session can already see.
 */
export default function MobileReports({
  api,
  session,
  workspace,
}: {
  api: ComplyraApi;
  session: SessionUser;
  workspace: WorkspaceView;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = useMemo(
    () => reportsForRole(session.roleKey),
    [session.roleKey],
  );

  if (!canAccessReportLibrary(session.roleKey)) {
    return (
      <p className="msh-empty">
        Report Library is not available for your role. It is available
        to agency administrators, program and house managers, nurses,
        and auditors.
      </p>
    );
  }

  const visible = entries.filter((entry) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.module.toLowerCase().includes(q)
    );
  });
  const groups: { module: string; entries: ReportDefinition[] }[] = [];
  for (const entry of visible) {
    const group = groups.find((row) => row.module === entry.module);
    if (group) group.entries.push(entry);
    else groups.push({ module: entry.module, entries: [entry] });
  }
  const ctx: ReportRunContext = { api, session, workspace };

  return (
    <div>
      <p className="msh-section-note">
        Every report in the app, in one place — printed output is the
        same stamped record each home surface produces.
      </p>
      <label className="msh-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reports"
          aria-label="Search reports"
        />
      </label>
      {groups.length === 0 && (
        <p className="msh-empty">No reports match. Try a different search.</p>
      )}
      {groups.map((group) => (
        <div key={group.module}>
          <h3 className="msh-pass-title">{group.module}</h3>
          <div className="msh-list">
            {group.entries.map((entry) =>
              openId === entry.id ? (
                <ReportScopeForm
                  key={entry.id}
                  def={entry}
                  ctx={ctx}
                  onClose={() => setOpenId(null)}
                />
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  className="msh-row"
                  onClick={() => setOpenId(entry.id)}
                >
                  <span className="msh-row-main">
                    <strong>{entry.title}</strong>
                    <small>{entry.description}</small>
                  </span>
                  <span className="msh-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function daysAgoIso(days: number): string {
  const date = new Date(`${centralTodayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * One entry's scope form + run buttons — the desktop ReportEntryCard's
 * controls, stacked for the phone. The scope object is built exactly
 * as the desktop card builds it.
 */
function ReportScopeForm({
  def,
  ctx,
  onClose,
}: {
  def: ReportDefinition;
  ctx: ReportRunContext;
  onClose: () => void;
}) {
  const { workspace } = ctx;
  const has = (kind: ReportDefinition["scopes"][number]) => def.scopes.includes(kind);
  const siteOptional = has("agency");
  const sites = workspace.sites;
  const [siteId, setSiteId] = useState<string>(
    siteOptional ? "" : (sites[0]?.id ?? ""),
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
  const [monthKey, setMonthKey] = useState<string>(() => monthKeyFrom(centralTodayIso()));
  const [allMonths, setAllMonths] = useState(false);
  const [year, setYear] = useState<number>(() => Number(centralTodayIso().slice(0, 4)));
  const [from, setFrom] = useState<string>(() => daysAgoIso(13));
  const [to, setTo] = useState<string>(() => centralTodayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (individualId && !individuals.some((person) => person.id === individualId)) {
      setIndividualId(individuals[0]?.id ?? "");
    }
    if (!individualId && individuals.length > 0) {
      setIndividualId(individuals[0].id);
    }
  }, [individuals, individualId]);

  const recordDeps = `${siteId}|${individualId}`;
  useEffect(() => {
    if (!def.recordKind) return;
    let live = true;
    listReportRecordOptions(ctx, def, {
      siteId: siteId || null,
      individualId: individualId || null,
    })
      .then((options) => {
        if (!live) return;
        setRecordOptions(options);
        setRecordId((current) =>
          options.some((option) => option.id === current)
            ? current
            : (options[0]?.id ?? ""),
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

  const run = async (mode: "download" | "print") => {
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
  };

  const monthOptional = def.id === "hm-checklists" || def.id === "service-logs";
  const recordLabel =
    def.recordKind === "packet"
      ? "Packet"
      : def.recordKind === "weeklyChecklist"
        ? "Week"
        : def.recordKind === "qaAudit"
          ? "Audit"
          : def.recordKind === "appointment"
            ? "Appointment"
            : def.recordKind === "delegation"
              ? "Delegation"
              : "Checklist";

  return (
    <form
      className="msh-record-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void run("print");
      }}
    >
      <strong>{def.title}</strong>
      <p>{def.description}</p>
      {has("site") && (
        <label className="msh-field">
          <span>Home</span>
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
        <label className="msh-field">
          <span>Individual</span>
          <select
            value={individualId}
            onChange={(event) => setIndividualId(event.target.value)}
          >
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
        <label className="msh-field">
          <span>Staff member</span>
          <select
            value={staffUserId}
            onChange={(event) => setStaffUserId(event.target.value)}
          >
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
        <label className="msh-field">
          <span>{recordLabel}</span>
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
        <label className="msh-field">
          <span>Month</span>
          <input
            type="month"
            value={monthKey}
            disabled={monthOptional && allMonths}
            onChange={(event) => setMonthKey(event.target.value)}
          />
        </label>
      )}
      {has("month") && monthOptional && (
        <label className="msh-field">
          <span>All months</span>
          <input
            type="checkbox"
            checked={allMonths}
            onChange={(event) => setAllMonths(event.target.checked)}
          />
        </label>
      )}
      {has("year") && (
        <label className="msh-field">
          <span>Year</span>
          <input
            type="number"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </label>
      )}
      {has("dateRange") && (
        <>
          <label className="msh-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="msh-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </>
      )}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {done && <p className="msh-status-text">{done}</p>}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="msh-button secondary"
          disabled={busy}
          onClick={() => void run("download")}
        >
          Download
        </button>
        <button type="submit" className="msh-button primary" disabled={busy}>
          {busy ? "Building…" : "Print"}
        </button>
      </div>
    </form>
  );
}
