import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import type { SignatureEvent } from "../../data/types";
import {
  formatSignatureDate,
  signatureDocumentHash,
} from "./signatureUtils";

/**
 * Tamper-evidence seal: recomputes the document hash from the LIVE document
 * payload and compares it to the hash bound at signing time. Text + icon
 * signaling (never color alone).
 */
export default function SignatureSeal({
  event,
  documentType,
  documentId,
  fieldName,
  getDocumentPayload,
}: {
  event: SignatureEvent;
  documentType: string;
  documentId: string;
  fieldName: string;
  getDocumentPayload: () => object;
}) {
  const [verdict, setVerdict] = useState<"checking" | "valid" | "invalid">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recomputed = await signatureDocumentHash(
          documentType,
          documentId,
          fieldName,
          getDocumentPayload(),
        );
        if (!cancelled)
          setVerdict(recomputed === event.documentHash ? "valid" : "invalid");
      } catch {
        if (!cancelled) setVerdict("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, event.documentHash, documentType, documentId, fieldName]);

  if (verdict === "checking") {
    return <span className="sig-seal checking">Checking signature…</span>;
  }
  if (verdict === "valid") {
    return (
      <span className="sig-seal valid" role="status">
        <BadgeCheck size={16} aria-hidden />
        Signed by {event.signerName} · {formatSignatureDate(event.signedAt)} ·
        Verified — unchanged since signing
      </span>
    );
  }
  return (
    <span className="sig-seal invalid" role="alert">
      <AlertTriangle size={16} aria-hidden />
      Signature invalid — document changed after signing
    </span>
  );
}
