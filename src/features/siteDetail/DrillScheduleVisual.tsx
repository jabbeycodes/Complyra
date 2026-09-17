import { useState } from "react";
import {
  Activity,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CloudLightning,
  Flame,
  HeartPulse,
  Moon,
  ShieldAlert,
  Sun,
  Sunrise,
  UserSearch,
  Wind,
} from "lucide-react";
import { Badge, formatDate } from "../../components";
import {
  DRILL_DUE_DAY,
  DRILLS_DUE_RULE,
  MEDICAL_EMERGENCY_RULE,
  SHIFT_PERIODS,
  scheduleMonthLabel,
  shiftPeriodForMonth,
  type ScheduleDrillType,
  type ScheduleMonthSummary,
  type ScheduledDrillState,
  type ShiftPeriodKey,
} from "../../data/drillSchedule";
import "./DrillScheduleVisual.css";

/* ------------------------------------------------------------------ */
/* Iconography: shift periods and drill types                            */
/* ------------------------------------------------------------------ */

const SHIFT_ICONS: Record<ShiftPeriodKey, typeof Sunrise> = {
  am: Sunrise,
  pm: Sun,
  overnight: Moon,
  weekend: CalendarDays,
};

const DRILL_TYPE_ICONS: Record<ScheduleDrillType, typeof Flame> = {
  fire: Flame,
  tornado: Wind,
  earthquake: Activity,
  severe_weather: CloudLightning,
  intruder: ShieldAlert,
  missing_person: UserSearch,
  medical_emergency: HeartPulse,
};

/* ------------------------------------------------------------------ */
/* Status helpers (pure, unit-tested)                                    */
/* ------------------------------------------------------------------ */

export type MonthScheduleStatus = "complete" | "due_soon" | "not_logged";

export function monthScheduleStatus(
  summary: ScheduleMonthSummary,
  isCurrentMonth: boolean,
): MonthScheduleStatus {
  if (summary.allComplete) return "complete";
  if (isCurrentMonth) return "due_soon";
  return "not_logged";
}

export function monthStatusLabel(status: MonthScheduleStatus): string {
  return status === "complete"
    ? "Complete"
    : status === "due_soon"
      ? "Due soon"
      : "Not logged";
}

/* ------------------------------------------------------------------ */
/* Progress ring                                                         */
/* ------------------------------------------------------------------ */

