/**
 * RightNowStrip — the manager "Right Now" strip on the Scheduling tab.
 *
 * One card that answers, for the viewer's own home(s): who is clocked in,
 * who was expected and hasn't arrived, who is out today, which of today's
 * shifts are still uncovered, and what is waiting on the viewer's
 * decision. Every number comes from the existing HR stores (punches,
 * shifts, time-off from PR #133, corrections, missed-punch reports, the
 * open-shift board); the judgments live in the pure helper (rightNow.ts).
 *
 * History: built for the Overview (PR #142); moved to the Scheduling tab
 * on 2026-10-28 when the founder made the Overview compliance-first (the
 * house-compliance donuts now lead it). The component is unchanged by the
 * move — its host passes the Scheduling tab's site pick as `focusSite`.
 *
 * Audience: house managers (scoped to their own home), program managers
 * and agency administrators (scoped to the current home focus). Everyone
 * else never sees the strip.
 *
 * Scoping: the strip only ever ASKS the stores about its scoped site ids
 * and hands the helper those same ids, and the helper drops any row that
 * arrives outside them. On the hosted path the queries go through the
 * store's agency-scoped Supabase reads filtered to those site ids — the
 * strip never calls an agency-wide team listing for its segments.
 * The Employee Hub's tab badges reuse a broader legacy helper for the
 * hub's own pages; nothing here depends on that reach.
 *
 * Freshness: loads on mount and whenever the home focus (or the viewer's
 * scope) changes. No polling. An "as of" time (Central) is shown on the
 * card.
 *
 * Tonight's overnight: the all-clear line claims "no shift is uncovered",
 * so the load also reads, per scoped home, the shifts in a ±1 day window
 * and the site's overnight block, and judges the in-progress (or upcoming)
 * overnight instance in the pure helper. That read is strict — if it
 * fails, the whole strip shows its could-not-load note rather than a
 * guessed verdict. Clearance reads are best-effort: a DSP is flagged
 * not-cleared only on a positive read, never on a failed one.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CalendarOff,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useData } from "../../data/DataProvider";
import { hasPermission } from "../../data/permissions";
import { shiftBlocksForSite } from "../../data/dueItems";
import { normalizeSiteFacts } from "../../data/siteReview";
import type { HrPunch } from "../../data/hr";
import { createHrStore } from "../../data/hrStore";
import { createOpenShiftStore } from "../../data/openShiftStore";
import { addIsoDays } from "../coverage/coverageWeek";
import {
  buildRightNowModel,
  chicagoToday,
  clockLabel,
  RIGHT_NOW_TIMEZONE,
  type RightNowModel,
  type RightNowStaff,
} from "./rightNow";

const MANAGER_ROLES = new Set(["house_manager", "program_manager", "administrator"]);
const MAX_SHOWN = 4;

interface Props {
  /** The host page's current home focus: "All sites" or a site name. */
  focusSite: string;
  /** Sites visible on this Overview (id + name). */
  sites: { id: string; name: string }[];
  onNavigate: (page: string) => void;
}

