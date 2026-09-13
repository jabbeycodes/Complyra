import { useEffect, useMemo, useState } from "react";
import { CarFront, Pencil, Printer, Trash2 } from "lucide-react";
import { Empty, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { hasPermission } from "../../data/permissions";
import {
  MONTH_LABELS_SHORT,
  WEEK_LABELS,
  canBackfillMileage,
  computeTripMiles,
  monthKeyOf,
  monthLabel,
  summarizeMonthlyMileage,
  summarizeWeeklyMileage,
  validateOdometerContinuity,
  validateTripInput,
} from "../../data/mileage";
import type { MileageYearlySummary } from "../../data/mileage";
import type { MileageTrip, MileageTripView } from "../../data/types";
import { todayIso } from "../../data/chart";
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

/** Yearly summary + weekly breakdowns are an administrator tracking view. */
function canViewYearlySummary(
  session: { roleKey: string; platformAdmin: boolean } | null,
): boolean {
  if (!session) return false;
  return (
    session.platformAdmin ||
    session.roleKey === "administrator" ||
    session.roleKey === "compliance_admin"
  );
}

export default function MileagePage() {
  const { api, session, workspace, refresh } = useData();
  const [siteId, setSiteId] = useState("");
  const [month, setMonth] = useState(() => monthKeyOf(todayIso()));
  const [tab, setTab] = useState<"monthly" | "yearly">("monthly");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [trips, setTrips] = useState<MileageTripView[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  /** Expected start for a NEW trip: the latest trip's end (odometer continuity). */
  const [expectedStart, setExpectedStart] = useState<number | null>(null);
  /** Expected start when EDITING: the previous trip's end, excluding this trip. */
  const [editExpectedStart, setEditExpectedStart] = useState<number | null>(null);
  const [yearly, setYearly] = useState<MileageYearlySummary | null>(null);
  const [yearlyError, setYearlyError] = useState("");
  const [yearlyLoading, setYearlyLoading] = useState(false);

  const sites = workspace?.sites ?? [];
  const activeSiteId = siteId || sites[0]?.id || "";
  const activeSite = sites.find((site) => site.id === activeSiteId);
  const showYearly = canViewYearlySummary(session);
  /** Admin backfill: administrators, compliance admins, and house managers
   * may log a forgotten trip out of sequence. Regular staff never see it. */
  const showBackfill = canBackfillMileage(session);
  const people = useMemo(
    () =>
      (workspace?.individuals ?? []).filter(
        (person) => person.site === activeSite?.name,
      ),
    [workspace, activeSite],
  );
  const peopleIds = useMemo(() => people.map((person) => person.id), [people]);
  const nameById = useMemo(
    () => Object.fromEntries(people.map((person) => [person.id, person.name])),
    [people],
  );

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
  useEffect(() => {
    if (tab !== "yearly" || !showYearly || !activeSiteId) return;
    let live = true;
    setYearlyError("");
    setYearlyLoading(true);
    api
      .getMileageYearlySummary(activeSiteId, year, peopleIds)
      .then((result) => {
        if (live) {
          setYearly(result);
          setYearlyLoading(false);
        }
      })
      .catch((err) => {
        if (live) {
          setYearlyError((err as Error).message);
          setYearlyLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [api, tab, showYearly, activeSiteId, year, peopleIds]);

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

  const continuityHint = editingId ? editExpectedStart : expectedStart;
  const weekColumns = WEEK_LABELS.slice(0, weekly.hasWeek5 ? 5 : 4);

  // ---- Print view: reproduces the paper mileage log for this house/month ----
  if (printMode) {
    const totalById = Object.fromEntries(
      summary.individualTotals.map((row) => [row.individualId, row.miles]),
    );
    return (
      <div className="mileage-print">
        <div className="mileage-print-toolbar no-print">
          <button className="button" onClick={() => setPrintMode(false)}>
            Back to mileage log
          </button>
          <button className="button primary" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
        </div>
        <div className="mileage-sheet">
          <h1>{activeSite?.name ?? "Home"}</h1>
          <p className="mileage-sheet-sub">
            Mileage Log &nbsp;·&nbsp; Month of: {monthLabel(month)}
          </p>
          <table className="mileage-sheet-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Odometer start</th>
                <th>Odometer stop</th>
                <th>Miles</th>
                {people.map((person) => (
                  <th key={person.id}>{person.name}</th>
                ))}
                <th>Reason / Trip</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const shareById = Object.fromEntries(
                  trip.riderShares.map((share) => [share.individualId, share.miles]),
                );
                return (
                  <tr key={trip.id}>
                    <td>{formatDate(trip.tripDate)}</td>
                    <td>{trip.odometerStart}</td>
                    <td>{trip.odometerEnd}</td>
                    <td>{trip.miles}</td>
                    {people.map((person) => (
                      <td key={person.id}>{shareById[person.id] ?? ""}</td>
                    ))}
                    <td>{trip.reason}{trip.backfilled ? " (backfilled)" : ""}</td>
                    <td className="mileage-signature">{trip.signatureName}</td>
                  </tr>
                );
              })}
              {/* blank rows so the printed sheet has room for pen entries */}
              {Array.from({ length: Math.max(0, 12 - trips.length) }).map((_, i) => (
                <tr key={`blank-${i}`} className="mileage-blank-row">
                  <td>&nbsp;</td>
                  <td />
                  <td />
                  <td />
                  {people.map((person) => (
                    <td key={person.id} />
                  ))}
                  <td />
                  <td />
                </tr>
              ))}
              <tr className="mileage-totals-row">
                <td colSpan={3}>Total Miles</td>
                <td>{summary.totalMiles}</td>
                {people.map((person) => (
                  <td key={person.id}>{totalById[person.id] ?? 0}</td>
                ))}
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <div className="mileage-sign-rows">
            {people.map((person) => (
              <div key={person.id} className="mileage-sign-row">
                <span>
                  <strong>Print name:</strong> {person.name}
                </span>
                <span>
                  <strong>Sign name:</strong>
                  <span className="mileage-sign-line" />
                </span>
              </div>
            ))}
            <div className="mileage-sign-row">
              <span>
                <strong>Print name:</strong>
                <span className="mileage-sign-line" />
              </span>
              <span>
                <strong>Sign name:</strong>
                <span className="mileage-sign-line" />
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeading
        eyebrow="LIFEPATH"
        title="Mileage log"
        description="Vehicle mileage per house: log each trip's odometer readings, split the miles equally among the individuals who rode, and print the monthly sheet."
      >
        {tab === "monthly" && (
          <button className="button" onClick={() => setPrintMode(true)} disabled={trips.length === 0 && people.length === 0}>
            <Printer size={14} /> Print monthly sheet
          </button>
        )}
      </PageHeading>
      {error && <p className="form-error">{error}</p>}

      <div className="tabs" role="tablist" aria-label="Mileage views">
        <button
          role="tab"
          aria-selected={tab === "monthly"}
          className={tab === "monthly" ? "selected" : ""}
          onClick={() => setTab("monthly")}
        >
          Monthly log
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

      <p style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Home{" "}
          <select value={activeSiteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        {tab === "monthly" ? (
          <label>
            Month{" "}
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
        ) : (
          <label>
            Year{" "}
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
        )}
        {tab === "monthly" && (
          <span className="stack-help">
            {summary.tripCount} trip{summary.tripCount === 1 ? "" : "s"} · {summary.totalMiles}{" "}
            total miles
          </span>
        )}
      </p>

      {tab === "yearly" && showYearly && (
        <>
          <section className="panel" aria-label={`Yearly mileage summary ${year}`}>
            <h2>
              Yearly summary — {activeSite?.name} · {year}
            </h2>
            {yearlyError && <p className="form-error">{yearlyError}</p>}
            {yearlyLoading || !yearly ? (
              <p className="stack-help">Loading the yearly summary…</p>
            ) : (
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
            )}
          </section>

          <section className="panel" aria-label="Monthly weekly breakdown">
            <h2>Weekly breakdown — {monthLabel(month)}</h2>
            <p style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                Month{" "}
                <input
                  type="month"
                  value={month}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
              </label>
              <span className="stack-help">
                Week 1: days 1–7 · Week 2: 8–14 · Week 3: 15–21 · Week 4: 22–28
                {weekly.hasWeek5 ? " · Week 5: days 29–31" : ""}
              </span>
            </p>
            <div className="table-scroll">
              <table className="mileage-table">
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
        </>
      )}

      {tab === "monthly" && (
        <>
          <section className="panel" aria-label={editingId ? "Edit trip" : "Log a trip"}>
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
                {continuityHint !== null && !editingId && (
                  <span className="stack-help">
                    Continues from the last trip's end: {continuityHint.toLocaleString("en-US")}
                  </span>
                )}
                {editingId && continuityHint !== null && (
                  <span className="stack-help">
                    Must match the previous trip's end: {continuityHint.toLocaleString("en-US")}
                  </span>
                )}
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
                  Backfill — this trip is out of sequence
                  <span className="stack-help">
                    For a forgotten trip logged late: skips the odometer chain check and flags the row.
                  </span>
                </label>
              )}
              <fieldset className="mileage-riders">
                <legend>Individuals who rode (miles split equally)</legend>
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

          <section className="panel" aria-label="Monthly mileage log">
            <h2>
              {monthLabel(month)} — {activeSite?.name}
            </h2>
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
                      <th aria-label="Actions" />
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
                          <td className="mileage-row-actions">
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
                      <td />
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
