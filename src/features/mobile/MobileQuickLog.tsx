import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, Flame, HeartPulse, TriangleAlert, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  AMOUNT_EATEN_OPTIONS,
  MEAL_SLOTS,
  amountEatenLabel,
  mealSlotLabel,
  type AmountEaten,
  type MealSlot,
  type MenuEntryView,
} from "../../data/menuRecords";
import {
  DRILL_LABELS,
  drillComplete,
  type EmergencyDrill,
} from "../../data/monthlyChecks";
import { validateTripInput } from "../../data/mileage";
import type { MileageTripView } from "../../data/types";
import type { GerReport } from "../../data/ger";
import type { HealthTrackEntry } from "../../data/healthTrack";
import { centralNowHhmm, centralTodayIso, formatIsoDay } from "./mar";
import {
  drillMonthStatus,
  drillRowStatus,
  fieldLogAccess,
  gerMonthStatus,
  healthTodayStatus,
  menuTodayStatus,
  mileageMonthStatus,
  monthKeyOf,
  personDayEntries,
  type FieldLogDomain,
} from "./fieldLogs";
import MobilePeopleList from "./MobilePeopleList";
import { PersonHeader } from "./MobileMar";
import MobileGerLog from "./MobileGerLog";
import MobileHealth from "./MobileHealth";
import type { WorkspaceIndividual } from "./types";

/**
 * Mobile Quick log — one door for the field logs that used to live only
 * on desktop surfaces: health trackers, menu records, mileage, drills,
 * and incident (GER) reports. Every flow writes through the SAME API
 * methods and validation the desktop surface uses, so a record logged
 * on a phone is the record the desktop shows. The chooser hides any
 * domain the role cannot use (the gates are the desktop gates —
 * fieldLogs.ts), and each entry carries a factual status line for the
 * current home. Health is the Health home itself (MobileHealth) mounted
 * as a sub-flow — one implementation behind both doors.
 */
const DOMAIN_META: {
  id: FieldLogDomain;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  {
    id: "health",
    label: "Health",
    hint: "Vitals, intake, elimination, seizures and more",
    icon: HeartPulse,
  },
  {
    id: "menu",
    label: "Menu record",
    hint: "Record what an Individual ate",
    icon: UtensilsCrossed,
  },
  {
    id: "mileage",
    label: "Mileage",
    hint: "Log a vehicle trip for this home",
    icon: Car,
  },
  {
    id: "drills",
    label: "Drill",
    hint: "Record this month's emergency drills",
    icon: Flame,
  },
  {
    id: "ger",
    label: "Incident report",
    hint: "File a general event report (GER)",
    icon: TriangleAlert,
  },
];

