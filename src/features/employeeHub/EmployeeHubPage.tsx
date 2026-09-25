/**
 * HR / Employee Hub.
 *
 * Everyone with hub.access gets the employee tabs (schedule, time clock,
 * timecard, compliance, documents, time off requests). Manager tabs are
 * gated by hub.* permissions. This page shows staff data only — never
 * individual health data (no PHI).
 *
 * Action-needed badges are computed in-app (exceptions, pending corrections,
 * pending time-off, unacked required docs, submitted timecards). There is no
 * push-notification API for these, so the counts live on the tabs themselves.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  FileText,
  FolderOpen,
  Lock,
  MonitorSmartphone,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Empty, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import { createSupabaseBrowserClient } from "../../data/index";
import { hasPermission, type PermissionKey } from "../../data/permissions";
import type { SessionUser } from "../../data/types";
import type { HrStaffingPattern } from "../../data/hr";
import { emitHrEvent } from "../notifications/useNotifications";
import {
  swapDecidedPayload,
  swapRequestedPayload,
} from "../notifications/notify";
import {
  currentLeaveBalance,
  DEFAULT_OVERTIME_RULES,
  timeOffRequestHours,
  validateAccrualPolicy,
  validateShiftSwap,
  validateTimeOffBalance,
  type AccrualPolicyInput,
  type AccrualTenureBand,
  type HrAccrualLedgerEntry,
  type HrAccrualPolicy,
  type HrOvertimeRules,
  type HrShiftSwap,
  type LeaveType,
  type OvertimeRulesInput,
  type ShiftSwapInput,
} from "../../data/hr";
import {
  DUE_SOON_DAYS,
  buildPayrollCsvExport,
  detectExceptions,
  pairPunches,
  rollupCompliance,
  summarizeTimecard,
} from "../../data/hr";
import type {
  ComplianceEvidence,
  HrDocument,
  HrDocumentAck,
  HrPayPeriod,
  HrPunch,
  HrPunchCorrection,
  HrReadinessRequirement,
  HrShift,
  HrTimecardApproval,
  HrTimeOffRequest,
  PayrollRow,
  ReadinessResult,
} from "../../data/hr";
import {
  createHrStore,
  type HrDocumentInput,
  type HrReadinessRequirementInput,
  type HrShiftInput,
  type HrStaffingPatternInput,
  type HrStore,
  type HrTimeOffRequestInput,
} from "../../data/hrStore";
import {
  RecurringCoverageStrip,
  StaffingBoard,
  StaffingConfigForm,
  StaffingPatternRow,
} from "./StaffingBoard";
import { WhosHereNow } from "./WhosHereNow";
import { PunchExceptions } from "./PunchExceptions";
import { MissedPunchReview } from "./MissedPunchReview";
import { PunchRulesConfig } from "./PunchRulesConfig";
import { KioskAdmin } from "./KioskAdmin";
import { OpenShiftsTab } from "./OpenShiftsTab";
import { createOpenShiftStore, type OpenShiftStore } from "../../data/openShiftStore";
import { scheduledVsActual } from "./punchInsights";
import {
  adaptRemotePunchStore,
  isRemotePunchAvailable,
} from "./kioskContracts";
import "./employeeHub.css";

export interface HubStaffEntry {
  userId: string;
  fullName: string;
  email: string;
  roleKey: string;
  siteId: string | null;
}

export interface HubSite {
  id: string;
  name: string;
}

interface EmployeeHubShellProps {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
  initialTab?: string;
  /** Injected in tests; defaults to the hosted/local open-shift store. */
  openShiftStore?: OpenShiftStore;
}

/* --------------------------------- utils --------------------------------- */

function dayStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days of overlap between two inclusive "YYYY-MM-DD" ranges. */
function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  return Math.round(
    (Date.UTC(+end.slice(0, 4), +end.slice(5, 7), +end.slice(8, 10)) -
      Date.UTC(+start.slice(0, 4), +start.slice(5, 7), +start.slice(8, 10))) /
      86_400_000 +
      1,
  );
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

