import { useCallback, useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { useData } from "../../data/DataProvider";
import type {
  AdoptedSignature,
  SignableDocumentType,
  SignatureEvent,
} from "../../data/types";
import SignatureAdoption from "./SignatureAdoption";
import SignatureSeal from "./SignatureSeal";
import { formatSignatureDate } from "./signatureUtils";

interface BaseFieldProps {
  documentType: SignableDocumentType;
  documentId: string;
  fieldName: string;
  label: string;
  /** Builds the canonical signable CONTENT of the document (no signature fields). */
  getDocumentPayload: () => object;
  /** Hide the sign action entirely (e.g. the viewer may never sign this field). */
  canAct?: boolean;
  cantActReason?: string;
  /** Button label; "{name}" is replaced with the authenticated user's name. */
  actionLabel?: string;
  /**
   * Pre-e-signature signing record (typed-name era): rendered as a plain
   * stamp with name + date and no tamper seal.
   */
  legacySigned?: { signerName: string; signedAt: string } | null;
  /** Compact rendering for table cells. */
  compact?: boolean;
  onSigned?: () => void;
}

/**
 * Reusable e-signature field. Flow:
 *  1. No adopted signature -> "Adopt signature" opens the adoption screen.
 *  2. Adopted, field unsigned -> one "Sign as {name}" button.
 *  3. Signed -> read-only stamp: image + printed name + timestamp + seal.
 * The signer is ALWAYS the session user — the API enforces this server-side;
 * the client only renders.
 */
function BaseSignatureField({
  kind,
  documentType,
  documentId,
  fieldName,
  label,
  getDocumentPayload,
  canAct = true,
  cantActReason,
  actionLabel,
  legacySigned,
  compact,
  onSigned,
}: BaseFieldProps & { kind: "signature" | "initials" }) {
  const { api, session, refresh } = useData();
  const [loading, setLoading] = useState(true);
  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null);
  const [event, setEvent] = useState<SignatureEvent | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sig, events] = await Promise.all([
        api.getMySignature(),
        api.getSignatureEvents(documentType, documentId),
      ]);
      setAdopted(sig);
      setEvent(events.find((e) => e.fieldName === fieldName) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, documentType, documentId, fieldName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!session) return null;

  async function sign() {
    setError("");
    setBusy(true);
    try {
      await api.applySignature({
        documentType,
        documentId,
        fieldName,
        kind,
        documentPayload: getDocumentPayload(),
      });
      await reload();
      await refresh();
      onSigned?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const resolvedLabel = actionLabel
    ? actionLabel.replace("{name}", session.fullName)
    : kind === "signature"
      ? `Sign as ${session.fullName}`
      : `Initial as ${session.fullName}`;

  return (
    <div className={`sig-field ${compact ? "compact" : ""}`}>
      <span className="sig-field-label">{label}</span>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <p className="muted">Loading signature…</p>
      ) : event ? (
        <SigStamp
          event={event}
          kind={kind}
          documentType={documentType}
          documentId={documentId}
          fieldName={fieldName}
          getDocumentPayload={getDocumentPayload}
        />
      ) : legacySigned ? (
        <div className="sig-stamp">
          <span className="sig-stamp-fallback" aria-hidden>
            {legacySigned.signerName}
          </span>
          <div className="sig-stamp-meta">
            <strong>{legacySigned.signerName}</strong>
            <span className="muted">
              {formatSignatureDate(legacySigned.signedAt)}
            </span>
          </div>
          <p className="muted">Signed before tamper-evident signatures.</p>
        </div>
      ) : !canAct ? (
        cantActReason ? <p className="muted">{cantActReason}</p> : null
      ) : !adopted ? (
        <>
          <button
            type="button"
            className="button"
            onClick={() => setAdopting(true)}
          >
            <PenLine size={16} /> Adopt signature
          </button>
          <p className="muted">
            Adopt your electronic signature once, then sign as{" "}
            {session.fullName}.
          </p>
        </>
      ) : (
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void sign()}
        >
          <PenLine size={16} /> {busy ? "Signing…" : resolvedLabel}
        </button>
      )}
      {adopting && (
        <SignatureAdoption
          onClose={() => setAdopting(false)}
          onAdopted={() => {
            setAdopting(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function SigStamp({
  event,
  kind,
  documentType,
  documentId,
  fieldName,
  getDocumentPayload,
}: {
  event: SignatureEvent;
  kind: "signature" | "initials";
  documentType: string;
  documentId: string;
  fieldName: string;
  getDocumentPayload: () => object;
}) {
  const { api } = useData();
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await api.getSignatureImageUrl(
          `${event.userId}/${kind === "signature" ? "signature.png" : "initials.png"}`,
        );
        if (!cancelled) setImgUrl(url);
      } catch {
        if (!cancelled) setImgUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, event.userId, kind]);

  return (
    <div className="sig-stamp">
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={`${kind === "signature" ? "Signature" : "Initials"} of ${event.signerName}`}
          className="sig-stamp-img"
        />
      ) : (
        <span className="sig-stamp-fallback" aria-hidden>
          {event.signerName}
        </span>
      )}
      <div className="sig-stamp-meta">
        <strong>{event.signerName}</strong>
        <span className="muted">{formatSignatureDate(event.signedAt)}</span>
      </div>
      <SignatureSeal
        event={event}
        documentType={documentType}
        documentId={documentId}
        fieldName={fieldName}
        getDocumentPayload={getDocumentPayload}
      />
    </div>
  );
}

export function SignatureField(props: BaseFieldProps) {
  return <BaseSignatureField {...props} kind="signature" />;
}

export function InitialsField(props: BaseFieldProps) {
  return <BaseSignatureField {...props} kind="initials" />;
}
