import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type { HrShift, HrTimeOffRequest } from "../../data/hr";
import { createHrStore } from "../../data/hrStore";
import { can } from "../../data/status";
import { canEditSiteReview } from "../../data/siteReview";
import {
  accountabilityStateLabel,
  type ShiftAccountability,
} from "../../data/shiftAccountability";
import {
  addIsoDays,
  chicagoWallClock,
  coverageQueryWindow,
  currentWeekStart,
  dayHeading,
  weekDates,
} from "../coverage/coverageWeek";
import { centralTodayIso, formatCentralTime } from "./mar";
import { useAssigneeClearanceWarning } from "../training/clearanceWarning";
import {
  accountabilityLine,
  shiftTimeLabel,
  staffPicksForShift,
  weekDayShifts,
  yourShiftText,
  type SchedStaffChoice,
} from "./scheduling";

/**
 * Mobile Scheduling — the manager's week coverage board on a phone.
 *
 * A phone layout over the desktop board's own stores and semantics
 * (features/coverage/SiteCoverageBoard): shifts load through the HR
 * store, assignments write the assignee of record with updateShift,
 * "Take off" cancels the shift row exactly as the desktop button does,
 * and there is no publish step because the desktop board writes rows
 * directly as published. The accountability line on every card is the
 * Phase 2 engine's rollup (getShiftAccountability) printed in words —
 * the state never rides on color alone.
 *
 * The staff picker adds the phone guard: a person with approved time
 * off overlapping the shift is not offered; a person already holding an
 * overlapping shift is offered with the clash stated in text.
 */
