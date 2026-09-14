import { useEffect } from "react";
import { useData } from "../../data/DataProvider";
import type { SignableDocumentType } from "../../data/types";

/**
 * Session-level set of documents already view-logged. The hook used to keep
 * this in a per-component ref, but a document page renders many
 * <SignatureField>s — each one would log its own `document_viewed` for the
 * same document. The module-level set keeps the audit trail to one view
 * entry per document per user per session.
 */
const loggedDocuments = new Set<string>();

/**
 * 13 CSR 65-3.050: track signed-record views in the audit trail. Logs one
 * `document_viewed` event per session for a document that has at least one
 * signature event. Multiple signature fields on the same document page share
 * the session-level set, so re-renders and post-sign reloads do not spam the
 * trail with duplicates.
 */
export function useSignatureViewLog(
  documentType: SignableDocumentType,
  documentId: string,
  hasSignatureEvent: boolean,
) {
  const { api, session } = useData();
  useEffect(() => {
    if (!session || !hasSignatureEvent) return;
    const key = `${session.userId}:${documentType}:${documentId}`;
    if (loggedDocuments.has(key)) return;
    loggedDocuments.add(key);
    void api.logSignatureAudit({
      action: "document_viewed",
      documentType,
      documentId,
    });
  }, [api, session, documentType, documentId, hasSignatureEvent]);
}
