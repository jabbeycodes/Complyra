/**
 * Mobile home — "Today's tracking" donut card and the Up next list.
 *
 * The donut is a picture of the legend's numbers, never the only record:
 * every segment's fraction and percent are printed beside it, and the
 * center label repeats the overall percent as text. Up next mixes today's
 * remaining med passes (from the MAR data) with the user's personal queue.
 */
import { useMemo, useState } from "react";
import type { PersonalWorkItem } from "../../data/dashboard";
import { formatDoseTime } from "./mar";
import { TRACK_COLOR, type TrackingCategoryId } from "./today";
import type { TodayTracking } from "./useTodayTracking";

const TONE_LABELS: Record<PersonalWorkItem["tone"], string> = {
  overdue: "Overdue",
  due: "Due",
  review: "Needs review",
};

type UpFilter = "all" | "due" | "done";

interface UpItem {
  id: string;
  state: "due" | "done";
  timeLabel: string;
  title: string;
  detail: string;
  open: () => void;
}

const RING_R = 57;
const RING_C = 2 * Math.PI * RING_R;

function DonutChart({ tracking }: { tracking: TodayTracking }) {
  const { summary } = tracking;
  return (
    <div className="msh-donut-wrap">
      <svg
        className="msh-donut"
        viewBox="0 0 148 148"
        role="img"
        aria-label={
          summary.hasData
            ? `Today's tracking is ${summary.overallPercent} percent complete: ${summary.segments
                .map((s) => `${s.label} ${s.fractionText}`)
                .join(", ")}`
            : "Nothing is scheduled for tracking today"
        }
      >
        <circle
          cx="74"
          cy="74"
          r={RING_R}
          fill="none"
          stroke={TRACK_COLOR}
          strokeWidth="21"
        />
        {summary.hasData &&
          summary.arcs
            .filter((arc) => arc.color !== TRACK_COLOR && arc.length > 0)
            .map((arc) => {
              const length = (arc.length / summary.overallTotal) * RING_C;
              const offset = (arc.start / summary.overallTotal) * RING_C;
              return (
                <circle
                  key={arc.id}
                  cx="74"
                  cy="74"
                  r={RING_R}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="21"
                  strokeDasharray={`${length} ${RING_C - length}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 74 74)"
                />
              );
            })}
      </svg>
      <div className="msh-donut-center" aria-hidden="true">
        <strong>{summary.overallPercent}%</strong>
        <span>of today&rsquo;s tracking</span>
      </div>
    </div>
  );
}

export default function MobileToday({
  tracking,
  queueItems,
  onOpenCategory,
  onOpenTasks,
  onOpenMar,
  onOpenQueueItem,
}: {
  tracking: TodayTracking;
  queueItems: PersonalWorkItem[];
  onOpenCategory: (id: TrackingCategoryId) => void;
  onOpenTasks: () => void;
  onOpenMar: () => void;
  onOpenQueueItem: (item: PersonalWorkItem) => void;
}) {
  const [filter, setFilter] = useState<UpFilter>("all");
  const { summary, countOnly } = tracking;

  const items = useMemo<UpItem[]>(() => {
    const passItems: UpItem[] = tracking.passes.map((pass) => {
      const done = pass.recorded >= pass.total;
      return {
        id: `pass-${pass.personId}-${pass.doseTime}`,
        state: done ? "done" : "due",
        timeLabel: formatDoseTime(pass.doseTime),
        title: `${formatDoseTime(pass.doseTime)} med pass`,
        detail: done
          ? `${pass.personName} · all ${pass.total} dose${pass.total === 1 ? "" : "s"} recorded`
          : `${pass.personName} · ${pass.total - pass.recorded} of ${pass.total} dose${pass.total === 1 ? "" : "s"} still to record`,
        open: onOpenMar,
      };
    });
    const duePasses = passItems.filter((item) => item.state === "due");
    const donePasses = passItems.filter((item) => item.state === "done");
    const queue: UpItem[] = queueItems.map((item) => ({
      id: `queue-${item.id}`,
      state: "due",
      timeLabel: TONE_LABELS[item.tone],
      title: item.title,
      detail: item.siteName ? `${item.detail} · ${item.siteName}` : item.detail,
      open: () => onOpenQueueItem(item),
    }));
    return [...duePasses, ...queue, ...donePasses];
  }, [tracking.passes, queueItems, onOpenMar, onOpenQueueItem]);

  const hasBothStates =
    items.some((item) => item.state === "due") &&
    items.some((item) => item.state === "done");
  const visibleItems = items
    .filter((item) => filter === "all" || item.state === filter)
    .slice(0, 4);

  return (
    <>
      <section className="msh-donut-card" aria-label="Today's tracking">
        <h3 className="msh-card-title">Today&rsquo;s tracking</h3>
        {tracking.loading ? (
          <p className="msh-section-note">Loading today&rsquo;s tracking…</p>
        ) : (
          <div className="msh-donut-flex">
            <DonutChart tracking={tracking} />
            <div className="msh-donut-legend">
              {summary.segments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  className="msh-legend-row"
                  onClick={() => onOpenCategory(segment.id)}
                >
                  <span
                    className="msh-legend-dot"
                    aria-hidden="true"
                    style={{ background: segment.color }}
                  />
                  <span className="msh-legend-main">
                    <span className="msh-legend-label">{segment.label}</span>
                    <span className="msh-legend-value">
                      {segment.fractionText} · {segment.percent}%
                    </span>
                  </span>
                </button>
              ))}
              {countOnly.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="msh-legend-row"
                  onClick={() => onOpenCategory(row.id)}
                >
                  <span
                    className="msh-legend-dot count-only"
                    aria-hidden="true"
                  />
                  <span className="msh-legend-main">
                    <span className="msh-legend-label">{row.label}</span>
                    <span className="msh-legend-value">{row.text}</span>
                  </span>
                </button>
              ))}
              {!summary.hasData && countOnly.length === 0 && (
                <p className="msh-section-note">
                  Nothing scheduled today. When meds, plan data, or checklists
                  are due at this home, they are tracked here.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="msh-upnext" aria-label="Up next">
        <div className="msh-upnext-head">
          <h3 className="msh-card-title">Up next</h3>
          <button
            type="button"
            className="msh-text-button"
            onClick={onOpenTasks}
          >
            See all
          </button>
        </div>
        {hasBothStates && (
          <div className="msh-chips" role="group" aria-label="Filter up next">
            {(
              [
                ["all", "All"],
                ["due", "Still due"],
                ["done", "Done"],
              ] as [UpFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`msh-chip${filter === value ? " active" : ""}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {items.length === 0 && (
          <p className="msh-empty">Everything due is done.</p>
        )}
        {items.length > 0 && visibleItems.length === 0 && (
          <p className="msh-empty">
            {filter === "done"
              ? "Nothing recorded done yet."
              : "Nothing still due."}
          </p>
        )}
        <div className="msh-list">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="msh-row"
              onClick={item.open}
            >
              <span className="msh-upnext-time">{item.timeLabel}</span>
              <span className="msh-row-main">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
                <small className="msh-status-text">
                  {item.state === "done" ? "Done" : "Still due"}
                </small>
              </span>
              <span className="msh-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