function fmtHours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)}h`;
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function statusClass(status: string): string {
  return `hub-status ${status}`;
}

function staffName(staffList: HubStaffEntry[], userId: string | null): string {
  if (!userId) return "Open shift";
  return staffList.find((s) => s.userId === userId)?.fullName ?? "Unknown staff";
}

function siteName(sites: HubSite[], siteId: string | null): string {
  if (!siteId) return "All sites";
  return sites.find((s) => s.id === siteId)?.name ?? "Unknown site";
}

/** One-line shift description for swap lists and notifications. */
function describeShift(shift: HrShift | undefined): string {
  if (!shift) return "Unknown shift";
  return `${shift.title} · ${fmtDateTime(shift.startsAt)} – ${fmtTime(shift.endsAt)}`;
}

/* ------------------- accrual / overtime / swap UI helpers ------------------ */

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  pto: "PTO",
  sick: "Sick",
};

/**
 * Plain-English summary of the active overtime rules, e.g.
 * "Overtime after 40 hours per week. Daily overtime after 10 hours in a day.
 * Seventh consecutive day: overtime after 8 hours."
 */
export function describeOvertimeRules(
  rules: Pick<
    HrOvertimeRules,
    | "weeklyThresholdHours"
    | "dailyThresholdHours"
    | "seventhConsecutiveDay"
    | "seventhDayThresholdHours"
  >,
): string {
  const parts: string[] = [
    `Overtime after ${rules.weeklyThresholdHours} hours per week.`,
  ];
  if (rules.dailyThresholdHours != null) {
    parts.push(
      `Daily overtime after ${rules.dailyThresholdHours} hours in a day.`,
    );
  }
  if (rules.seventhConsecutiveDay) {
    parts.push(
      `Seventh consecutive day: overtime after ${rules.seventhDayThresholdHours} hours.`,
    );
  }
  return parts.join(" ");
}

/**
 * Whether `userId` may claim this swap: pending, not their own posting, and
 * open to everyone or targeted at them. (A claimed swap stays "pending"
 * until a manager decides it.)
 */
export function swapClaimable(
  swap: { status: string; requesterId: string; targetStaffId: string | null },
  userId: string,
): boolean {
  if (swap.status !== "pending") return false;
  if (swap.requesterId === userId) return false;
  return swap.targetStaffId === null || swap.targetStaffId === userId;
}

/** "0–2 yrs → 3.08h/period" */
export function formatTenureBand(band: AccrualTenureBand): string {
  const range =
    band.maxYears == null
      ? `${band.minYears}+ yrs`
      : `${band.minYears}–${band.maxYears} yrs`;
  return `${range} → ${band.hoursPerPeriod}h/period`;
}

/** Browser client for client-side notification emits; null in tests/local. */
function useNotifyClient() {
  return useMemo(() => createSupabaseBrowserClient(), []);
}

/** Load the agency overtime rules. */
function useOvertimeRules(store: HrStore): HrOvertimeRules | null {
  const [rules, setRules] = useState<HrOvertimeRules | null>(null);
  useEffect(() => {
    let cancelled = false;
    store
      .getOvertimeRules()
      .then((r) => {
        if (!cancelled) setRules(r);
      })
      .catch(() => {
        if (!cancelled) setRules(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);
  return rules;
}

/** summarizeTimecard options with the agency overtime rules when present.
 * The spread bypasses the excess-property check so this compiles against
 * both the current signature and the extended contract signature. */
function timecardOptions(overtimeRules: HrOvertimeRules | null): {
  unpaidBreakMinutesPerDay: number;
} {
  return {
    unpaidBreakMinutesPerDay: 0,
    ...(overtimeRules ? { overtimeRules } : {}),
  };
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------------------------- tab registry ----------------------------- */

interface TabDef {
  id: string;
  label: string;
  icon: typeof Clock;
  /** Permission that gates the tab; undefined = everyone with hub.access. */
  perm?: PermissionKey;
  /** Any-of permissions that also open the tab (union with perm). */
  permAny?: PermissionKey[];
  badge?: number;
}

const EMPLOYEE_TABS: TabDef[] = [
  { id: "schedule", label: "My Schedule", icon: CalendarDays },
  { id: "staffing", label: "Staffing", icon: CalendarRange },
  { id: "open-shifts", label: "Open Shifts", icon: CalendarPlus },
  { id: "timeclock", label: "Time Clock", icon: Clock },
  { id: "timecard", label: "My Timecard", icon: FileText },
  { id: "compliance", label: "My Compliance", icon: ShieldCheck },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "timeoff", label: "Time Off", icon: CalendarCheck },
];

const MANAGER_TABS: TabDef[] = [
  { id: "team-schedule", label: "Team Schedule", icon: Users, perm: "hub.manage_schedule" },
  { id: "attendance", label: "Attendance", icon: ClipboardList, perm: "hub.view_team" },
  { id: "timecards", label: "Timecards", icon: FileText, perm: "hub.review_timecards" },
  { id: "team-compliance", label: "Team Compliance", icon: ShieldCheck, perm: "hub.view_team" },
  { id: "payroll", label: "Payroll", icon: Wallet, perm: "hub.approve_payroll" },
  { id: "kiosk", label: "Kiosk", icon: MonitorSmartphone, permAny: ["hub.manage_staffing", "hub.manage_pay_settings"] },
];

/* --------------------------------- shell ---------------------------------- */

interface BadgeCounts {
  attendance: number;
  timecards: number;
  timeoff: number;
  documents: number;
}

export function EmployeeHubShell({
  session,
  store,
  staffList,
  sites,
  initialTab,
  openShiftStore,
}: EmployeeHubShellProps) {
  const can = (key: PermissionKey) => hasPermission(session, key);
  // HMs/PMs post for their sites; HR and administrators also post agency-wide.
  const canPostAgencyWide =
    can("hub.manage_staffing") && ["hr", "administrator"].includes(session.roleKey);
  const shiftStore = useMemo(
    () =>
      openShiftStore ??
      createOpenShiftStore({
        agencyId: session.agencyId,
        userId: session.userId,
        fullName: session.fullName,
        canManageSchedule: can("hub.manage_schedule"),
        canPostAgencyWide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openShiftStore, session],
  );
  const tabs = useMemo(
    () => [
      ...EMPLOYEE_TABS,
      ...MANAGER_TABS.filter(
        (t) =>
          !t.perm || can(t.perm) || (t.permAny?.some((p) => can(p)) ?? false),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session],
  );
  const [tab, setTab] = useState(initialTab && tabs.some((t) => t.id === initialTab) ? initialTab : tabs[0]?.id ?? "schedule");
  const [badges, setBadges] = useState<BadgeCounts>({ attendance: 0, timecards: 0, timeoff: 0, documents: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Action-needed counts, computed in-app (there is no push-notification API
  // for these — the badges on the tabs are the notification surface).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const counts: BadgeCounts = { attendance: 0, timecards: 0, timeoff: 0, documents: 0 };
      try {
        if (can("hub.view_team")) {
          const stamp = dayStamp(new Date());
          const [shiftsToday, perStaff] = await Promise.all([
            store
              .listShifts(`${stamp}T00:00:00`, `${stamp}T23:59:59`)
              .catch(() => [] as HrShift[]),
            Promise.all(
              staffList.map((s) =>
                store
                  .listPunches(s.userId, `${stamp}T00:00:00`, `${stamp}T23:59:59`)
                  .catch(() => [] as HrPunch[]),
              ),
            ),
          ]);
          // Punch/shift exception kinds only; timecard_unapproved_at_lock is
          // surfaced on the Timecards tab where approvals are reviewed.
          counts.attendance = detectExceptions({
            punches: perStaff.flat(),
            shifts: shiftsToday,
            timecardApprovals: [],
            payPeriods: [],
            nowIso: new Date().toISOString(),
          }).length;
        }
        if (can("hub.review_timecards")) {
          const corrections = await store.listPunchCorrections({}).catch(() => []);
          counts.timecards += corrections.filter((c) => c.status === "pending").length;
          const periods = await store.listPayPeriods().catch(() => []);
          const latest = periods[0];
          if (latest) {
            const approvals = await Promise.all(
              staffList.map((s) =>
                store.getTimecardApproval(latest.id, s.userId).catch(() => null),
              ),
            );
            counts.timecards += approvals.filter((a) => a?.status === "submitted").length;
          }
        }
        if (can("hub.approve_time_off")) {
          const reqs = await store.listTimeOffRequests({}).catch(() => []);
          counts.timeoff = reqs.filter((r) => r.status === "pending").length;
        }
        const [docs, acks] = await Promise.all([
          store.listDocuments().catch(() => [] as HrDocument[]),
          store.listDocumentAcks().catch(() => []),
        ]);
        const myAcked = new Set(
          acks.filter((a) => a.staffId === session.userId).map((a) => a.docId),
        );
        counts.documents = docs.filter(
          (d) => d.requiresAck && d.active && !myAcked.has(d.id),
        ).length;
      } catch {
        // Badges are best effort; tabs still render.
      }
      if (!cancelled) setBadges(counts);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, session.userId]);

  const tabBadges: Record<string, number> = {
    attendance: badges.attendance,
    timecards: badges.timecards,
    timeoff: badges.timeoff,
    documents: badges.documents,
  };

  return (
    <div className="hub-page">
      <PageHeading
        eyebrow="HR"
        title="Employee Hub"
        description="Schedules, time clock, timecards, compliance, and HR documents — one place."
      />
      <div className="hub-tabs-wrap" role="tablist" aria-label="Employee Hub sections">
        {tabs.map((t) => {
          const Icon = t.icon;
          const badge = tabBadges[t.id] ?? 0;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`hub-tab${tab === t.id ? " selected" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={18} aria-hidden="true" />
              {t.label}
              {badge > 0 && (
                <span className="hub-badge" aria-label={`${badge} need attention`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="hub-panel">
        {tab === "schedule" && <MyScheduleTab session={session} store={store} sites={sites} staffList={staffList} />}
        {tab === "staffing" && (
          <StaffingTab session={session} store={store} staffList={staffList} sites={sites} />
        )}
        {tab === "open-shifts" && (
          <OpenShiftsTab
            session={session}
            store={shiftStore}
            sites={sites}
            canPostSite={can("hub.manage_schedule")}
            canPostAgency={canPostAgencyWide}
          />
        )}
        {tab === "timeclock" && <TimeClockTab session={session} store={store} onChanged={refresh} />}
        {tab === "timecard" && (
          <MyTimecardTab session={session} store={store} onChanged={refresh} />
        )}
        {tab === "compliance" && <MyComplianceTab session={session} store={store} />}
        {tab === "documents" && (
          <DocumentsTab
            session={session}
            store={store}
            canManage={can("hub.manage_documents")}
            onChanged={refresh}
          />
        )}
        {tab === "timeoff" && (
          <TimeOffTab
            session={session}
            store={store}
            staffList={staffList}
            canApprove={can("hub.approve_time_off")}
            onChanged={refresh}
          />
        )}
        {tab === "team-schedule" && can("hub.manage_schedule") && (
          <TeamScheduleTab session={session} store={store} staffList={staffList} sites={sites} />
        )}
        {tab === "attendance" && can("hub.view_team") && (
          <AttendanceTab session={session} store={store} staffList={staffList} sites={sites} />
        )}
        {tab === "timecards" && can("hub.review_timecards") && (
          <TimecardsTab session={session} store={store} staffList={staffList} onChanged={refresh} />
        )}
        {tab === "team-compliance" && can("hub.view_team") && (
          <TeamComplianceTab
            session={session}
            store={store}
            staffList={staffList}
            canManage={can("hub.manage_documents")}
          />
        )}
        {tab === "payroll" && can("hub.approve_payroll") && (
          <PayrollTab session={session} store={store} staffList={staffList} />
        )}
        {tab === "kiosk" && (can("hub.manage_staffing") || can("hub.manage_pay_settings")) && (
          <KioskAdmin session={session} store={store} sites={sites} staffList={staffList} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------ My Schedule ------------------------------- */

function MyScheduleTab({
  session,
  store,
  sites,
  staffList,
}: {
  session: SessionUser;
  store: HrStore;
  sites: HubSite[];
  staffList: HubStaffEntry[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    store
      .listShifts(from, to)
      .then((all) => {
        if (cancelled) return;
        // My shifts plus open shifts I could pick up.
        setShifts(
          all.filter(
            (s) => s.status === "published" && (s.staffId === session.userId || s.staffId === null),
          ),
        );
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load your schedule."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, weekStart, session.userId]);

  // Read-only recurring patterns for this staff member.
  const [patterns, setPatterns] = useState<HrStaffingPattern[]>([]);
  useEffect(() => {
    let cancelled = false;
    store
      .listStaffingPatterns({ staffId: session.userId })
      .then((p) => {
        if (!cancelled) setPatterns(p);
      })
      .catch(() => {
        if (!cancelled) setPatterns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store, session.userId]);

  return (
    <section className="hub-card" aria-label="My schedule">
      <div className="hub-row">
        <div>
          <h2>My Schedule</h2>
          <p className="hub-sub">
            Week of {fmtDate(weekStart.toISOString())} — your shifts and open shifts.
          </p>
        </div>
        <div className="hub-row">
          <button className="hub-btn" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button className="hub-btn" onClick={() => setWeekOffset(0)}>This week</button>
          <button className="hub-btn" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading schedule…</p>
      ) : shifts.length === 0 ? (
        <Empty title="No shifts this week" text="Nothing scheduled for you this week." mark="quiet" />
      ) : (
        days.map((day) => {
          const stamp = dayStamp(day);
          const dayShifts = shifts.filter((s) => s.startsAt.slice(0, 10) === stamp);
          if (!dayShifts.length) return null;
          return (
            <div className="hub-day-group" key={stamp}>
              <h3>{day.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3>
              <ul className="hub-list">
                {dayShifts.map((s) => (
                  <li className="hub-list-item" key={s.id}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">
                        {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} · {s.title}
                      </span>
                      <span className="hub-item-sub">
                        {siteName(sites, s.siteId)}
                        {s.staffId === null ? " · Open shift" : ""}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </span>
                    </div>
                    {s.staffId === null && <span className={statusClass("open")}>Open</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <h3 style={{ margin: "20px 0 8px" }}>My recurring schedule</h3>
      {patterns.length === 0 ? (
        <p className="hub-sub">No recurring pattern assigned to you yet.</p>
      ) : (
        <ul className="hub-list">
          {patterns.map((p) => (
            <StaffingPatternRow
              key={p.id}
              pattern={p}
              staffList={[]}
              sites={sites}
              editable={false}
              onEdit={() => {}}
              onToggleActive={() => {}}
            />
          ))}
        </ul>
      )}
      <SwapBoard session={session} store={store} staffList={staffList} />
    </section>
  );
}

/* --------------------------- shift swap board ----------------------------- */

/**
 * Employee shift-swap board. Post one of my upcoming shifts for swap (open
 * claim, targeted at one coworker, or a direct two-shift exchange), claim
 * coworkers' open/targeted swaps, and cancel my own pending requests.
 * Renders a "being set up" note until the phase-2 store surface exists.
 */
function SwapBoard({
  session,
  store,
  staffList,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
}) {
  const notifyClient = useNotifyClient();
  const [swaps, setSwaps] = useState<HrShiftSwap[]>([]);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offeredId, setOfferedId] = useState("");
  const [requestedId, setRequestedId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [targetShifts, setTargetShifts] = useState<HrShift[]>([]);

  const load = () => {
    setLoading(true);
    setError("");
    const now = Date.now();
    Promise.all([
      store.listShiftSwaps(),
      store
        .listShifts(
          new Date(now - 7 * 86_400_000).toISOString(),
          new Date(now + 60 * 86_400_000).toISOString(),
        )
        .catch(() => [] as HrShift[]),
    ])
      .then(([sw, sh]) => {
        setSwaps(sw);
        setShifts(sh);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load shift swaps."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  // The exchange shift in a direct two-shift swap belongs to the target
  // coworker (the store validates ownership), so load their upcoming
  // published shifts when a target is chosen.
  useEffect(() => {
    if (targetId === "") {
      setTargetShifts([]);
      setRequestedId("");
      return;
    }
    let cancelled = false;
    const now = Date.now();
    store
      .listShifts(
        new Date(now).toISOString(),
        new Date(now + 60 * 86_400_000).toISOString(),
      )
      .then((all) => {
        if (cancelled) return;
        const nowIso = new Date(now).toISOString();
        setTargetShifts(
          all.filter(
            (s) =>
              s.staffId === targetId &&
              s.status === "published" &&
              s.startsAt > nowIso,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setTargetShifts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store, targetId]);

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const nowIso = new Date().toISOString();
  const myUpcoming = shifts.filter(
    (s) => s.staffId === session.userId && s.status === "published" && s.startsAt > nowIso,
  );
  const openSwaps = swaps.filter(
    (s) =>
      s.status === "pending" &&
      (s.targetStaffId === null || s.targetStaffId === session.userId),
  );
  const myRequests = swaps.filter((s) => s.requesterId === session.userId);

  const notifyManagers = (swapId: string, offered: HrShift | undefined) => {
    if (!notifyClient) return;
    const title = "Shift swap requested";
    const body = `${staffName(staffList, session.userId)} offered ${describeShift(offered)} for swap.`;
    for (const roleKey of ["house_manager", "program_manager"]) {
      void emitHrEvent(
        notifyClient,
        swapRequestedPayload({
          agencyId: session.agencyId,
          roleKey,
          swapId,
          title,
          body,
        }),
      );
    }
  };

  const postSwap = async () => {
    const input: ShiftSwapInput = {
      offeredShiftId: offeredId,
      requestedShiftId: requestedId || null,
      targetStaffId: targetId || null,
    };
    setBusy(true);
    setError("");
    try {
      // The store validates the swap (past shifts, overlaps, self-target)
      // and throws user-facing errors, shown inline below.
      const created = await store.createShiftSwap(input);
      notifyManagers(created.id, shiftById.get(created.offeredShiftId));
      setOfferedId("");
      setRequestedId("");
      setTargetId("");
      load();
    } catch (err) {
      setError(errMessage(err, "Could not post the swap."));
    } finally {
      setBusy(false);
    }
  };

  const claim = async (swap: HrShiftSwap) => {
    // Client-side pre-check with the real validator (catches started shifts
    // and self-claims early); the store re-validates authoritatively,
    // including overlap windows, and throws user-facing errors.
    const offered = shiftById.get(swap.offeredShiftId);
    const problems = offered
      ? validateShiftSwap({
          offeredShift: offered,
          requesterId: swap.requesterId,
          requesterShifts: [],
          claimerId: session.userId,
          claimerShifts: [],
          claimedShift: swap.requestedShiftId
            ? (shiftById.get(swap.requestedShiftId) ?? null)
            : null,
          nowIso: new Date().toISOString(),
        })
      : ["Shift details are unavailable."];
    if (problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await store.claimShiftSwap(swap.id, session.userId);
      if (notifyClient) {
        void emitHrEvent(
          notifyClient,
          swapDecidedPayload({
            agencyId: session.agencyId,
            userId: swap.requesterId,
            swapId: updated.id,
            approved: true,
            title: "Your shift swap was claimed",
            body: `${staffName(staffList, session.userId)} claimed your swap offer (${describeShift(shiftById.get(updated.offeredShiftId))}).`,
          }),
        );
      }
      load();
    } catch (err) {
      setError(errMessage(err, "Could not claim the swap."));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await store.cancelShiftSwap(id);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not cancel the swap."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Shift swaps">
      <h3 style={{ margin: "20px 0 8px" }}>Shift swap board</h3>
      <p className="hub-sub">
        Offer one of your upcoming shifts for swap — leave it open for anyone,
        target a coworker, or propose a direct two-shift exchange.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-inline-form" style={{ marginBottom: 20 }}>
        <h3>Post a shift for swap</h3>
        <div className="hub-form">
          <label>
            My shift to offer
            <select value={offeredId} onChange={(e) => setOfferedId(e.target.value)}>
              <option value="">Pick a shift…</option>
              {myUpcoming.map((s) => (
                <option key={s.id} value={s.id}>
                  {describeShift(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Request in exchange (optional)
            <select
              value={requestedId}
              onChange={(e) => setRequestedId(e.target.value)}
              disabled={targetId === ""}
            >
              <option value="">Open claim — no specific shift</option>
              {targetShifts
                .filter((s) => s.id !== offeredId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {describeShift(s)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Target coworker (optional)
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Open to everyone</option>
              {staffList
                .filter((s) => s.userId !== session.userId)
                .map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </label>
          <p className="hub-form-wide hub-sub">
            {targetId === ""
              ? "Choose a target coworker above to request a direct two-shift exchange."
              : "Direct swap: the coworker above gives up the selected shift in exchange. Leave it blank for a one-sided claim."}
          </p>
        </div>
        <div className="hub-form-actions">
          <button className="hub-btn primary" disabled={busy || !offeredId} onClick={postSwap}>
            <ArrowLeftRight size={16} /> Post swap
          </button>
        </div>
      </div>
      <h3>Open swaps</h3>
      {loading ? (
        <p>Loading swaps…</p>
      ) : openSwaps.length === 0 ? (
        <Empty title="No open swaps" text="Nothing posted for swap right now." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {openSwaps.map((s) => (
            <li className="hub-list-item" key={s.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {staffName(staffList, s.requesterId)} offers {describeShift(shiftById.get(s.offeredShiftId))}
                </span>
                <span className="hub-item-sub">
                  {s.requestedShiftId
                    ? `Wants in exchange: ${describeShift(shiftById.get(s.requestedShiftId))}`
                    : "Open claim — pick up this shift"}
                  {s.targetStaffId ? ` · Targeted at you` : ""}
                </span>
              </div>
              <div className="hub-row">
                <span className={statusClass(s.status)}>{s.status}</span>
                {swapClaimable(s, session.userId) && (
                  <button className="hub-btn primary" disabled={busy} onClick={() => claim(s)}>
                    <Check size={16} /> Claim
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 style={{ marginTop: 20 }}>My swap requests</h3>
      {loading ? (
        <p>Loading…</p>
      ) : myRequests.length === 0 ? (
        <p className="hub-sub">You haven't posted any swaps.</p>
      ) : (
        <ul className="hub-list">
          {myRequests.map((s) => (
            <li className="hub-list-item" key={s.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  Offering {describeShift(shiftById.get(s.offeredShiftId))}
                </span>
                <span className="hub-item-sub">
                  {s.requestedShiftId
                    ? `For: ${describeShift(shiftById.get(s.requestedShiftId))}`
                    : s.targetStaffId
                      ? `Targeted at ${staffName(staffList, s.targetStaffId)}`
                      : "Open claim"}
                  {s.decisionNote ? ` · Manager: ${s.decisionNote}` : ""}
                </span>
              </div>
              <div className="hub-row">
                <span className={statusClass(s.status)}>{s.status}</span>
                {s.status === "pending" && s.requesterId === session.userId && (
                  <button className="hub-btn" disabled={busy} onClick={() => cancel(s.id)}>
                    <X size={16} /> Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------------- Staffing --------------------------------- */

/**
 * Staffing tab: the recurring weekly schedule board. Everyone with hub.access
 * can read it; only hub.manage_staffing holders get the config form and the
 * edit/deactivate controls (editing is gated in-app).
 */
function StaffingTab({
  session,
  store,
  staffList,
  sites,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
}) {
  const canManage = hasPermission(session, "hub.manage_staffing");
  const [patterns, setPatterns] = useState<HrStaffingPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HrStaffingPattern | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listStaffingPatterns({})
      .then((p) => {
        setPatterns(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load staffing patterns."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  const handleSave = async (input: HrStaffingPatternInput) => {
    setBusy(true);
    setFormError("");
    try {
      if (editing) await store.updateStaffingPattern(editing.id, input);
      else await store.createStaffingPattern(input);
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMessage(err, "Could not save the staffing pattern."));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (pattern: HrStaffingPattern) => {
    setBusy(true);
    try {
      await store.setStaffingPatternActive(pattern.id, !pattern.active);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not update the staffing pattern."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Staffing">
      <div className="hub-row">
        <div>
          <h2>Staffing</h2>
          <p className="hub-sub">
            Recurring weekly assignments — who works where, every week. Dated
            shifts remain the source of truth for actual coverage.
          </p>
        </div>
        {canManage && (
          <button
            className="hub-btn primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={18} /> Add pattern
          </button>
        )}
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {formError && <div className="hub-error" role="alert">{formError}</div>}
      {formOpen && canManage && (
        <div className="hub-inline-form" style={{ marginBottom: 16 }}>
          <h3>{editing ? "Edit staffing pattern" : "New staffing pattern"}</h3>
          <StaffingConfigForm
            staffList={staffList}
            sites={sites}
            initial={editing}
            busy={busy}
            onSave={handleSave}
            onCancel={() => {
              setFormOpen(false);
              setEditing(null);
            }}
          />
        </div>
      )}
      {!canManage && (
        <p className="hub-sub">
          Read-only view — your manager configures these patterns.
        </p>
      )}
      <StaffingBoard
        patterns={patterns}
        staffList={staffList}
        sites={sites}
        editable={canManage}
        loading={loading}
        error=""
        onEdit={(p) => {
          setEditing(p);
          setFormOpen(true);
        }}
        onToggleActive={toggleActive}
      />
    </section>
  );
}

/* ------------------------------- Time Clock -------------------------------- */

export function TimeClockTab({
  session,
  store,
  onChanged,
  initialGrant,
}: {
  session: SessionUser;
  store: HrStore;
  onChanged: () => void;
  /** Test/SSR seed for the remote-punch grant check. */
  initialGrant?: "allowed" | "denied";
}) {
  const [punches, setPunches] = useState<HrPunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Remote-punch grant state for this staff member. "unknown" while the
   * grant is being checked; "allowed" when they hold a hub.remote_punch
   * grant (or the store predates the grant surface — legacy behavior keeps
   * punching available); "denied" replaces the punch buttons with the
   * kiosk message.
   */
  const [grant, setGrant] = useState<"unknown" | "allowed" | "denied">(
    () => initialGrant ?? (isRemotePunchAvailable(store) ? "unknown" : "allowed"),
  );

  const stamp = dayStamp(new Date());

  useEffect(() => {
    let cancelled = false;
    if (initialGrant || !isRemotePunchAvailable(store)) {
      if (!initialGrant) setGrant("allowed");
      return;
    }
    adaptRemotePunchStore(store)
      .hasRemotePunch(session.userId)
      .then((ok) => {
        if (!cancelled) setGrant(ok ? "allowed" : "denied");
      })
      .catch(() => {
        if (!cancelled) setGrant("allowed");
      });
    return () => {
      cancelled = true;
    };
  }, [store, session.userId, initialGrant]);

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listPunches(session.userId, `${stamp}T00:00:00`, `${stamp}T23:59:59`)
      .then((p) => {
        setPunches(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load today's punches."));
        setLoading(false);
      });
  };

  useEffect(load, [store, session.userId, stamp]);

  const last = punches[punches.length - 1];
  const clockedIn = last?.kind === "in";

  const act = async (kind: "in" | "out") => {
    setBusy(true);
    setError("");
    try {
      if (kind === "in") await store.clockIn();
      else await store.clockOut();
      onChanged();
      load();
    } catch (err) {
      setError(errMessage(err, kind === "in" ? "Could not clock in." : "Could not clock out."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Time clock">
      <h2>Time Clock</h2>
      <p className="hub-sub">
        {clockedIn
          ? `Clocked in since ${fmtTime(last.punchedAt)}.`
          : "You are clocked out."}{" "}
        Today: {fmtDate(stamp)}
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {grant === "denied" ? (
        <div className="hub-inline-form" role="note">
          <p className="hub-sub" style={{ margin: 0 }}>
            Clock in on the house kiosk laptop
          </p>
          <p className="hub-sub">
            Remote punching from a personal device isn't enabled for your
            account. Use the kiosk at your work site instead.
          </p>
        </div>
      ) : (
        <button
          className={`hub-clock-btn${clockedIn ? " clock-out" : ""}`}
          disabled={busy || loading || grant === "unknown"}
          onClick={() => act(clockedIn ? "out" : "in")}
        >
          <Clock size={28} aria-hidden="true" />
          {busy ? "Saving…" : clockedIn ? "Clock Out" : "Clock In"}
        </button>
      )}
      <h3 style={{ margin: "20px 0 8px" }}>Today's punches</h3>
      {loading ? (
        <p>Loading…</p>
      ) : punches.length === 0 ? (
        <Empty title="No punches today" text="Clock in to start your shift." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {[...punches].reverse().map((p) => (
            <li className="hub-list-item" key={p.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {p.kind === "in" ? "Clock in" : "Clock out"} · {fmtTime(p.punchedAt)}
                </span>
                {p.note && <span className="hub-item-sub">{p.note}</span>}
              </div>
              <span className={statusClass(p.kind === "in" ? "submitted" : "complete")}>
                {p.kind === "in" ? "In" : "Out"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------- My Timecard ------------------------------- */

function MyTimecardTab({
  session,
  store,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  onChanged: () => void;
}) {
  const [periods, setPeriods] = useState<HrPayPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [punches, setPunches] = useState<HrPunch[]>([]);
  const [approval, setApproval] = useState<HrTimecardApproval | null>(null);
  const [corrections, setCorrections] = useState<HrPunchCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [corrKind, setCorrKind] = useState<"in" | "out">("in");
  const [corrAt, setCorrAt] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const overtimeRules = useOvertimeRules(store);

  useEffect(() => {
    store
      .listPayPeriods()
      .then((p) => {
        setPeriods(p);
        if (p.length && !periodId) setPeriodId(p[0].id);
      })
      .catch(() => setPeriods([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const period = periods.find((p) => p.id === periodId);

  useEffect(() => {
    if (!period) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      store.listPunches(session.userId, `${period.startsOn}T00:00:00`, `${period.endsOn}T23:59:59`),
      store.getTimecardApproval(period.id, session.userId),
      store.listPunchCorrections({ staffId: session.userId }),
    ])
      .then(([p, a, c]) => {
        if (cancelled) return;
        setPunches(p);
        setApproval(a);
        setCorrections(c);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load your timecard."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, period, session.userId]);

  const summary = useMemo(
    () => summarizeTimecard(punches, timecardOptions(overtimeRules)),
    [punches, overtimeRules],
  );
  const segments = useMemo(() => pairPunches(punches), [punches]);

  const submit = async () => {
    if (!period) return;
    setBusy(true);
    setError("");
    try {
      const a = await store.submitTimecard(period.id);
      setApproval(a);
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not submit your timecard."));
    } finally {
      setBusy(false);
    }
  };

  const requestCorrection = async (punchId: string) => {
    if (!corrAt || !corrReason.trim()) {
      setError("Pick the correct time and add a reason.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const c = await store.requestPunchCorrection(punchId, {
        requestedKind: corrKind,
        requestedAt: new Date(corrAt).toISOString(),
        reason: corrReason.trim(),
      });
      setCorrections((prev) => [c, ...prev]);
      setCorrectingId(null);
      setCorrReason("");
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not request the correction."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="My timecard">
      <h2>My Timecard</h2>
      <p className="hub-sub">Review your hours, then submit for approval.</p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-form" style={{ marginBottom: 16 }}>
        <label>
          Pay period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {fmtDate(p.startsOn)} – {fmtDate(p.endsOn)} ({p.status})
              </option>
            ))}
          </select>
        </label>
      </div>
      {!period ? (
        <Empty title="No pay periods yet" text="Your manager creates pay periods under Payroll." mark="quiet" />
      ) : loading ? (
        <p>Loading timecard…</p>
      ) : (
        <>
          <div className="hub-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>{fmtHours(summary.totalMinutes)}</strong> total ·{" "}
              {fmtHours(summary.regularMinutes)} regular · {fmtHours(summary.overtimeMinutes)} OT
            </div>
            {approval && <span className={statusClass(approval.status)}>{approval.status.replace("_", " ")}</span>}
          </div>
          {segments.length === 0 ? (
            <Empty title="No punches in this period" text="Clock in from the Time Clock tab." mark="quiet" />
          ) : (
            <div className="hub-table-scroll">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Clock in</th>
                    <th>Clock out</th>
                    <th>Hours</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s, i) => {
                    const punch = punches.find((p) => p.punchedAt === s.clockIn);
                    return (
                      <tr key={i}>
                        <td>{fmtDateTime(s.clockIn)}</td>
                        <td>{s.clockOut ? fmtDateTime(s.clockOut) : <em>Missing</em>}</td>
                        <td>{fmtHours(s.minutes)}</td>
                        <td>
                          {punch && (
                            <button
                              className="hub-btn"
                              onClick={() => {
                                setCorrectingId(punch.id);
                                // Corrections target in/out punches only: the row
                                // is a segment's clock-in, so it is always "in"
                                // unless a break/transfer punch shares the
                                // timestamp (defensive "out" branch).
                                setCorrKind(punch.kind === "out" ? "out" : "in");
                                setCorrAt(toLocalInputValue(punch.punchedAt));
                              }}
                            >
                              Request correction
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {correctingId && (
            <div className="hub-inline-form" style={{ marginTop: 16 }}>
              <h3>Request a punch correction</h3>
              <div className="hub-form">
                <label>
                  Correct punch type
                  <select value={corrKind} onChange={(e) => setCorrKind(e.target.value as "in" | "out")}>
                    <option value="in">Clock in</option>
                    <option value="out">Clock out</option>
                  </select>
                </label>
                <label>
                  Correct time
                  <input type="datetime-local" value={corrAt} onChange={(e) => setCorrAt(e.target.value)} />
                </label>
                <label className="hub-form-wide">
                  Reason
                  <textarea
                    rows={2}
                    value={corrReason}
                    onChange={(e) => setCorrReason(e.target.value)}
                    placeholder="Forgot to clock out at end of shift"
                  />
                </label>
              </div>
              <div className="hub-form-actions">
                <button className="hub-btn primary" disabled={busy} onClick={() => requestCorrection(correctingId)}>
                  <Send size={16} /> Send request
                </button>
                <button className="hub-btn" onClick={() => setCorrectingId(null)}>Cancel</button>
              </div>
            </div>
          )}
          {corrections.length > 0 && (
            <>
              <h3 style={{ margin: "20px 0 8px" }}>My correction requests</h3>
              <ul className="hub-list">
                {corrections.map((c) => (
                  <li className="hub-list-item" key={c.id}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">
                        {c.requestedKind === "in" ? "Clock in" : c.requestedKind === "out" ? "Clock out" : "Punch"} → {c.requestedAt ? fmtDateTime(c.requestedAt) : "pending review"}
                      </span>
                      <span className="hub-item-sub">{c.reason}</span>
                    </div>
                    <span className={statusClass(c.status)}>{c.status}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="hub-form-actions" style={{ marginTop: 20 }}>
            <button
              className="hub-btn primary"
              disabled={busy || !period || period.status !== "open" || approval?.status === "submitted" || approval?.status === "approved"}
              onClick={submit}
            >
              <Check size={18} />
              {approval?.status === "approved"
                ? "Approved"
                : approval?.status === "submitted"
                  ? "Submitted"
                  : "Submit for approval"}
            </button>
          </div>
          {approval?.note && <p className="hub-sub">Manager note: {approval.note}</p>}
        </>
      )}
    </section>
  );
}

/* ------------------------------ My Compliance ----------------------------- */

function MyComplianceTab({ session, store }: { session: SessionUser; store: HrStore }) {
  const [requirements, setRequirements] = useState<HrReadinessRequirement[]>([]);
  const [evidence, setEvidence] = useState<ComplianceEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([store.listReadinessRequirements(), store.getComplianceEvidence(session.userId)])
      .then(([reqs, ev]) => {
        if (cancelled) return;
        setRequirements(reqs);
        setEvidence(ev);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load your compliance status."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, session.userId]);

  const items: ReadinessResult[] = useMemo(
    () =>
      evidence
        ? rollupCompliance(
            session.userId,
            session.roleKey,
            requirements,
            evidence,
            new Date().toISOString(),
          )
        : [],
    [requirements, evidence, session.userId, session.roleKey],
  );
  const attention = items.filter(
    (i) => i.status === "missing_or_expired" || i.status === "due_soon",
  );

  return (
    <section className="hub-card" aria-label="My compliance">
      <h2>My Compliance</h2>
      <p className="hub-sub">
        Certifications, trainings, and document acknowledgments. Items due
        within {DUE_SOON_DAYS} days are flagged.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading || !evidence ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <Empty title="No requirements assigned" text="Nothing is tracking against your role right now." mark="check" />
      ) : (
        <>
          {attention.length > 0 && (
            <p><strong>{attention.length}</strong> item{attention.length === 1 ? "" : "s"} need{attention.length === 1 ? "s" : ""} your attention.</p>
          )}
          <ul className="hub-list">
            {items.map((item) => (
              <li className="hub-list-item" key={item.requirement.id}>
                <div className="hub-item-main">
                  <span className="hub-item-title">{item.requirement.label}</span>
                  <span className="hub-item-sub">
                    {item.requirement.kind}
                    {item.evidenceNote ? ` · ${item.evidenceNote}` : ""}
                    {item.dueOn ? ` · due ${fmtDate(item.dueOn)}` : ""}
                  </span>
                </div>
                <span className={statusClass(item.status)}>{item.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* -------------------------------- Documents ------------------------------- */

function DocumentsTab({
  session,
  store,
  canManage,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [acks, setAcks] = useState<HrDocumentAck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  /** null = editor closed, "new" = creating, HrDocument = editing existing. */
  const [editing, setEditing] = useState<HrDocument | "new" | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCategory, setFormCategory] = useState<HrDocument["category"]>("notice");
  const [formRequiresAck, setFormRequiresAck] = useState(true);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([store.listDocuments(), store.listDocumentAcks()])
      .then(([d, a]) => {
        setDocs(d);
        setAcks(a);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load documents."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  const myAckFor = (docId: string) => acks.find((a) => a.docId === docId && a.staffId === session.userId);

  const acknowledge = async (docId: string) => {
    setBusy(true);
    setError("");
    try {
      await store.acknowledgeDocument(docId, signature);
      setAckingId(null);
      setSignature("");
      onChanged();
      load();
    } catch (err) {
      setError(errMessage(err, "Could not record the acknowledgment."));
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (doc: HrDocument | null) => {
    setEditing(doc ?? "new");
    setFormTitle(doc?.title ?? "");
    setFormBody(doc?.body ?? "");
    setFormCategory(doc?.category ?? "notice");
    setFormRequiresAck(doc?.requiresAck ?? true);
  };

  const saveDoc = async () => {
    if (!formTitle.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input: HrDocumentInput = {
        title: formTitle.trim(),
        category: formCategory,
        body: formBody.trim() ? formBody.trim() : null,
        fileUrl: null,
        requiresAck: formRequiresAck,
        active: true,
      };
      if (editing && editing !== "new") {
        await store.updateDocument(editing.id, input);
      } else {
        await store.createDocument(input);
      }
      setEditing(null);
      onChanged();
      load();
    } catch (err) {
      setError(errMessage(err, "Could not save the document."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="HR documents">
      <div className="hub-row">
        <div>
          <h2>Documents</h2>
          <p className="hub-sub">HR library — handbooks, policies, and notices.</p>
        </div>
        {canManage && (
          <button className="hub-btn primary" onClick={() => openEditor(null)}>
            <Plus size={18} /> New document
          </button>
        )}
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : docs.length === 0 ? (
        <Empty title="No HR documents yet" text="Documents added by your agency will appear here." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {docs.map((doc) => {
            const ack = myAckFor(doc.id);
            return (
              <li className="hub-list-item" key={doc.id}>
                <div className="hub-item-main">
                  <span className="hub-item-title">
                    {doc.title} {doc.requiresAck && <span className={statusClass("due_soon")}>Requires acknowledgment</span>}
                  </span>
                  <span className="hub-item-sub">
                    {doc.category}
                    {doc.fileUrl ? (
                      <> · <a href={doc.fileUrl} target="_blank" rel="noreferrer">Open file</a></>
                    ) : null}
                  </span>
                  {doc.body && <p style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{doc.body}</p>}
                  {ack ? (
                    <span className="hub-item-sub">
                      Acknowledged by {ack.signatureName} on {fmtDateTime(ack.ackedAt)}.
                      <br />
                      <em>Digital record generated by Complyrer.</em>
                    </span>
                  ) : ackingId === doc.id ? (
                    <div className="hub-inline-form">
                      <label>
                        Type your full name to acknowledge
                        <input
                          value={signature}
                          onChange={(e) => setSignature(e.target.value)}
                          placeholder="Jordan Avery"
                          autoComplete="name"
                        />
                      </label>
                      <p className="hub-sub" style={{ margin: 0 }}>
                        <em>Digital record generated by Complyrer.</em>
                      </p>
                      <div className="hub-form-actions">
                        <button className="hub-btn primary" disabled={busy || !signature.trim()} onClick={() => acknowledge(doc.id)}>
                          <Check size={16} /> Acknowledge
                        </button>
                        <button className="hub-btn" onClick={() => setAckingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button className="hub-btn" onClick={() => setAckingId(doc.id)}>
                        Acknowledge
                      </button>
                    </div>
                  )}
                </div>
                <div className="hub-row">
                  {ack && <span className={statusClass("complete")}>Acknowledged</span>}
                  {canManage && (
                    <button className="hub-btn" aria-label={`Edit ${doc.title}`} onClick={() => openEditor(doc)}>
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canManage && editing !== null && (
        <EditorDialog
          editing={editing === "new" ? null : editing}
          formTitle={formTitle}
          setFormTitle={setFormTitle}
          formBody={formBody}
          setFormBody={setFormBody}
          formCategory={formCategory}
          setFormCategory={setFormCategory}
          formRequiresAck={formRequiresAck}
          setFormRequiresAck={setFormRequiresAck}
          busy={busy}
          onSave={saveDoc}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function EditorDialog(props: {
  editing: HrDocument | null;
  formTitle: string;
  setFormTitle: (v: string) => void;
  formBody: string;
  setFormBody: (v: string) => void;
  formCategory: HrDocument["category"];
  setFormCategory: (v: HrDocument["category"]) => void;
  formRequiresAck: boolean;
  setFormRequiresAck: (v: boolean) => void;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { editing } = props;
  return (
    <div className="hub-inline-form" style={{ marginTop: 16 }}>
      <h3>{editing ? "Edit document" : "New document"}</h3>
      <div className="hub-form">
        <label className="hub-form-wide">
          Title
          <input value={props.formTitle} onChange={(e) => props.setFormTitle(e.target.value)} />
        </label>
        <label className="hub-form-wide">
          Body
          <textarea rows={6} value={props.formBody} onChange={(e) => props.setFormBody(e.target.value)} />
        </label>
        <label>
          Category
          <select
            value={props.formCategory}
            onChange={(e) => props.setFormCategory(e.target.value as HrDocument["category"])}
          >
            <option value="handbook">Handbook</option>
            <option value="policy">Policy</option>
            <option value="form">Form</option>
            <option value="notice">Notice</option>
          </select>
        </label>
        <label>
          Requires acknowledgment
          <select
            value={props.formRequiresAck ? "yes" : "no"}
            onChange={(e) => props.setFormRequiresAck(e.target.value === "yes")}
          >
            <option value="yes">Yes — every staff member must acknowledge</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <div className="hub-form-actions">
        <button className="hub-btn primary" disabled={props.busy} onClick={props.onSave}>
          <Check size={16} /> Save document
        </button>
        <button className="hub-btn" onClick={props.onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* -------------------------------- Time Off -------------------------------- */

function TimeOffTab({
  session,
  store,
  staffList,
  canApprove,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [mine, setMine] = useState<HrTimeOffRequest[]>([]);
  const [team, setTeam] = useState<HrTimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<HrTimeOffRequest["kind"]>("pto");
  const [startsOn, setStartsOn] = useState(dayStamp(new Date()));
  const [endsOn, setEndsOn] = useState(dayStamp(new Date()));
  const [reason, setReason] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [policies, setPolicies] = useState<HrAccrualPolicy[]>([]);
  const [ledger, setLedger] = useState<HrAccrualLedgerEntry[]>([]);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      store.listTimeOffRequests({ staffId: session.userId }),
      canApprove ? store.listTimeOffRequests({}) : Promise.resolve([] as HrTimeOffRequest[]),
      Promise.all([
        store.listAccrualPolicies().catch(() => [] as HrAccrualPolicy[]),
        store.listLedgerEntries(session.userId).catch(() => [] as HrAccrualLedgerEntry[]),
      ]),
    ])
      .then(([m, t, [pol, entries]]) => {
        setMine(m);
        setTeam(t);
        setPolicies(pol);
        setLedger(entries);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load time-off requests."));
        setLoading(false);
      });
  };

  useEffect(load, [store, session.userId, canApprove]);

  const submitRequest = async () => {
    if (endsOn < startsOn) {
      setError("The end date can't be before the start date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!reason.trim()) {
        setError("Please add a short reason for the request.");
        return;
      }
      const input: HrTimeOffRequestInput = { kind, startsOn, endsOn, reason: reason.trim() };
      const created = await store.createTimeOffRequest(input);
      setMine((prev) => [created, ...prev]);
      setReason("");
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not submit the request."));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      const updated = await store.decideTimeOffRequest(id, approve, decisionNote);
      setTeam((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setDecidingId(null);
      setDecisionNote("");
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not decide the request."));
    } finally {
      setBusy(false);
    }
  };

  const pending = team.filter((r) => r.status === "pending");

  const activePolicies = policies.filter((p) => p.active);
  const balances = new Map<LeaveType, number>(
    activePolicies.map((p) => [p.leaveType, currentLeaveBalance(ledger, p.leaveType)]),
  );
  // Time-off kind → leave type for balance checks (unpaid/other have none).
  const requestLeaveType: LeaveType | null =
    kind === "pto" ? "pto" : kind === "sick" ? "sick" : null;
  const datesValid = startsOn !== "" && endsOn !== "" && endsOn >= startsOn;
  const requestedHours = requestLeaveType && datesValid ? timeOffRequestHours(startsOn, endsOn, 8) : 0;
  const availableHours = requestLeaveType ? (balances.get(requestLeaveType) ?? 0) : null;
  // Domain validation: blocks when the request exceeds the balance, warns
  // when fewer than 8h would remain. The store re-validates on submit and
  // throws — caught and shown inline by submitRequest.
  const balanceCheck =
    requestLeaveType && datesValid
      ? validateTimeOffBalance(requestedHours, availableHours ?? 0, requestLeaveType)
      : null;

  return (
    <section className="hub-card" aria-label="Time off">
      <h2>Time Off</h2>
      <p className="hub-sub">Request time off and track your requests.</p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {activePolicies.length > 0 && (
        <div className="hub-balance-cards" aria-label="Leave balances">
          {activePolicies.map((p) => (
            <div className="hub-balance-card" key={p.id}>
              <span className="hub-balance-label">{LEAVE_TYPE_LABELS[p.leaveType]} available</span>
              <span className="hub-balance-value">{balances.get(p.leaveType) ?? 0}h</span>
            </div>
          ))}
        </div>
      )}
      <div className="hub-inline-form" style={{ marginBottom: 20 }}>
        <h3>New request</h3>
        <div className="hub-form">
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as HrTimeOffRequest["kind"])}>
              <option value="pto">PTO</option>
              <option value="sick">Sick</option>
              <option value="unpaid">Unpaid</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
          <label className="hub-form-wide">
            Reason
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {requestLeaveType && datesValid && balanceCheck && (
            <div className="hub-form-wide">
              <p className="hub-balance-line">
                Requesting <strong>{requestedHours}h</strong> of {availableHours}h available{" "}
                {LEAVE_TYPE_LABELS[requestLeaveType]} (8h per day).
              </p>
              {balanceCheck.errors.map((message) => (
                <p className="hub-balance-line" key={message}>
                  <span className="hub-balance-warn">{message}</span>
                </p>
              ))}
              {balanceCheck.warnings.map((message) => (
                <p className="hub-balance-line hub-sub" key={message}>
                  {message}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="hub-form-actions">
          <button className="hub-btn primary" disabled={busy} onClick={submitRequest}>
            <Send size={16} /> Submit request
          </button>
        </div>
      </div>
      <h3>My requests</h3>
      {loading ? (
        <p>Loading…</p>
      ) : mine.length === 0 ? (
        <Empty title="No requests yet" text="Your time-off requests will appear here." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {mine.map((r) => (
            <li className="hub-list-item" key={r.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {r.kind} · {fmtDate(r.startsOn)} – {fmtDate(r.endsOn)}
                </span>
                <span className="hub-item-sub">
                  {r.reason ?? "No reason given"}
                  {r.decisionNote ? ` · Manager: ${r.decisionNote}` : ""}
                </span>
              </div>
              <span className={statusClass(r.status)}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
      {canApprove && (
        <>
          <h3 style={{ marginTop: 24 }}>Team requests needing a decision</h3>
          {pending.length === 0 ? (
            <Empty title="Nothing pending" text="All team requests have been decided." mark="check" />
          ) : (
            <ul className="hub-list">
              {pending.map((r) => (
                <li className="hub-list-item" key={r.id}>
                  <div className="hub-item-main">
                    <span className="hub-item-title">
                      {staffName(staffList, r.staffId)} · {r.kind} · {fmtDate(r.startsOn)} – {fmtDate(r.endsOn)}
                    </span>
                    <span className="hub-item-sub">{r.reason}</span>
                    {decidingId === r.id ? (
                      <div className="hub-inline-form" style={{ marginTop: 8 }}>
                        <label>
                          Note (optional)
                          <input value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Coverage arranged" />
                        </label>
                        <div className="hub-form-actions">
                          <button className="hub-btn primary" disabled={busy} onClick={() => decide(r.id, true)}>
                            <Check size={16} /> Approve
                          </button>
                          <button className="hub-btn danger" disabled={busy} onClick={() => decide(r.id, false)}>
                            <X size={16} /> Deny
                          </button>
                          <button className="hub-btn" onClick={() => setDecidingId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <button className="hub-btn" onClick={() => setDecidingId(r.id)}>
                          Decide
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={statusClass(r.status)}>{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------ Team Schedule ----------------------------- */

function TeamScheduleTab({
  session,
  store,
  staffList,
  sites,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [siteFilter, setSiteFilter] = useState("");
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HrShift | null>(null);
  const [patterns, setPatterns] = useState<HrStaffingPattern[]>([]);
  const [form, setForm] = useState({ title: "Shift", siteId: "", staffId: "", date: dayStamp(new Date()), start: "08:00", end: "16:00", notes: "", status: "published" as HrShift["status"] });

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listShifts(weekStart.toISOString(), addDays(weekStart, 7).toISOString(), siteFilter || undefined)
      .then((s) => {
        setShifts(s);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load shifts."));
        setLoading(false);
      });
  };

  useEffect(load, [store, weekStart, siteFilter]);

  // Recurring coverage comes from staffing patterns, shown alongside the
  // dated one-off shifts.
  useEffect(() => {
    let cancelled = false;
    store
      .listStaffingPatterns({})
      .then((p) => {
        if (!cancelled) setPatterns(p);
      })
      .catch(() => {
        if (!cancelled) setPatterns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: "Shift", siteId: siteFilter, staffId: "", date: dayStamp(weekStart), start: "08:00", end: "16:00", notes: "", status: "published" });
    setShowForm(true);
  };

  const openEdit = (s: HrShift) => {
    setEditing(s);
    setForm({
      title: s.title,
      siteId: s.siteId ?? "",
      staffId: s.staffId ?? "",
      date: s.startsAt.slice(0, 10),
      start: toLocalInputValue(s.startsAt).slice(11, 16),
      end: toLocalInputValue(s.endsAt).slice(11, 16),
      notes: s.notes ?? "",
      status: s.status,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      setError("Give the shift a title.");
      return;
    }
    if (form.end <= form.start) {
      setError("The end time must be after the start time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input: HrShiftInput = {
        siteId: form.siteId || null,
        staffId: form.staffId || null,
        title: form.title.trim(),
        startsAt: new Date(`${form.date}T${form.start}:00`).toISOString(),
        endsAt: new Date(`${form.date}T${form.end}:00`).toISOString(),
        status: form.status,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      if (editing) await store.updateShift(editing.id, input);
      else await store.createShift(input);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not save the shift."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await store.deleteShift(id);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not delete the shift."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Team schedule">
      <div className="hub-row">
        <div>
          <h2>Team Schedule</h2>
          <p className="hub-sub">Week of {fmtDate(weekStart.toISOString())}. Create, assign, and publish shifts — including open shifts.</p>
        </div>
        <button className="hub-btn primary" onClick={openCreate}>
          <Plus size={18} /> Add shift
        </button>
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-form" style={{ marginBottom: 16 }}>
        <div className="hub-row">
          <button className="hub-btn" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button className="hub-btn" onClick={() => setWeekOffset(0)}>This week</button>
          <button className="hub-btn" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
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
      <h3 style={{ margin: "20px 0 8px" }}>Recurring coverage this week</h3>
      <p className="hub-sub">
        The recurring plan (from staffing patterns) next to the one-off shifts
        below. Dated shifts remain the source of truth for actual coverage.
      </p>
      <RecurringCoverageStrip patterns={patterns} staffList={staffList} weekStart={weekStart} />
      {showForm && (
        <div className="hub-inline-form" style={{ marginBottom: 20 }}>
          <h3>{editing ? "Edit shift" : "Add shift"}</h3>
          <div className="hub-form">
            <label>
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="DSP day shift" />
            </label>
            <label>
              Assign to
              <select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
                <option value="">Open shift (unassigned)</option>
                {staffList.map((s) => (
                  <option key={s.userId} value={s.userId}>{s.fullName}</option>
                ))}
              </select>
            </label>
            <label>
              Site
              <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>
              Start
              <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </label>
            <label>
              End
              <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HrShift["status"] })}>
                <option value="published">Published — visible to staff</option>
                <option value="scheduled">Scheduled — not yet published</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="hub-form-wide">
              Notes
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Bring keys" />
            </label>
          </div>
          <div className="hub-form-actions">
            <button className="hub-btn primary" disabled={busy} onClick={save}>
              <Check size={16} /> Save shift
            </button>
            <button className="hub-btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      {loading ? (
        <p>Loading shifts…</p>
      ) : shifts.length === 0 ? (
        <Empty title="No shifts this week" text="Add the first shift to get the week scheduled." mark="quiet" />
      ) : (
        days.map((day) => {
          const stamp = dayStamp(day);
          const dayShifts = shifts.filter((s) => s.startsAt.slice(0, 10) === stamp);
          if (!dayShifts.length) return null;
          return (
            <div className="hub-day-group" key={stamp}>
              <h3>{day.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3>
              <ul className="hub-list">
                {dayShifts.map((s) => (
                  <li className="hub-list-item" key={s.id}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">
                        {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} · {s.title}
                      </span>
                      <span className="hub-item-sub">
                        {staffName(staffList, s.staffId)} · {siteName(sites, s.siteId)}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </span>
                    </div>
                    <div className="hub-row">
                      <span className={statusClass(s.status)}>{s.status}</span>
                      <button className="hub-btn" aria-label={`Edit shift ${s.title}`} onClick={() => openEdit(s)}>
                        <Pencil size={16} />
                      </button>
                      <button className="hub-btn danger" aria-label={`Delete shift ${s.title}`} disabled={busy} onClick={() => remove(s.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <SwapApprovalList session={session} store={store} staffList={staffList} />
    </section>
  );
}

/* -------------------------- swap approvals (manager) ---------------------- */

/**
 * Manager view of pending shift swaps (gated on hub.manage_schedule by the
 * tab itself). Approve or deny with an optional note; the requester is
 * notified of the decision.
 */
function SwapApprovalList({
  session,
  store,
  staffList,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
}) {
  const notifyClient = useNotifyClient();
  const [swaps, setSwaps] = useState<HrShiftSwap[]>([]);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    const now = Date.now();
    Promise.all([
      store.listShiftSwaps(),
      store
        .listShifts(
          new Date(now - 7 * 86_400_000).toISOString(),
          new Date(now + 60 * 86_400_000).toISOString(),
        )
        .catch(() => [] as HrShift[]),
    ])
      .then(([sw, sh]) => {
        setSwaps(sw);
        setShifts(sh);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load shift swaps."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const pending = swaps.filter((s) => s.status === "pending");

  const decide = async (swap: HrShiftSwap, approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      const updated = await store.decideShiftSwap(
        swap.id,
        approve,
        session.userId,
        decisionNote.trim() ? decisionNote.trim() : undefined,
      );
      if (notifyClient) {
        void emitHrEvent(
          notifyClient,
          swapDecidedPayload({
            agencyId: session.agencyId,
            userId: swap.requesterId,
            swapId: updated.id,
            approved: updated.status === "approved",
            title: approve ? "Your shift swap was approved" : "Your shift swap was denied",
            body: approve
              ? `Your swap offer (${describeShift(shiftById.get(updated.offeredShiftId))}) was approved.`
              : `Your swap offer (${describeShift(shiftById.get(updated.offeredShiftId))}) was denied.${decisionNote.trim() ? ` Note: ${decisionNote.trim()}` : ""}`,
          }),
        );
      }
      setDecidingId(null);
      setDecisionNote("");
      load();
    } catch (err) {
      setError(errMessage(err, "Could not decide the swap."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Shift swap approvals" style={{ marginTop: 24 }}>
      <h3>Shift swap approvals</h3>
      <p className="hub-sub">Pending swap requests — approve or deny with a note.</p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading swaps…</p>
      ) : pending.length === 0 ? (
        <Empty title="No pending swaps" text="All swap requests have been decided." mark="check" />
      ) : (
        <ul className="hub-list">
          {pending.map((s) => (
            <li className="hub-list-item" key={s.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {staffName(staffList, s.requesterId)} offers {describeShift(shiftById.get(s.offeredShiftId))}
                </span>
                <span className="hub-item-sub">
                  {s.requestedShiftId
                    ? `Wants in exchange: ${describeShift(shiftById.get(s.requestedShiftId))}`
                    : "Open claim — no exchange requested"}
                  {s.targetStaffId && s.status === "pending"
                    ? ` · With ${staffName(staffList, s.targetStaffId)}`
                    : s.status === "pending"
                      ? " · Open to everyone"
                      : ""}
                </span>
                {decidingId === s.id ? (
                  <div className="hub-inline-form" style={{ marginTop: 8 }}>
                    <label>
                      Note (optional)
                      <input
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        placeholder="Coverage confirmed"
                      />
                    </label>
                    <div className="hub-form-actions">
                      <button className="hub-btn primary" disabled={busy} onClick={() => decide(s, true)}>
                        <Check size={16} /> Approve
                      </button>
                      <button className="hub-btn danger" disabled={busy} onClick={() => decide(s, false)}>
                        <X size={16} /> Deny
                      </button>
                      <button className="hub-btn" onClick={() => setDecidingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button className="hub-btn" onClick={() => setDecidingId(s.id)}>
                      Decide
                    </button>
                  </div>
                )}
              </div>
              <span className={statusClass(s.status)}>{s.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------- Attendance ------------------------------ */

function AttendanceTab({
  session,
  store,
  staffList,
  sites,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
}) {
  const [date, setDate] = useState(dayStamp(new Date()));
  const [siteFilter, setSiteFilter] = useState("");
  const [punchesByStaff, setPunchesByStaff] = useState<Record<string, HrPunch[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleStaff = useMemo(
    () => staffList.filter((s) => !siteFilter || s.siteId === siteFilter),
    [staffList, siteFilter],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all(
      visibleStaff.map((s) =>
        store
          .listPunches(s.userId, `${date}T00:00:00`, `${date}T23:59:59`)
          .catch(() => [] as HrPunch[]),
      ),
    )
      .then((lists) => {
        if (cancelled) return;
        const map: Record<string, HrPunch[]> = {};
        visibleStaff.forEach((s, i) => {
          map[s.userId] = lists[i];
        });
        setPunchesByStaff(map);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load attendance."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, date, visibleStaff]);

  return (
    <>
      <WhosHereNow session={session} store={store} staffList={staffList} sites={sites} />
      <PunchExceptions session={session} store={store} staffList={staffList} sites={sites} />
      <MissedPunchReview session={session} store={store} staffList={staffList} />
      <section className="hub-card" aria-label="Attendance">
        <h2>Attendance</h2>
        <p className="hub-sub">Who clocked in on the selected day.</p>
        {error && <div className="hub-error" role="alert">{error}</div>}
        <div className="hub-form" style={{ marginBottom: 16 }}>
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
        {loading ? (
          <p>Loading attendance…</p>
        ) : (
          <ul className="hub-list">
            {visibleStaff.map((s) => {
              const punches = punchesByStaff[s.userId] ?? [];
              const last = punches[punches.length - 1];
              return (
                <li className="hub-list-item" key={s.userId}>
                  <div className="hub-item-main">
                    <span className="hub-item-title">{s.fullName}</span>
                    <span className="hub-item-sub">
                      {punches.length === 0
                        ? "No punches"
                        : punches
                            .map((p) => `${p.kind === "in" ? "In" : "Out"} ${fmtTime(p.punchedAt)}`)
                            .join(" · ")}
                    </span>
                  </div>
                  {last && (
                    <span className={statusClass(last.kind === "in" ? "submitted" : "complete")}>
                      {last.kind === "in" ? "Clocked in" : "Clocked out"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/* -------------------------------- Timecards -------------------------------- */

function TimecardsTab({
  store,
  staffList,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  onChanged: () => void;
}) {
  const [periods, setPeriods] = useState<HrPayPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [punches, setPunches] = useState<HrPunch[]>([]);
  const [shifts, setShifts] = useState<HrShift[]>([]);
  const [approval, setApproval] = useState<HrTimecardApproval | null>(null);
  const [corrections, setCorrections] = useState<HrPunchCorrection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const overtimeRules = useOvertimeRules(store);

  useEffect(() => {
    store
      .listPayPeriods()
      .then((p) => {
        setPeriods(p);
        if (p.length && !periodId) setPeriodId(p[0].id);
      })
      .catch(() => setPeriods([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (staffList.length && !staffId) setStaffId(staffList[0].userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffList]);

  const period = periods.find((p) => p.id === periodId);

  useEffect(() => {
    if (!period || !staffId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      store.listPunches(staffId, `${period.startsOn}T00:00:00`, `${period.endsOn}T23:59:59`),
      store.listShifts(`${period.startsOn}T00:00:00`, `${period.endsOn}T23:59:59`),
      store.getTimecardApproval(period.id, staffId),
      store.listPunchCorrections({ staffId }),
    ])
      .then(([p, sh, a, c]) => {
        if (cancelled) return;
        setPunches(p);
        setShifts(sh);
        setApproval(a);
        setCorrections(c);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the timecard."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, period, staffId]);

  const summary = useMemo(
    () => summarizeTimecard(punches, timecardOptions(overtimeRules)),
    [punches, overtimeRules],
  );
  const pendingCorrections = corrections.filter((c) => c.status === "pending");

  // Scheduled vs actual hours per day, with variance flags at ±15 minutes.
  const variance = useMemo(
    () =>
      scheduledVsActual({
        staffId,
        punches,
        shifts: period
          ? shifts.filter((s) => s.staffId === staffId)
          : [],
      }),
    [period, staffId, punches, shifts],
  );

  const decideCorrection = async (id: string, approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      const updated = await store.decidePunchCorrection(id, approve, note);
      setCorrections((prev) => prev.map((c) => (c.id === id ? updated : c)));
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not decide the correction."));
    } finally {
      setBusy(false);
    }
  };

  const decideTimecard = async (status: "approved" | "changes_requested") => {
    if (!period) return;
    setBusy(true);
    setError("");
    try {
      const updated = await store.decideTimecard(period.id, staffId, status, note);
      setApproval(updated);
      setNote("");
      onChanged();
    } catch (err) {
      setError(errMessage(err, "Could not decide the timecard."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Timecard review">
      <h2>Timecards</h2>
      <p className="hub-sub">Review hours, decide punch corrections, and approve timecards.</p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-form" style={{ marginBottom: 16 }}>
        <label>
          Pay period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {fmtDate(p.startsOn)} – {fmtDate(p.endsOn)} ({p.status})
              </option>
            ))}
          </select>
        </label>
        <label>
          Staff
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staffList.map((s) => (
              <option key={s.userId} value={s.userId}>{s.fullName}</option>
            ))}
          </select>
        </label>
      </div>
      {!period ? (
        <Empty title="No pay periods yet" text="Create one under Payroll." mark="quiet" />
      ) : loading ? (
        <p>Loading timecard…</p>
      ) : (
        <>
          <div className="hub-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>{staffName(staffList, staffId)}</strong> · {fmtHours(summary.totalMinutes)} total ·{" "}
              {fmtHours(summary.regularMinutes)} regular · {fmtHours(summary.overtimeMinutes)} OT
            </div>
            {approval ? (
              <span className={statusClass(approval.status)}>{approval.status.replace("_", " ")}</span>
            ) : (
              <span className={statusClass("pending")}>Not submitted</span>
            )}
          </div>
          {variance.length > 0 && (
            <>
              <h3>Scheduled vs actual</h3>
              <p className="hub-sub">
                Scheduled hours from published shifts next to clocked hours.
                Days off by 15 minutes or more are flagged.
              </p>
              <div className="hub-table-scroll" style={{ marginBottom: 16 }}>
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Scheduled</th>
                      <th>Actual</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variance.map((r) => {
                      const flagged = Math.abs(r.varianceMinutes) >= 15;
                      return (
                        <tr key={r.date}>
                          <td>
                            {fmtDate(r.date)}
                            {r.shiftLabels.length > 0 && (
                              <span className="hub-item-sub"> · {r.shiftLabels.join(", ")}</span>
                            )}
                          </td>
                          <td>{fmtHours(r.scheduledMinutes)}</td>
                          <td>{fmtHours(r.actualMinutes)}</td>
                          <td>
                            <span className={flagged ? (r.varianceMinutes > 0 ? "hub-variance-over" : "hub-variance-under") : ""}>
                              {r.varianceMinutes === 0 ? "—" : `${r.varianceMinutes > 0 ? "+" : "−"}${fmtHours(Math.abs(r.varianceMinutes))}`}
                            </span>{" "}
                            {flagged && (
                              <span className={`hub-status ${r.varianceMinutes > 0 ? "due_soon" : "overdue"}`}>
                                {r.varianceMinutes > 0 ? "Over" : "Under"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {pendingCorrections.length > 0 && (
            <>
              <h3>Pending punch corrections ({pendingCorrections.length})</h3>
              <ul className="hub-list" style={{ marginBottom: 16 }}>
                {pendingCorrections.map((c) => (
                  <li className="hub-list-item" key={c.id}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">
                        {c.requestedKind === "in" ? "Clock in" : c.requestedKind === "out" ? "Clock out" : "Punch"} → {c.requestedAt ? fmtDateTime(c.requestedAt) : "pending review"}
                      </span>
                      <span className="hub-item-sub">{c.reason}</span>
                    </div>
                    <div className="hub-row">
                      <button className="hub-btn primary" disabled={busy} onClick={() => decideCorrection(c.id, true)}>
                        <Check size={16} /> Approve
                      </button>
                      <button className="hub-btn danger" disabled={busy} onClick={() => decideCorrection(c.id, false)}>
                        <X size={16} /> Deny
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="hub-inline-form">
            <h3>Decision</h3>
            <div className="hub-form">
              <label className="hub-form-wide">
                Note for {staffName(staffList, staffId)} (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thanks — approved" />
              </label>
            </div>
            <div className="hub-form-actions">
              <button className="hub-btn primary" disabled={busy} onClick={() => decideTimecard("approved")}>
                <Check size={16} /> Approve timecard
              </button>
              <button className="hub-btn danger" disabled={busy} onClick={() => decideTimecard("changes_requested")}>
                Request changes
              </button>
            </div>
            {approval?.note && <p className="hub-sub">Last note: {approval.note}</p>}
          </div>
        </>
      )}
    </section>
  );
}

/* ----------------------------- Team Compliance ---------------------------- */

function TeamComplianceTab({
  session,
  store,
  staffList,
  canManage,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  canManage: boolean;
}) {
  const [requirements, setRequirements] = useState<HrReadinessRequirement[]>([]);
  const [evidenceByStaff, setEvidenceByStaff] = useState<Record<string, ComplianceEvidence>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showReqForm, setShowReqForm] = useState(false);
  const [reqKey, setReqKey] = useState("");
  const [reqLabel, setReqLabel] = useState("");
  const [reqKind, setReqKind] = useState<HrReadinessRequirement["kind"]>("certificate");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const reqs = await store.listReadinessRequirements();
        const entries = await Promise.all(
          staffList.map(async (s) => {
            const ev = await store.getComplianceEvidence(s.userId).catch(
              (): ComplianceEvidence => ({ certs: [], trainings: [], delegations: [], docAcks: [] }),
            );
            return [s.userId, ev] as const;
          }),
        );
        if (cancelled) return;
        setRequirements(reqs);
        setEvidenceByStaff(Object.fromEntries(entries));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load team compliance."));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, staffList]);

  const rows = useMemo(
    () =>
      staffList.map((s) => ({
        staff: s,
        items: rollupCompliance(
          s.userId,
          s.roleKey,
          requirements,
          evidenceByStaff[s.userId] ?? { certs: [], trainings: [], delegations: [], docAcks: [] },
          new Date().toISOString(),
        ),
      })),
    [staffList, requirements, evidenceByStaff],
  );

  const attentionCount = rows.filter((r) =>
    r.items.some((i) => i.status === "missing_or_expired" || i.status === "due_soon"),
  ).length;

  const saveRequirement = async () => {
    if (!reqKey.trim() || !reqLabel.trim()) {
      setError("Key and label are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input: HrReadinessRequirementInput = {
        key: reqKey.trim(),
        label: reqLabel.trim(),
        kind: reqKind,
        dueEveryDays: null,
        requiredRoleKeys: [],
        active: true,
      };
      const created = await store.saveReadinessRequirement(input);
      setRequirements((prev) => [...prev, created].sort((a, b) => a.label.localeCompare(b.label)));
      setShowReqForm(false);
      setReqKey("");
      setReqLabel("");
    } catch (err) {
      setError(errMessage(err, "Could not save the requirement."));
    } finally {
      setBusy(false);
    }
  };

  void session;

  return (
    <section className="hub-card" aria-label="Team compliance">
      <div className="hub-row">
        <div>
          <h2>Team Compliance</h2>
          <p className="hub-sub">
            Readiness matrix — certifications, trainings, delegations, and document
            acknowledgments per staff member.
            {attentionCount > 0 && (
              <> <strong>{attentionCount}</strong> staff member{attentionCount === 1 ? "" : "s"} need{attentionCount === 1 ? "s" : ""} attention.</>
            )}
          </p>
        </div>
        {canManage && (
          <button className="hub-btn primary" onClick={() => setShowReqForm((v) => !v)}>
            <Plus size={18} /> Requirement
          </button>
        )}
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {showReqForm && canManage && (
        <div className="hub-inline-form" style={{ marginBottom: 16 }}>
          <h3>Add readiness requirement</h3>
          <div className="hub-form">
            <label>
              Key (matches the evidence, e.g. cert name)
              <input value={reqKey} onChange={(e) => setReqKey(e.target.value)} placeholder="CPR" />
            </label>
            <label>
              Label
              <input value={reqLabel} onChange={(e) => setReqLabel(e.target.value)} placeholder="CPR certification" />
            </label>
            <label>
              Kind
              <select value={reqKind} onChange={(e) => setReqKind(e.target.value as HrReadinessRequirement["kind"])}>
                <option value="certificate">Certificate</option>
                <option value="training">Training</option>
                <option value="document">Document</option>
                <option value="acknowledgment">Acknowledgment</option>
              </select>
            </label>
          </div>
          <div className="hub-form-actions">
            <button className="hub-btn primary" disabled={busy} onClick={saveRequirement}>
              <Check size={16} /> Save requirement
            </button>
            <button className="hub-btn" onClick={() => setShowReqForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      {loading ? (
        <p>Loading team compliance…</p>
      ) : requirements.length === 0 ? (
        <Empty title="No readiness requirements" text="Add the first requirement to start tracking the team." mark="quiet" />
      ) : (
        <div className="hub-table-scroll">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Staff</th>
                {requirements.map((r) => (
                  <th key={r.id} title={r.label}>
                    {r.label.length > 18 ? `${r.label.slice(0, 18)}…` : r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ staff, items }) => (
                <tr key={staff.userId}>
                  <td><strong>{staff.fullName}</strong></td>
                  {requirements.map((r) => {
                    const item = items.find((i) => i.requirement.id === r.id);
                    return (
                      <td key={r.id} title={item ? `${item.requirement.label} — ${item.status.replace(/_/g, " ")}${item.evidenceNote ? ` (${item.evidenceNote})` : ""}` : r.label}>
                        {item ? (
                          <span className={`hub-dot ${item.status}`} aria-label={item.status.replace(/_/g, " ")} />
                        ) : (
                          <span className="hub-dot missing" aria-label="not applicable" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------- Payroll -------------------------------- */

function PayrollTab({
  session,
  store,
  staffList,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
}) {
  const canManagePaySettings = hasPermission(session, "hub.manage_pay_settings");
  const [periods, setPeriods] = useState<HrPayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startsOn, setStartsOn] = useState(dayStamp(addDays(new Date(), -14)));
  const [endsOn, setEndsOn] = useState(dayStamp(addDays(new Date(), -1)));
  const [overtimeRules, setOvertimeRules] = useState<HrOvertimeRules | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listPayPeriods()
      .then((p) => {
        setPeriods(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load pay periods."));
        setLoading(false);
      });
    store
      .getOvertimeRules()
      .then(setOvertimeRules)
      .catch(() => setOvertimeRules(null));
  };

  useEffect(load, [store]);

  const create = async () => {
    if (endsOn < startsOn) {
      setError("The end date can't be before the start date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const p = await store.createPayPeriod(startsOn, endsOn);
      setPeriods((prev) => [p, ...prev]);
    } catch (err) {
      setError(errMessage(err, "Could not create the pay period."));
    } finally {
      setBusy(false);
    }
  };

  const lock = async (id: string) => {
    setBusy(true);
    try {
      const updated = await store.lockPayPeriod(id);
      setPeriods((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(errMessage(err, "Could not lock the period."));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async (period: HrPayPeriod) => {
    setBusy(true);
    setError("");
    try {
      // Approved time-off counts toward the export as PTO or sick hours.
      // Assumption (documented): 8 hours per approved time-off day.
      const timeOff = await store.listTimeOffRequests({}).catch(() => [] as HrTimeOffRequest[]);
      const rows: (PayrollRow & { approvalStatus: string })[] = await Promise.all(
        staffList.map(async (s) => {
          const [punches, approval] = await Promise.all([
            store.listPunches(s.userId, `${period.startsOn}T00:00:00`, `${period.endsOn}T23:59:59`),
            store.getTimecardApproval(period.id, s.userId),
          ]);
          const summary = summarizeTimecard(punches, timecardOptions(overtimeRules));
          let ptoHours = 0;
          let sickHours = 0;
          for (const r of timeOff) {
            if (r.staffId !== s.userId || r.status !== "approved") continue;
            const days = overlapDays(period.startsOn, period.endsOn, r.startsOn, r.endsOn);
            if (days <= 0) continue;
            if (r.kind === "pto") ptoHours += days * 8;
            else if (r.kind === "sick") sickHours += days * 8;
          }
          return {
            employeeId: s.userId,
            employeeEmail: s.email,
            employeeName: s.fullName,
            periodStart: period.startsOn,
            periodEnd: period.endsOn,
            regularHours: summary.regularMinutes / 60,
            overtimeHours: summary.overtimeMinutes / 60,
            ptoHours,
            sickHours,
            totalHours: (summary.totalMinutes / 60) + ptoHours + sickHours,
            approvalStatus: approval?.status ?? "pending",
          };
        }),
      );
      const approved = rows.filter((r) => r.approvalStatus === "approved");
      downloadText(
        `payroll-${period.startsOn}-to-${period.endsOn}.csv`,
        buildPayrollCsvExport(approved),
        "text/csv;charset=utf-8",
      );
      const updated = await store.markPayPeriodExported(period.id);
      setPeriods((prev) => prev.map((p) => (p.id === period.id ? updated : p)));
    } catch (err) {
      setError(errMessage(err, "Could not export payroll."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card" aria-label="Payroll">
      <h2>Payroll</h2>
      <p className="hub-sub">
        Export-first payroll: lock a period, then export approved timecards as CSV
        for Paycor/ADP/Gusto import. No payroll is processed inside Complyrer.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      <div className="hub-inline-form" style={{ marginBottom: 20 }}>
        <h3>New pay period</h3>
        <div className="hub-form">
          <label>
            Starts on
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <label>
            Ends on
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
        </div>
        <div className="hub-form-actions">
          <button className="hub-btn primary" disabled={busy} onClick={create}>
            <Plus size={16} /> Create period
          </button>
        </div>
      </div>
      {loading ? (
        <p>Loading pay periods…</p>
      ) : periods.length === 0 ? (
        <Empty title="No pay periods yet" text="Create the first period above." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {periods.map((p) => (
            <li className="hub-list-item" key={p.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {fmtDate(p.startsOn)} – {fmtDate(p.endsOn)}
                </span>
                <span className="hub-item-sub">
                  {p.status === "exported"
                    ? "Exported"
                    : p.status === "locked"
                      ? "Locked — ready to export"
                      : "Open — timecards still being submitted"}
                </span>
              </div>
              <div className="hub-row">
                <span className={statusClass(p.status)}>{p.status}</span>
                {p.status === "open" && (
                  <button className="hub-btn" disabled={busy} onClick={() => lock(p.id)}>
                    <Lock size={16} /> Lock period
                  </button>
                )}
                {p.status !== "open" && (
                  <button className="hub-btn primary" disabled={busy} onClick={() => exportCsv(p)}>
                    <Download size={16} /> Export CSV
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManagePaySettings && <PaySettingsSection store={store} />}
      {canManagePaySettings && <PunchRulesConfig store={store} />}
    </section>
  );
}

/* ------------------------------ pay settings ------------------------------ */

/**
 * Pay-settings configuration (overtime rules + accrual policies), gated on
 * hub.manage_pay_settings by the Payroll tab. Renders nothing without the
 * phase-2 store surface.
 */
function PaySettingsSection({ store }: { store: HrStore }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3>Pay settings</h3>
      <p className="hub-sub">
        Overtime rules feed every timecard summary and payroll export; accrual
        policies feed leave balances on the Time Off tab.
      </p>
      <div className="hub-pay-grid">
        <OvertimeRulesCard store={store} />
        <AccrualPoliciesCard store={store} />
      </div>
    </div>
  );
}

function OvertimeRulesCard({ store }: { store: HrStore }) {
  const [rules, setRules] = useState<HrOvertimeRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [weekly, setWeekly] = useState(String(DEFAULT_OVERTIME_RULES.weeklyThresholdHours));
  const [daily, setDaily] = useState("");
  const [seventh, setSeventh] = useState(DEFAULT_OVERTIME_RULES.seventhConsecutiveDay);
  const [seventhHours, setSeventhHours] = useState(
    String(DEFAULT_OVERTIME_RULES.seventhDayThresholdHours),
  );

  const load = () => {
    setLoading(true);
    setError("");
    store
      .getOvertimeRules()
      .then((r) => {
        setRules(r);
        setWeekly(String(r.weeklyThresholdHours));
        setDaily(r.dailyThresholdHours == null ? "" : String(r.dailyThresholdHours));
        setSeventh(r.seventhConsecutiveDay);
        setSeventhHours(String(r.seventhDayThresholdHours));
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load overtime rules."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  const save = async () => {
    const weeklyHours = Number(weekly);
    if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) {
      setError("Weekly overtime threshold must be a positive number of hours.");
      return;
    }
    const dailyHours = daily.trim() === "" ? null : Number(daily);
    if (dailyHours != null && (!Number.isFinite(dailyHours) || dailyHours <= 0)) {
      setError("Daily overtime threshold must be a positive number, or blank to turn it off.");
      return;
    }
    const seventhDayHours = Number(seventhHours);
    if (seventh && (!Number.isFinite(seventhDayHours) || seventhDayHours <= 0)) {
      setError("Seventh-day threshold must be a positive number of hours.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input: OvertimeRulesInput = {
        weeklyThresholdHours: weeklyHours,
        dailyThresholdHours: dailyHours,
        seventhConsecutiveDay: seventh,
        seventhDayThresholdHours: seventhDayHours,
      };
      const saved = await store.saveOvertimeRules(input);
      setRules(saved);
    } catch (err) {
      setError(errMessage(err, "Could not save overtime rules."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card hub-pay-card" aria-label="Overtime rules">
      <h3>Overtime rules</h3>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading pay settings…</p>
      ) : (
        <>
          <div className="hub-summary-box" aria-live="polite">
            <strong>Active rules:</strong> {rules ? describeOvertimeRules(rules) : "None configured."}
            <br />
            Double-time is not supported — overtime is calculated at the single configured rate.
          </div>
          <div className="hub-form" style={{ marginTop: 12 }}>
            <label>
              Weekly threshold (hours)
              <input
                type="number"
                min="1"
                step="0.5"
                value={weekly}
                onChange={(e) => setWeekly(e.target.value)}
              />
            </label>
            <label>
              Daily threshold (hours, blank = off)
              <input
                type="number"
                min="1"
                step="0.5"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                placeholder="Off"
              />
            </label>
            <label>
              Seventh-day threshold (hours)
              <input
                type="number"
                min="1"
                step="0.5"
                value={seventhHours}
                onChange={(e) => setSeventhHours(e.target.value)}
                disabled={!seventh}
              />
            </label>
            <label className="hub-check">
              <input
                type="checkbox"
                checked={seventh}
                onChange={(e) => setSeventh(e.target.checked)}
              />
              Seventh consecutive day overtime
            </label>
          </div>
          <div className="hub-form-actions" style={{ marginTop: 12 }}>
            <button className="hub-btn primary" disabled={busy} onClick={save}>
              <Check size={16} /> Save overtime rules
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const LEAVE_TYPES: LeaveType[] = ["vacation", "pto", "sick"];

function AccrualPoliciesCard({ store }: { store: HrStore }) {
  const [policies, setPolicies] = useState<HrAccrualPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HrAccrualPolicy | null>(null);
  const [leaveType, setLeaveType] = useState<LeaveType>("pto");
  const [bands, setBands] = useState<AccrualTenureBand[]>([
    { minYears: 0, maxYears: null, hoursPerPeriod: 3.08 },
  ]);
  const [capHours, setCapHours] = useState("40");
  const [basis, setBasis] = useState<"calendar_year" | "anniversary">("calendar_year");
  const [effectiveFrom, setEffectiveFrom] = useState(dayStamp(new Date()));
  const [effectiveTo, setEffectiveTo] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listAccrualPolicies()
      .then((p) => {
        setPolicies(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load accrual policies."));
        setLoading(false);
      });
  };

  useEffect(load, [store]);

  const openCreate = () => {
    setEditing(null);
    setLeaveType("pto");
    setBands([{ minYears: 0, maxYears: null, hoursPerPeriod: 3.08 }]);
    setCapHours("40");
    setBasis("calendar_year");
    setEffectiveFrom(dayStamp(new Date()));
    setEffectiveTo("");
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (policy: HrAccrualPolicy) => {
    setEditing(policy);
    setLeaveType(policy.leaveType);
    setBands(policy.tenureBands.map((b) => ({ ...b })));
    setCapHours(String(policy.carryoverCapHours));
    setBasis(policy.carryoverBasis);
    setEffectiveFrom(policy.effectiveFrom);
    setEffectiveTo(policy.effectiveTo ?? "");
    setFormError("");
    setFormOpen(true);
  };

  const updateBand = (index: number, patch: Partial<AccrualTenureBand>) => {
    setBands((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const save = async () => {
    const input: AccrualPolicyInput = {
      leaveType,
      // Bands must be sorted by minYears (the domain validator requires it).
      tenureBands: [...bands].sort((a, b) => a.minYears - b.minYears),
      carryoverCapHours: Number(capHours),
      carryoverBasis: basis,
      effectiveFrom,
      effectiveTo: effectiveTo === "" ? null : effectiveTo,
    };
    const problems = validateAccrualPolicy(input);
    if (problems.length > 0) {
      setFormError(problems.join(" "));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      if (editing) await store.updateAccrualPolicy(editing.id, input);
      else await store.createAccrualPolicy(input);
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errMessage(err, "Could not save the accrual policy."));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (policy: HrAccrualPolicy) => {
    setBusy(true);
    setError("");
    try {
      await store.setAccrualPolicyActive(policy.id, !policy.active);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not update the policy."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hub-card hub-pay-card" aria-label="Accrual policies">
      <div className="hub-row">
        <h3>Accrual policies</h3>
        <button className="hub-btn primary" onClick={openCreate}>
          <Plus size={16} /> Add policy
        </button>
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {formError && !formOpen && <div className="hub-error" role="alert">{formError}</div>}
      {formOpen && (
        <div className="hub-inline-form" style={{ margin: "12px 0" }}>
          <h3>{editing ? "Edit accrual policy" : "New accrual policy"}</h3>
          {formError && <div className="hub-error" role="alert">{formError}</div>}
          <div className="hub-form">
            <label>
              Leave type
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LEAVE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Carryover basis
              <select value={basis} onChange={(e) => setBasis(e.target.value as "calendar_year" | "anniversary")}>
                <option value="calendar_year">Calendar year</option>
                <option value="anniversary">Anniversary</option>
              </select>
            </label>
            <label>
              Carryover cap (hours)
              <input
                type="number"
                min="0"
                step="0.5"
                value={capHours}
                onChange={(e) => setCapHours(e.target.value)}
                placeholder="40"
              />
            </label>
            <label>
              Effective from
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <label>
              Effective to (blank = open-ended)
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="hub-fieldset">
            <legend>Tenure bands</legend>
            {bands.map((band, i) => (
              <div className="hub-band-row" key={i}>
                <label>
                  Min years
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={band.minYears}
                    onChange={(e) => updateBand(i, { minYears: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Max years (blank = none)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={band.maxYears == null ? "" : band.maxYears}
                    onChange={(e) =>
                      updateBand(i, {
                        maxYears: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="None"
                  />
                </label>
                <label>
                  Hours / period
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={band.hoursPerPeriod}
                    onChange={(e) => updateBand(i, { hoursPerPeriod: Number(e.target.value) })}
                  />
                </label>
                {bands.length > 1 && (
                  <button
                    className="hub-btn danger"
                    aria-label={`Remove band ${i + 1}`}
                    onClick={() => setBands((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            <div className="hub-form-actions" style={{ marginTop: 8 }}>
              <button
                className="hub-btn"
                onClick={() => setBands((prev) => [...prev, { minYears: 0, maxYears: null, hoursPerPeriod: 0 }])}
              >
                <Plus size={16} /> Add band
              </button>
            </div>
          </fieldset>
          <div className="hub-form-actions">
            <button className="hub-btn primary" disabled={busy} onClick={save}>
              <Check size={16} /> Save policy
            </button>
            <button
              className="hub-btn"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <p>Loading policies…</p>
      ) : policies.length === 0 ? (
        <Empty title="No accrual policies" text="Add the first policy above — leave balances appear once a policy is active." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {policies.map((p) => (
            <li className={`hub-list-item${p.active ? "" : " hub-inactive"}`} key={p.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  <span className="hub-leave-badge">{LEAVE_TYPE_LABELS[p.leaveType]}</span>
                </span>
                <span className="hub-item-sub">
                  {p.tenureBands.map(formatTenureBand).join(" · ")}
                </span>
                <span className="hub-item-sub">
                  Carryover: {p.carryoverCapHours}h ·{" "}
                  {p.carryoverBasis === "calendar_year" ? "Calendar year" : "Anniversary"} ·{" "}
                  Effective {fmtDate(p.effectiveFrom)}
                  {p.effectiveTo ? ` – ${fmtDate(p.effectiveTo)}` : " – present"}
                </span>
              </div>
              <div className="hub-row">
                <span className={statusClass(p.active ? "approved" : "draft")}>
                  {p.active ? "Active" : "Inactive"}
                </span>
                <button className="hub-btn" aria-label={`Edit ${LEAVE_TYPE_LABELS[p.leaveType]} policy`} disabled={busy} onClick={() => openEdit(p)}>
                  <Pencil size={16} />
                </button>
                <button className="hub-btn" disabled={busy} onClick={() => toggleActive(p)}>
                  {p.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------- page export ------------------------------ */

export default function EmployeeHubPage() {
  const { session, workspace } = useData();
  const store = useMemo(
    () =>
      session
        ? createHrStore({ agencyId: session.agencyId, userId: session.userId })
        : null,
    [session],
  );
  const staffList: HubStaffEntry[] = useMemo(
    () =>
      (workspace?.staff ?? []).map((s) => ({
        userId: s.id,
        fullName: s.name,
        email: s.email,
        roleKey: s.roleKey,
        siteId: s.siteId,
      })),
    [workspace],
  );
  const sites: HubSite[] = useMemo(
    () => (workspace?.sites ?? []).map((s) => ({ id: s.id, name: s.name })),
    [workspace],
  );

  if (!session || !store) {
    return (
      <div className="hub-page">
        <PageHeading eyebrow="HR" title="Employee Hub" />
        <Empty title="Sign in required" text="Sign in to open the Employee Hub." mark="quiet" />
      </div>
    );
  }
  return <EmployeeHubShell session={session} store={store} staffList={staffList} sites={sites} />;
}
