import { useEffect, useMemo, useRef, useState } from "react";
import "./coverage.css";
import { can } from "../../data/status";
import { useData } from "../../data/DataProvider";
import { createHrStore, type HrShiftInput } from "../../data/hrStore";
import type { HrShift } from "../../data/hr";
import { createOpenShiftStore } from "../../data/openShiftStore";
import type { HrOpenShift } from "../../data/openShifts";
import { useOperatingRules } from "../employeeHub/useOvertimeLines";
import {
  shiftBlocksForSite,
  shiftClockFromFacts,
  shiftScheduleProblem,
  shiftScheduleSummary,
} from "../../data/dueItems";
import { owedLinesForDay, rowsToCopy, rowsToFill, type PlanShift } from "./coveragePlan";
import { canEditSiteReview, normalizeSiteFacts, type SiteFacts } from "../../data/siteReview";
import {
  accountabilityStateLabel,
  type ShiftAccountability,
} from "../../data/shiftAccountability";
import {
  chicagoShiftInstants,
  chicagoWallClock,
  coverageQueryWindow,
  currentWeekStart,
  dayHeading,
  shiftTouchesDate,
  weekDates,
} from "./coverageWeek";

type StaffChoice = {
  id: string;
  name: string;
  role: string;
  roleKey?: string;
  siteId: string | null;
  site: string;
  expiresOn: string | null;
};

type Draft = {
  shiftId: string | null;
  date: string;
  staffId: string;
  start: string;
  end: string;
};

const HOUR_FIELDS: Array<{ key: keyof SiteFacts; label: string }> = [
  { key: "dayShiftStart", label: "Day starts" },
  { key: "dayShiftEnd", label: "Day ends" },
  { key: "eveningShiftStart", label: "Evening starts" },
  { key: "eveningShiftEnd", label: "Evening ends" },
  { key: "overnightShiftStart", label: "Overnight starts" },
  { key: "overnightShiftEnd", label: "Overnight ends" },
];

