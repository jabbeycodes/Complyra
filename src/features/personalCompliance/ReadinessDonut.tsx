/**
 * ReadinessDonut — the status-mix donut for a personal readiness roll-up,
 * drawn in exactly the grammar of the house compliance donuts
 * (components/StatusMixDonut): same ring, same center total, same legend
 * rows with counts and percents spelled out as text, so no segment is
 * carried by color alone. Segments are Current / Due soon / Missing or
 * expired (personalCompliance.ts).
 */
import type { ComplianceSegment } from "./personalCompliance";

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ReadinessDonut({
  segments,
  total,
  variant = "full",
}: {
  segments: ComplianceSegment[];
  total: number;
  /** "mini" drops the legend for the compact Overview strip. */
  variant?: "full" | "mini";
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
      className={`status-mix${variant === "mini" ? " status-mix-mini" : ""}`}
      aria-label={`Personal compliance status mix. ${summary}`}
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
          {total}
        </text>
        <text
          x="48"
          y="60"
          textAnchor="middle"
          className="status-mix-total-label"
        >
          items
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
