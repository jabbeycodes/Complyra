import { Fragment, useEffect, useMemo, useState } from "react";
import { CarFront, Download, Pencil, Printer, Trash2 } from "lucide-react";
import { Empty, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { hasPermission } from "../../data/permissions";
import { downloadBlob } from "../../data/openFile";
import {
  buildMileageMonthPdf,
  buildMileageWeekPdf,
  buildMileageYearPdf,
  mileageMonthFileName,
  mileageWeekFileName,
  mileageYearFileName,
} from "../../pdf/mileagePdf";
import {
  MONTH_LABELS_SHORT,
  WEEK_LABELS,
  canBackfillMileage,
  canDownloadMileageMonthly,
  canViewMileageYearlySummary,
  computeTripMiles,
  monthKeyOf,
  monthLabel,
  summarizeMonthlyMileage,
  summarizeWeeklyMileage,
  validateOdometerContinuity,
  validateTripInput,
} from "../../data/mileage";
import type { MileageYearlySummary, MileageAgencyYearlySummary } from "../../data/mileage";
import type { MileageTrip, MileageTripView } from "../../data/types";
import { individualsAtSite } from "../../data/dashboard";
import { todayIso } from "../../data/chart";
import { agencyStateCode, siteLocationFrom } from "../../data/siteAddress";
import "./mileage.css";

interface FormState {
  tripDate: string;
  odometerStart: string;
  odometerEnd: string;
  riderIds: string[];
  reason: string;
  driverName: string;
  signatureName: string;
  /** Admin backfill: this trip is being logged out of sequence. */
  backfill: boolean;
}

function emptyForm(): FormState {
  return {
    tripDate: todayIso(),
    odometerStart: "",
    odometerEnd: "",
    riderIds: [],
    reason: "",
    driverName: "",
    signatureName: "",
    backfill: false,
  };
}

/**
 * Yearly tracking is only available to administrators and program
 * managers (plus the platform owner) — Joshua's 2026-09-14 spec.
 */
function canViewYearlySummary(
  session: { roleKey: string; platformAdmin: boolean } | null,
): boolean {
  return canViewMileageYearlySummary(session);
}

/**
 * Monthly/weekly PDF download: house managers, agency admins, and the
 * platform operator. Everyone else on this page still gets Print.
 */
function canDownloadMonthly(
  session: { roleKey: string; platformAdmin: boolean } | null,
): boolean {
  return canDownloadMileageMonthly(session);
}

export default function MileagePage() {
  const { api, session, workspace, refresh } = useData();
  const [siteId, setSiteId] = useState("");
  const [month, setMonth] = useState(() => monthKeyOf(todayIso()));
  const [tab, setTab] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [trips, setTrips] = useState<MileageTripView[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /** Expected start for a NEW trip: the latest trip's end (odometer continuity). */
  const [expectedStart, setExpectedStart] = useState<number | null>(null);
  /** Expected start when EDITING: the previous trip's end, excluding this trip. */
  const [editExpectedStart, setEditExpectedStart] = useState<number | null>(null);
  const [yearly, setYearly] = useState<MileageYearlySummary | null>(null);
  const [yearlyError, setYearlyError] = useState("");
  const [yearlyLoading, setYearlyLoading] = useState(false);
  /** Yearly tab scope: one site, or "all" for the agency-wide view. */
  const [yearlyScope, setYearlyScope] = useState<string>("all");
  const [agencyYearly, setAgencyYearly] = useState<MileageAgencyYearlySummary | null>(null);

  const sites = workspace?.sites ?? [];
  const activeSiteId = siteId || sites[0]?.id || "";
  const activeSite = sites.find((site) => site.id === activeSiteId);
  const siteLocation = siteLocationFrom(
    activeSite,
    agencyStateCode(null, session?.agencyCode),
  );
  const showYearly = canViewYearlySummary(session);
  /** Admin backfill: administrators, compliance admins, and house managers
   * may log a forgotten trip out of sequence. Regular staff never see it. */
  const showBackfill = canBackfillMileage(session);
  const people = useMemo(
    () => individualsAtSite(workspace?.individuals ?? [], activeSite),
    [workspace, activeSite],
  );
  const peopleIds = useMemo(() => people.map((person) => person.id), [people]);
  /** id -> name across ALL sites (the agency-wide yearly view needs it). */
  const nameById = useMemo(
    () =>
      Object.fromEntries(
        (workspace?.individuals ?? []).map((person) => [person.id, person.name]),
      ),
    [workspace],
  );
  /** Individuals at one site, by site id — for the yearly scope selector. */
  const peopleBySiteId = useMemo(() => {
    const out = new Map<string, Array<{ id: string; name: string }>>();
    for (const site of sites) {
      out.set(
        site.id,
        individualsAtSite(workspace?.individuals ?? [], site).map((person) => ({
          id: person.id,
          name: person.name,
        })),
      );
    }
    return out;
  }, [workspace, sites]);
  const yearlySiteName =
    yearlyScope === "all"
      ? "All sites"
      : (sites.find((site) => site.id === yearlyScope)?.name ?? "");

  const summary = useMemo(
    () => summarizeMonthlyMileage(trips, peopleIds),
    [trips, peopleIds],
  );

  const weekly = useMemo(
    () => summarizeWeeklyMileage(trips, peopleIds),
    [trips, peopleIds],
  );

  useEffect(() => {
    if (!activeSiteId) return;
    let live = true;
    setError("");
    api
      .listMileageTrips(activeSiteId, month)
      .then((rows) => {
        if (live) setTrips(rows);
      })
      .catch((err) => {
        if (live) setError((err as Error).message);
      });
    return () => {
      live = false;
    };
  }, [api, activeSiteId, month, workspace]);

  // Odometer continuity: prefill a new trip's start from the latest trip's
  // end, and keep the expected value around for the blocking validation.
  useEffect(() => {
    if (!activeSiteId || editingId) return;
    let live = true;
    api
      .getLastMileageOdometerEnd(activeSiteId)
      .then((end) => {
        if (!live) return;
        setExpectedStart(end);
        if (end !== null) {
          setForm((prev) =>
            prev.odometerStart === "" ? { ...prev, odometerStart: String(end) } : prev,
          );
        }
      })
      .catch(() => {
        if (live) setExpectedStart(null);
      });
    return () => {
      live = false;
    };
  }, [api, activeSiteId, editingId, trips]);

  // Yearly administrator summary (auto-populated per the full-year tracker).
  // Scope "all" pulls every program site in one agency-wide table; otherwise
  // the selected site's per-site view.
  useEffect(() => {
    if (tab !== "yearly" || !showYearly) return;
    let live = true;
    setYearlyError("");
    setYearlyLoading(true);
    setYearly(null);
    setAgencyYearly(null);
    const fail = (err: unknown) => {
      if (live) {
        setYearlyError(
          err instanceof Error ? err.message : "Could not load the yearly summary.",
        );
        setYearlyLoading(false);
      }
    };
    if (yearlyScope === "all") {
      const siteInputs = sites.map((site) => ({
        siteId: site.id,
        siteName: site.name,
        individualIds: (peopleBySiteId.get(site.id) ?? []).map((p) => p.id),
      }));
      api
        .getMileageYearlySummaryAllSites(year, siteInputs)
        .then((result) => {
          if (live) {
            setAgencyYearly(result);
            setYearlyLoading(false);
          }
        })
        .catch(fail);
    } else {
      const ids = (peopleBySiteId.get(yearlyScope) ?? []).map((p) => p.id);
      api
        .getMileageYearlySummary(yearlyScope, year, ids)
        .then((result) => {
          if (live) {
            setYearly(result);
            setYearlyLoading(false);
          }
        })
        .catch(fail);
    }
    return () => {
      live = false;
    };
  }, [api, tab, showYearly, yearlyScope, year, sites, peopleBySiteId]);

  if (!session || !hasPermission(session, "mileage.manage")) {
    return (
      <Empty
        title="Mileage log"
        text="You don't have access to vehicle mileage records."
      />
    );
  }

  async function reload() {
    if (!activeSiteId) return;
    setTrips(await api.listMileageTrips(activeSiteId, month));
  }

  async function startEdit(trip: MileageTrip) {
    setEditingId(trip.id);
    setForm({
      tripDate: trip.tripDate,
      odometerStart: String(trip.odometerStart),
      odometerEnd: String(trip.odometerEnd),
      riderIds: [...trip.riderIds],
      reason: trip.reason,
      driverName: trip.driverName,
      signatureName: trip.signatureName,
      backfill: false,
    });
    setFormErrors([]);
    try {
      setEditExpectedStart(
        await api.getPreviousMileageOdometerEnd(activeSiteId, trip.id),
      );
    } catch {
      setEditExpectedStart(null);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditExpectedStart(null);
    setForm(emptyForm());
    setFormErrors([]);
  }

  async function removeTrip(tripId: string) {
    if (!window.confirm("Remove this mileage trip? This cannot be undone.")) return;
    setError("");
    try {
      await api.deleteMileageTrip(tripId);
      await refresh();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeSiteId) return;
    const odometerStart = Number(form.odometerStart);
    const odometerEnd = Number(form.odometerEnd);
    const problems = validateTripInput({
      tripDate: form.tripDate,
      odometerStart,
      odometerEnd,
      riderIds: form.riderIds,
      reason: form.reason,
      driverName: form.driverName,
    });
    // Odometer continuity is blocking: the start must continue the previous
    // trip's end (latest end for a new trip) — unless an authorized
    // backfiller checked the backfill box to log a forgotten trip.
    const backfill = showBackfill && form.backfill;
    const continuity = backfill
      ? null
      : validateOdometerContinuity(
          odometerStart,
          editingId ? editExpectedStart : expectedStart,
        );
    if (continuity) {
      problems.push({ field: "odometerStart", message: continuity });
    }
    setFormErrors(problems.map((problem) => problem.message));
    if (problems.length > 0) return;
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await api.updateMileageTrip(editingId, {
          tripDate: form.tripDate,
          odometerStart,
          odometerEnd,
          riderIds: form.riderIds,
          reason: form.reason,
          driverName: form.driverName,
          signatureName: form.signatureName,
          backfill,
        });
      } else {
        await api.addMileageTrip({
          siteId: activeSiteId,
          tripDate: form.tripDate,
          odometerStart,
          odometerEnd,
          riderIds: form.riderIds,
          reason: form.reason,
          driverName: form.driverName,
          signatureName: form.signatureName,
          backfill,
        });
      }
      await refresh();
      await reload();
      cancelEdit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const liveMiles =
    form.odometerStart !== "" && form.odometerEnd !== ""
      ? computeTripMiles(Number(form.odometerStart), Number(form.odometerEnd))
      : null;

  function toggleRider(personId: string) {
    setForm((prev) => ({
      ...prev,
      riderIds: prev.riderIds.includes(personId)
        ? prev.riderIds.filter((id) => id !== personId)
        : [...prev.riderIds, personId],
    }));
  }

  const weekColumns = WEEK_LABELS; // exactly Week 1–Week 4 per the tracker workbook

  // ---- Monthly sheet PDF: build and download a real file, no dead-end views ----
  async function downloadYearlySummary() {
    setDownloading(true);
    setYearlyError("");
    try {
      if (yearlyScope === "all") {
        if (!agencyYearly) return;
        // Flatten site-by-site so the PDF's group headers stay together.
        const orderedPeople: Array<{ id: string; name: string }> = [];
        const siteNameByIndividualId: Record<string, string> = {};
        for (const group of agencyYearly.sites) {
          for (const row of group.rows) {
            orderedPeople.push({
              id: row.individualId,
              name: nameById[row.individualId] ?? row.individualId,
            });
            siteNameByIndividualId[row.individualId] = group.siteName;
          }
        }
        const flatSummary: MileageYearlySummary = {
          year: agencyYearly.year,
          rows: agencyYearly.sites.flatMap((group) => group.rows),
          grandTotal: agencyYearly.grandTotal,
        };
        const doc = buildMileageYearPdf({
          agencyName: session?.agencyName ?? "Agency",
          siteName: "All sites",
          year,
          people: orderedPeople,
          summary: flatSummary,
          siteNameByIndividualId,
        });
        const blob = doc.output("blob") as Blob;
        downloadBlob(mileageYearFileName("all-sites", year), blob);
        return;
      }
      if (!yearly) return;
      const scopedPeople = peopleBySiteId.get(yearlyScope) ?? [];
      const yearlySite = sites.find((site) => site.id === yearlyScope);
      const doc = buildMileageYearPdf({
        agencyName: session?.agencyName ?? "Agency",
        siteName: yearlySiteName,
        year,
        people: scopedPeople.map((person) => ({ id: person.id, name: person.name })),
        summary: yearly,
        siteLocation: siteLocationFrom(
          yearlySite,
          agencyStateCode(null, session?.agencyCode),
        ),
      });
      const blob = doc.output("blob") as Blob;
      downloadBlob(mileageYearFileName(yearlySiteName || "home", year), blob);
    } catch (err) {
      setYearlyError(
        err instanceof Error ? err.message : "Could not build the yearly summary PDF.",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function downloadWeeklySheet() {
    setDownloading(true);
    setError("");
    try {
      const doc = buildMileageWeekPdf({
        agencyName: session?.agencyName ?? "Agency",
        siteName: activeSite?.name ?? "Home",
        monthKey: month,
        people: people.map((person) => ({ id: person.id, name: person.name })),
        rows: weekly.rows,
        siteLocation,
      });
      const blob = doc.output("blob") as Blob;
      downloadBlob(mileageWeekFileName(activeSite?.name ?? "home", month), blob);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not build the weekly sheet.",
      );
    } finally {
      setDownloading(false);
    }
  }

  function printSheet(kind: "weekly" | "monthly") {
    document.body.dataset.mileagePrint = kind;
    const clear = () => {
      delete document.body.dataset.mileagePrint;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  }

  async function downloadMonthlySheet() {
    setDownloading(true);
    setError("");
    try {
      const milesByIndividualId = Object.fromEntries(
        summary.individualTotals.map((row) => [row.individualId, row.miles]),
      );
      const doc = buildMileageMonthPdf({
        agencyName: session?.agencyName ?? "Agency",
        siteName: activeSite?.name ?? "Home",
        monthKey: month,
        people: people.map((person) => ({ id: person.id, name: person.name })),
        trips,
        totalMiles: summary.totalMiles,
        milesByIndividualId,
        siteLocation,
      });
      const blob = doc.output("blob") as Blob;
      downloadBlob(mileageMonthFileName(activeSite?.name ?? "home", month), blob);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not build the monthly sheet.",
      );
    } finally {
      setDownloading(false);
    }
  }


  const canDownloadSheets = canDownloadMonthly(session);

  function sheetActions(kind: "weekly" | "monthly") {
    const printLabel = kind === "weekly" ? "Print weekly" : "Print monthly";
    const pdfLabel = kind === "weekly" ? "Weekly PDF" : "Monthly PDF";
    return (
      <div className="mileage-sheet-actions">
        <button
          className="button"
          onClick={() => printSheet(kind)}
          disabled={downloading}
        >
          <Printer size={14} /> {printLabel}
        </button>
        {canDownloadSheets && (
          <button
            className="button"
            onClick={kind === "weekly" ? downloadWeeklySheet : downloadMonthlySheet}
            disabled={downloading}
          >
            <Download size={14} /> {downloading ? "Building…" : pdfLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-tour="mileage" className="mileage-page">
      <PageHeading title="Mileage" />
      {error && <p className="form-error mileage-no-print">{error}</p>}

      <div className="tabs mileage-no-print" role="tablist" aria-label="Mileage views">
        <button
          role="tab"
          aria-selected={tab === "monthly"}
          className={tab === "monthly" ? "selected" : ""}
          onClick={() => setTab("monthly")}
        >
          Monthly log
        </button>
        <button
          role="tab"
          aria-selected={tab === "weekly"}
          className={tab === "weekly" ? "selected" : ""}
          onClick={() => setTab("weekly")}
        >
          Weekly sheet
        </button>
        {showYearly && (
          <button
            role="tab"
            aria-selected={tab === "yearly"}
            className={tab === "yearly" ? "selected" : ""}
            onClick={() => setTab("yearly")}
          >
            Yearly summary
          </button>
        )}
      </div>

      <div className="mileage-toolbar mileage-no-print">
        {tab === "yearly" ? (
          <label>
            Scope
            <select
              value={yearlyScope}
              onChange={(e) => setYearlyScope(e.target.value)}
              aria-label="Yearly summary scope"
            >
              <option value="all">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Home
            <select value={activeSiteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === "yearly" ? (
          <label>
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) setYear(next);
              }}
            />
          </label>
        ) : (
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
        )}
        {tab !== "yearly" && (
          <>
            <span className="mileage-toolbar-stat">
              {summary.tripCount} trip{summary.tripCount === 1 ? "" : "s"} · {summary.totalMiles} mi
            </span>
            {sheetActions(tab)}
          </>
        )}
      </div>

      {tab === "weekly" && (
        <section className="panel mileage-print-weekly" aria-label="Weekly mileage sheet">
          <div className="mileage-sheet-head">
            <h2>Weekly sheet — {monthLabel(month)}</h2>
            {sheetActions("weekly")}
          </div>
          <div className="table-scroll">
            <table className="mileage-table mileage-table-compact">
              <thead>
                <tr>
                  <th>Name</th>
                  {weekColumns.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                  <th>Monthly Total</th>
                </tr>
              </thead>
              <tbody>
                {weekly.rows.map((row) => (
                  <tr key={row.individualId}>
                    <td>{nameById[row.individualId] ?? row.individualId}</td>
                    {weekColumns.map((label, index) => (
                      <td key={label}>{row.weeks[index]}</td>
                    ))}
                    <td>
                      <strong>{row.monthlyTotal}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "yearly" && showYearly && (
        <>
          <section className="panel" aria-label={`Yearly mileage summary ${year}`}>
            <h2>
              Yearly summary — {yearlySiteName} · {year}
            </h2>
            <p>
              <button
                className="button"
                onClick={downloadYearlySummary}
                disabled={
                  downloading || (yearlyScope === "all" ? !agencyYearly : !yearly)
                }
              >
                <Download size={14} /> {downloading ? "Building PDF…" : "Download yearly summary (PDF)"}
              </button>
            </p>
            {yearlyError && <p className="form-error">{yearlyError}</p>}
            {yearlyLoading ? (
              <p className="stack-help">Loading the yearly summary…</p>
            ) : yearlyScope === "all" ? (
              agencyYearly && (
                <div className="table-scroll">
                  <table className="mileage-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        {MONTH_LABELS_SHORT.map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                        <th>Yearly Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agencyYearly.sites.map((group) => (
                        <Fragment key={group.siteId}>
                          <tr className="mileage-site-row">
                            <td colSpan={14}>
                              <strong>{group.siteName}</strong>
                            </td>
                          </tr>
                          {group.rows.map((row) => (
                            <tr key={row.individualId}>
                              <td>{nameById[row.individualId] ?? row.individualId}</td>
                              {row.months.map((miles, index) => (
                                <td key={MONTH_LABELS_SHORT[index]}>{miles}</td>
                              ))}
                              <td>
                                <strong>{row.yearlyTotal}</strong>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                      <tr className="mileage-totals-row">
                        <td>Grand Total</td>
                        {agencyYearly.grandTotal.months.map((miles, index) => (
                          <td key={MONTH_LABELS_SHORT[index]}>
                            <strong>{miles}</strong>
                          </td>
                        ))}
                        <td>
                          <strong>{agencyYearly.grandTotal.yearlyTotal}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              yearly && (
                <div className="table-scroll">
                  <table className="mileage-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        {MONTH_LABELS_SHORT.map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                        <th>Yearly Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearly.rows.map((row) => (
                        <tr key={row.individualId}>
                          <td>{nameById[row.individualId] ?? row.individualId}</td>
                          {row.months.map((miles, index) => (
                            <td key={MONTH_LABELS_SHORT[index]}>{miles}</td>
                          ))}
                          <td>
                            <strong>{row.yearlyTotal}</strong>
                          </td>
                        </tr>
                      ))}
                      <tr className="mileage-totals-row">
                        <td>Grand Total</td>
                        {yearly.grandTotal.months.map((miles, index) => (
                          <td key={MONTH_LABELS_SHORT[index]}>
                            <strong>{miles}</strong>
                          </td>
                        ))}
                        <td>
                          <strong>{yearly.grandTotal.yearlyTotal}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>

        </>
      )}

      {tab === "monthly" && (
        <>
          <section className="panel mileage-no-print" aria-label={editingId ? "Edit trip" : "Log a trip"}>
            <h2>
              <CarFront size={18} /> {editingId ? "Edit trip" : "Log a trip"}
            </h2>
            {formErrors.length > 0 && (
              <ul className="form-error">
                {formErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            <form onSubmit={submit} className="mileage-form">
              <label>
                Date
                <input
                  type="date"
                  value={form.tripDate}
                  onChange={(e) => setForm({ ...form, tripDate: e.target.value })}
                />
              </label>
              <label>
                Odometer start
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.odometerStart}
                  onChange={(e) => setForm({ ...form, odometerStart: e.target.value })}
                  placeholder="e.g. 45210"
                />
              </label>
              <label>
                Odometer stop
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.odometerEnd}
                  onChange={(e) => setForm({ ...form, odometerEnd: e.target.value })}
                  placeholder="e.g. 45236"
                />
              </label>
              <div className="mileage-live-miles" aria-live="polite">
                Miles: <strong>{liveMiles === null || Number.isNaN(liveMiles) ? "—" : liveMiles}</strong>
              </div>
              {showBackfill && (
                <label className="mileage-backfill mileage-form-wide">
                  <input
                    type="checkbox"
                    checked={form.backfill}
                    onChange={(e) => setForm({ ...form, backfill: e.target.checked })}
                  />
                  Backfill — out of sequence
                </label>
              )}
              <fieldset className="mileage-riders">
                <legend>Riders</legend>
                {people.length === 0 && (
                  <p className="stack-help">No individuals are assigned to this home yet.</p>
                )}
                {people.map((person) => (
                  <label key={person.id} className="mileage-rider">
                    <input
                      type="checkbox"
                      checked={form.riderIds.includes(person.id)}
                      onChange={() => toggleRider(person.id)}
                    />
                    {person.name}
                  </label>
                ))}
              </fieldset>
              <label className="mileage-form-wide">
                Reason / Trip
                <input
                  type="text"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g. Doctor appointment, grocery run"
                />
              </label>
              <label>
                Driver (print name)
                <input
                  type="text"
                  value={form.driverName}
                  onChange={(e) => setForm({ ...form, driverName: e.target.value })}
                  placeholder="Staff name"
                />
              </label>
              <label>
                Signature
                <input
                  type="text"
                  value={form.signatureName}
                  onChange={(e) => setForm({ ...form, signatureName: e.target.value })}
                  placeholder="Sign name"
                />
              </label>
              <div className="mileage-form-actions mileage-form-wide">
                <button type="submit" className="button primary" disabled={saving}>
                  {saving ? "Saving…" : editingId ? "Save changes" : "Log trip"}
                </button>
                {editingId && (
                  <button type="button" className="button" onClick={cancelEdit}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="panel mileage-print-monthly" aria-label="Monthly mileage log">
            <div className="mileage-sheet-head">
              <h2>
                {monthLabel(month)} — {activeSite?.name}
              </h2>
              {sheetActions("monthly")}
            </div>
            {trips.length === 0 ? (
              <Empty title="No trips logged" text="Log the first trip for this month above." />
            ) : (
              <div className="table-scroll">
                <table className="mileage-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Odo start</th>
                      <th>Odo stop</th>
                      <th>Miles</th>
                      {people.map((person) => (
                        <th key={person.id}>{person.name}</th>
                      ))}
                      <th>Reason / Trip</th>
                      <th>Signature</th>
                      <th className="mileage-no-print" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => {
                      const shareById = Object.fromEntries(
                        trip.riderShares.map((share) => [share.individualId, share.miles]),
                      );
                      return (
                        <tr key={trip.id}>
                          <td>
                            {formatDate(trip.tripDate)}
                            {trip.backfilled && (
                              <span className="mileage-backfill-badge">backfilled</span>
                            )}
                          </td>
                          <td>{trip.odometerStart}</td>
                          <td>{trip.odometerEnd}</td>
                          <td>
                            <strong>{trip.miles}</strong>
                          </td>
                          {people.map((person) => (
                            <td key={person.id}>{shareById[person.id] ?? "—"}</td>
                          ))}
                          <td>{trip.reason}</td>
                          <td>{trip.signatureName}</td>
                          <td className="mileage-row-actions mileage-no-print">
                            <button
                              className="icon-button"
                              aria-label={`Edit trip on ${trip.tripDate}`}
                              onClick={() => startEdit(trip)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Delete trip on ${trip.tripDate}`}
                              onClick={() => removeTrip(trip.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="mileage-totals-row">
                      <td colSpan={3}>Total Miles</td>
                      <td>
                        <strong>{summary.totalMiles}</strong>
                      </td>
                      {people.map((person) => (
                        <td key={person.id}>
                          <strong>
                            {summary.individualTotals.find((row) => row.individualId === person.id)
                              ?.miles ?? 0}
                          </strong>
                        </td>
                      ))}
                      <td />
                      <td />
                      <td className="mileage-no-print" />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