export default function MobileScheduling({
  api,
  session,
  sites,
  staff,
  initialSiteId,
}: {
  api: ComplyraApi;
  session: SessionUser;
  sites: { id: string; name: string }[];
  staff: SchedStaffChoice[];
  initialSiteId: string | null;
}) {
  const todayIso = centralTodayIso();
  const [siteId, setSiteId] = useState<string | null>(() =>
    initialSiteId && sites.some((site) => site.id === initialSiteId)
      ? initialSiteId
      : (sites[0]?.id ?? null),
  );
  const [weekStart, setWeekStart] = useState<string>(() => currentWeekStart());
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [accountability, setAccountability] = useState<
    Map<string, ShiftAccountability>
  >(new Map());
  const [timeOff, setTimeOff] = useState<HrTimeOffRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignShift, setAssignShift] = useState<HrShift | null>(null);
  const loadTicket = useRef(0);

  const canManage =
    canEditSiteReview(session.roleKey) || can(session, "hub.manage_schedule");
  const site = sites.find((row) => row.id === siteId) ?? null;
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const nameById = useMemo(
    () => new Map(staff.map((person) => [person.id, person.name])),
    [staff],
  );

  const load = useCallback(
    async (forSiteId: string, forWeekStart: string) => {
      const ticket = ++loadTicket.current;
      const store = createHrStore({
        agencyId: session.agencyId,
        userId: session.userId,
      });
      const range = coverageQueryWindow(forWeekStart);
      try {
        const rows = await store.listShifts(range.fromIso, range.toIso, forSiteId);
        if (ticket !== loadTicket.current) return;
        setShifts(rows.filter((row) => row.status !== "cancelled"));
        // Accountability reads the same local coverage buckets the shift
        // list just loaded (the demo seed lands with that load), so it
        // runs after — the desktop board's order. A failed read leaves
        // the board usable without the lines.
        const rollups = await api
          .getShiftAccountability(forSiteId, range.fromIso, range.toIso)
          .catch(() => [] as ShiftAccountability[]);
        if (ticket !== loadTicket.current) return;
        setAccountability(new Map(rollups.map((row) => [row.shiftId, row])));
        const requests = await store
          .listTimeOffRequests({})
          .catch(() => [] as HrTimeOffRequest[]);
        if (ticket !== loadTicket.current) return;
        setTimeOff(requests);
        setError("");
      } catch (err) {
        if (ticket !== loadTicket.current) return;
        setError(
          err instanceof Error ? err.message : "Could not load this week's coverage.",
        );
      } finally {
        if (ticket === loadTicket.current) setLoaded(true);
      }
    },
    [api, session],
  );

  useEffect(() => {
    if (!siteId) return;
    setLoaded(false);
    void load(siteId, weekStart);
  }, [load, siteId, weekStart]);

  const days = useMemo(
    () => weekDayShifts({ dates, shifts, accountability, todayIso }),
    [dates, shifts, accountability, todayIso],
  );
  const nowIso = new Date().toISOString();

  async function takeOff(shift: HrShift) {
    if (!siteId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const store = createHrStore({
        agencyId: session.agencyId,
        userId: session.userId,
      });
      // The desktop board's own "Take off": the shift row is cancelled.
      await store.updateShift(shift.id, { status: "cancelled" });
      setNotice("Shift taken off the board.");
      await load(siteId, weekStart);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not take this shift off.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignment(shift: HrShift, staffId: string) {
    if (!siteId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const store = createHrStore({
        agencyId: session.agencyId,
        userId: session.userId,
      });
      await store.updateShift(shift.id, { staffId });
      setAssignShift(null);
      setNotice(`${nameById.get(staffId) ?? "Staff member"} is on the shift now.`);
      await load(siteId, weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the assignment.");
    } finally {
      setBusy(false);
    }
  }

  if (sites.length === 0) {
    return <p className="msh-empty">No houses are in your scope.</p>;
  }

  return (
    <div>
      {sites.length > 1 ? (
        <label className="msh-field">
          <span>House</span>
          <select
            value={siteId ?? ""}
            onChange={(event) => {
              setSiteId(event.target.value);
              setNotice("");
            }}
            aria-label="House"
          >
            {sites.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        site && <p className="msh-section-note">{site.name} · week coverage</p>
      )}

      <div className="msh-weeknav" role="group" aria-label="Week">
        <button
          type="button"
          className="msh-chip-button"
          onClick={() => setWeekStart(addIsoDays(weekStart, -7))}
        >
          ‹ Prev week
        </button>
        <button
          type="button"
          className="msh-chip-button"
          onClick={() => setWeekStart(currentWeekStart())}
        >
          This week
        </button>
        <button
          type="button"
          className="msh-chip-button"
          onClick={() => setWeekStart(addIsoDays(weekStart, 7))}
        >
          Next week ›
        </button>
      </div>
      <p className="msh-section-note">
        {dayHeading(dates[0])} to {dayHeading(dates[6])} · The person on a
        shift is accountable for everything due in its window.
      </p>

      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="msh-section-note" role="status">
          {notice}
        </p>
      )}

      {!loaded ? (
        <p className="msh-empty">Loading this week's coverage…</p>
      ) : (
        days.map((day) => (
          <section key={day.date} className="msh-day-group">
            <h3 className="msh-day-heading">
              {day.heading}
              {day.isToday ? " · Today" : ""}
            </h3>
            {day.rows.length === 0 && (
              <p className="msh-section-note">No shifts published.</p>
            )}
            <div className="msh-list">
              {day.rows.map(({ shift, acc }) => {
                const assignee = shift.staffId
                  ? (nameById.get(shift.staffId) ?? acc?.ownerName ?? "Staff")
                  : null;
                return (
                  <div key={shift.id} className="msh-sched-card">
                    <strong>{assignee ?? "Open shift"}</strong>
                    <small>
                      {shift.title ? `${shift.title} · ` : ""}
                      {shiftTimeLabel(shift.startsAt, shift.endsAt)}
                    </small>
                    {acc ? (
                      <p className="msh-sched-acc">
                        {accountabilityLine(acc, nowIso)}
                      </p>
                    ) : (
                      <p className="msh-sched-acc">
                        {assignee
                          ? `${assignee} · Accountability unavailable for this shift`
                          : "Unowned · Accountability unavailable for this shift"}
                      </p>
                    )}
                    {canManage && (
                      <div className="msh-sched-actions">
                        <button
                          type="button"
                          className="msh-chip-button"
                          disabled={busy}
                          onClick={() => setAssignShift(shift)}
                        >
                          {assignee ? "Change" : "Assign"}
                        </button>
                        <button
                          type="button"
                          className="msh-chip-button"
                          disabled={busy}
                          onClick={() => void takeOff(shift)}
                        >
                          Take off
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {assignShift && (
        <AssignSheet
          api={api}
          shift={assignShift}
          staff={staff}
          todayIso={todayIso}
          timeOff={timeOff}
          allShifts={shifts}
          busy={busy}
          currentName={
            assignShift.staffId
              ? (nameById.get(assignShift.staffId) ?? "Staff")
              : null
          }
          onClose={() => setAssignShift(null)}
          onSave={(staffId) => void saveAssignment(assignShift, staffId)}
        />
      )}
    </div>
  );
}

/**
 * The staff picker for one shift: who may take it, with approved
 * time-off overlaps excluded and overlapping assignments flagged in
 * text (see scheduling.ts for the rules).
 */
function AssignSheet({
  api,
  shift,
  staff,
  todayIso,
  timeOff,
  allShifts,
  busy,
  currentName,
  onClose,
  onSave,
}: {
  api: ComplyraApi;
  shift: HrShift;
  staff: SchedStaffChoice[];
  todayIso: string;
  timeOff: HrTimeOffRequest[];
  allShifts: HrShift[];
  busy: boolean;
  currentName: string | null;
  onClose: () => void;
  onSave: (staffId: string) => void;
}) {
  const picks = useMemo(
    () => staffPicksForShift({ staff, todayIso, shift, timeOff, allShifts }),
    [staff, todayIso, shift, timeOff, allShifts],
  );
  const [picked, setPicked] = useState<string>(shift.staffId ?? "");
  // Batch 59: warn (never block) when the picked staffer is a DSP who is
  // not training-cleared yet.
  const pickedStaff = staff.find((s) => s.id === picked);
  const clearanceWarning = useAssigneeClearanceWarning(api, pickedStaff?.id ?? null, pickedStaff?.roleKey ?? null);
  const dayLabel = dayHeading(chicagoWallClock(shift.startsAt).date);

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close staff picker"
        onClick={onClose}
      />
      <div className="msh-sheet" role="dialog" aria-label="Assign this shift">
        <h3 className="msh-sheet-title">
          {currentName ? "Change who is on this shift" : "Assign this shift"}
        </h3>
        <p className="msh-section-note">
          {shift.title ? `${shift.title} · ` : ""}
          {dayLabel} · {shiftTimeLabel(shift.startsAt, shift.endsAt)}
          <br />
          {currentName ? `Currently: ${currentName}` : "Currently open"}
        </p>
        {picks.length === 0 ? (
          <p className="msh-empty">
            Nobody can be offered this shift right now — everyone eligible
            is on approved time off.
          </p>
        ) : (
          <div className="msh-list" role="radiogroup" aria-label="Who is working">
            {picks.map((pick) => {
              const selected = picked === pick.id;
              return (
                <button
                  key={pick.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`msh-row msh-sched-pick${selected ? " selected" : ""}`}
                  onClick={() => setPicked(pick.id)}
                >
                  <span className="msh-row-main">
                    <strong>{pick.label}</strong>
                    {pick.overlapWarning && (
                      <small className="msh-sched-warn">{pick.overlapWarning}</small>
                    )}
                  </span>
                  {selected && <span className="msh-current">Selected</span>}
                </button>
              );
            })}
          </div>
        )}
        <p className="msh-section-note">
          Staff on approved time off for this shift are not listed.
        </p>
        {clearanceWarning && (
          <p className="msh-sched-warn" role="alert">
            {clearanceWarning}
          </p>
        )}
        <div className="msh-form-actions">
          <button type="button" className="msh-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="msh-button primary"
            disabled={busy || !picked || picked === shift.staffId}
            onClick={() => onSave(picked)}
          >
            {busy ? "Saving…" : "Save assignment"}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Read-only accountability detail for the signed-in person's own shift —
 * where the Today strip lands for non-managers. The same engine rollup
 * the board prints; no management actions exist here.
 */
export function MobileYourShiftDetail({
  acc,
  siteName,
}: {
  acc: ShiftAccountability;
  siteName: string;
}) {
  const text = yourShiftText(acc);
  return (
    <div>
      <div className="msh-sched-card static">
        <strong>{text.title}</strong>
        <small>
          {siteName ? `${siteName} · ` : ""}
          {accountabilityStateLabel(acc.state)}
        </small>
        <p className="msh-sched-acc">{text.detail}</p>
      </div>
      <h3 className="msh-pass-title">What this shift carries</h3>
      {acc.totalDue === 0 ? (
        <p className="msh-empty">Nothing is due in this shift's window.</p>
      ) : acc.missingItems.length === 0 ? (
        <p className="msh-empty">
          All complete — everything due on this shift is recorded.
        </p>
      ) : (
        <div className="msh-list">
          {acc.missingItems.map((item) => (
            <div key={item.id} className="msh-row static">
              <span className="msh-row-main">
                <strong>{item.label}</strong>
                <small>Due {formatCentralTime(item.dueAt)} Central</small>
              </span>
              <span className="msh-status-text">Still to do</span>
            </div>
          ))}
        </div>
      )}
      <p className="msh-section-note">
        Your manager sees this same list on the Scheduling board.
      </p>
    </div>
  );
}
