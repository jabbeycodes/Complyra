/**
 * New Hire Binder — Employee Hub tab (founder commission 2026-10-30).
 *
 * One binder per staff member: linked items (certificates, the training
 * checklist, document acknowledgments) derive live from their systems of
 * record; wallet documents are uploaded here and verified by HR.
 *
 * Modes:
 *  - Self: the signed-in staff member sees their own binder, uploads
 *    their documents, and jumps off to sign acknowledgments.
 *  - Team: viewers with hub.view_team (plus HR and auditors) can pick
 *    any staff member. Verification (verify / return with a note) is
 *    gated on certificates.manage — the same gate certificate writes
 *    use. Auditors are read-only: no upload, verify, or edit controls.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Pencil, RotateCcw, Upload } from "lucide-react";
import { useData } from "../../data/DataProvider";
import { todayIso } from "../../data/chart";
import type { ComplianceEvidence } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import { hasPermission } from "../../data/permissions";
import type { SessionUser } from "../../data/types";
import {
  BINDER_STATUS_LABELS,
  deriveBinder,
  type BinderDocument,
  type BinderEvidence,
  type BinderItemStatus,
  type DerivedBinder,
  type DerivedBinderItem,
  type EmergencyContactInput,
  type StaffBinder,
  type StaffEmergencyContact,
} from "../../data/newHireBinder";
import { summarizePerformanceRecords } from "../../data/performanceRecords";
import StaffCertificatesModal from "../certificates/StaffCertificatesModal";
import BinderDonut from "./BinderDonut";
import {
  binderDonutSegments,
  binderStatusCounts,
} from "./binderBoardStats";
import type { HubStaffEntry } from "../employeeHub/EmployeeHubPage";

const STATUS_BADGE: Record<BinderItemStatus, string> = {
  verified: "badge on-track",
  on_file: "badge on-track",
  due_soon: "badge due-soon",
  in_progress: "badge due-soon",
  missing: "badge overdue",
  returned: "badge overdue",
  expired: "badge expired",
  informational: "badge",
};

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function BinderTab({
  session,
  store,
  staffList,
  onJumpToTab,
  initialSubjectId,
  onOpenPerformance,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  onJumpToTab: (tabId: string) => void;
  /** Open on this staff member (the board's "Open binder" jump). */
  initialSubjectId?: string;
  /** Jump to the Performance tab for this staff member (build 3). */
  onOpenPerformance?: (staffId: string) => void;
}) {
  const { api } = useData();
  const isAuditor = session.roleKey === "auditor";
  const canViewTeam =
    hasPermission(session, "hub.view_team") ||
    session.roleKey === "hr" ||
    isAuditor;
  // Verification is gated to HR/admin, mirroring the certificate model:
  // the certificates.manage permission (HR by default, grantable) plus
  // the agency administrator and HR roles themselves.
  const canVerify =
    !isAuditor &&
    (hasPermission(session, "certificates.manage") ||
      session.roleKey === "administrator" ||
      session.roleKey === "hr");
  const canReadCerts =
    hasPermission(session, "certificates.manage") ||
    hasPermission(session, "hr.view_staff");
  const readOnly = isAuditor;

  const [subjectId, setSubjectId] = useState(initialSubjectId ?? session.userId);
  const subject = useMemo<HubStaffEntry>(
    () =>
      staffList.find((s) => s.userId === subjectId) ?? {
        userId: session.userId,
        fullName: session.fullName,
        email: "",
        roleKey: session.roleKey,
        siteId: null,
      },
    [staffList, subjectId, session],
  );
  const isSelf = subjectId === session.userId;
  const canUpload = !readOnly && (isSelf || canVerify || canViewTeam);

  const [binder, setBinder] = useState<StaffBinder | null>(null);
  const [derived, setDerived] = useState<DerivedBinder | null>(null);
  const [contact, setContact] = useState<StaffEmergencyContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [showCerts, setShowCerts] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState<EmergencyContactInput>({
    contactName: "",
    relationship: "",
    phone: "",
    alternatePhone: "",
  });
  const [obtainedDates, setObtainedDates] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [binderRow, wallet, contactRow, evidence, docs, acks, profile, perfReviews, perfActions] =
          await Promise.all([
            store.getBinder(subjectId, subject.roleKey),
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
        if (cancelled) return;
        const titleById = new Map(docs.map((d) => [d.id, d.title]));
        const bundle: BinderEvidence = {
          certificates: evidence.certs.map((c) => ({
            certName: c.name,
            expiresOn: c.expiresOn,
          })),
          trainingProfile: profile,
          documentAcks: acks
            .filter((a) => a.staffId === subjectId)
            .map((a) => ({
              docKey: titleById.get(a.docId) ?? a.docId,
              ackedAt: a.ackedAt,
            })),
          walletDocuments: wallet,
          emergencyContact: contactRow,
          performance: summarizePerformanceRecords(perfReviews, perfActions),
        };
        setBinder(binderRow);
        setContact(contactRow);
        setDerived(deriveBinder(binderRow, bundle, todayIso()));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the binder."));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, api, subjectId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const upload = (item: DerivedBinderItem, file: File) =>
    run(async () => {
      await store.uploadBinderDocument({
        staffId: subjectId,
        itemKey: item.item.key,
        file,
        obtainedOn: item.item.withObtainedDate
          ? obtainedDates[item.item.key] || null
          : null,
        uploaderName: session.fullName,
      });
    }, "Could not upload the document.");

  const verify = (doc: BinderDocument) =>
    run(async () => {
      await store.verifyBinderDocument(doc.id, session.fullName);
    }, "Could not verify the document.");

  const sendBack = (doc: BinderDocument) =>
    run(async () => {
      await store.returnBinderDocument(doc.id, returnNote);
      setReturningId(null);
      setReturnNote("");
    }, "Could not send the document back.");

  const viewFile = (doc: BinderDocument) =>
    run(async () => {
      const url = await store.getBinderDocumentFileUrl(doc.id);
      if (!url) {
        throw new Error("No viewable file is attached to this document yet.");
      }
      window.open(url, "_blank", "noopener");
    }, "Could not open the file.");

  const saveContact = () =>
    run(async () => {
      await store.saveEmergencyContact(subjectId, contactForm);
      setEditingContact(false);
    }, "Could not save the emergency contact.");

  const openContactEditor = () => {
    setContactForm({
      contactName: contact?.contactName ?? "",
      relationship: contact?.relationship ?? "",
      phone: contact?.phone ?? "",
      alternatePhone: contact?.alternatePhone ?? "",
    });
    setEditingContact(true);
  };

  const renderItemActions = (row: DerivedBinderItem) => {
    const item = row.item;
    if (item.kind === "document") {
      const doc = row.document;
      return (
        <div className="binder-actions">
          {doc && (
            <button
              className="hub-btn"
              disabled={busy}
              onClick={() => viewFile(doc)}
            >
              <Eye size={15} /> View file
            </button>
          )}
          {doc?.status === "on_file" && canVerify && (
            <>
              <button
                className="hub-btn primary"
                disabled={busy}
                onClick={() => verify(doc)}
              >
                <Check size={15} /> Verify
              </button>
              <button
                className="hub-btn"
                disabled={busy}
                onClick={() => {
                  setReturningId(returningId === doc.id ? null : doc.id);
                  setReturnNote("");
                }}
              >
                <RotateCcw size={15} /> Return
              </button>
            </>
          )}
          {canUpload && (
            <>
              {item.withObtainedDate && (
                <label className="binder-obtained">
                  Obtained
                  <input
                    type="date"
                    value={obtainedDates[item.key] ?? doc?.obtainedOn ?? ""}
                    onChange={(e) =>
                      setObtainedDates((prev) => ({
                        ...prev,
                        [item.key]: e.target.value,
                      }))
                    }
                  />
                </label>
              )}
              <label className="hub-btn binder-upload">
                <Upload size={15} /> {doc ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(row, file);
                  }}
                />
              </label>
            </>
          )}
        </div>
      );
    }
    if (item.kind === "certificate" && canReadCerts) {
      return (
        <div className="binder-actions">
          <button className="hub-btn" onClick={() => setShowCerts(true)}>
            <Eye size={15} /> Certificates of record
          </button>
        </div>
      );
    }
    if (item.kind === "acknowledgment" && !row.satisfied && isSelf && !readOnly) {
      return (
        <div className="binder-actions">
          <button className="hub-btn" onClick={() => onJumpToTab("documents")}>
            Open Documents to sign
          </button>
        </div>
      );
    }
    if (item.kind === "records" && onOpenPerformance) {
      return (
        <div className="binder-actions">
          <button
            className="hub-btn"
            onClick={() => onOpenPerformance(subjectId)}
          >
            <Eye size={15} /> Open Performance
          </button>
        </div>
      );
    }
    if (item.kind === "profile" && !readOnly && (isSelf || canVerify || canViewTeam)) {
      return (
        <div className="binder-actions">
          <button className="hub-btn" onClick={openContactEditor}>
            <Pencil size={15} /> {contact ? "Edit contact" : "Add contact"}
          </button>
        </div>
      );
    }
    return null;
  };

  return (
    <section className="hub-card" aria-label="New hire binder">
      <div className="hub-row">
        <div>
          <h2>New Hire Binder</h2>
          <p className="hub-sub">
            {isSelf
              ? "Your new hire file — everything HR needs, in one place."
              : `${subject.fullName}'s new hire file.`}{" "}
            Certificates, training, and policy signatures update from their
            own records; wallet documents are verified by HR.
          </p>
        </div>
        {canViewTeam && (
          <label className="binder-subject">
            Staff member
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {staffList.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.fullName}
                  {s.userId === session.userId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div className="hub-error" role="alert">
          {error}
        </div>
      )}

      {loading || !derived || !binder ? (
        <p>Loading binder…</p>
      ) : (
        <>
          <div className="binder-head">
            <BinderDonut
              segments={binderDonutSegments(binderStatusCounts(derived))}
              total={derived.totalItems}
              percent={derived.percentComplete}
              variant="mini"
              label={`${subject.fullName}'s binder`}
            />
            <div className="binder-percent">
              <strong>{derived.percentComplete}%</strong>
              <span>
                complete — {derived.satisfiedItems} of {derived.totalItems}{" "}
                items
              </span>
            </div>
            {derived.awaitingVerification > 0 && (
              <p className="binder-awaiting">
                {derived.awaitingVerification} document
                {derived.awaitingVerification === 1 ? "" : "s"} awaiting HR
                verification
              </p>
            )}
            {derived.optionalItems > 0 && (
              <p className="binder-awaiting">
                Plus {derived.optionalItems} optional item
                {derived.optionalItems === 1 ? "" : "s"} — tracked, not
                counted above
              </p>
            )}
            {readOnly && <p className="binder-awaiting">Read-only — auditor view</p>}
          </div>

          {derived.sections.map(({ section, items, satisfied, total, optional, informational }) => (
            <div className="binder-section" key={section.key}>
              <h3>
                {section.title}
                <span className="binder-section-count">
                  {informational > 0
                    ? "File records — not counted in completeness"
                    : `${satisfied} of ${total} complete${
                        optional > 0 ? ` · ${optional} optional` : ""
                      }`}
                </span>
              </h3>
              <ul className="hub-list">
                {items.map((row) => (
                  <li className="hub-list-item" key={row.item.key}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">
                        {row.item.label}
                        {!row.required && row.item.kind !== "records" && (
                          <span className="binder-optional-tag">Optional</span>
                        )}
                      </span>
                      <span className="hub-item-sub">{row.note}</span>
                      {row.document && (
                        <span className="hub-item-sub">
                          {row.document.fileName} · uploaded by{" "}
                          {row.document.uploadedByName}
                        </span>
                      )}
                      {row.document && returningId === row.document.id && (
                        <span className="binder-return-form">
                          <input
                            value={returnNote}
                            onChange={(e) => setReturnNote(e.target.value)}
                            placeholder="What needs fixing?"
                            aria-label="Return note"
                          />
                          <button
                            className="hub-btn primary"
                            disabled={busy || !returnNote.trim()}
                            onClick={() => row.document && sendBack(row.document)}
                          >
                            Send back
                          </button>
                        </span>
                      )}
                    </div>
                    <span className={STATUS_BADGE[row.status]}>
                      {BINDER_STATUS_LABELS[row.status]}
                    </span>
                    {renderItemActions(row)}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {editingContact && (
            <div className="hub-inline-form">
              <h3>Emergency contact</h3>
              <div className="hub-form">
                <label>
                  Contact name
                  <input
                    value={contactForm.contactName}
                    onChange={(e) =>
                      setContactForm((f) => ({ ...f, contactName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Relationship
                  <input
                    value={contactForm.relationship}
                    onChange={(e) =>
                      setContactForm((f) => ({ ...f, relationship: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={contactForm.phone}
                    onChange={(e) =>
                      setContactForm((f) => ({ ...f, phone: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Alternate phone (optional)
                  <input
                    value={contactForm.alternatePhone ?? ""}
                    onChange={(e) =>
                      setContactForm((f) => ({
                        ...f,
                        alternatePhone: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="hub-form-actions">
                <button className="hub-btn primary" disabled={busy} onClick={saveContact}>
                  <Check size={16} /> Save contact
                </button>
                <button className="hub-btn" onClick={() => setEditingContact(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showCerts && (
        <StaffCertificatesModal
          staffName={subject.fullName}
          userId={subjectId}
          onClose={() => setShowCerts(false)}
        />
      )}
    </section>
  );
}
