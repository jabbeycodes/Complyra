/**
 * Staffing board — presentational components for recurring staffing patterns.
 *
 * Used by the Employee Hub "Staffing" tab (manager + read-only), the employee
 * "My Schedule" tab's recurring section, and the Team Schedule tab's
 * "Recurring coverage this week" strip. All data props come from
 * store.listStaffingPatterns(); domain helpers (formatWindowLabel,
 * expandStaffingPattern, STAFFING_DAY_LABELS, computePatternWeeklyHours,
 * validateStaffingPattern) are imported from ../../data/hr.
 */
import { useMemo, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import {
  STAFFING_DAY_LABELS,
  computePatternWeeklyHours,
  expandStaffingPattern,
  formatWindowLabel,
  validateStaffingPattern,
} from "../../data/hr";
import type { HrStaffingPattern, StaffingWindow } from "../../data/hr";
import type { HrStaffingPatternInput } from "../../data/hrStore";
import type { HubSite, HubStaffEntry } from "./EmployeeHubPage";

const SERVICE_TAG_SUGGESTIONS = ["In-Home Respite", "Community Networking", "Residential"];

/** Mon-first ordering of the 0=Sun..6=Sat day indexes. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function staffDisplayName(
  pattern: HrStaffingPattern,
  staffList: HubStaffEntry[],
): string {
  if (pattern.staffName) return pattern.staffName;
  return staffList.find((s) => s.userId === pattern.staffId)?.fullName ?? "Unknown staff";
}

function siteDisplayName(
  pattern: HrStaffingPattern,
  sites: HubSite[],
): string | null {
  if (pattern.siteName) return pattern.siteName;
  if (pattern.siteId) {
    return sites.find((s) => s.id === pattern.siteId)?.name ?? null;
  }
  return null;
}

/** "Demo Client A" or "Demo House North · 1st shift" style assignment line. */
export function assignmentLine(
  pattern: HrStaffingPattern,
  sites: HubSite[],
): string {
  const parts: string[] = [];
  if (pattern.individualName) {
    parts.push(pattern.individualName);
  } else {
    const site = siteDisplayName(pattern, sites);
    if (site) parts.push(site);
    if (pattern.shiftLabel) parts.push(pattern.shiftLabel);
  }
  return parts.length ? parts.join(" · ") : "Unassigned";
}

/* --------------------------- one pattern's row --------------------------- */

export function StaffingPatternRow({
  pattern,
  staffList,
  sites,
  editable,
  onEdit,
  onToggleActive,
}: {
  pattern: HrStaffingPattern;
  staffList: HubStaffEntry[];
  sites: HubSite[];
  editable: boolean;
  onEdit: (p: HrStaffingPattern) => void;
  onToggleActive: (p: HrStaffingPattern) => void;
}) {
  return (
    <li className={`hub-list-item${pattern.active ? "" : " hub-inactive"}`}>
      <div className="hub-item-main">
        <span className="hub-item-title">
          {assignmentLine(pattern, sites)}
          {!pattern.active && <span className="hub-flag-badge">Inactive</span>}
        </span>
        <div className="hub-day-chips" aria-label="Days of week">
          {WEEK_ORDER.map((d) => (
            <span
              key={d}
              className={`hub-day-chip${pattern.days.includes(d) ? " on" : ""}`}
              title={STAFFING_DAY_LABELS[d]}
            >
              {STAFFING_DAY_LABELS[d]}
            </span>
          ))}
        </div>
        <div className="hub-window-pills">
          {pattern.windows.map((w, i) => (
            <span className="hub-window-pill" key={i}>
              {formatWindowLabel(w)}
            </span>
          ))}
        </div>
        {pattern.serviceTags.length > 0 && (
          <div className="hub-tag-badges">
            {pattern.serviceTags.map((t) => (
              <span className="hub-tag-badge" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="hub-flag-row">
          {pattern.requiresIsdTraining && (
            <span className="hub-flag-badge isd">ISD training required</span>
          )}
          {pattern.onCall && <span className="hub-flag-badge oncall">On call</span>}
          {pattern.notes && <span className="hub-item-sub">{pattern.notes}</span>}
        </div>
      </div>
      <div className="hub-staff-actions">
        <span className="hub-hours-badge">{pattern.weeklyHours}h/week</span>
        {editable && (
          <>
            <button
              className="hub-btn"
              aria-label={`Edit staffing pattern for ${staffDisplayName(pattern, staffList)}`}
              onClick={() => onEdit(pattern)}
            >
              <Pencil size={16} />
            </button>
            <button
              className="hub-btn"
              onClick={() => onToggleActive(pattern)}
            >
              {pattern.active ? "Deactivate" : "Reactivate"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/* ------------------------------- the board -------------------------------- */

interface StaffingBoardProps {
  patterns: HrStaffingPattern[];
  staffList: HubStaffEntry[];
  sites: HubSite[];
  /** hub.manage_staffing: shows edit/deactivate controls. */
  editable: boolean;
  loading: boolean;
  error: string;
  onEdit: (p: HrStaffingPattern) => void;
  onToggleActive: (p: HrStaffingPattern) => void;
}

export function StaffingBoard({
  patterns,
  staffList,
  sites,
  editable,
  loading,
  error,
  onEdit,
  onToggleActive,
}: StaffingBoardProps) {
  const groups = useMemo(() => {
    const map = new Map<string, HrStaffingPattern[]>();
    for (const p of patterns) {
      const list = map.get(p.staffId) ?? [];
      list.push(p);
      map.set(p.staffId, list);
    }
    return [...map.entries()].sort((a, b) =>
      staffDisplayName(a[1][0]!, staffList).localeCompare(
        staffDisplayName(b[1][0]!, staffList),
      ),
    );
  }, [patterns, staffList]);

  const siteTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of patterns) {
      if (!p.active) continue;
      const key = siteDisplayName(p, sites) ?? "Unassigned";
      map.set(key, (map.get(key) ?? 0) + p.weeklyHours);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [patterns, sites]);

  if (loading) return <p>Loading staffing patterns…</p>;
  if (error) return <div className="hub-error" role="alert">{error}</div>;
  if (patterns.length === 0) {
    return (
      <p className="hub-sub">
        No recurring staffing patterns yet
        {editable ? " — add the first one above." : "."}
      </p>
    );
  }

  return (
    <div className="hub-staffing-board">
      <div className="hub-totals-strip" aria-label="Weekly hours per site">
        <span className="hub-totals-label">Week hours per site:</span>
        {siteTotals.map(([site, hours]) => (
          <span className="hub-totals-chip" key={site}>
            {site}: <strong>{hours}h</strong>
          </span>
        ))}
      </div>
      {groups.map(([staffId, rows]) => {
        const totalHours = rows
          .filter((p) => p.active)
          .reduce((sum, p) => sum + p.weeklyHours, 0);
        const name = staffDisplayName(rows[0]!, staffList);
        return (
          <div className="hub-staff-block" key={staffId}>
            <div className="hub-staff-head">
              <span className="hub-avatar" aria-hidden="true">
                {initials(name)}
              </span>
              <span className="hub-staff-name">{name}</span>
              <span className="hub-hours-badge">{totalHours}h/week</span>
            </div>
            <ul className="hub-list">
              {rows.map((p) => (
                <StaffingPatternRow
                  key={p.id}
                  pattern={p}
                  staffList={staffList}
                  sites={sites}
                  editable={editable}
                  onEdit={onEdit}
                  onToggleActive={onToggleActive}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ config form ------------------------------- */

const BLANK_WINDOW: StaffingWindow = { start: "08:00", end: "16:00" };

export function StaffingConfigForm({
  staffList,
  sites,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  staffList: HubStaffEntry[];
  sites: HubSite[];
  initial: HrStaffingPattern | null;
  busy: boolean;
  onSave: (input: HrStaffingPatternInput) => void;
  onCancel: () => void;
}) {
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [shiftLabel, setShiftLabel] = useState(initial?.shiftLabel ?? "");
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [days, setDays] = useState<number[]>(initial ? [...initial.days] : [1, 2, 3, 4, 5]);
  const [windows, setWindows] = useState<StaffingWindow[]>(
    initial ? initial.windows.map((w) => ({ ...w })) : [{ ...BLANK_WINDOW }],
  );
  const [tags, setTags] = useState<string[]>(initial ? [...initial.serviceTags] : []);
  const [customTag, setCustomTag] = useState("");
  const [requiresIsdTraining, setRequiresIsdTraining] = useState(
    initial?.requiresIsdTraining ?? false,
  );
  const [onCall, setOnCall] = useState(initial?.onCall ?? false);
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? "");
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const weeklyHours = computePatternWeeklyHours(days, windows);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const addCustomTag = () => {
    const t = customTag.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setCustomTag("");
  };

  const setWindow = (i: number, key: "start" | "end", value: string) =>
    setWindows((prev) => prev.map((w, j) => (j === i ? { ...w, [key]: value } : w)));

  const removeWindow = (i: number) =>
    setWindows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const save = () => {
    const input: HrStaffingPatternInput = {
      siteId: siteId || null,
      staffId,
      individualId: null,
      shiftLabel: shiftLabel.trim() ? shiftLabel.trim() : null,
      days,
      windows,
      weeklyHours,
      serviceTags: tags,
      requiresIsdTraining,
      onCall,
      notes: notes.trim() ? notes.trim() : null,
      effectiveFrom,
      effectiveTo: effectiveTo ? effectiveTo : null,
      active: initial?.active ?? true,
    };
    const problems = validateStaffingPattern(input);
    setErrors(problems);
    if (problems.length === 0) onSave(input);
  };

  return (
    <div className="hub-form">
      {errors.length > 0 && (
        <div className="hub-error hub-form-wide" role="alert">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <label>
        Staff member
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">Choose staff…</option>
          {staffList.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.fullName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Shift label
        <input
          value={shiftLabel}
          onChange={(e) => setShiftLabel(e.target.value)}
          placeholder="1st shift"
        />
      </label>
      <label>
        Site / house
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">No house assigned</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="hub-form-wide hub-fieldset">
        <legend>Days</legend>
        <div className="hub-day-chips interactive" role="group" aria-label="Days of week">
          {WEEK_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              className={`hub-day-chip${days.includes(d) ? " on" : ""}`}
              aria-pressed={days.includes(d)}
              onClick={() => toggleDay(d)}
            >
              {STAFFING_DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="hub-form-wide hub-fieldset">
        <legend>Time windows</legend>
        {windows.map((w, i) => (
          <div className="hub-window-row" key={i}>
            <label>
              Start
              <input
                type="time"
                value={w.start}
                onChange={(e) => setWindow(i, "start", e.target.value)}
              />
            </label>
            <label>
              End
              <input
                type="time"
                value={w.end}
                onChange={(e) => setWindow(i, "end", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="hub-btn"
              aria-label={`Remove window ${i + 1}`}
              disabled={windows.length <= 1}
              onClick={() => removeWindow(i)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="hub-btn"
          onClick={() => setWindows((prev) => [...prev, { ...BLANK_WINDOW }])}
        >
          <Plus size={16} /> Add window
        </button>
      </fieldset>
      <fieldset className="hub-form-wide hub-fieldset">
        <legend>Service tags</legend>
        <div className="hub-tag-picker" role="group" aria-label="Service tags">
          {SERVICE_TAG_SUGGESTIONS.map((t) => (
            <label key={t} className="hub-check">
              <input
                type="checkbox"
                checked={tags.includes(t)}
                onChange={() => toggleTag(t)}
              />
              {t}
            </label>
          ))}
        </div>
        <div className="hub-tag-custom">
          {tags
            .filter((t) => !SERVICE_TAG_SUGGESTIONS.includes(t))
            .map((t) => (
              <span className="hub-tag-badge" key={t}>
                {t}
                <button
                  type="button"
                  className="hub-tag-x"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => toggleTag(t)}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          <input
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Custom tag"
            aria-label="Custom service tag"
          />
          <button type="button" className="hub-btn" onClick={addCustomTag} disabled={!customTag.trim()}>
            <Plus size={16} /> Add
          </button>
        </div>
      </fieldset>
      <fieldset className="hub-form-wide hub-fieldset">
        <legend>Flags</legend>
        <div className="hub-tag-picker" role="group" aria-label="Pattern flags">
          <label className="hub-check">
            <input
              type="checkbox"
              checked={requiresIsdTraining}
              onChange={(e) => setRequiresIsdTraining(e.target.checked)}
            />
            ISD training required
          </label>
          <label className="hub-check">
            <input type="checkbox" checked={onCall} onChange={(e) => setOnCall(e.target.checked)} />
            On call
          </label>
        </div>
      </fieldset>
      <label>
        Effective from
        <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </label>
      <label>
        Effective to (optional)
        <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
      </label>
      <label className="hub-form-wide">
        Notes
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the team should know about this pattern"
        />
      </label>
      <div className="hub-form-wide hub-row">
        <span>
          Weekly hours: <strong>{weeklyHours}h</strong>
        </span>
      </div>
      <div className="hub-form-actions">
        <button type="button" className="hub-btn primary" disabled={busy} onClick={save}>
          {initial ? "Save changes" : "Add pattern"}
        </button>
        <button type="button" className="hub-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ----------------------- recurring coverage this week ---------------------- */

function dayStampLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function RecurringCoverageStrip({
  patterns,
  staffList,
  weekStart,
}: {
  patterns: HrStaffingPattern[];
  staffList: HubStaffEntry[];
  weekStart: Date;
}) {
  const days = useMemo(() => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const from = dayStampLocal(weekStart);
    const to = dayStampLocal(weekEnd);
    const byDate = new Map<string, Array<{ pattern: HrStaffingPattern; occurrence: { date: string; dayOfWeek: number } }>>();
    for (const p of patterns) {
      if (!p.active) continue;
      for (const occ of expandStaffingPattern(p, from, to)) {
        const list = byDate.get(occ.date) ?? [];
        list.push({ pattern: p, occurrence: occ });
        byDate.set(occ.date, list);
      }
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const stamp = dayStampLocal(d);
      return { date: d, stamp, entries: byDate.get(stamp) ?? [] };
    });
  }, [patterns, weekStart]);

  const covered = days.some((d) => d.entries.length > 0);
  if (!covered) {
    return <p className="hub-sub">No recurring coverage set for this week.</p>;
  }

  return (
    <div className="hub-recurring-strip" aria-label="Recurring coverage this week">
      {days.map(({ date, stamp, entries }) => (
        <div className="hub-recurring-day" key={stamp}>
          <strong>{STAFFING_DAY_LABELS[date.getDay()]}</strong>
          <span className="hub-item-sub">{date.getDate()}</span>
          {entries.length === 0 ? (
            <span className="hub-item-sub">—</span>
          ) : (
            <ul className="hub-recurring-list">
              {entries.map(({ pattern, occurrence }) => (
                <li key={`${pattern.id}-${occurrence.date}`}>
                  <span className="hub-recurring-staff">
                    {staffDisplayName(pattern, staffList)}
                  </span>
                  <span className="hub-window-pills">
                    {pattern.windows.map((w, i) => (
                      <span className="hub-window-pill" key={i}>
                        {formatWindowLabel(w)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
