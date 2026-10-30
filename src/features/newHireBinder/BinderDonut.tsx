/**
 * BinderDonut — the binder board's donut, drawn in exactly the grammar
 * of the platform's compliance donuts (components/StatusMixDonut and
 * personalCompliance/ReadinessDonut): same ring geometry, same track,
 * same legend rows with counts and percents spelled out as text, so no
 * segment is carried by color alone. The center carries the headline
 * percent complete; the segments say how the rest of the ring divides
 * (satisfied / awaiting verification / outstanding).
 */
import type { BinderDonutSegmentData } from "./binderBoardStats";

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function BinderDonut({
  segments,
  total,
  percent,
  variant = "full",
  label = "Binder completion",
}: {
  segments: BinderDonutSegmentData[];
  /** Required items the ring divides (the segments' denominator). */
  total: number;
  /** Satisfied share as a whole percent — the center number. */
  percent: number;
  /** "mini" drops the legend for cards and the binder header. */
  variant?: "full" | "mini";
  /** What the ring describes, for the accessible summary. */
  label?: string;
}) {
  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = total ? (segment.count / total) * CIRCUMFERENCE : 0;
    const arc = { ...segment, length, offset };
    offset -= length;
    return arc;
  });

  const summary = segments
    .map((segment) => {
      const pct = total ? Math.round((segment.count / total) * 100) : 0;
      return `${segment.label} ${segment.count} (${pct}%)`;
    })
    .join(", ");

  return (
    <figure
      className={`status-mix binder-donut${variant === "mini" ? " status-mix-mini" : ""}`}
      aria-label={`${label}: ${percent}% complete. ${summary}`}
    >
      <svg
        className="status-mix-chart"
        viewBox="0 0 96 96"
        width={variant === "mini" ? 76 : 180}
        height={variant === "mini" ? 76 : 180}
        role="img"
        aria-hidden="true"
      >
        <circle
          cx="48"
          cy="48"
          r={RADIUS}
          fill="none"
          stroke="#e8dcc8"
          strokeWidth="14"
        />
        {arcs.map((arc) =>
          arc.length <= 0 ? null : (
            <circle
              key={arc.key}
              cx="48"
              cy="48"
              r={RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth="14"
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE}`}
              strokeDashoffset={arc.offset}
              strokeLinecap="butt"
              transform="rotate(-90 48 48)"
            />
          ),
        )}
        <text x="48" y="46" textAnchor="middle" className="status-mix-total">
          {percent}%
        </text>
        <text
          x="48"
          y="60"
          textAnchor="middle"
          className="status-mix-total-label"
        >
          complete
        </text>
      </svg>
      {variant === "full" && (
        <ul className="status-mix-legend">
          {segments.map((segment) => {
            const pct = total ? Math.round((segment.count / total) * 100) : 0;
            return (
              <li key={segment.key}>
                <i style={{ background: segment.color }} aria-hidden="true" />
                <span>{segment.label}</span>
                <strong>
                  {segment.count} · {pct}%
                </strong>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
