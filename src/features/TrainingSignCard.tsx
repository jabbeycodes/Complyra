import { Check, Download, Printer } from "lucide-react";
import { Badge, formatDate } from "../components";
import {
  allLinesInitialed,
  trainingProgress,
  type TrainingRowView,
} from "../data/chart";

export default function TrainingSignCard({
  row,
  canCheck,
  canSignStaff,
  canSignHm,
  onInitial,
  onSignStaff,
  onSignHm,
  onDownload,
  onPrint,
}: {
  row: TrainingRowView;
  canCheck: boolean;
  canSignStaff: boolean;
  canSignHm: boolean;
  onInitial: (lineId: string) => void;
  onSignStaff: () => void;
  onSignHm: () => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  const { done, total } = trainingProgress(row.checklist);
  const readyToSign = allLinesInitialed(row.checklist);
  return (
    <article className="obligation-card training-card">
      <header>
        <span className="kind-pill training">in-home training</span>
        <h3>In-home training checklist</h3>
        <Badge
          status={
            row.status === "complete"
              ? "Signed"
              : row.status === "staff_signed"
                ? "Needs signature"
                : "Needs signature"
          }
        />
      </header>
      <p className="stack-help">
        First time you are assigned to this home, check off each item. Then sign.
        House manager countersigns after you.
      </p>
      <p>
        {row.checklist.staffName} · {done}/{total} items checked
        {row.checklist.staffSignedAt
          ? ` · Staff signed ${formatDate(row.checklist.staffSignedAt)}`
          : ""}
        {row.checklist.hmSignedAt
          ? ` · HM signed ${formatDate(row.checklist.hmSignedAt)}`
          : ""}
      </p>
      <ul className="training-lines">
        {row.checklist.items.map((line) => (
          <li key={line.id}>
            <label className={line.initialedAt ? "done" : ""}>
              <input
                type="checkbox"
                checked={Boolean(line.initialedAt)}
                disabled={!canCheck || Boolean(line.initialedAt)}
                onChange={() => onInitial(line.id)}
              />
              <span>{line.title}</span>
              {line.initialedAt && (
                <small>
                  <Check size={14} /> {formatDate(line.initialedAt)}
                </small>
              )}
            </label>
          </li>
        ))}
      </ul>
      <div className="chart-actions">
        <button className="button" onClick={onDownload}>
          <Download size={16} /> Download
        </button>
        <button className="button" onClick={onPrint}>
          <Printer size={16} /> Print
        </button>
        {canSignStaff && !row.checklist.staffSignedAt && (
          <button
            className="button primary"
            disabled={!readyToSign}
            onClick={onSignStaff}
          >
            Sign as staff
          </button>
        )}
        {canSignHm &&
          row.checklist.staffSignedAt &&
          !row.checklist.hmSignedAt && (
            <button className="button primary" onClick={onSignHm}>
              Sign as house manager
            </button>
          )}
      </div>
    </article>
  );
}