export default function MobileQuickLog({
  api,
  session,
  siteId,
  siteName,
  people,
  drills,
  onOpenChart,
  onOpenMedications,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  siteName: string;
  people: WorkspaceIndividual[];
  /** The current home's scheduled drill rows (workspace monthly data). */
  drills: EmergencyDrill[];
  onOpenChart: (name: string) => void;
  /** The Health flow's Medications row deep-links to the MAR. */
  onOpenMedications: () => void;
}) {
  const todayIso = centralTodayIso();
  const monthKey = monthKeyOf(todayIso);
  const access = useMemo(
    () => fieldLogAccess(session.roleKey, session.permissions),
    [session],
  );
  const [screen, setScreen] = useState<"chooser" | FieldLogDomain>("chooser");
  const [refreshKey, setRefreshKey] = useState(0);
  const [menuEntries, setMenuEntries] = useState<MenuEntryView[]>([]);
  const [healthEntries, setHealthEntries] = useState<HealthTrackEntry[]>([]);
  const [trips, setTrips] = useState<MileageTripView[]>([]);
  const [reports, setReports] = useState<GerReport[]>([]);
  const [drillRows, setDrillRows] = useState<EmergencyDrill[]>(drills);
  const [statusError, setStatusError] = useState("");

  // Chooser statuses, reloaded on entry and after every save (a save
  // bumps refreshKey via onLogged) — no polling.
  const loadStatuses = useCallback(async () => {
    try {
      if (access.menu) {
        const perPerson = await Promise.all(
          people.map((person) =>
            api.getMenuEntries(person.id, todayIso, todayIso),
          ),
        );
        setMenuEntries(perPerson.flat());
      }
      if (access.healthView) {
        const perPerson = await Promise.all(
          people.map((person) =>
            api.listHealthTrackEntries({ individualId: person.id }),
          ),
        );
        setHealthEntries(perPerson.flat());
      }
      if (access.mileage) {
        setTrips(await api.listMileageTrips(siteId, monthKey));
      }
      if (access.gerView) {
        setReports(await api.listGerReports({ siteId }));
      }
      setStatusError("");
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : "Could not load today's status.",
      );
    }
  }, [api, access, people, siteId, todayIso, monthKey]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses, refreshKey]);

  const onLogged = useCallback(() => setRefreshKey((key) => key + 1), []);

  const statusFor = (domain: FieldLogDomain): string => {
    switch (domain) {
      case "health":
        return healthTodayStatus(healthEntries, todayIso).text;
      case "menu":
        return menuTodayStatus(menuEntries, todayIso).text;
      case "mileage":
        return mileageMonthStatus(trips, monthKey).text;
      case "drills":
        return drillMonthStatus(drillRows, monthKey).text;
      case "ger":
        return access.gerView
          ? gerMonthStatus(reports, monthKey).text
          : "File a new report";
    }
  };

  const domainVisible = (domain: FieldLogDomain): boolean => {
    switch (domain) {
      case "health":
        return access.healthView;
      case "menu":
        return access.menu;
      case "mileage":
        return access.mileage;
      case "drills":
        return access.drills;
      case "ger":
        return access.gerCreate || access.gerView;
    }
  };

  if (screen === "health") {
    return (
      <MobileHealth
        api={api}
        session={session}
        people={people}
        onOpenChart={onOpenChart}
        onOpenMedications={onOpenMedications}
        onBack={() => setScreen("chooser")}
        backLabel="Quick log"
        onEntrySaved={onLogged}
      />
    );
  }
  if (screen === "menu") {
    return (
      <MenuLogScreen
        api={api}
        people={people}
        entries={menuEntries}
        todayIso={todayIso}
        onOpenChart={onOpenChart}
        onBack={() => setScreen("chooser")}
        onLogged={onLogged}
      />
    );
  }
  if (screen === "mileage") {
    return (
      <MileageLogScreen
        api={api}
        session={session}
        siteId={siteId}
        people={people}
        trips={trips}
        monthKey={monthKey}
        onBack={() => setScreen("chooser")}
        onLogged={onLogged}
      />
    );
  }
  if (screen === "drills") {
    return (
      <DrillsScreen
        api={api}
        session={session}
        drillRows={drillRows}
        monthKey={monthKey}
        todayIso={todayIso}
        onBack={() => setScreen("chooser")}
        onRecorded={(updated) => {
          setDrillRows((rows) =>
            rows.map((row) => (row.id === updated.id ? updated : row)),
          );
          onLogged();
        }}
      />
    );
  }
  if (screen === "ger") {
    return (
      <MobileGerLog
        api={api}
        session={session}
        siteId={siteId}
        siteName={siteName}
        people={people}
        reports={reports}
        canCreate={access.gerCreate}
        canView={access.gerView}
        onBack={() => setScreen("chooser")}
        onLogged={onLogged}
      />
    );
  }

  return (
    <div>
      <p className="msh-section-note">
        Log the day's field records for {siteName}. Everything saved here
        is the same record the desktop shows.
      </p>
      {statusError && (
        <p className="msh-alert" role="alert">
          {statusError}
        </p>
      )}
      <div className="msh-list">
        {DOMAIN_META.filter((domain) => domainVisible(domain.id)).map(
          (domain) => {
            const Icon = domain.icon;
            return (
              <button
                key={domain.id}
                type="button"
                className="msh-row"
                onClick={() => setScreen(domain.id)}
              >
                <span className="msh-tile-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>{domain.label}</strong>
                  <small>{domain.hint}</small>
                  <small className="msh-status-text">
                    {statusFor(domain.id)}
                  </small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Menu ─────────────────────────────

function MenuLogScreen({
  api,
  people,
  entries,
  todayIso,
  onOpenChart,
  onBack,
  onLogged,
}: {
  api: ComplyraApi;
  people: WorkspaceIndividual[];
  entries: MenuEntryView[];
  todayIso: string;
  onOpenChart: (name: string) => void;
  onBack: () => void;
  onLogged: () => void;
}) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const person = people.find((row) => row.id === personId) ?? null;
  const todays = person ? personDayEntries(entries, person.id, todayIso) : [];

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Quick log
      </button>
      {!person ? (
        <>
          <p className="msh-section-note">
            Pick the Individual whose meal you are recording.
          </p>
          <MobilePeopleList
            people={people}
            onPick={(row) => setPersonId(row.id)}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            className="msh-text-button"
            onClick={() => setPersonId(null)}
          >
            ‹ All Individuals
          </button>
          <PersonHeader person={person} onOpenChart={onOpenChart} />
          <h3 className="msh-pass-title">
            Meals today · {formatIsoDay(todayIso)}
          </h3>
          <button
            type="button"
            className="msh-button primary block"
            onClick={() => setSheetOpen(true)}
          >
            Record a meal
          </button>
          <div className="msh-list">
            {todays.length === 0 && (
              <p className="msh-empty">Nothing recorded for today yet.</p>
            )}
            {todays.map((entry) => (
              <div key={entry.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>{mealSlotLabel(entry.mealSlot)}</strong>
                  <small>
                    {entry.foodText} ({amountEatenLabel(entry.amountEaten)})
                  </small>
                  {entry.note && <small>{entry.note}</small>}
                  <small className="msh-status-text">
                    Recorded by {entry.recordedByName}
                  </small>
                </span>
              </div>
            ))}
          </div>
          {sheetOpen && (
            <MenuLogSheet
              api={api}
              person={person}
              todayIso={todayIso}
              onClose={() => setSheetOpen(false)}
              onSaved={() => {
                setSheetOpen(false);
                onLogged();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function MenuLogSheet({
  api,
  person,
  todayIso,
  onClose,
  onSaved,
}: {
  api: ComplyraApi;
  person: WorkspaceIndividual;
  todayIso: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entryDate, setEntryDate] = useState(todayIso);
  const [mealSlot, setMealSlot] = useState<MealSlot>("breakfast");
  const [foodText, setFoodText] = useState("");
  const [amountEaten, setAmountEaten] = useState<AmountEaten>("all");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!foodText.trim()) {
      setError("Record what was eaten.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.saveMenuEntry({
        individualId: person.id,
        entryDate,
        mealSlot,
        foodText,
        amountEaten,
        note,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close menu form"
        onClick={onClose}
      />
      <div className="msh-sheet" role="dialog" aria-label="Record a meal">
        <h3 className="msh-sheet-title">Record a meal — {person.name}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className="msh-field">
            <span>Date</span>
            <input
              type="date"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
              required
            />
          </label>
          <label className="msh-field">
            <span>Meal</span>
            <select
              value={mealSlot}
              onChange={(event) => setMealSlot(event.target.value as MealSlot)}
            >
              {MEAL_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {mealSlotLabel(slot)}
                </option>
              ))}
            </select>
          </label>
          <label className="msh-field">
            <span>Food eaten</span>
            <input
              type="text"
              value={foodText}
              onChange={(event) => setFoodText(event.target.value)}
              placeholder="e.g. Oatmeal with berries, orange juice"
            />
          </label>
          <label className="msh-field">
            <span>Amount eaten</span>
            <select
              value={amountEaten}
              onChange={(event) =>
                setAmountEaten(event.target.value as AmountEaten)
              }
            >
              {AMOUNT_EATEN_OPTIONS.map((amount) => (
                <option key={amount} value={amount}>
                  {amountEatenLabel(amount)}
                </option>
              ))}
            </select>
          </label>
          <label className="msh-field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error && (
            <p className="msh-alert" role="alert">
              {error}
            </p>
          )}
          <div className="msh-form-actions">
            <button
              type="button"
              className="msh-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="msh-button primary" disabled={busy}>
              {busy ? "Saving…" : "Save entry"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ───────────────────────────── Mileage ─────────────────────────────

function MileageLogScreen({
  api,
  session,
  siteId,
  people,
  trips,
  monthKey,
  onBack,
  onLogged,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  people: WorkspaceIndividual[];
  trips: MileageTripView[];
  monthKey: string;
  onBack: () => void;
  onLogged: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const status = mileageMonthStatus(trips, monthKey);
  const newestFirst = [...trips].reverse();

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Quick log
      </button>
      <h3 className="msh-pass-title">Mileage</h3>
      <p className="msh-section-note">{status.text}</p>
      <button
        type="button"
        className="msh-button primary block"
        onClick={() => setSheetOpen(true)}
      >
        Log a trip
      </button>
      <div className="msh-list">
        {newestFirst.length === 0 && (
          <p className="msh-empty">No trips logged this month.</p>
        )}
        {newestFirst.map((trip) => (
          <div key={trip.id} className="msh-row static">
            <span className="msh-row-main">
              <strong>
                {formatIsoDay(trip.tripDate)} · {trip.miles} miles
              </strong>
              <small>
                {trip.reason} · {trip.odometerStart} → {trip.odometerEnd}
              </small>
              <small className="msh-status-text">
                Driver: {trip.driverName}
                {trip.backfilled ? " · Backfilled" : ""}
              </small>
            </span>
          </div>
        ))}
      </div>
      {sheetOpen && (
        <MileageLogSheet
          api={api}
          session={session}
          siteId={siteId}
          people={people}
          onClose={() => setSheetOpen(false)}
          onSaved={() => {
            setSheetOpen(false);
            onLogged();
          }}
        />
      )}
    </div>
  );
}

function MileageLogSheet({
  api,
  session,
  siteId,
  people,
  onClose,
  onSaved,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  people: WorkspaceIndividual[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tripDate, setTripDate] = useState(() => centralTodayIso());
  const [odometerStart, setOdometerStart] = useState("");
  const [odometerEnd, setOdometerEnd] = useState("");
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [driverName, setDriverName] = useState(session.fullName);
  const [signatureName, setSignatureName] = useState(session.fullName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The paper log is one unbroken chain: the desktop form pre-fills the
  // start from the last trip's end, and the API enforces it. Mirror both.
  useEffect(() => {
    let live = true;
    api
      .getLastMileageOdometerEnd(siteId)
      .then((end) => {
        if (live && end !== null) setOdometerStart(String(end));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, siteId]);

  const toggleRider = (id: string) =>
    setRiderIds((ids) =>
      ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id],
    );

  const save = async () => {
    const input = {
      tripDate,
      odometerStart: Number(odometerStart),
      odometerEnd: Number(odometerEnd),
      riderIds,
      reason,
      driverName,
    };
    const errors = validateTripInput(input);
    if (errors.length > 0) {
      setError(errors[0].message);
      return;
    }
    if (!signatureName.trim()) {
      setError("Sign the trip with your full name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.addMileageTrip({ siteId, ...input, signatureName });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close mileage form"
        onClick={onClose}
      />
      <div className="msh-sheet" role="dialog" aria-label="Log a trip">
        <h3 className="msh-sheet-title">Log a trip</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className="msh-field">
            <span>Trip date</span>
            <input
              type="date"
              value={tripDate}
              onChange={(event) => setTripDate(event.target.value)}
              required
            />
          </label>
          <div className="msh-field-pair">
            <label className="msh-field">
              <span>Odometer start</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={odometerStart}
                onChange={(event) => setOdometerStart(event.target.value)}
              />
            </label>
            <label className="msh-field">
              <span>Odometer end</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={odometerEnd}
                onChange={(event) => setOdometerEnd(event.target.value)}
              />
            </label>
          </div>
          <fieldset className="msh-fieldset">
            <legend>Who rode (Individuals)</legend>
            {people.map((person) => (
              <label key={person.id} className="msh-confirm">
                <input
                  type="checkbox"
                  checked={riderIds.includes(person.id)}
                  onChange={() => toggleRider(person.id)}
                />
                <span>{person.name}</span>
              </label>
            ))}
            {people.length === 0 && (
              <p className="msh-empty">No Individuals at this home.</p>
            )}
          </fieldset>
          <label className="msh-field">
            <span>Reason for the trip</span>
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Day program"
            />
          </label>
          <label className="msh-field">
            <span>Driver name</span>
            <input
              type="text"
              value={driverName}
              onChange={(event) => setDriverName(event.target.value)}
            />
          </label>
          <label className="msh-field">
            <span>Signature (type full name)</span>
            <input
              type="text"
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
            />
          </label>
          {error && (
            <p className="msh-alert" role="alert">
              {error}
            </p>
          )}
          <div className="msh-form-actions">
            <button
              type="button"
              className="msh-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="msh-button primary" disabled={busy}>
              {busy ? "Saving…" : "Save trip"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ───────────────────────────── Drills ─────────────────────────────

function DrillsScreen({
  api,
  session,
  drillRows,
  monthKey,
  todayIso,
  onBack,
  onRecorded,
}: {
  api: ComplyraApi;
  session: SessionUser;
  drillRows: EmergencyDrill[];
  monthKey: string;
  todayIso: string;
  onBack: () => void;
  onRecorded: (updated: EmergencyDrill) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const rows = drillRows.filter((drill) => drill.monthKey === monthKey);
  const status = drillMonthStatus(drillRows, monthKey);
  const active = rows.find((drill) => drill.id === activeId) ?? null;

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Quick log
      </button>
      <h3 className="msh-pass-title">Emergency drills</h3>
      <p className="msh-section-note">{status.text}</p>
      <div className="msh-list">
        {rows.length === 0 && (
          <p className="msh-empty">No drills scheduled this month.</p>
        )}
        {rows.map((drill) => (
          <button
            key={drill.id}
            type="button"
            className="msh-row"
            onClick={() => setActiveId(drill.id)}
          >
            <span className="msh-row-main">
              <strong>{DRILL_LABELS[drill.drillType]} drill</strong>
              <small className="msh-status-text">{drillRowStatus(drill)}</small>
            </span>
            <span className="msh-chip-button" aria-hidden="true">
              {drillComplete(drill) ? "Edit" : "Record"}
            </span>
          </button>
        ))}
      </div>
      {active && (
        <DrillLogSheet
          api={api}
          session={session}
          drill={active}
          todayIso={todayIso}
          onClose={() => setActiveId(null)}
          onSaved={(updated) => {
            setActiveId(null);
            onRecorded(updated);
          }}
        />
      )}
    </div>
  );
}

function DrillLogSheet({
  api,
  session,
  drill,
  todayIso,
  onClose,
  onSaved,
}: {
  api: ComplyraApi;
  session: SessionUser;
  drill: EmergencyDrill;
  todayIso: string;
  onClose: () => void;
  onSaved: (updated: EmergencyDrill) => void;
}) {
  const [date, setDate] = useState(drill.date ?? todayIso);
  const [time, setTime] = useState(drill.time ?? centralNowHhmm());
  const [evacTime, setEvacTime] = useState(drill.evacTime ?? "");
  const [leaderName, setLeaderName] = useState(
    drill.leaderName ?? session.fullName,
  );
  const [participants, setParticipants] = useState(drill.participants);
  const [awakeOrSleep, setAwakeOrSleep] = useState(drill.awakeOrSleep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The desktop form asks awake/sleep only for fire and missing-person drills.
  const needsSleep =
    drill.drillType === "fire" || drill.drillType === "missing_person";

  const save = async () => {
    if (!date || !time || !leaderName.trim() || !participants.trim()) {
      setError("Enter the date, time, drill leader, and participants.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.recordEmergencyDrill({
        id: drill.id,
        date,
        time,
        evacTime,
        leaderName,
        participants,
        awakeOrSleep,
      });
      onSaved({
        ...drill,
        date,
        time,
        evacTime: evacTime.trim() || null,
        leaderName: leaderName.trim(),
        participants: participants.trim(),
        awakeOrSleep,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close drill form"
        onClick={onClose}
      />
      <div className="msh-sheet" role="dialog" aria-label="Record a drill">
        <h3 className="msh-sheet-title">
          {DRILL_LABELS[drill.drillType]} drill
        </h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <div className="msh-field-pair">
            <label className="msh-field">
              <span>Date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
            <label className="msh-field">
              <span>Time</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="msh-field">
            <span>Evac time (optional)</span>
            <input
              type="text"
              value={evacTime}
              onChange={(event) => setEvacTime(event.target.value)}
              placeholder="2:05"
            />
          </label>
          <label className="msh-field">
            <span>Drill leader</span>
            <input
              type="text"
              value={leaderName}
              onChange={(event) => setLeaderName(event.target.value)}
            />
          </label>
          <label className="msh-field">
            <span>Participants</span>
            <input
              type="text"
              value={participants}
              onChange={(event) => setParticipants(event.target.value)}
              placeholder="Names of everyone who took part"
            />
          </label>
          {needsSleep && (
            <label className="msh-field">
              <span>Awake / sleep</span>
              <select
                value={awakeOrSleep}
                onChange={(event) =>
                  setAwakeOrSleep(event.target.value as "awake" | "sleep" | "")
                }
              >
                <option value="">Select</option>
                <option value="awake">Awake</option>
                <option value="sleep">Sleep</option>
              </select>
            </label>
          )}
          {error && (
            <p className="msh-alert" role="alert">
              {error}
            </p>
          )}
          <div className="msh-form-actions">
            <button
              type="button"
              className="msh-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="msh-button primary" disabled={busy}>
              {busy ? "Saving…" : "Save drill"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
