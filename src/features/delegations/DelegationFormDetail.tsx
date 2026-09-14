import { useState } from "react";
import { Download, LockKeyhole } from "lucide-react";
import { Badge, formatDate, Modal } from "../../components";
import { useData } from "../../data/DataProvider";
import { openPrintable } from "../../data/openFile";
import {
  canSignAsDelegatingRn,
  canToggleDelegation,
} from "../../data/planStack";
import { can } from "../../data/status";
import {
  blankDelegationForm,
  DELEGATION_COMPETENCY_ITEMS,
  DELEGATION_INSPECTION_CADENCES,
  delegationFormStatus,
  type DelegationForm,
  type DelegationRosterRow,
} from "../../data/types";
import ImprovedDelegationForm from "./ImprovedDelegationForm";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { InitialsField, SignatureField } from "../signatures/SignatureField";
import {
  delegationFormPayload,
  delegationRowInitialsPayload,
} from "../signatures/documentPayloads";
import { delegationRosterRowKey } from "../signatures/signatureUtils";

/**
 * Delegation detail view: Complyrer's own form rendering, form editing,
 * RN-first signing, roster row signing/rescinding, and PDF export.
 * One record, one view.
 */
export default function DelegationFormDetail({
  obligationId,
  onClose,
}: {
  obligationId: string;
  onClose: () => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const view = workspace?.planStacks
    .flatMap((stack) => stack.required)
    .find((entry) => entry.item.id === obligationId);
  const item = view?.item;
  const person = workspace?.individuals.find((p) => p.id === item?.individualId);

  if (!session || !item) return null;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const form: DelegationForm = item.delegationForm ?? blankDelegationForm();
  const status = delegationFormStatus(form);
  const editor = canToggleDelegation(
    session.roleKey,
    session.role,
    can(session, "requirements.approve"),
  );
  const rnSigner = canSignAsDelegatingRn(session.roleKey, session.role);
  const rnSignatureLine = item.rnSignedAt
    ? `${item.rnSignatureName ?? "Signed"} · ${formatDate(item.rnSignedAt)}`
    : null;
  // A signed form is read-only until a formal correction flow: hide every
  // content-editing control (the API enforces the same lock server-side).
  const signed =
    Boolean(item.rnSignedAt) || form.roster.some((row) => row.signedAt);

  async function downloadPdf(obligationId: string) {
    setPdfBusy(true);
    setError("");
    try {
      const { blob, name } = await api.getDelegationPdf({ obligationId });
      await openPrintable(name, blob, "download");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <Modal title={`Delegation — ${item.title}`} onClose={onClose} wide>
      {error && <p className="form-error">{error}</p>}
      <div className="delegation-toolbar">
        <div className="chart-actions">
          <Badge
            status={status.rescinded ? "Off" : status.fullySigned ? "Current" : "Pending"}
          />
          <span className="delegation-small">
            {status.rowsSigned}/{status.rowsNamed} staff signed
          </span>
          <button className="button" disabled={pdfBusy} onClick={() => downloadPdf(item.id)}>
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>

      <ImprovedDelegationForm
        individualName={person?.name ?? ""}
        location={person?.site ?? ""}
        taskTitle={item.title}
        form={form}
        rnSignatureLine={rnSignatureLine}
      />

      {editor && !signed && (
        <div className="delegation-actions">
          <button className="button" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close form editor" : "Edit form details"}
          </button>
        </div>
      )}
      {signed && (
        <p className="quiet-note">
          <LockKeyhole size={14} /> This form is signed and read-only. Contact an
          administrator about the formal correction process to make changes.
        </p>
      )}
      {editing && editor && !signed && (
        <FormEditor
          form={form}
          onSave={(patch) =>
            run(async () => {
              await api.updateDelegationForm({ obligationId: item.id, patch });
              setEditing(false);
            })
          }
        />
      )}

      <SignatureField
        documentType="delegation_form"
        documentId={item.id}
        fieldName="rn_signature"
        label="Delegating RN signature (signs first)"
        getDocumentPayload={() =>
          delegationFormPayload({
            obligationId: item.id,
            individualName: person?.name ?? "",
            taskTitle: item.title,
            form,
          })
        }
        canAct={rnSigner}
        cantActReason="Waiting on the delegating RN signature — staff sign after."
        legacySigned={
          item.rnSignedAt
            ? {
                signerName: item.rnSignatureName ?? "Signed",
                signedAt: item.rnSignedAt,
              }
            : null
        }
      />

      <RosterBlock
        obligationId={item.id}
        individualName={person?.name ?? ""}
        taskTitle={item.title}
        form={form}
        editor={editor}
        rnSigned={Boolean(item.rnSignedAt)}
        signed={signed}
        onRescind={(rowIndex, rescindedDate) =>
          run(() => api.rescindDelegationRow({ obligationId: item.id, rowIndex, rescindedDate }))
        }
        onSaveRoster={(roster) =>
          run(() => api.updateDelegationForm({ obligationId: item.id, patch: { roster } }))
        }
      />

      <ComplyrerRecordMark documentId={item.id} generatedAt={item.rnSignedAt} />
    </Modal>
  );
}

function RosterBlock({
  obligationId,
  individualName,
  taskTitle,
  form,
  editor,
  rnSigned,
  signed,
  onRescind,
  onSaveRoster,
}: {
  obligationId: string;
  individualName: string;
  taskTitle: string;
  form: DelegationForm;
  editor: boolean;
  rnSigned: boolean;
  /** Any signature event exists: the form is read-only. */
  signed: boolean;
  onRescind: (rowIndex: number, date: string) => void;
  onSaveRoster: (roster: DelegationRosterRow[]) => void;
}) {
  const { session } = useData();
  const [draft, setDraft] = useState<DelegationRosterRow[] | null>(null);
  const [editingRoster, setEditingRoster] = useState(false);
  const rows = draft ?? form.roster;
  const myName = (session?.fullName ?? "").trim().toLowerCase();
  return (
    <section className="panel">
      <h4>Employee roster</h4>
      {editor && !signed && (
        <div className="chart-actions">
          <button
            className="button"
            onClick={() => {
              setDraft(form.roster.map((r) => ({ ...r, competency: [...r.competency] })));
              setEditingRoster((v) => !v);
            }}
          >
            {editingRoster ? "Cancel roster edit" : "Edit roster names"}
          </button>
          {editingRoster && (
            <button
              className="button primary"
              onClick={() => {
                if (draft) onSaveRoster(draft);
                setEditingRoster(false);
                setDraft(null);
              }}
            >
              Save roster
            </button>
          )}
        </div>
      )}
      <table className="delegation-table">
        <thead>
          <tr>
            <th>Print name / title</th>
            <th>Signature</th>
            <th>Training date</th>
            <th>Initials</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                {editingRoster ? (
                  <>
                    <input
                      aria-label={`Row ${i + 1} name`}
                      value={row.printName}
                      placeholder="Print name"
                      onChange={(e) =>
                        setDraft((d) =>
                          d!.map((r, j) => (j === i ? { ...r, printName: e.target.value } : r)),
                        )
                      }
                    />
                    <input
                      aria-label={`Row ${i + 1} title`}
                      value={row.title}
                      placeholder="Title"
                      onChange={(e) =>
                        setDraft((d) =>
                          d!.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                        )
                      }
                    />
                    <div className="delegation-competency-edit">
                      {DELEGATION_COMPETENCY_ITEMS.map((item) => (
                        <label key={item}>
                          <input
                            type="checkbox"
                            checked={row.competency.includes(item)}
                            onChange={(e) =>
                              setDraft((d) =>
                                d!.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        competency: e.target.checked
                                          ? [...r.competency, item]
                                          : r.competency.filter((c) => c !== item),
                                      }
                                    : r,
                                ),
                              )
                            }
                          />{" "}
                          {item}
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {row.printName || <span className="delegation-small">—</span>}
                    {row.title ? ` — ${row.title}` : ""}
                    {row.competency.length > 0 && (
                      <div className="delegation-small">✓ {row.competency.length} competency items</div>
                    )}
                  </>
                )}
              </td>
              <td>
                {(() => {
                  const rowName = row.printName.trim();
                  const isMine = rowName.length > 0 && rowName.toLowerCase() === myName;
                  return (
                    <SignatureField
                      compact
                      documentType="delegation_form"
                      documentId={obligationId}
                      fieldName={`row:${i}`}
                      label={`Row ${i + 1} signature`}
                      getDocumentPayload={() =>
                        delegationFormPayload({
                          obligationId,
                          individualName,
                          taskTitle,
                          form,
                        })
                      }
                      canAct={rnSigned && isMine}
                      cantActReason={
                        row.signedAt
                          ? undefined
                          : !rnSigned
                            ? "The delegating RN must sign first."
                            : "Unsigned"
                      }
                      legacySigned={
                        row.signedAt
                          ? {
                              signerName: row.signatureName || rowName || "Signed",
                              signedAt: row.signedAt,
                            }
                          : null
                      }
                    />
                  );
                })()}
              </td>
              <td>
                {row.rescindedDate ? (
                  formatDate(row.rescindedDate)
                ) : editor && !signed && row.printName ? (
                  <RescindRowInput onRescind={(date) => onRescind(i, date)} />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {(() => {
                  // The paper roster's "Initials" column: a staff member's
                  // acknowledgment of the training/competency statement above
                  // the roster. Keyed by printed name, not the array index.
                  // No legacySigned stamp: in the typed-name era initials were
                  // captured together with the row signature, so a separate
                  // legacy initials mark never existed.
                  const rowName = row.printName.trim();
                  const isMine =
                    rowName.length > 0 && rowName.toLowerCase() === myName;
                  const rowKey = delegationRosterRowKey(row.printName);
                  return (
                    <InitialsField
                      compact
                      documentType="delegation_form"
                      documentId={obligationId}
                      fieldName={rowKey}
                      label={`Row ${i + 1} initials`}
                      getDocumentPayload={() =>
                        delegationRowInitialsPayload({
                          obligationId,
                          individualName,
                          taskTitle,
                          form,
                          rowKey,
                        })
                      }
                      canAct={rnSigned && isMine}
                      cantActReason={
                        !rnSigned
                          ? "The delegating RN must sign first."
                          : "Unsigned"
                      }
                    />
                  );
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rnSigned && (
        <p className="stack-help">Staff rows unlock for signing once the delegating RN signs.</p>
      )}
    </section>
  );
}

function RescindRowInput({ onRescind }: { onRescind: (date: string) => void }) {
  const [date, setDate] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (date) onRescind(date);
      }}
      className="delegation-inline"
    >
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Training date" />
      <button className="button" type="submit" disabled={!date}>
        Set date
      </button>
    </form>
  );
}

function FormEditor({
  form,
  onSave,
}: {
  form: DelegationForm;
  onSave: (patch: import("../../data/types").DelegationFormPatch) => void;
}) {
  const [purpose, setPurpose] = useState(form.purpose);
  const [procedures, setProcedures] = useState(form.procedures);
  const [observeReportDo, setObserveReportDo] = useState(form.observeReportDo);
  const [ack, setAck] = useState(form.nonTransferableAcknowledged);
  const [inspectionInterval, setInspectionInterval] = useState(form.inspectionInterval);
  const [reviewDate, setReviewDate] = useState(form.reviewDate ?? "");
  const [inspectionCadence, setInspectionCadence] = useState(form.inspectionCadence ?? "");
  const [profName, setProfName] = useState(form.instructingProfessional.name);
  const [profTitle, setProfTitle] = useState(form.instructingProfessional.title);
  const [profContact, setProfContact] = useState(form.instructingProfessional.contactNumber);
  const [rnName, setRnName] = useState(form.delegatingRn.name);
  const [rnContact, setRnContact] = useState(form.delegatingRn.contactNumber);
  const [rescindReason, setRescindReason] = useState(form.rescindReason ?? "");
  const [rescindExplanation, setRescindExplanation] = useState(form.rescindExplanation);
  return (
    <form
      className="panel delegation-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          purpose,
          procedures,
          observeReportDo,
          nonTransferableAcknowledged: ack,
          inspectionInterval,
          reviewDate: reviewDate || null,
          inspectionCadence: inspectionCadence || null,
          instructingProfessional: {
            name: profName,
            title: profTitle,
            contactNumber: profContact,
          },
          delegatingRn: { name: rnName, contactNumber: rnContact },
          rescindReason: (rescindReason || null) as DelegationForm["rescindReason"],
          rescindExplanation,
        });
      }}
    >
      <h4>Form details</h4>
      <label className="form-label">
        Purpose of task
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
      </label>
      <div className="delegation-grid2">
        <label className="form-label">
          PROCEDURES / steps to follow
          <textarea value={procedures} onChange={(e) => setProcedures(e.target.value)} rows={4} />
        </label>
        <label className="form-label">
          What to OBSERVE / REPORT / DO / CONTACT
          <textarea value={observeReportDo} onChange={(e) => setObserveReportDo(e.target.value)} rows={4} />
        </label>
      </div>
      <label className="delegation-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Staff
        acknowledge this delegation is specific to this individual and non-transferable
      </label>
      <div className="delegation-grid2">
        <label className="form-label">
          Inspection interval (as determined by delegating RN)
          <input value={inspectionInterval} onChange={(e) => setInspectionInterval(e.target.value)} />
        </label>
        <label className="form-label">
          Inspection cadence
          <select value={inspectionCadence} onChange={(e) => setInspectionCadence(e.target.value)}>
            <option value="">Not set</option>
            {DELEGATION_INSPECTION_CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="form-label">
        Review / expiry date
        <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
      </label>
      <h4>Instructional licensed medical professional</h4>
      <div className="delegation-grid3">
        <label className="form-label">
          Printed name
          <input value={profName} onChange={(e) => setProfName(e.target.value)} />
        </label>
        <label className="form-label">
          Signature and title
          <input value={profTitle} onChange={(e) => setProfTitle(e.target.value)} />
        </label>
        <label className="form-label">
          Contact number
          <input value={profContact} onChange={(e) => setProfContact(e.target.value)} />
        </label>
      </div>
      <h4>Delegating RN</h4>
      <div className="delegation-grid2">
        <label className="form-label">
          Name
          <input value={rnName} onChange={(e) => setRnName(e.target.value)} />
        </label>
        <label className="form-label">
          Contact number
          <input value={rnContact} onChange={(e) => setRnContact(e.target.value)} />
        </label>
      </div>
      <h4>Task rescinded</h4>
      <div className="delegation-grid2">
        <label className="form-label">
          Reason
          <select value={rescindReason} onChange={(e) => setRescindReason(e.target.value)}>
            <option value="">Not rescinded</option>
            <option value="health_status_change">Change in health status</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="form-label">
          Explanation
          <input value={rescindExplanation} onChange={(e) => setRescindExplanation(e.target.value)} />
        </label>
      </div>
      <button className="button primary" type="submit">
        Save form details
      </button>
    </form>
  );
}