function staffChoices(staff: StaffChoice[], today: string): StaffChoice[] {
  return staff
    .filter((person) => !person.expiresOn || person.expiresOn >= today)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compactOwed(
  owed: Array<{ blockId: string; text: string }>,
  hasRows: boolean,
): string | null {
  if (hasRows || owed.length < 2) return null;
  const tails = owed.map((line) => {
    const mark = line.text.indexOf(" · ");
    return mark === -1 ? null : line.text.slice(mark + 3);
  });
  const tail = tails[0];
  if (!tail || tails.some((item) => item !== tail || item.includes(" · "))) return null;
  return `Open. ${tail}`;
}

/**
 * One text line carrying a shift's accountability: the owner (or
 * "Unowned"), the state in words, the done fraction, and the first
 * missing obligations by name — the state never rides on color alone.
 * Undone work reads "Missing" once the window has ended and "Still to
 * do" while it can still be done.
 */
function accountabilityLine(acc: ShiftAccountability): string {
  const counts = `${acc.doneCount} of ${acc.totalDue} done`;
  const head =
    acc.state === "unowned"
      ? "Unowned"
      : `${acc.ownerName ?? "Unassigned"} · ${accountabilityStateLabel(acc.state)}`;
  if (acc.totalDue === 0) return `${head} · Nothing due in this window`;
  if (acc.missingItems.length === 0) return `${head} · ${counts} · All complete`;
  const verb = acc.endsAt <= new Date().toISOString() ? "Missing" : "Still to do";
  const labels = acc.missingItems.slice(0, 3).map((entry) => entry.label);
  const more =
    acc.missingItems.length > 3 ? ` · and ${acc.missingItems.length - 3} more` : "";
  return `${head} · ${counts} · ${verb}: ${labels.join("; ")}${more}`;
}

function choiceLabel(person: StaffChoice, siteId: string): string {
  const where = person.siteId === siteId ? "" : person.siteId ? ", other house" : ", agency";
  return `${person.name}, ${person.role}${where}`;
}

export default function SiteCoverageBoard({ siteId }: { siteId: string | null }) {
  const { api, session, workspace, refresh } = useData();
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [accountability, setAccountability] = useState<Map<string, ShiftAccountability>>(new Map());
  const [openShifts, setOpenShifts] = useState<HrOpenShift[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const operating = useOperatingRules(session);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hours, setHours] = useState<SiteFacts | null>(null);

  const canEdit = Boolean(
    session && (canEditSiteReview(session.roleKey) || can(session, "hub.manage_schedule")),
  );
  const site = workspace?.sites.find((row) => row.id === siteId) ?? null;
  const facts = site ? normalizeSiteFacts(site) : null;
  const today = currentWeekStart();
  const people = useMemo(
    () => staffChoices((workspace?.staff ?? []) as StaffChoice[], today),
    [workspace?.staff, today],
  );

  const [hoursSite, setHoursSite] = useState<string | null>(null);
  if (siteId !== hoursSite) {
    setHoursSite(siteId);
    setHours(facts);
    if (draft) setDraft(null);
  }

  const houseWriters = people.filter((person) => person.roleKey === "dsp" && person.siteId === siteId);
  const loadTicket = useRef(0);

  async function loadWeek(start: string) {
    if (!session || !siteId) return;
    const ticket = ++loadTicket.current;
    const store = createHrStore({ agencyId: session.agencyId, userId: session.userId, roleKey: session.roleKey });
    const range = coverageQueryWindow(start);
    const posted = createOpenShiftStore({
      agencyId: session.agencyId,
      userId: session.userId,
      fullName: session.fullName,
      canManageSchedule: can(session, "hub.manage_schedule"),
      readOnly: session.roleKey === "auditor",
      canPostAgencyWide: false,
    });
    const [rows, openings] = await Promise.all([
      store.listShifts(range.fromIso, range.toIso, siteId),
      posted.listOpenShifts(),
    ]);
    const dates = weekDates(start);
    if (ticket !== loadTicket.current) return;
    setShifts(rows.filter((row) => row.status !== "cancelled"));
    // Accountability reads the same local coverage buckets the shift list
    // just loaded (the demo seed lands with that load), so it runs after.
    // A failed read leaves the board usable without the lines — the board
    // never pictures numbers it could not actually read.
    const rollups = await api
      .getShiftAccountability(siteId, range.fromIso, range.toIso)
      .catch(() => [] as ShiftAccountability[]);
    if (ticket !== loadTicket.current) return;
    setAccountability(new Map(rollups.map((row) => [row.shiftId, row])));
    setOpenShifts(
      openings.filter(
        (row) =>
          row.siteId === siteId &&
          row.kind === "temporary" &&
          row.status === "open" &&
          row.startsAt &&
          row.endsAt &&
          dates.some((date) => shiftTouchesDate(row.startsAt!, row.endsAt!, date)),
      ),
    );
  }

  useEffect(() => {
    if (!session || !siteId) return;
    loadWeek(weekStart).catch((err: Error) => {
      setError(err.message || "Could not load this week's coverage.");
    });
    // loadWeek reads the session and site already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, siteId, weekStart]);

  if (!canEdit) return null;

  const dates = weekDates(weekStart);
  const planShifts: PlanShift[] = [
    ...shifts
      .filter((row) => row.staffId && dates.some((date) => shiftTouchesDate(row.startsAt, row.endsAt, date)))
      .map((row) => ({
        id: row.id,
        staffId: row.staffId,
        staffName: people.find((choice) => choice.id === row.staffId)?.name ?? "Staff",
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      })),
    ...openShifts
      .filter((row) => row.startsAt && row.endsAt)
      .map((row) => ({
        id: row.id,
        staffId: null,
        staffName: "Open",
        startsAt: row.startsAt!,
        endsAt: row.endsAt!,
      })),
  ];
  const live = planShifts;
  const blocks = facts ? shiftBlocksForSite(facts) : null;
  const days = dates.map((date) => ({
    date,
    heading: dayHeading(date),
    owed: blocks
      ? owedLinesForDay({
          date,
          blocks,
          shifts: planShifts.filter((row) => shiftTouchesDate(row.startsAt, row.endsAt, date)),
          writers: houseWriters.map((person) => ({ userId: person.id, name: person.name })),
          graceMinutes: operating.noteGraceMinutes,
          weekHasSchedule: planShifts.length > 0,
        })
      : [],
    shifts: shifts
      .filter((row) => row.staffId && shiftTouchesDate(row.startsAt, row.endsAt, date))
      .map((row) => {
        const person = people.find((choice) => choice.id === row.staffId);
        const start = chicagoWallClock(row.startsAt);
        const end = chicagoWallClock(row.endsAt);
        return {
          id: row.id,
          who: person?.name ?? "Staff",
          when: `${start.hhmm} to ${end.hhmm}`,
        };
      }),
    unassigned: shifts
      .filter((row) => !row.staffId && shiftTouchesDate(row.startsAt, row.endsAt, date))
      .map((row) => {
        const start = chicagoWallClock(row.startsAt);
        const end = chicagoWallClock(row.endsAt);
        return {
          id: row.id,
          who: "Open shift",
          when: `${start.hhmm} to ${end.hhmm}`,
        };
      }),
    openings: openShifts.filter(
      (row) => row.startsAt && row.endsAt && shiftTouchesDate(row.startsAt, row.endsAt, date),
    ),
  })).map((day) => ({
    ...day,
    summary: compactOwed(day.owed, day.shifts.length + day.openings.length > 0),
  }));

  function openDraft(date: string, shift?: HrShift) {
    const clock = facts ? shiftClockFromFacts(facts) : null;
    const start = shift ? chicagoWallClock(shift.startsAt).hhmm : clock?.dayStart ?? "06:00";
    const end = shift ? chicagoWallClock(shift.endsAt).hhmm : clock?.dayEnd ?? "14:00";
    setDraft({
      shiftId: shift?.id ?? null,
      date,
      staffId: shift?.staffId ?? "",
      start,
      end,
    });
    setError("");
  }

  async function saveDraft() {
    if (!session || !siteId || !draft) return;
    if (!draft.staffId) {
      setError("Choose who is working, or leave it open for a PRN.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const times = chicagoShiftInstants(draft.date, draft.start, draft.end);
      if (draft.staffId === "__open__") {
        if (draft.shiftId) throw new Error("Take this person off before posting the shift as open.");
        const posted = createOpenShiftStore({
          agencyId: session.agencyId,
          userId: session.userId,
          fullName: session.fullName,
          canManageSchedule: can(session, "hub.manage_schedule"),
      readOnly: session.roleKey === "auditor",
          canPostAgencyWide: false,
        });
        await posted.postOpenShift({
          siteId,
          kind: "temporary",
          audience: "site",
          title: "Coverage",
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          pickupMode: "first_come",
          slots: 1,
          notes: "Posted from the house dashboard.",
        });
        setNotice("Posted. A PRN takes it from Open Shifts, and then that person owes the note.");
      } else {
        const store = createHrStore({ agencyId: session.agencyId, userId: session.userId, roleKey: session.roleKey });
        const input: HrShiftInput = {
          siteId,
          staffId: draft.staffId,
          title: "Coverage",
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          status: "published",
          notes: null,
        };
        if (draft.shiftId) await store.updateShift(draft.shiftId, input);
        else await store.createShift(input);
      }
      await loadWeek(weekStart);
      setDraft(null);
    } catch (err) {
      setError((err as Error).message || "Could not save the shift.");
    } finally {
      setBusy(false);
    }
  }

  async function removeShift(shift: HrShift) {
    if (!session || !siteId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const store = createHrStore({ agencyId: session.agencyId, userId: session.userId, roleKey: session.roleKey });
      await store.updateShift(shift.id, { status: "cancelled" });
      await loadWeek(weekStart);
    } catch (err) {
      setError((err as Error).message || "Could not take this person off the shift.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOpening(shift: HrOpenShift) {
    if (!session) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const posted = createOpenShiftStore({
        agencyId: session.agencyId,
        userId: session.userId,
        fullName: session.fullName,
        canManageSchedule: can(session, "hub.manage_schedule"),
      readOnly: session.roleKey === "auditor",
        canPostAgencyWide: false,
      });
      await posted.cancelOpenShift(shift.id);
      await loadWeek(weekStart);
    } catch (err) {
      setError((err as Error).message || "Could not take down this open shift.");
    } finally {
      setBusy(false);
    }
  }

  async function fillWeek() {
    if (!session || !siteId || !blocks) return;
    if (houseWriters.length === 0) {
      setError("This house has no assigned DSP to put on the usual hours.");
      return;
    }
    const rows = rowsToFill({
      dates,
      blocks,
      existing: planShifts,
      writers: houseWriters.map((person) => ({ userId: person.id, name: person.name })),
    });
    if (rows.length === 0) {
      setNotice("The open hours are already covered.");
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const store = createHrStore({ agencyId: session.agencyId, userId: session.userId, roleKey: session.roleKey });
      for (const row of rows) {
        const times = chicagoShiftInstants(row.date, row.start, row.end);
        await store.createShift({
          siteId,
          staffId: row.staffId,
          title: row.title,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          status: "published",
          notes: null,
        });
      }
      await loadWeek(weekStart);
      setNotice(`Put ${rows.length} shifts on this week from the usual house hours.`);
    } catch (err) {
      setError((err as Error).message || "Could not fill this week.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLastWeek() {
    if (!session || !siteId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const store = createHrStore({ agencyId: session.agencyId, userId: session.userId, roleKey: session.roleKey });
      const previousWeek = addWeek(weekStart, -1);
      const range = coverageQueryWindow(previousWeek);
      const previous = (await store.listShifts(range.fromIso, range.toIso, siteId)).filter((row) => row.status !== "cancelled");
      const rows = rowsToCopy({
        previous: previous.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          staffName: people.find((choice) => choice.id === row.staffId)?.name ?? "Staff",
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        })),
        previousWeekStart: previousWeek,
        targetWeekStart: weekStart,
        target: planShifts,
      });
      if (rows.length === 0) {
        setNotice("Last week has no published coverage to copy.");
        return;
      }
      for (const row of rows) {
        await store.createShift({
          siteId,
          staffId: row.staffId,
          title: row.title,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: "published",
          notes: null,
        });
      }
      await loadWeek(weekStart);
      setNotice(`Copied ${rows.length} shifts from last week. Change any row a PRN is covering.`);
    } catch (err) {
      setError((err as Error).message || "Could not copy last week.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHours() {
    if (!siteId || !hours) return;
    const problem = shiftScheduleProblem(shiftClockFromFacts(hours));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.saveSiteFacts(siteId, {
        dayShiftStart: hours.dayShiftStart,
        dayShiftEnd: hours.dayShiftEnd,
        eveningShiftStart: hours.eveningShiftStart,
        eveningShiftEnd: hours.eveningShiftEnd,
        overnightShiftStart: hours.overnightShiftStart,
        overnightShiftEnd: hours.overnightShiftEnd,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Could not save the house hours.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel coverage-board" aria-label="This week's coverage">
      <div className="panel-heading">
        <div>
          <h2>{site ? `${site.name} coverage` : "House coverage"}</h2>
          <p>
            {site
              ? `This week starts from the schedule already published for the house. Fill the usual hours, copy last week, or leave a shift open for a PRN. The person on the shift owes the Shift note ${operating.noteGraceMinutes} minutes after their own end time.`
              : "Choose one program site. A house manager sees the home they run. A program manager or administrator picks the home on this dashboard."}
          </p>
        </div>
      </div>
      {site && facts && (
        <>
          <div className="coverage-toolbar">
            <button type="button" className="button" onClick={() => setWeekStart(addWeek(weekStart, -1))}>Previous week</button>
            <button type="button" className="button" onClick={() => setWeekStart(currentWeekStart())}>This week</button>
            <button type="button" className="button" onClick={() => setWeekStart(addWeek(weekStart, 1))}>Next week</button>
            <button type="button" className="button" disabled={busy} onClick={() => void fillWeek()}>Fill open hours</button>
            <button type="button" className="button" disabled={busy} onClick={() => void copyLastWeek()}>Use last week</button>
            <span>{dayHeading(dates[0])} to {dayHeading(dates[6])}</span>
          </div>
          <p className="coverage-hours">{shiftScheduleSummary(shiftClockFromFacts(facts))}</p>
          {live.length === 0 && (
            <p className="coverage-empty">
              Nobody is published for this week. Assigned DSPs still owe the Shift notes. Fill the usual hours, or leave a shift open for a PRN to take.
            </p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="coverage-week">
            {days.map((day) => (
              <div key={day.date} className="coverage-day">
                <h3>{day.heading}</h3>
                {day.summary ? (
                  <p className="coverage-owed">{day.summary}</p>
                ) : (
                  day.owed.map((line) => (
                    <p key={line.blockId} className="coverage-owed">{line.text}</p>
                  ))
                )}
                {!day.summary && day.shifts.length === 0 && day.unassigned.length === 0 && day.openings.length === 0 && <p>Open</p>}
                {day.shifts.map((shift) => {
                  const row = shifts.find((item) => item.id === shift.id);
                  const acc = accountability.get(shift.id);
                  return (
                    <div key={shift.id} className="coverage-shift">
                      <strong>{shift.who}</strong>
                      <span>{shift.when}</span>
                      {acc && <p className="coverage-accountability">{accountabilityLine(acc)}</p>}
                      {row && (
                        <span className="coverage-shift-actions">
                          <button type="button" className="button" onClick={() => openDraft(day.date, row)}>Change</button>
                          <button type="button" className="button" onClick={() => void removeShift(row)}>Take off</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {day.unassigned.map((shift) => {
                  const row = shifts.find((item) => item.id === shift.id);
                  const acc = accountability.get(shift.id);
                  return (
                    <div key={shift.id} className="coverage-shift">
                      <strong>{shift.who}</strong>
                      <span>{shift.when}</span>
                      {acc && <p className="coverage-accountability">{accountabilityLine(acc)}</p>}
                      {row && (
                        <span className="coverage-shift-actions">
                          <button type="button" className="button" onClick={() => openDraft(day.date, row)}>Change</button>
                          <button type="button" className="button" onClick={() => void removeShift(row)}>Take off</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {day.openings.map((opening) => (
                  <div key={opening.id} className="coverage-shift">
                    <strong>Open for a PRN</strong>
                    <span>
                      {opening.startsAt && opening.endsAt
                        ? `${chicagoWallClock(opening.startsAt).hhmm} to ${chicagoWallClock(opening.endsAt).hhmm}`
                        : opening.title}
                    </span>
                    <span className="coverage-shift-actions">
                      <button type="button" className="button" onClick={() => void removeOpening(opening)}>Take off</button>
                    </span>
                  </div>
                ))}
                <button type="button" className="button" onClick={() => openDraft(day.date)}>Add someone</button>
              </div>
            ))}
          </div>
          {draft && (
            <form
              className="coverage-draft"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              <h3>{draft.shiftId ? "Change this shift" : `Add coverage, ${dayHeading(draft.date)}`}</h3>
              <label>
                Who is working
                <select
                  aria-label="Who is working"
                  value={draft.staffId}
                  onChange={(event) => setDraft({ ...draft, staffId: event.target.value })}
                >
                  <option value="">Choose a person</option>
                  {!draft.shiftId && <option value="__open__">Leave open for a PRN</option>}
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{choiceLabel(person, site.id)}</option>
                  ))}
                </select>
              </label>
              <div className="coverage-presets">
                {(["day", "evening", "overnight"] as const).map((block) => (
                  <button
                    key={block}
                    type="button"
                    className="button"
                    onClick={() => {
                      const clock = shiftClockFromFacts(facts);
                      const start = block === "day" ? clock.dayStart : block === "evening" ? clock.eveningStart : clock.overnightStart;
                      const end = block === "day" ? clock.dayEnd : block === "evening" ? clock.eveningEnd : clock.overnightEnd;
                      setDraft({ ...draft, start: start ?? draft.start, end: end ?? draft.end });
                    }}
                  >
                    Use {block} hours
                  </button>
                ))}
              </div>
              <label>
                Starts
                <input aria-label="Shift starts" type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              </label>
              <label>
                Ends
                <input aria-label="Shift ends" type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              </label>
              <div className="coverage-draft-actions">
                <button type="submit" className="button primary" disabled={busy}>Save coverage</button>
                <button type="button" className="button" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="coverage-regular">
            <h3>Regular house hours</h3>
            <p>These are the usual day, evening, and overnight windows. Changing them does not rewrite a week that is already published. A new row on this board starts from these hours, and you can still type a different time for a PRN.</p>
            {hours && (
              <div className="coverage-hour-grid">
                {HOUR_FIELDS.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      aria-label={field.label}
                      type="time"
                      value={String(hours[field.key] ?? "")}
                      onChange={(event) => setHours({ ...hours, [field.key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
            )}
            <button type="button" className="button primary" disabled={busy} onClick={() => void saveHours()}>
              Save house hours
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function addWeek(weekStart: string, direction: number): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  utc.setUTCDate(utc.getUTCDate() + direction * 7);
  return utc.toISOString().slice(0, 10);
}