function asOfLabel(d: Date): string {
  return `${d.toLocaleTimeString("en-US", {
    timeZone: RIGHT_NOW_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

export default function RightNowStrip({ focusSite, sites, onNavigate }: Props) {
  const { api, session, workspace } = useData();
  const [model, setModel] = useState<RightNowModel | null>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  const roleKey = session?.roleKey ?? "";
  const isManager = MANAGER_ROLES.has(roleKey);

  const staff: RightNowStaff[] = useMemo(
    () =>
      (workspace?.staff ?? []).map((s) => ({
        userId: s.id,
        fullName: s.name,
        siteId: s.siteId,
        roleKey: s.roleKey,
      })),
    [workspace],
  );

  const scopedSiteIds = useMemo(() => {
    if (!session || !isManager) return [] as string[];
    if (roleKey === "house_manager") {
      return session.siteId ? [session.siteId] : sites.map((s) => s.id);
    }
    if (focusSite && focusSite !== "All sites") {
      const focused = sites.find((s) => s.name === focusSite);
      return focused ? [focused.id] : sites.map((s) => s.id);
    }
    return sites.map((s) => s.id);
  }, [session, isManager, roleKey, focusSite, sites]);

  const scopeKey = scopedSiteIds.join(",");
  const scopeLabel = useMemo(() => {
    const names = sites
      .filter((s) => scopedSiteIds.includes(s.id))
      .map((s) => s.name);
    if (names.length === 0) return "";
    if (names.length === sites.length && sites.length > 1) return "All your sites";
    return names.join(" · ");
  }, [sites, scopedSiteIds]);

  useEffect(() => {
    if (!session || !isManager || scopedSiteIds.length === 0) return;
    let cancelled = false;
    setFailed(false);
    (async () => {
      const store = createHrStore({
        agencyId: session.agencyId,
        userId: session.userId,
      });
      const openShiftStore = createOpenShiftStore({
        agencyId: session.agencyId,
        userId: session.userId,
        fullName: session.fullName,
        canManageSchedule: hasPermission(session, "hub.manage_schedule"),
        canPostAgencyWide: hasPermission(session, "hub.manage_staffing"),
      });
      const today = chicagoToday();
      const dayStart = `${today}T00:00:00`;
      const dayEnd = `${today}T23:59:59`;
      const empty = <T,>(v: T) => () => v;
      const [openPunches, shiftsToday, timeOff, corrections, missedReports, openShifts] =
        await Promise.all([
          Promise.all(
            scopedSiteIds.map((id) =>
              store.listOpenPunches(id).catch(empty([] as HrPunch[])),
            ),
          ).then((lists) => lists.flat()),
          store.listShifts(dayStart, dayEnd).catch(empty([])),
          store.listTimeOffRequests({}).catch(empty([])),
          store.listPunchCorrections({}).catch(empty([])),
          store.listMissedPunchReports({}).catch(empty([])),
          openShiftStore.listOpenShifts().catch(empty([])),
        ]);
      // Today's punches are needed for exactly two judgments — who has
      // arrived (against a started shift) and who is on break — so fetch
      // them only for staff with a shift today or an open punch.
      const scope = new Set(scopedSiteIds);
      const candidateIds = new Set<string>();
      for (const s of shiftsToday) {
        if (s.staffId && (scope.has(s.siteId ?? "") || scope.has(staff.find((x) => x.userId === s.staffId)?.siteId ?? ""))) {
          candidateIds.add(s.staffId);
        }
      }
      for (const p of openPunches) candidateIds.add(p.staffId);
      const punchesToday = (
        await Promise.all(
          [...candidateIds].map((staffId) =>
            store.listPunches(staffId, dayStart, dayEnd).catch(empty([] as HrPunch[])),
          ),
        )
      ).flat();
      // Tonight's overnight: shifts in a ±1 day window per scoped home, so
      // an instance that started yesterday is read too. Strict on purpose —
      // a failure lands in the outer catch and the strip shows its
      // could-not-load note instead of an all-clear it did not verify.
      const tonightShifts = (
        await Promise.all(
          scopedSiteIds.map((id) =>
            store.listShifts(
              `${addIsoDays(today, -1)}T00:00:00`,
              `${addIsoDays(today, 1)}T23:59:59`,
              id,
            ),
          ),
        )
      ).flat();
      const clearanceRows = await Promise.all(
        scopedSiteIds.map((id) => api.listStaffNeedingClearance(id).catch(() => null)),
      );
      const clearanceByStaffId = new Map<string, boolean>();
      for (const rows of clearanceRows) {
        for (const row of rows ?? []) {
          clearanceByStaffId.set(row.userId, row.clearedForInRatio);
        }
      }
      const tonightSites = scopedSiteIds.flatMap((id) => {
        const site = workspace?.sites.find((s) => s.id === id);
        if (!site) return [];
        const blocks = shiftBlocksForSite(normalizeSiteFacts(site));
        return [
          {
            siteId: id,
            siteName: site.name,
            overnightStartMin: blocks.overnight.startMin,
            overnightEndMin: blocks.overnight.endMin,
          },
        ];
      });
      if (cancelled) return;
      setModel(
        buildRightNowModel({
          nowIso: new Date().toISOString(),
          today,
          siteIds: scopedSiteIds,
          staff,
          openPunches,
          punchesToday,
          shiftsToday,
          timeOff,
          corrections,
          missedReports,
          openShifts,
          canApproveTimeOff: hasPermission(session, "hub.approve_time_off"),
          canReviewTimecards: hasPermission(session, "hub.review_timecards"),
          canViewTeam: hasPermission(session, "hub.view_team"),
          tonightSites,
          tonightShifts,
          clearanceByStaffId,
        }),
      );
      setAsOf(new Date());
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, isManager, scopeKey]);

  if (!session || !isManager) return null;

  const goHub = () => onNavigate("Employee Hub");

  return (
    <section className="panel right-now" aria-label="Right now at your home">
      <div className="panel-heading right-now-head">
        <div>
          <h2>
            <Clock3 size={16} /> Right now
            {scopeLabel ? <span className="right-now-scope">{scopeLabel}</span> : null}
          </h2>
          <p>What is true at this moment — attendance, leave, coverage, and your queue.</p>
        </div>
        {asOf && <span className="right-now-asof">As of {asOfLabel(asOf)}</span>}
      </div>
      {failed ? (
        <p className="right-now-note">
          Right now could not be loaded. Open the Employee Hub for attendance and
          approvals.
        </p>
      ) : !model ? (
        <p className="right-now-note" role="status">
          Loading right now…
        </p>
      ) : (
        <>
          {model.tonight
            .filter((entry) => entry.state !== "covered")
            .map((entry) => (
              <p key={entry.siteId} className="right-now-attention">
                {entry.state === "uncovered" ? (
                  <>
                    Tonight at <strong>{entry.siteName}</strong>: no one is
                    scheduled for the overnight.
                  </>
                ) : (
                  <>
                    Tonight at <strong>{entry.siteName}</strong>:{" "}
                    {entry.unclearedNames.join(", ")}{" "}
                    {entry.unclearedNames.length === 1 ? "is" : "are"} on the
                    overnight but not cleared to work alone.
                  </>
                )}
              </p>
            ))}
          {model.allClear ? (
        <p className="right-now-allclear">
          All clear — nobody is out today, no shift is uncovered, and nothing is
          waiting on you.
        </p>
      ) : (
        <div className="right-now-grid">
          <button type="button" className="right-now-segment" onClick={goHub}>
            <span className="right-now-seg-head">
              <UserCheck size={15} /> Clocked in now
              <span className="count-pill">{model.clockedIn.length}</span>
            </span>
            {model.clockedIn.length ? (
              <span className="right-now-list">
                {model.clockedIn.slice(0, MAX_SHOWN).map((entry) => (
                  <span className="right-now-row" key={entry.staffId}>
                    <strong>{entry.name}</strong>
                    <small>
                      since {clockLabel(entry.clockInAt)}
                      {entry.onBreak ? " · On break" : ""}
                    </small>
                  </span>
                ))}
                {model.clockedIn.length > MAX_SHOWN && (
                  <span className="right-now-more">
                    +{model.clockedIn.length - MAX_SHOWN} more
                  </span>
                )}
              </span>
            ) : (
              <span className="right-now-empty">No one clocked in right now</span>
            )}
            <ChevronRight size={14} className="right-now-chevron" />
          </button>

          <button type="button" className="right-now-segment" onClick={goHub}>
            <span className="right-now-seg-head">
              <UserX size={15} /> Expected, not arrived
              <span className="count-pill">{model.notArrived.length}</span>
            </span>
            {model.notArrived.length ? (
              <span className="right-now-list">
                {model.notArrived.slice(0, MAX_SHOWN).map((entry) => (
                  <span className="right-now-row" key={entry.shiftId}>
                    <strong>{entry.name}</strong>
                    <small>shift started {clockLabel(entry.shiftStartAt)}</small>
                  </span>
                ))}
                {model.notArrived.length > MAX_SHOWN && (
                  <span className="right-now-more">
                    +{model.notArrived.length - MAX_SHOWN} more
                  </span>
                )}
              </span>
            ) : (
              <span className="right-now-empty">Everyone expected has arrived</span>
            )}
            <ChevronRight size={14} className="right-now-chevron" />
          </button>

          <button type="button" className="right-now-segment" onClick={goHub}>
            <span className="right-now-seg-head">
              <CalendarOff size={15} /> Out today
              <span className="count-pill">{model.outToday.length}</span>
            </span>
            {model.outToday.length ? (
              <span className="right-now-list">
                {model.outToday.slice(0, MAX_SHOWN).map((entry) => (
                  <span className="right-now-row" key={entry.staffId}>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.partial
                        ? `Out part of today · ${entry.hours}h · ${entry.leaveLabel}`
                        : entry.leaveLabel}
                    </small>
                  </span>
                ))}
                {model.outToday.length > MAX_SHOWN && (
                  <span className="right-now-more">
                    +{model.outToday.length - MAX_SHOWN} more
                  </span>
                )}
              </span>
            ) : (
              <span className="right-now-empty">Nobody out today</span>
            )}
            <ChevronRight size={14} className="right-now-chevron" />
          </button>

          <button type="button" className="right-now-segment" onClick={goHub}>
            <span className="right-now-seg-head">
              <Users size={15} /> Open shifts today
              <span className="count-pill">{model.openShiftsToday.length}</span>
            </span>
            {model.openShiftsToday.length ? (
              <span className="right-now-list">
                {model.openShiftsToday.slice(0, MAX_SHOWN).map((entry) => (
                  <span className="right-now-row" key={entry.id}>
                    <strong>{entry.windowLabel}</strong>
                    <small>
                      {entry.slotsLeft} slot{entry.slotsLeft === 1 ? "" : "s"} open
                    </small>
                  </span>
                ))}
                {model.openShiftsToday.length > MAX_SHOWN && (
                  <span className="right-now-more">
                    +{model.openShiftsToday.length - MAX_SHOWN} more
                  </span>
                )}
              </span>
            ) : (
              <span className="right-now-empty">No open shifts today</span>
            )}
            <ChevronRight size={14} className="right-now-chevron" />
          </button>

          <button type="button" className="right-now-segment" onClick={goHub}>
            <span className="right-now-seg-head">
              <ClipboardCheck size={15} /> Needs your decision
              <span className="count-pill">{model.decisions.total}</span>
            </span>
            {model.decisions.total ? (
              <span className="right-now-list">
                {model.decisions.timeOff > 0 && (
                  <span className="right-now-row">
                    <strong>
                      {model.decisions.timeOff} time-off request
                      {model.decisions.timeOff === 1 ? "" : "s"}
                    </strong>
                  </span>
                )}
                {model.decisions.corrections > 0 && (
                  <span className="right-now-row">
                    <strong>
                      {model.decisions.corrections} punch correction
                      {model.decisions.corrections === 1 ? "" : "s"}
                    </strong>
                  </span>
                )}
                {model.decisions.missedPunches > 0 && (
                  <span className="right-now-row">
                    <strong>
                      {model.decisions.missedPunches} missed-punch report
                      {model.decisions.missedPunches === 1 ? "" : "s"}
                    </strong>
                  </span>
                )}
              </span>
            ) : (
              <span className="right-now-empty">Nothing waiting on you</span>
            )}
            <ChevronRight size={14} className="right-now-chevron" />
          </button>
        </div>
          )}
        </>
      )}
    </section>
  );
}