function ProgressRing({ complete, required }: { complete: number; required: number }) {
  const pct = required === 0 ? 100 : Math.round((complete / required) * 100);
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="dsv-ring" role="img" aria-label={`${complete} of ${required} drills logged`}>
      <svg viewBox="0 0 36 36" width="44" height="44" aria-hidden="true">
        <circle cx="18" cy="18" r={radius} className="dsv-ring-track" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          className="dsv-ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="dsv-ring-text" aria-hidden="true">
        {pct === 100 ? <Check size={16} /> : `${complete}/${required}`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shift responsibility band                                             */
/* ------------------------------------------------------------------ */

export function ShiftResponsibilityBand({ currentMonth }: { currentMonth: number }) {
  const currentPeriod = shiftPeriodForMonth(currentMonth).key;
  return (
    <ol className="dsv-band" aria-label="Which staff run drills each quarter">
      {SHIFT_PERIODS.map((period) => {
        const Icon = SHIFT_ICONS[period.key];
        const active = period.key === currentPeriod;
        return (
          <li
            key={period.key}
            className={`dsv-band-seg dsv-shift-${period.key}${active ? " dsv-band-active" : ""}`}
            aria-current={active ? "true" : undefined}
          >
            <span className="dsv-band-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="dsv-band-text">
              <strong>{period.staffLabel}</strong>
              <span className="dsv-band-sub">
                {period.quarterLabel} · {period.months}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Due-by-the-7th callout                                                */
/* ------------------------------------------------------------------ */

export function DueDateCallout() {
  return (
    <aside className="dsv-due" aria-label="Drill due date rule">
      <span className="dsv-due-icon" aria-hidden="true">
        <CalendarClock size={22} />
      </span>
      <div>
        <strong className="dsv-due-title">Due by the 7th</strong>
        <p>
          {DRILLS_DUE_RULE} Drills recorded after the {DRILL_DUE_DAY}th are
          accepted but flagged late.
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Collapsible drill row (moved over from SiteDrillsSchedule, same       */
/* behavior; restyled with drill-type icon + completion state)           */
/* ------------------------------------------------------------------ */

export function DrillRow({ state }: { state: ScheduledDrillState }) {
  const [open, setOpen] = useState(false);
  const record = state.record;
  const label = `${scheduleMonthLabel(state.type)} drill`;
  const DrillIcon = DRILL_TYPE_ICONS[state.type];
  const done = state.status === "complete";
  const detailId = `drill-detail-${state.type}-${record?.id ?? "none"}`;

  return (
    <li className={`dsv-drill${done ? " dsv-drill-done" : ""}${state.late ? " dsv-drill-late" : ""}`}>
      <button
        type="button"
        className="dsv-drill-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dsv-drill-icon" aria-hidden="true">
          <DrillIcon size={17} />
          {done && (
            <span className="dsv-drill-check" aria-hidden="true">
              <Check size={10} strokeWidth={3.5} />
            </span>
          )}
        </span>
        <span className="dsv-drill-title">
          <strong>{label}</strong>
          <span className="dsv-drill-sub">
            {record?.date ? formatDate(record.date) : "Not logged yet"}
            {state.late ? " · after the 7th" : ""}
          </span>
        </span>
        <span className="dsv-drill-badges">
          {state.late && <Badge status="Late" />}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`dsv-chevron${open ? " dsv-chevron-open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div id={detailId} className="dsv-drill-detail">
          {record ? (
            <dl className="fact-list dsv-drill-facts">
              <div>
                <dt>Date</dt>
                <dd>{record.date ? formatDate(record.date) : "Not logged"}</dd>
              </div>
              {record.time && (
                <div>
                  <dt>Time</dt>
                  <dd>{record.time}</dd>
                </div>
              )}
              <div>
                <dt>Evacuation time</dt>
                <dd>{record.evacTime || "—"}</dd>
              </div>
              <div>
                <dt>Drill leader</dt>
                <dd>{record.leaderName || "—"}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{record.participants || "—"}</dd>
              </div>
              {state.late && (
                <div>
                  <dt>Flag</dt>
                  <dd>
                    Recorded after the {DRILL_DUE_DAY}th — accepted, flagged late.
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">Not logged for this month yet.</p>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Month card                                                            */
/* ------------------------------------------------------------------ */

function MonthCard({
  summary,
  isCurrent,
  year,
}: {
  summary: ScheduleMonthSummary;
  isCurrent: boolean;
  year: number;
}) {
  const period = shiftPeriodForMonth(summary.month.month);
  const status = monthScheduleStatus(summary, isCurrent);
  const ShiftIcon = SHIFT_ICONS[period.key];

  return (
    <article
      className={`dsv-month dsv-shift-${period.key}${isCurrent ? " dsv-current" : ""}`}
      aria-label={`${summary.month.name} ${year} drills — ${monthStatusLabel(status).toLowerCase()}`}
    >
      <div className="dsv-month-accent" aria-hidden="true" />
      <div className="dsv-month-top">
        <div className="dsv-month-id">
          <h3>{summary.month.name}</h3>
          <p className="dsv-shift-line">
            <ShiftIcon size={14} aria-hidden="true" />
            <span>
              {period.periodLabel} · {summary.month.shiftWindow}
            </span>
          </p>
        </div>
        <ProgressRing complete={summary.complete} required={summary.required} />
      </div>

      <div className="dsv-status-row">
        <Badge status={monthStatusLabel(status)} />
        {summary.anyLate && <Badge status="Late" />}
        {isCurrent && <span className="dsv-current-tag">Current month</span>}
        {summary.month.allStaffMedicalMonth && (
          <span className="dsv-medical-pill">
            <HeartPulse size={12} aria-hidden="true" />
            All-staff medical month
          </span>
        )}
      </div>

      <ul className="dsv-drills" aria-label={`${summary.month.name} drill records`}>
        {summary.states.map((state) => (
          <DrillRow key={state.type} state={state} />
        ))}
      </ul>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Year grid: band + callout + month cards + medical footnote            */
/* ------------------------------------------------------------------ */

export default function DrillScheduleGrid({
  months,
  currentMonth,
  year,
}: {
  months: ScheduleMonthSummary[];
  currentMonth: number;
  year: number;
}) {
  return (
    <div className="dsv">
      <ShiftResponsibilityBand currentMonth={currentMonth} />
      <DueDateCallout />
      <div className="dsv-grid">
        {months.map((summary) => (
          <MonthCard
            key={summary.month.month}
            summary={summary}
            isCurrent={summary.month.month === currentMonth}
            year={year}
          />
        ))}
      </div>
      <p className="dsv-medical-footnote">
        <HeartPulse size={13} aria-hidden="true" />* {MEDICAL_EMERGENCY_RULE}
      </p>
    </div>
  );
}
