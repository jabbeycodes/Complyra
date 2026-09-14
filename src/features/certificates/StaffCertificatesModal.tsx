import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "../../components";
import { useData } from "../../data/DataProvider";
import { InitialsField } from "../signatures/SignatureField";
import { certificatePayload } from "../signatures/documentPayloads";
import {
  CERT_STATUS_CLASS,
  certCountdownLabel,
  certExpiryStatus,
  daysRemaining,
} from "../../data/certificates";
import type { StaffCertificate } from "../../data/types";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";

// LIFEPATH-P4 (certificates): the certificates section surfaced on the staff
// profile — cert name, issued/renewal dates, days-remaining countdown, and a
// download link for the attached file.

export default function StaffCertificatesModal({
  staffName,
  userId,
  onClose,
}: {
  staffName: string;
  userId: string;
  onClose: () => void;
}) {
  const { api, session } = useData();
  const [certs, setCerts] = useState<StaffCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listCertificates(userId);
        if (!cancelled) setCerts(list);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  async function downloadFile(cert: StaffCertificate) {
    try {
      const url = await api.certificateFileUrl(cert.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={`Certificates — ${staffName}`} onClose={onClose} wide>
      {loading ? (
        <p className="muted">Loading certificates…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : certs.length === 0 ? (
        <p className="muted">No certificates on file for {staffName}.</p>
      ) : (
        <div className="cert-list">
          {certs.map((cert) => {
            const remaining = daysRemaining(cert.expiresOn);
            return (
              <div className="cert-row" key={cert.id}>
                <div className="cert-row-main">
                  <strong>{cert.certName}</strong>
                  <span
                    className={CERT_STATUS_CLASS[certExpiryStatus(remaining)]}
                  >
                    {certCountdownLabel(remaining)}
                  </span>
                </div>
                <div className="cert-row-meta muted">
                  Issued {cert.issuedOn} · Renews {cert.expiresOn}
                  {cert.fileName && ` · ${cert.fileName}`}
                </div>
                {cert.filePath && (
                  <div className="cert-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => downloadFile(cert)}
                    >
                      <Download size={14} /> Download file
                    </button>
                  </div>
                )}
                <InitialsField
                  documentType="certificate"
                  documentId={cert.id}
                  fieldName="staff_ack"
                  label="Staff acknowledgment"
                  getDocumentPayload={() => certificatePayload(cert)}
                  canAct={session?.userId === cert.userId}
                />
              </div>
            );
          })}
        </div>
      )}
      <ComplyrerRecordMark />
    </Modal>
  );
}
