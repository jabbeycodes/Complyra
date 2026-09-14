import { Check, Download, Printer } from "lucide-react";
import { Badge, formatDate } from "../components";
import {
  allLinesInitialed,
  trainingProgress,
  type TrainingRowView,
} from "../data/chart";
import { SignatureField } from "./signatures/SignatureField";
import {
  legacyTrainingDocId,
  legacyTrainingPayload,
} from "./signatures/documentPayloads";

export default function TrainingSignCard({
  row,
  canCheck,
  canSignStaff,
  canSignHm,
  onInitial,
  onDownload,
  onPrint,
}: {
  row: TrainingRowView;
  canCheck: boolean;
  canSignStaff: boolean;
  canSignHm: boolean;
  onInitial: (lineId: string) => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  const { done, total } = trainingProgress(row.checklist);
  const readyToSign = allLinesInitialed(row.checklist);
  const documentId = legacyTrainingDocId(row.checklist.id);
  const buildPayload = () =>
    legacyTrainingPayload({
      checklistId: row.checklist.id,
      staffUserId: row.checklist.staffUserId,
      staffName: row.checklist.staffName,
      items: row.checklist.items.map((line) => ({
        id: line.id,
        title: line.title,
      })),
    });
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
      </div>
      <SignatureField
        documentType="training_checklist"
        documentId={documentId}
        fieldName="staff_sign"
        label="Staff signature"
        getDocumentPayload={buildPayload}
        canAct={canSignStaff && readyToSign}
        cantActReason={
          !readyToSign
            ? "Check off every training item before you sign."
            : "Not signed yet."
        }
        legacySigned={
          row.checklist.staffSignedAt
            ? {
                signerName:
                  row.checklist.staffSignatureName ?? row.checklist.staffName,
                signedAt: row.checklist.staffSignedAt,
              }
            : null
        }
      />
      <SignatureField
        documentType="training_checklist"
        documentId={documentId}
        fieldName="hm_countersign"
        label="House manager signature"
        actionLabel="Countersign as {name}"
        getDocumentPayload={buildPayload}
        canAct={canSignHm}
        cantActReason="Not countersigned yet."
        legacySigned={
          row.checklist.hmSignedAt
            ? {
                signerName: row.checklist.hmSignatureName ?? "Signed",
                signedAt: row.checklist.hmSignedAt,
              }
            : null
        }
      />
    </article>
  );
}
