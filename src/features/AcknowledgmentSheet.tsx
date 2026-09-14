import { useState } from "react";
import {
  Check,
  Download,
  FileText,
  LockKeyhole,
  PenLine,
} from "lucide-react";
import { Badge, formatDate } from "../components";
import { useData } from "../data/DataProvider";
import { useStepUpContext } from "../security/useStepUp";
import { can, isPrivileged } from "../data/status";
import type { PacketDetail } from "../data/types";
import {
  buildAcknowledgmentPdf,
  packetFileName,
  sortAcknowledgmentRows,
} from "../pdf/acknowledgmentPdf";
import SignaturePad from "./SignaturePad";
import ComplyrerRecordMark from "../components/ComplyrerRecordMark";

export default function AcknowledgmentSheet({
  detail,
  onClose,
}: {
  detail: PacketDetail;
  onClose: () => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const { requireStepUp } = useStepUpContext();
  const [error, setError] = useState("");
  const [legalName, setLegalName] = useState(session?.fullName ?? "");
  const [mark, setMark] = useState("");
  const [extraUser, setExtraUser] = useState(workspace?.staff[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const myRow = detail.rows.find((row) => row.userId === session?.userId);
  const canManage =
    session != null &&
    isPrivileged(session.role) &&
    can(session, "acknowledgments.manage");
  const unsigned = detail.rows.filter((row) => !row.signedAt).length;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="ack-sheet">
      <div className="ack-header">
        <Badge status={detail.packet.status === "open" ? "Open" : "Archived"} />
        <span>{detail.version.versionLabel}</span>
      </div>
      <h2 className="detail-title">{detail.packet.whatAcknowledging}</h2>
      <dl className="ack-meta">
        <div>
          <dt>Agency</dt>
          <dd>{session?.agencyName}</dd>
        </div>
        <div>
          <dt>Individual</dt>
          <dd>{detail.individual.fullName}</dd>
        </div>
        <div>
          <dt>Date of birth</dt>
          <dd>{formatDate(detail.individual.dateOfBirth)}</dd>
        </div>
        <div>
          <dt>Start date</dt>
          <dd>{formatDate(detail.packet.startsOn)}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>
            {detail.packet.endsOn ? formatDate(detail.packet.endsOn) : "—"}
          </dd>
        </div>
        <div>
          <dt>Still unsigned</dt>
          <dd>{unsigned}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Signature</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {sortAcknowledgmentRows(detail.rows).map((row) => (
              <tr key={row.id}>
                <td>
                  {row.staffName}
                  {row.addedManually ? (
                    <span className="cell-sub">Added for this sheet</span>
                  ) : null}
                </td>
                <td>{row.signedAt ? row.signatureName : "Pending"}</td>
                <td>
                  {row.signedAt
                    ? new Date(row.signedAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.version.storagePath && myRow && !myRow.signedAt && (
        <button
          className="button"
          onClick={() =>
            run(async () => {
              await api.markOpened(myRow.id);
              const file = await api.getDocumentFile(detail.version.id);
              if (file) {
                const url = URL.createObjectURL(file);
                window.open(url, "_blank", "noopener");
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }
            })
          }
        >
          <FileText size={16} /> Open PCSP to review
        </button>
      )}
      {myRow && !myRow.signedAt && detail.packet.status === "open" && (
        <div className="ack-sign">
          <h3 className="section-label">Your signature</h3>
          <p className="form-help">
            Review the plan first. Signing records your legal name, mark, and
            the time. Managers cannot sign this row for you.
          </p>
          <label className="form-label">
            Legal name
            <input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </label>
          <SignaturePad onChange={setMark} />
          <button
            className="button primary full"
            onClick={() =>
              run(() => api.signRow(myRow.id, legalName, mark))
            }
          >
            <PenLine size={16} /> Sign acknowledgment
          </button>
        </div>
      )}
      {myRow?.signedAt && (
        <div className="evidence-confirmed">
          <Check size={20} />
          <div>
            <strong>You signed this sheet</strong>
            <p>{new Date(myRow.signedAt).toLocaleString()}</p>
          </div>
        </div>
      )}
      {canManage && detail.packet.status === "open" && (
        <div className="ack-manage">
          <h3 className="section-label">Add a one-off signer</h3>
          <p className="form-help">
            Use this for a trainer or floater who must sign this version without
            changing their standing assignment.
          </p>
          <label className="form-label">
            Staff member
            <select
              value={extraUser}
              onChange={(e) => setExtraUser(e.target.value)}
            >
              {workspace?.staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Covering Maple House this week"
            />
          </label>
          <button
            className="button"
            onClick={() =>
              run(() => api.addPacketSigner(detail.packet.id, extraUser, reason))
            }
          >
            Add to this sheet
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {detail.packet.status !== "open" && (
          <span className="quiet-note">
            <LockKeyhole size={14} /> Archived sheets stay complete. A newer
            PCSP creates a new roster.
          </span>
        )}
        <button
          className="button primary"
          onClick={async () => {
            // HIPAA step-up: the acknowledgment sheet is an export. It is
            // generated client-side, so the export is logged here.
            if (!(await requireStepUp("export"))) return;
            const pdf = buildAcknowledgmentPdf(
              session?.agencyName ?? "Agency",
              detail,
              workspace?.branding.logoUrl,
            );
            pdf.save(packetFileName(detail));
            void api.logPhiAccess({
              action: "export",
              recordType: "workspace_export",
              recordId: `acknowledgment-sheet:${detail.packet.id}`,
              agencyId: session?.agencyId ?? null,
              details: { filename: packetFileName(detail) },
            });
          }}
        >
          <Download size={16} /> Export acknowledgment sheet
        </button>
        <button className="button" onClick={onClose}>
          Close
        </button>
      </div>
      <ComplyrerRecordMark documentId={detail.packet.id} />
    </div>
  );
}
