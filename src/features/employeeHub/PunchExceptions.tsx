/**
 * Punch exceptions dashboard — filterable list of kiosk/time-clock
 * exceptions for managers, rendered inside the Attendance tab.
 *
 * Consumes Worker 1's `detectPunchExceptions` (kiosk-focused flags),
 * merges the legacy `detectExceptions` late/early/missed/overlap signals
 * (deduped — kiosk rows win), and shows Worker 1's `scoreTimecard` per
 * staff member plus `findAutoClockoutCandidates` for still-open clock-ins.
 *
 * Each row carries a flag chip and one-tap actions that reuse the existing
 * punch-correction flow:
 *  - "Approve as-is" files a no-change correction and approves it, leaving
 *    an audit trail in Timecard Review.
 *  - "Flag" opens an inline correction request; the staff member is
 *    notified via the hr.punch_exception event.
 * Overtime-trending flags additionally raise hr.overtime_alert to the
 * scheduling managers (house_manager + program_manager), deduped per
 * staff member per day.
 *
 * A "Remote" filter lists punches made from a personal device under a
 * hub.remote_punch grant. Remote punches are reviewable here but are never
 * scoring demerits — they are not fed into scoreTimecard.
 *
 * `initialExceptions` seeds the first render (tests / SSR).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Flag } from "lucide-react";
import { Empty } from "../../components";
import { createSupabaseBrowserClient } from "../../data/index";
import { detectExceptions } from "../../data/hr";
import type { HrPunch, HrPunchRules, HrShift } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import { emitHrEvent } from "../notifications/useNotifications";
import { overtimeAlertPayload, punchExceptionPayload } from "../notifications/notify";
import {
  adaptKioskStore,
  isKioskStoreAvailable,
} from "./kioskContracts";
import {
  detectPunchExceptions,
  findAutoClockoutCandidates,
  remotePunchRows,
  scoreTimecard,
  type PunchException,
  type PunchExceptionKind,
} from "./punchInsights";
import type { HubSite, HubStaffEntry } from "./EmployeeHubPage";

/** Display kinds: Worker 1's flags plus legacy overlap (kiosk detection
 *  doesn't flag overlaps; the legacy signal still does). */
type DisplayKind = PunchExceptionKind;

const KIND_LABELS: Record<DisplayKind, string> = {
  late: "Late",
  early: "Early",
  missed_punch: "Missed punch",
  offline: "Offline",
  auto_clockout: "Auto clock-out",
  overtime_trending: "Overtime trending",
  overlap: "Overlap",
  remote: "Remote",
};

const KIND_STATUS_CLASS: Record<DisplayKind, string> = {
  late: "overdue",
  early: "due_soon",
  missed_punch: "missing",
  offline: "pending",
  auto_clockout: "locked",
  overtime_trending: "due_soon",
  overlap: "pending",
  remote: "info",
};

/** Legacy hr.ts ExceptionKind → display kind (null = not shown here). */
const LEGACY_KIND_MAP: Record<string, DisplayKind | null> = {
  late_clock_in: "late",
  early_clock_out: "early",
  missed_punch: "missed_punch",
  overlapping_punch: "overlap",
  timecard_unapproved_at_lock: null,
};

function dayStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${fmtTime(iso)}`;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function PunchExceptions({
  session,
  store,
  staffList,
  sites,
  initialExceptions,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
  initialExceptions?: PunchException[];
  onChanged?: () => void;
}) {
  const notifyClient = useMemo(() => createSupabaseBrowserClient(), []);
  const kiosk = useMemo(() => adaptKioskStore(store), [store]);
  const kioskAvailable = isKioskStoreAvailable(store);
  const [date, setDate] = useState(dayStamp(new Date()));
  const [siteFilter, setSiteFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | DisplayKind>("all");
  const [exceptions, setExceptions] = useState<PunchException[]>(initialExceptions ?? []);
  const [punchesByStaff, setPunchesByStaff] = useState<Record<string, HrPunch[]>>({});
  const [punchById, setPunchById] = useState<Map<string, HrPunch>>(new Map());
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [rules, setRules] = useState<HrPunchRules | null>(null);
  const [candidates, setCandidates] = useState<
    { punch: HrPunch; shift: HrShift; clockOutAt: string }[]
  >([]);
  const [weekMinutesByStaff, setWeekMinutesByStaff] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(!initialExceptions);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagKind, setFlagKind] = useState<"in" | "out">("out");
  const [flagAt, setFlagAt] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const emittedAlerts = useRef<Set<string>>(new Set());

  const visibleStaff = useMemo(
    () => staffList.filter((s) => !siteFilter || s.siteId === siteFilter),
    [staffList, siteFilter],
  );

  const staffName = (userId: string): string =>
    staffList.find((s) => s.userId === userId)?.fullName ?? "Unknown staff";

  useEffect(() => {
    if (initialExceptions) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const windowStart = new Date(`${date}T00:00:00`);
    windowStart.setDate(windowStart.getDate() - 6);
    const fromIso = `${dayStamp(windowStart)}T00:00:00`;
    const toIso = `${date}T23:59:59`;
    const nowIso = new Date().toISOString();

    (async () => {
      try {
        const [punchLists, dayShifts, punchRules] = await Promise.all([
          Promise.all(
            visibleStaff.map((s) =>
              store.listPunches(s.userId, fromIso, toIso).catch(() => [] as HrPunch[]),
            ),
          ),
          store.listShifts(fromIso, toIso).catch(() => [] as HrShift[]),
          kioskAvailable ? kiosk.getPunchRules().catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const punches = punchLists.flat();
        const byId = new Map<string, HrPunch>();
        const byStaff: Record<string, HrPunch[]> = {};
        visibleStaff.forEach((s, i) => {
          byStaff[s.userId] = punchLists[i];
        });
        for (const p of punches) byId.set(p.id, p);
        setPunchById(byId);
        setPunchesByStaff(byStaff);
        setShifts(dayShifts);
        setRules(punchRules);

        // Kiosk-focused exceptions (Worker 1), then the legacy
        // late/early/missed/overlap signals merged in and deduped
        // (kiosk rows win — they carry punch ids).
        const kioskExceptions = detectPunchExceptions({
          punches,
          shifts: dayShifts,
          rules: punchRules,
          nowIso,
        });
        const legacy = detectExceptions({
          punches,
          shifts: dayShifts,
          timecardApprovals: [],
          payPeriods: [],
          nowIso,
        });
        const seen = new Set(kioskExceptions.map((e) => `${e.staffId}:${e.kind}:${e.at}`));
        const merged: PunchException[] = [...kioskExceptions];
        for (const ex of legacy) {
          const kind = LEGACY_KIND_MAP[ex.kind];
          if (!kind) continue;
          const key = `${ex.staffId}:${kind}:${ex.at}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            kind,
            staffId: ex.staffId,
            detail: ex.detail,
            at: ex.at,
            punchId: null,
          });
        }
        // Remote punches (personal device) — reviewable here, never
        // scoring demerits, so they merge as their own kind.
        for (const row of remotePunchRows(punches)) {
          const key = `${row.staffId}:${row.kind}:${row.at}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
        merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind < b.kind ? -1 : 1));
        setExceptions(merged);

        // Auto-clock-out candidates: open clock-ins past shift end + buffer.
        const openIns = new Map<string, HrPunch>();
        const sorted = [...punches].sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1));
        for (const p of sorted) {
          if (p.kind === "in") openIns.set(p.staffId, p);
          else openIns.delete(p.staffId);
        }
        setCandidates(
          findAutoClockoutCandidates({
            openPunches: [...openIns.values()],
            shifts: dayShifts,
            rules: punchRules,
            nowIso,
          }),
        );

        // 7-day minutes per staff for the overtime alert body.
        const weekMin: Record<string, number> = {};
        for (const [staffId, list] of Object.entries(byStaff)) {
          let mins = 0;
          const open: HrPunch[] = [];
          for (const p of [...list].sort((a, b) => (a.punchedAt < b.punchedAt ? -1 : 1))) {
            if (p.kind === "in") open.push(p);
            else {
              const first = open.shift();
              if (first) mins += Math.max(0, Math.round((Date.parse(p.punchedAt) - Date.parse(first.punchedAt)) / 60_000));
            }
          }
          for (const rest of open) {
            mins += Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(rest.punchedAt)) / 60_000));
          }
          weekMin[staffId] = mins;
        }
        setWeekMinutesByStaff(weekMin);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load punch exceptions."));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, date, siteFilter, visibleStaff, kioskAvailable]);

  // Overtime alerts: emit once per staff member per day while the dashboard
  // is open; the server dedupes on the payload's dedupe key as well.
  useEffect(() => {
    if (!notifyClient || exceptions.length === 0) return;
    const weekLabel = dayStamp(new Date());
    for (const ex of exceptions) {
      if (ex.kind !== "overtime_trending") continue;
      const key = `${ex.staffId}:${weekLabel}`;
      if (emittedAlerts.current.has(key)) continue;
      emittedAlerts.current.add(key);
      const hours = (weekMinutesByStaff[ex.staffId] ?? 0) / 60;
      for (const roleKey of ["house_manager", "program_manager"]) {
        void emitHrEvent(
          notifyClient,
          overtimeAlertPayload({
            agencyId: session.agencyId,
            roleKey,
            staffId: ex.staffId,
            staffName: staffName(ex.staffId),
            hoursWorked: hours,
            thresholdHours: 40,
            weekLabel,
          }),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exceptions, notifyClient]);

  // Timecard scores per staff (Worker 1), for the row subtitles.
  const scores = useMemo(() => {
    const out = new Map<string, number>();
    for (const [staffId, list] of Object.entries(punchesByStaff)) {
      out.set(staffId, scoreTimecard({ punches: list, shifts, rules }).score);
    }
    return out;
  }, [punchesByStaff, shifts, rules]);

  const filtered = kindFilter === "all" ? exceptions : exceptions.filter((e) => e.kind === kindFilter);
  const kindsPresent = useMemo(
    () => [...new Set(exceptions.map((e) => e.kind))],
    [exceptions],
  );

  /** Approve the punch as-is: file a no-change correction and approve it,
   *  leaving the audit trail in Timecard Review. */
  const approveAsIs = async (ex: PunchException) => {
    if (!ex.punchId) return;
    const punch = punchById.get(ex.punchId);
    if (!punch) {
      setError("That punch is no longer available.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const correction = await store.requestPunchCorrection(ex.punchId, {
        // Corrections re-target in/out punches only; break/transfer kinds
        // pass null (kind unchanged).
        requestedKind: punch.kind === "in" || punch.kind === "out" ? punch.kind : null,
        requestedAt: punch.punchedAt,
        reason: `Manager approved as-is: ${ex.detail}`,
      });
      await store.decidePunchCorrection(correction.id, true, "Approved as-is from the exceptions dashboard.");
      setExceptions((prev) => prev.filter((e) => e !== ex));
      onChanged?.();
    } catch (err) {
      setError(errMessage(err, "Could not approve the punch."));
    } finally {
      setBusy(false);
    }
  };

  const openFlagForm = (ex: PunchException) => {
    setFlaggingId(ex.punchId);
    setFlagKind("out");
    setFlagAt(toLocalInputValue(ex.at));
    setFlagReason("");
  };

  const submitFlag = async (ex: PunchException) => {
    if (!ex.punchId) return;
    if (!flagAt || !flagReason.trim()) {
      setError("Pick the correct time and add a reason.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const correction = await store.requestPunchCorrection(ex.punchId, {
        requestedKind: flagKind,
        requestedAt: new Date(flagAt).toISOString(),
        reason: flagReason.trim(),
      });
      if (notifyClient) {
        void emitHrEvent(
          notifyClient,
          punchExceptionPayload({
            agencyId: session.agencyId,
            userId: ex.staffId,
            correctionId: correction.id,
            title: "Your punch was flagged for review",
            body: `${staffName(session.userId)} flagged your ${flagKind === "in" ? "clock-in" : "clock-out"} on ${fmtDateTime(ex.at)}: ${flagReason.trim()}`,
          }),
        );
      }
      setFlaggingId(null);
      setFlagReason("");
      setExceptions((prev) => prev.filter((e) => e !== ex));
      onChanged?.();
    } catch (err) {
      setError(errMessage(err, "Could not flag the punch."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Punch exceptions" style={{ marginTop: 16 }}>
      <div className="hub-row">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={18} aria-hidden="true" /> Punch exceptions
          </h2>
          <p className="hub-sub">
            Kiosk and time-clock flags from the last 7 days. Approving files a
            no-change correction for the audit trail; flagging requests a
            correction through the usual flow.
          </p>
        </div>
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-form" style={{ marginBottom: 12 }}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Site
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="hub-chip-row" role="group" aria-label="Filter by exception kind" style={{ marginBottom: 12 }}>
        <button
          className={`hub-chip${kindFilter === "all" ? " selected" : ""}`}
          onClick={() => setKindFilter("all")}
          aria-pressed={kindFilter === "all"}
        >
          All ({exceptions.length})
        </button>
        {kindsPresent.map((kind) => (
          <button
            key={kind}
            className={`hub-chip${kindFilter === kind ? " selected" : ""}`}
            onClick={() => setKindFilter(kind)}
            aria-pressed={kindFilter === kind}
          >
            {KIND_LABELS[kind]} ({exceptions.filter((e) => e.kind === kind).length})
          </button>
        ))}
      </div>
      {loading ? (
        <p>Loading exceptions…</p>
      ) : filtered.length === 0 ? (
        <Empty
          title="No exceptions"
          text={kindFilter === "all" ? "Nothing flagged in the last 7 days." : `No ${KIND_LABELS[kindFilter].toLowerCase()} flags in the last 7 days.`}
          mark="check"
        />
      ) : (
        <ul className="hub-list">
          {filtered.map((ex, i) => {
            const score = scores.get(ex.staffId);
            const actionable = ex.punchId !== null;
            return (
              <li className="hub-list-item" key={`${ex.staffId}:${ex.kind}:${ex.at}:${i}`}>
                <div className="hub-item-main">
                  <span className="hub-item-title">
                    {staffName(ex.staffId)}
                    {score != null && !initialExceptions && (
                      <span className="hub-item-sub"> · timecard score {score}</span>
                    )}
                  </span>
                  <span className="hub-item-sub">
                    {ex.detail} · {fmtDateTime(ex.at)}
                  </span>
                  {flaggingId === ex.punchId && ex.punchId && (
                    <div className="hub-inline-form" style={{ marginTop: 8 }}>
                      <div className="hub-form">
                        <label>
                          Correct punch type
                          <select value={flagKind} onChange={(e) => setFlagKind(e.target.value as "in" | "out")}>
                            <option value="in">Clock in</option>
                            <option value="out">Clock out</option>
                          </select>
                        </label>
                        <label>
                          Correct time
                          <input type="datetime-local" value={flagAt} onChange={(e) => setFlagAt(e.target.value)} />
                        </label>
                        <label className="hub-form-wide">
                          Reason
                          <textarea
                            rows={2}
                            value={flagReason}
                            onChange={(e) => setFlagReason(e.target.value)}
                            placeholder="Left at 3:05 but the kiosk didn't record it"
                          />
                        </label>
                      </div>
                      <div className="hub-form-actions">
                        <button className="hub-btn primary" disabled={busy} onClick={() => submitFlag(ex)}>
                          <Flag size={16} /> Send correction request
                        </button>
                        <button className="hub-btn" onClick={() => setFlaggingId(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="hub-row">
                  <span className={`hub-status ${KIND_STATUS_CLASS[ex.kind]}`}>
                    {KIND_LABELS[ex.kind]}
                  </span>
                  {actionable ? (
                    <>
                      {ex.kind !== "missed_punch" && (
                        <button className="hub-btn primary" disabled={busy} onClick={() => approveAsIs(ex)}>
                          <Check size={16} /> Approve
                        </button>
                      )}
                      <button className="hub-btn" disabled={busy} onClick={() => openFlagForm(ex)}>
                        <Flag size={16} /> Flag
                      </button>
                    </>
                  ) : (
                    <span className="hub-item-sub">
                      {ex.kind === "missed_punch"
                        ? "Use the missed-punch review below to add the missing punch."
                        : ex.kind === "overtime_trending"
                          ? "Review upcoming shifts on the Team Schedule tab."
                          : ex.kind === "remote"
                            ? "Punched from a personal device — reviewable, not a scoring demerit."
                            : "Resolve in Timecard Review."}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {candidates.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Auto clock-out candidates ({candidates.length})</h3>
          <p className="hub-sub">
            Still clocked in past their shift end plus the auto-clock-out
            buffer. The system closes these automatically; no action needed
            unless the time is wrong.
          </p>
          <ul className="hub-list">
            {candidates.map((c) => (
              <li className="hub-list-item" key={c.punch.id}>
                <div className="hub-item-main">
                  <span className="hub-item-title">{staffName(c.punch.staffId)}</span>
                  <span className="hub-item-sub">
                    Clocked in {fmtTime(c.punch.punchedAt)} · {c.shift.title}{" "}
                    (shift ended {fmtTime(c.shift.endsAt)}) · closes at {fmtTime(c.clockOutAt)}
                  </span>
                </div>
                <span className="hub-status locked">Auto clock-out</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
