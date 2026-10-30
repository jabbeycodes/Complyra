import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import type { HrDocument, HrDocumentAck } from "../../data/hr";
import { myDocumentAck } from "./hub";

/**
 * Mobile Documents — the HR library from the Employee Hub's Documents
 * tab: handbooks, policies, and notices, with acknowledgment signing
 * from the phone. Signing is the desktop flow exactly — type your
 * full name, and the store records the acknowledgment
 * (acknowledgeDocument). Documents that do not require acknowledgment
 * are read-only here; document authoring stays with HR on the desktop
 * hub (hub.manage_documents).
 */
export default function MobileDocuments({
  store,
  session,
  onBack,
}: {
  store: HrStore;
  session: SessionUser;
  onBack: () => void;
}) {
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [acks, setAcks] = useState<HrDocumentAck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [signature, setSignature] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docRows, ackRows] = await Promise.all([
        store.listDocuments(),
        store.listDocumentAcks(),
      ]);
      setDocs(docRows);
      setAcks(ackRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (docId: string) => {
    setBusy(true);
    setError("");
    try {
      await store.acknowledgeDocument(docId, signature);
      setAckingId(null);
      setSignature("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the acknowledgment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">Documents</h3>
      <p className="msh-section-note">
        HR library — handbooks, policies, and notices.
      </p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="msh-empty">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="msh-empty">
          No HR documents yet. Documents added by your agency will appear
          here.
        </p>
      ) : (
        <div className="msh-list">
          {docs.map((doc) => {
            const ack = myDocumentAck(acks, doc.id, session.userId);
            return (
              <div key={doc.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>{doc.title}</strong>
                  <small className="msh-status-text">
                    {doc.category}
                    {doc.requiresAck
                      ? ack
                        ? " · Acknowledged"
                        : " · Requires acknowledgment"
                      : ""}
                  </small>
                  {doc.fileUrl && (
                    <small>
                      <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    </small>
                  )}
                  {doc.body && <small>{doc.body}</small>}
                  {ack ? (
                    <small>
                      Acknowledged by {ack.signatureName} on{" "}
                      {ack.ackedAt.slice(0, 10)}. Digital record generated
                      by Complyrer.
                    </small>
                  ) : doc.requiresAck ? (
                    ackingId === doc.id ? (
                      <>
                        <label className="msh-field">
                          <span>Type your full name to acknowledge</span>
                          <input
                            type="text"
                            value={signature}
                            onChange={(event) => setSignature(event.target.value)}
                            autoComplete="name"
                          />
                        </label>
                        <span className="msh-row-actions">
                          <button
                            type="button"
                            className="msh-chip-button"
                            disabled={busy || !signature.trim()}
                            onClick={() => void acknowledge(doc.id)}
                          >
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => setAckingId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="msh-row-actions">
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() => {
                            setAckingId(doc.id);
                            setSignature("");
                          }}
                        >
                          Acknowledge
                        </button>
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
