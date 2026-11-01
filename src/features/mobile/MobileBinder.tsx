import { useCallback, useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import type { ComplianceEvidence } from "../../data/hr";
import {
  BINDER_STATUS_LABELS,
  deriveBinder,
  type BinderEvidence,
  type DerivedBinder,
  type EmergencyContactInput,
  type StaffEmergencyContact,
} from "../../data/newHireBinder";
import { summarizePerformanceRecords } from "../../data/performanceRecords";
import { documentHasReadableContent } from "../../data/starterDocuments";
import { todayIso } from "../../data/chart";

/**
 * Mobile New Hire Binder — the signed-in staff member's own binder,
 * assembled exactly like the desktop Binder tab's self mode: linked
 * items derive live from their systems of record (certificates,
 * training profile, document acknowledgments), wallet documents are
 * uploaded here and verified by HR on the desktop board. The employee
 * sees each item's status in words — missing, on file (awaiting
 * verification), verified, returned with HR's note — and can replace a
 * document from the phone. Verification itself stays with HR
 * (certificates.manage) on the desktop board.
 */
export default function MobileBinder({
  api,
  store,
  session,
  onBack,
}: {
  api: ComplyraApi;
  store: HrStore;
  session: SessionUser;
  onBack: () => void;
}) {
  const [derived, setDerived] = useState<DerivedBinder | null>(null);
  const [contact, setContact] = useState<StaffEmergencyContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [obtainedDates, setObtainedDates] = useState<Record<string, string>>({});
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState<EmergencyContactInput>({
    contactName: "",
    relationship: "",
    phone: "",
    alternatePhone: "",
  });
  const subjectId = session.userId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [binderRow, wallet, contactRow, evidence, docs, acks, profile, perfReviews, perfActions] =
        await Promise.all([
          store.getBinder(subjectId, session.roleKey),
          store.listBinderDocuments(subjectId),
          store.getEmergencyContact(subjectId),
          store
            .getComplianceEvidence(subjectId)
            .catch(
              (): ComplianceEvidence => ({
                certs: [],
                trainings: [],
                delegations: [],
                docAcks: [],
              }),
            ),
          store.listDocuments().catch(() => []),
          store.listDocumentAcks().catch(() => []),
          api.getStaffTrainingProfile(subjectId).catch(() => null),
          store.listPerformanceReviews(subjectId).catch(() => []),
          store.listStaffCorrectiveActions(subjectId).catch(() => []),
        ]);
      const titleById = new Map(docs.map((doc) => [doc.id, doc.title]));
      const bundle: BinderEvidence = {
        certificates: evidence.certs.map((cert) => ({
          certName: cert.name,
          expiresOn: cert.expiresOn,
        })),
        trainingProfile: profile,
        documentAcks: acks
          .filter((ack) => ack.staffId === subjectId)
          .map((ack) => ({
            docKey: titleById.get(ack.docId) ?? ack.docId,
            ackedAt: ack.ackedAt,
          })),
        libraryDocuments: docs.map((doc) => ({
          title: doc.title,
          hasContent: documentHasReadableContent(doc),
        })),
        walletDocuments: wallet,
        emergencyContact: contactRow,
        performance: summarizePerformanceRecords(perfReviews, perfActions),
      };
      setDerived(deriveBinder(binderRow, bundle, todayIso()));
      setContact(contactRow);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your binder.");
    } finally {
      setLoading(false);
    }
  }, [api, store, subjectId, session.roleKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (itemKey: string, withObtainedDate: boolean, file: File) => {
    setBusy(true);
    setError("");
    try {
      await store.uploadBinderDocument({
        staffId: subjectId,
        itemKey,
        file,
        obtainedOn: withObtainedDate ? obtainedDates[itemKey] || null : null,
        uploaderName: session.fullName,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the document.");
    } finally {
      setBusy(false);
    }
  };

  const saveContact = async () => {
    setBusy(true);
    setError("");
    try {
      await store.saveEmergencyContact(subjectId, contactForm);
      setEditingContact(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the emergency contact.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">New Hire Binder</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="msh-empty">Loading your binder…</p>}
      {derived && (
        <>
          <p className="msh-status-text">
            {derived.percentComplete}% complete · {derived.satisfiedItems} of{" "}
            {derived.totalItems} required items satisfied
            {derived.awaitingVerification > 0
              ? ` · ${derived.awaitingVerification} awaiting verification`
              : ""}
          </p>
          {derived.sections.map((section) => (
            <div key={section.section.key}>
              <h4 className="msh-day-heading">{section.section.title}</h4>
              <div className="msh-list">
                {section.items.map((row) => {
                  const doc = row.document;
                  return (
                    <div key={row.item.key} className="msh-row static">
                      <span className="msh-row-main">
                        <strong>{row.item.label}</strong>
                        <small className="msh-status-text">
                          {BINDER_STATUS_LABELS[row.status]}
                          {row.required ? "" : " · Optional"}
                        </small>
                        {row.note && <small>{row.note}</small>}
                        {doc && (
                          <small>
                            {doc.fileName} · uploaded {doc.uploadedAt.slice(0, 10)}
                            {doc.status === "verified" &&
                              ` · Verified by ${doc.verifiedByName ?? "HR"} on ${doc.verifiedAt?.slice(0, 10) ?? ""}`}
                            {doc.status === "returned" &&
                              ` · Returned: ${doc.returnNote ?? "HR asked for a new copy"}`}
                            {doc.status === "on_file" &&
                              " · On file — awaiting verification"}
                          </small>
                        )}
                        {row.item.kind === "document" && (
                          <>
                            {row.item.withObtainedDate && (
                              <label className="msh-field">
                                <span>Obtained</span>
                                <input
                                  type="date"
                                  value={(obtainedDates[row.item.key] ?? doc?.obtainedOn) || ""}
                                  onChange={(event) =>
                                    setObtainedDates((prev) => ({
                                      ...prev,
                                      [row.item.key]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                            )}
                            <label className="msh-chip-button msh-upload-label">
                              {doc ? "Replace document" : "Upload document"}
                              <input
                                type="file"
                                accept="application/pdf,image/png,image/jpeg"
                                hidden
                                disabled={busy}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = "";
                                  if (file) {
                                    void upload(row.item.key, Boolean(row.item.withObtainedDate), file);
                                  }
                                }}
                              />
                            </label>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <h4 className="msh-day-heading">Emergency contact</h4>
          {!editingContact ? (
            <div className="msh-list">
              <div className="msh-row static">
                <span className="msh-row-main">
                  {contact ? (
                    <>
                      <strong>{contact.contactName}</strong>
                      <small>
                        {contact.relationship} · {contact.phone}
                        {contact.alternatePhone ? ` · ${contact.alternatePhone}` : ""}
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>No emergency contact on file</strong>
                      <small>Add one so the agency can reach your person.</small>
                    </>
                  )}
                  <span className="msh-row-actions">
                    <button
                      type="button"
                      className="msh-chip-button"
                      onClick={() => {
                        setContactForm({
                          contactName: contact?.contactName ?? "",
                          relationship: contact?.relationship ?? "",
                          phone: contact?.phone ?? "",
                          alternatePhone: contact?.alternatePhone ?? "",
                        });
                        setEditingContact(true);
                      }}
                    >
                      {contact ? "Update contact" : "Add contact"}
                    </button>
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <form
              className="msh-record-card"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void saveContact();
              }}
            >
              {(
                [
                  ["contactName", "Contact name"],
                  ["relationship", "Relationship"],
                  ["phone", "Phone"],
                  ["alternatePhone", "Alternate phone"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="msh-field">
                  <span>{label}</span>
                  <input
                    type="text"
                    required={key !== "alternatePhone"}
                    value={contactForm[key] ?? ""}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <div className="msh-form-actions">
                <button
                  type="button"
                  className="msh-button secondary"
                  onClick={() => setEditingContact(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="msh-button primary" disabled={busy}>
                  Save contact
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
