import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import type { SignatureEvent } from "../../data/types";
import {
  formatSignatureDate,
  signatureDocumentHash,
} from "./signatureUtils";

/**
 * The invalid-seal alert text. It must NAME the document — "document
 * changed after signing" on its own leaves the reader hunting for which
 * of a chart's signed documents is meant (simulation expired-consent
 * check, 2026-11-02). Callers that know the document's title pass it;
 * the generic wording remains only as the fallback for call sites that
 * cannot name their document yet.
 */
export function signatureInvalidMessage(documentTitle?: string | null): string {
  const title = documentTitle?.trim();
  return title
    ? `Signature invalid — ${title} changed after signing`
    : "Signature invalid — document changed after signing";
}

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
  documentTitle,
}: {
  event: SignatureEvent;
  documentType: string;
  documentId: string;
  fieldName: string;
  getDocumentPayload: () => object;
  /** The document's display title, named in the invalid alert. */
  documentTitle?: string | null;
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
      {signatureInvalidMessage(documentTitle)}
    </span>
  );
}
