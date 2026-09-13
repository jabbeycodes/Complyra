import { useState } from "react";
import { Download } from "lucide-react";
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
import LifepathDelegationForm from "./LifepathDelegationForm";
import ImprovedDelegationForm from "./ImprovedDelegationForm";
import SignaturePad from "../SignaturePad";

/**
 * Delegation detail view: template toggle (rendering only), form editing,
 * RN-first signing, roster row signing/rescinding, and PDF export.
 * One underlying delegation record — the toggle never forks the data.
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
  const [template, setTemplate] = useState<"lifepath_exact" | "complyrer_improved" | null>(null);
  const [editing, setEditing] = useState(false);
  const [signingRow, setSigningRow] = useState<number | null>(null);
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
  const tpl = template ?? form.templateVersion;
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

  async function downloadPdf(obligationId: string, kind: "exact" | "improved") {
    setPdfBusy(true);
    setError("");
    try {
      const { blob, name } = await api.getDelegationPdf({ obligationId, kind });
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
        <div className="delegation-toggle" role="tablist" aria-label="Template">
          {(["exact", "improved"] as const).map((kind) => {
            const version = kind === "exact" ? "lifepath_exact" : "complyrer_improved";
            return (
              <button
                key={kind}
                role="tab"
                aria-selected={tpl === version}
                className={tpl === version ? "active" : ""}
                onClick={() => setTemplate(version)}
              >
                {kind === "exact" ? "LifePath exact" : "Complyrer improved"}
              </button>
            );
          })}
        </div>
        <div className="chart-actions">
          <Badge
            status={status.rescinded ? "Off" : status.fullySigned ? "Current" : "Pending"}
          />
          <span className="delegation-small">
            {status.rowsSigned}/{status.rowsNamed} staff signed
          </span>
          <button className="button" disabled={pdfBusy} onClick={() => downloadPdf(item.id, "exact")}>
            <Download size={14} /> Exact PDF
          </button>
          <button className="button" disabled={pdfBusy} onClick={() => downloadPdf(item.id, "improved")}>
            <Download size={14} /> Improved PDF
          </button>
        </div>
      </div>
      <p className="stack-help">
        The template toggle changes rendering only — one record underneath. The LifePath exact
        view mirrors the paper form; the Complyrer improved view adds the review date, inspection
        cadence, and competency checks the paper form omits.
      </p>

      {tpl === "lifepath_exact" ? (
        <LifepathDelegationForm
          individualName={person?.name ?? ""}
          dmhId=""
          location={person?.site ?? ""}
          taskTitle={item.title}
          form={form}
          rnSignatureLine={rnSignatureLine}
        />
      ) : (
        <ImprovedDelegationForm
          individualName={person?.name ?? ""}
          location={person?.site ?? ""}
          taskTitle={item.title}
          form={form}
          rnSignatureLine={rnSignatureLine}
        />
      )}

      {editor && (
        <div className="delegation-actions">
          <button className="button" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close form editor" : "Edit form details"}
          </button>
        </div>
      )}
      {editing && editor && (
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

      <RnSignBlock
        itemId={item.id}
        rnSignedAt={item.rnSignedAt}
        canSign={rnSigner && !item.rnSignedAt}
        onSign={(name, mark) =>
          run(async () => {
            await api.signDelegationRn(item.id, name, mark);
            await api.updateDelegationForm({
              obligationId: item.id,
              patch: {
                delegatingRn: {
                  name,
                  signatureName: name,
                  dateSigned: new Date().toISOString().slice(0, 10),
                },
              },
            });
          })
        }
      />

      <RosterBlock
        form={form}
        editor={editor}
        rnSigned={Boolean(item.rnSignedAt)}
        signingRow={signingRow}
        onSigningRow={setSigningRow}
        onSign={(rowIndex, signatureName, signatureMark, initials) =>
          run(async () => {
            await api.signDelegationRow({
              obligationId: item.id,
              rowIndex,
              signatureName,
              signatureMark,
              initials,
            });
            setSigningRow(null);
          })
        }
        onRescind={(rowIndex, rescindedDate) =>
          run(() => api.rescindDelegationRow({ obligationId: item.id, rowIndex, rescindedDate }))
        }
        onSaveRoster={(roster) =>
          run(() => api.updateDelegationForm({ obligationId: item.id, patch: { roster } }))
        }
      />
    </Modal>
  );
}

function RnSignBlock({
  itemId,
  rnSignedAt,
  canSign,
  onSign,
}: {
  itemId: string;
  rnSignedAt: string | null;
  canSign: boolean;
  onSign: (name: string, mark: string) => void;
}) {
  const [name, setName] = useState("");
  const [mark, setMark] = useState("");
  if (rnSignedAt) return null;
  if (!canSign) {
    return <p className="stack-help">Waiting on the delegating RN signature — staff sign after.</p>;
  }
  return (
    <form
      className="panel delegation-sign-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSign(name, mark);
      }}
    >
      <h4>Delegating RN signature (signs first)</h4>
      <label>
        Legal name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Andrea Murdock, RN" />
      </label>
      <SignaturePad onChange={setMark} />
      <button className="button" type="submit" disabled={!name.trim() || !mark} data-testid={`rn-sign-${itemId}`}>
        Sign as delegating RN
      </button>
    </form>
  );
}

function RosterBlock({
  form,
  editor,
  rnSigned,
  signingRow,
  onSigningRow,
  onSign,
  onRescind,
  onSaveRoster,
}: {
  form: DelegationForm;
  editor: boolean;
  rnSigned: boolean;
  signingRow: number | null;
  onSigningRow: (i: number | null) => void;
  onSign: (rowIndex: number, name: string, mark: string, initials: string) => void;
  onRescind: (rowIndex: number, date: string) => void;
  onSaveRoster: (roster: DelegationRosterRow[]) => void;
}) {
  const [draft, setDraft] = useState<DelegationRosterRow[] | null>(null);
  const [editingRoster, setEditingRoster] = useState(false);
  const rows = draft ?? form.roster;
  return (
    <section className="panel">
      <h4>Employee roster</h4>
      {editor && (
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
            <th>Rescinded</th>
            <th>Actions</th>
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
                {row.signedAt ? (
                  <>
                    {row.signatureName} ({row.initials})
                    <br />
                    <span className="delegation-small">{formatDate(row.signedAt)}</span>
                  </>
                ) : signingRow === i ? (
                  <RowSignForm
                    onCancel={() => onSigningRow(null)}
                    onSubmit={(name, mark, initials) => onSign(i, name, mark, initials)}
                  />
                ) : (
                  <span className="delegation-small">Unsigned</span>
                )}
              </td>
              <td>
                {row.rescindedDate ? (
                  formatDate(row.rescindedDate)
                ) : editor && row.printName ? (
                  <RescindRowInput onRescind={(date) => onRescind(i, date)} />
                ) : (
                  "—"
                )}
              </td>
              <td>
                {!row.signedAt && signingRow !== i && row.printName.trim() && (
                  <button
                    className="button"
                    disabled={!rnSigned}
                    title={rnSigned ? "Sign this row" : "The delegating RN must sign first"}
                    onClick={() => onSigningRow(i)}
                  >
                    Sign
                  </button>
                )}
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

function RowSignForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, mark: string, initials: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [mark, setMark] = useState("");
  const [initials, setInitials] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name, mark, initials);
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Legal name" aria-label="Legal name" />
      <SignaturePad onChange={setMark} />
      <input
        value={initials}
        onChange={(e) => setInitials(e.target.value)}
        placeholder="Initials"
        aria-label="Initials"
        maxLength={4}
      />
      <div className="chart-actions">
        <button className="button primary" type="submit" disabled={!name.trim() || !mark || !initials.trim()}>
          Sign row
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
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
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Rescinded date" />
      <button className="button" type="submit" disabled={!date}>
        Rescind
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
      <label>
        Purpose of task
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
      </label>
      <div className="delegation-grid2">
        <label>
          PROCEDURES / steps to follow
          <textarea value={procedures} onChange={(e) => setProcedures(e.target.value)} rows={4} />
        </label>
        <label>
          What to OBSERVE / REPORT / DO / CONTACT
          <textarea value={observeReportDo} onChange={(e) => setObserveReportDo(e.target.value)} rows={4} />
        </label>
      </div>
      <label className="delegation-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Staff
        acknowledge this delegation is specific to this individual and non-transferable
      </label>
      <div className="delegation-grid2">
        <label>
          Inspection interval (as determined by delegating RN)
          <input value={inspectionInterval} onChange={(e) => setInspectionInterval(e.target.value)} />
        </label>
        <label>
          Inspection cadence (improved)
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
      <label>
        Review / expiry date (improved — the paper form prints none)
        <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
      </label>
      <h4>Instructional licensed medical professional</h4>
      <div className="delegation-grid3">
        <label>
          Printed name
          <input value={profName} onChange={(e) => setProfName(e.target.value)} />
        </label>
        <label>
          Signature and title
          <input value={profTitle} onChange={(e) => setProfTitle(e.target.value)} />
        </label>
        <label>
          Contact number
          <input value={profContact} onChange={(e) => setProfContact(e.target.value)} />
        </label>
      </div>
      <h4>Delegating RN</h4>
      <div className="delegation-grid2">
        <label>
          Name
          <input value={rnName} onChange={(e) => setRnName(e.target.value)} />
        </label>
        <label>
          Contact number
          <input value={rnContact} onChange={(e) => setRnContact(e.target.value)} />
        </label>
      </div>
      <h4>Task rescinded</h4>
      <div className="delegation-grid2">
        <label>
          Reason
          <select value={rescindReason} onChange={(e) => setRescindReason(e.target.value)}>
            <option value="">Not rescinded</option>
            <option value="health_status_change">Change in health status</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
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
