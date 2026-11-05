import { useState } from "react";
import { Modal } from "../components";
import { statusMix, type Requirement } from "../domain";

const SLICES = [
  { key: "compliant" as const, label: "Compliant", color: "#4d6b42" },
  { key: "dueSoon" as const, label: "Due soon", color: "#c49c60" },
  { key: "overdue" as const, label: "Overdue or expired", color: "#b56a4e" },
  { key: "review" as const, label: "Pending review", color: "#6f815c" },
  { key: "upcoming" as const, label: "Upcoming", color: "#8b5e3c" },
];

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function StatusMixDonut({ items }: { items: Requirement[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRows = selected ? items.filter(item => selected === "compliant" ? item.status === "Compliant" : selected === "dueSoon" ? item.status === "Due soon" : selected === "overdue" ? ["Overdue", "Expired"].includes(item.status) : selected === "review" ? item.status === "Pending review" : item.status === "Upcoming") : [];
  const mix = statusMix(items);
  const rows = SLICES.map((slice) => ({
    ...slice,
    count: mix[slice.key],
  })).filter((row) => row.key !== "upcoming" || row.count > 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  let offset = 0;
  const arcs = rows.map((row) => {
    const length = total ? (row.count / total) * CIRCUMFERENCE : 0;
    const arc = { ...row, length, offset };
    offset -= length;
    return arc;
  });

  const summary = rows
    .map((row) => {
      const pct = total ? Math.round((row.count / total) * 100) : 0;
      return `${row.label} ${row.count} (${pct}%)`;
    })
    .join(", ");

  return (
    <figure className="status-mix" aria-label={`Requirement status mix. ${summary}`}>
      <svg
        className="status-mix-chart"
        viewBox="0 0 96 96"
        width="180"
        height="180"
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
        <text
          x="48"
          y="46"
          textAnchor="middle"
          className="status-mix-total"
        >
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
      <ul className="status-mix-legend">
        {rows.map((row) => {
          const pct = total ? Math.round((row.count / total) * 100) : 0;
          return (
            <li key={row.key}>
              <i style={{ background: row.color }} aria-hidden="true" />
              <button type="button" className="text-button" onClick={() => setSelected(row.key)} aria-label={`View ${row.count} ${row.label.toLowerCase()} requirement records`}>{row.label}</button>
              <strong>
                {row.count} · {pct}%
              </strong>
            </li>
          );
        })}
      </ul>
      {selected !== null && <Modal title="Requirement source records" onClose={() => setSelected(null)} wide>
        <p>{selectedRows.length} matching requirement record{selectedRows.length === 1 ? "" : "s"} in this chart's authorized scope.</p>
        {!selectedRows.length ? <p>No records in this status. This does not assess other compliance areas.</p> : <ul className="record-list">{selectedRows.map(row => <li key={row.id} className="record-row">
          <div><strong>{row.title}</strong><p>{row.person} · {row.site} · {row.status} · due {row.due}</p><p>Owner: {row.owner} · {row.source}, page {row.page}</p><p>Evidence: {row.evidence || "Not recorded"}</p></div>
        </li>)}</ul>}
      </Modal>}
    </figure>
  );
}
