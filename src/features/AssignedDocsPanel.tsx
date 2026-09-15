import { useState } from "react";
import { Check, FileText, LockKeyhole, PenLine } from "lucide-react";
import { Badge, DueChip, formatDate } from "../components";
import { useData } from "../data/DataProvider";
import { can } from "../data/status";
import { canSignTrainingAsHm } from "../data/chart";
import { openPrintable } from "../data/openFile";
import {
  canEditCover,
  canEditExtraction,
  canSignAsDelegatingRn,
  canToggleDelegation,
  canUploadRenewal,
  isObligationActive,
  renewalBadge,
  staffCanSignDelegation,
  type ClinicalEvidenceKind,
  type ClinicalRenewalView,
  type IndividualProfile,
  type ObligationView,
} from "../data/planStack";
import type { TrainingRowView } from "../data/chart";
import SignaturePad from "./SignaturePad";
import TrainingSignCard from "./TrainingSignCard";
import { SignatureField } from "./signatures/SignatureField";
import { delegationFormPayload } from "./signatures/documentPayloads";

type Tab = "required" | "checked";

const EVIDENCE_OPTIONS: { value: ClinicalEvidenceKind; label: string }[] = [
  { value: "consultation", label: "Consultation note" },
  { value: "doctor_notes", label: "Doctor's notes" },
  { value: "physician_orders", label: "Physician orders" },
  { value: "pdf", label: "PDF / other" },
];

export default function AssignedDocsPanel({
  individualId,
  hideIdentity = false,
  hideRenewals = false,
}: {
  individualId: string;
  hideIdentity?: boolean;
  hideRenewals?: boolean;
}) {
  const { api, session, workspace, refresh } = useData();
  const stack = workspace?.planStacks.find((item) => item.individualId === individualId);
  const person = workspace?.individuals.find((item) => item.id === individualId);
  const [tab, setTab] = useState<Tab>("required");
  const [signingId, setSigningId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState(session?.fullName ?? "");
  const [mark, setMark] = useState("");
  const [error, setError] = useState("");
  const [protocolTitle, setProtocolTitle] = useState("");
  const [shiftDraft, setShiftDraft] = useState("");
  const [profile, setProfile] = useState<IndividualProfile | null>(null);
  const [discontinueId, setDiscontinueId] = useState<string | null>(null);
  const [discontinueTitle, setDiscontinueTitle] = useState("");
  const [discontinueFile, setDiscontinueFile] = useState<File | undefined>();

  if (!session || !stack || !person) return null;

  const editCover = canEditCover(session.roleKey);
  const editExtract = canEditExtraction(
    session.roleKey,
    can(session, "requirements.approve"),
  );
  const editDelegation = canToggleDelegation(
    session.roleKey,
    session.role,
    can(session, "requirements.approve"),
  );
  const nurseFirst = canSignAsDelegatingRn(session.roleKey, session.role);
  const showRenewals = stack.renewals.length > 0;
  const uploadRenewal = canUploadRenewal(session.roleKey);
  const activeProfile = profile ?? stack.profile;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="plan-stack">
      {!hideIdentity && (
        <div className="profile-heading">
          <div>
            <h2>{activeProfile.goesBy || person.name}</h2>
            <p>
              {person.site}
              {activeProfile.dmhId ? ` · DMH ${activeProfile.dmhId}` : ""}
              {person.dateOfBirth ? ` · DOB ${formatDate(person.dateOfBirth)}` : ""}
            </p>
          </div>
        </div>
      )}

      <section className="cover-fields">
        <h3 className="section-label">Cover page</h3>
        <div className="cover-grid">
          {(
            [
              ["legalName", "Legal name"],
              ["goesBy", "Goes by"],
              ["dmhId", "DMH ID"],
              ["diagnosis", "Primary diagnosis"],
              ["waiver", "Waiver"],
              ["address", "Address"],
              ["phone", "Phone"],
              ["language", "Language"],
              ["implementationStart", "Implementation start"],
              ["implementationEnd", "Implementation end"],
              ["serviceCoordinator", "Service coordinator"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={activeProfile[key]}
                disabled={!editCover}
                onChange={(e) =>
                  setProfile({ ...activeProfile, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <h3 className="section-label">Pre-survey facts</h3>
        <p className="stack-help">
          These fill the pre-survey individual information sheet for this
          home. Adaptive equipment comes from the monthly equipment log.
        </p>
        <div className="cover-grid">
          <label>
            Sex
            <select
              aria-label="Sex"
              disabled={!editCover}
              value={activeProfile.sex}
              onChange={(e) =>
                setProfile({
                  ...activeProfile,
                  sex: e.target.value as IndividualProfile["sex"],
                })
              }
            >
              <option value="">Not listed</option>
              <option value="F">F</option>
              <option value="M">M</option>
              <option value="X">X</option>
            </select>
          </label>
          <label>
            DMH / Medicaid / waiver
            <select
              aria-label="Medicaid status"
              disabled={!editCover}
              value={activeProfile.medicaidStatus}
              onChange={(e) =>
                setProfile({
                  ...activeProfile,
                  medicaidStatus: e.target.value as IndividualProfile["medicaidStatus"],
                })
              }
            >
              <option value="">Not listed</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="ida">IDA</option>
              <option value="cd_only">CD only</option>
            </select>
          </label>
          {(
            [
              ["specializedDiet", "Physician-ordered / specialized diet"],
              ["specializedMedical", "Specialized medical needs"],
              ["behaviorSupports", "Restrictions / BSP"],
              ["dailyActivities", "Scheduled daily activities"],
              ["visitHours", "Hours available for visits"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={activeProfile[key]}
                disabled={!editCover}
                onChange={(e) =>
                  setProfile({ ...activeProfile, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        {editCover && (
          <button
            className="button"
            onClick={() =>
              run(() => api.updateIndividualProfile(individualId, activeProfile))
            }
          >
            Save cover page
          </button>
        )}
      </section>

      {showRenewals && !hideRenewals && (
        <ClinicalRenewals
          items={stack.renewals}
          canUpload={uploadRenewal}
          onUpload={(renewalId, evidenceKind, documentTitle, file) =>
            run(() =>
              api.uploadRenewalEvidence({
                renewalId,
                evidenceKind,
                documentTitle,
                file,
              }),
            )
          }
        />
      )}

      <div className="stack-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "required"}
          className={tab === "required" ? "active" : ""}
          onClick={() => setTab("required")}
        >
          Must acknowledge
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "checked"}
          className={tab === "checked" ? "active" : ""}
          onClick={() => setTab("checked")}
        >
          Checked in plan
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === "required" ? (
        <RequiredList
          items={stack.required}
          training={stack.myTraining}
          signingId={signingId}
          legalName={legalName}
          mark={mark}
          canSign={can(session, "acknowledgments.sign_own")}
          nurseFirst={nurseFirst}
          individualName={person.name}
          editExtract={editExtract}
          editDelegation={editDelegation}
          canSubmit={stack.canSubmit}
          submittedAt={stack.mySubmissionAt}
          onSignId={setSigningId}
          onLegalName={setLegalName}
          onMark={setMark}
          onOpen={(id) => run(() => api.markObligationOpened(id))}
          onSign={(id) =>
            run(async () => {
              await api.signObligation(id, legalName, mark);
              setSigningId(null);
              setMark("");
            })
          }
          onToggle={(id, enabled) => {
            if (!enabled) {
              setDiscontinueId(id);
              setDiscontinueTitle("");
              setDiscontinueFile(undefined);
              return Promise.resolve();
            }
            return run(() => api.updateObligation(id, { enabled }));
          }}
          discontinueId={discontinueId}
          discontinueTitle={discontinueTitle}
          discontinueFile={discontinueFile}
          onDiscontinueTitle={setDiscontinueTitle}
          onDiscontinueFile={setDiscontinueFile}
          onDiscontinue={(id) =>
            run(async () => {
              if (!discontinueFile) {
                throw new Error("Upload a discontinuation order first.");
              }
              await api.discontinueDelegation({
                obligationId: id,
                title: discontinueTitle || discontinueFile.name,
                file: discontinueFile,
              });
              setDiscontinueId(null);
              setDiscontinueFile(undefined);
            })
          }
          onSubmit={() => run(() => api.submitPlanPacket(individualId))}
          onInitialLine={(checklistId, lineId) =>
            run(() => api.initialTrainingLine(checklistId, lineId))
          }
          onOpenTraining={async (mode) => {
            if (!stack.myTraining) return;
            const file = await api.getChartFile({
              type: "training",
              id: stack.myTraining.checklist.id,
            });
            if (!file) throw new Error("That file is not stored yet.");
            await openPrintable(file.name, file.blob, mode);
          }}
          canCheckTraining={
            Boolean(stack.myTraining) &&
            stack.myTraining!.checklist.staffUserId === session.userId &&
            !stack.myTraining!.checklist.staffSignedAt
          }
          canSignTrainingStaff={
            Boolean(stack.myTraining) &&
            stack.myTraining!.checklist.staffUserId === session.userId
          }
          canSignTrainingHm={canSignTrainingAsHm(session.roleKey)}
        />
      ) : (
        <CheckedList
          items={stack.checked}
          editExtract={editExtract}
          shiftDraft={shiftDraft}
          onShiftDraft={setShiftDraft}
          onState={(id, inventoryState) =>
            run(() => api.updateObligation(id, { inventoryState }))
          }
          onPromote={(id) =>
            run(() =>
              api.promoteToShiftTask(
                id,
                shiftDraft.split(",").map((part) => part.trim()).filter(Boolean),
              ),
            )
          }
        />
      )}

      {editExtract && (
        <form
          className="add-protocol"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addProtocol(individualId, protocolTitle);
              setProtocolTitle("");
            });
          }}
        >
          <label>
            Add a protocol
            <input
              value={protocolTitle}
              onChange={(e) => setProtocolTitle(e.target.value)}
              placeholder="e.g. Aspiration protocol"
            />
          </label>
          <button className="button" type="submit">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function ClinicalRenewals({
  items,
  canUpload,
  onUpload,
}: {
  items: ClinicalRenewalView[];
  canUpload: boolean;
  onUpload: (
    renewalId: string,
    evidenceKind: ClinicalEvidenceKind,
    documentTitle: string,
    file?: File,
  ) => void;
}) {
  const [drafts, setDrafts] = useState<
    Record<string, { kind: ClinicalEvidenceKind; title: string; file?: File }>
  >({});

  function draft(id: string) {
    return drafts[id] ?? { kind: "consultation" as const, title: "" };
  }

  return (
    <section className="clinical-renewals">
      <h3 className="section-label">Upcoming clinical renewals</h3>
      <p className="stack-help">
        Annual physical, vision, dental, and physician orders. The next due date
        resets only after the required document is uploaded.
      </p>
      <div className="obligation-list">
        {items.map((row) => {
          const current = draft(row.id);
          return (
            <article key={row.id} className="obligation-card renewal-card">
              <header>
                <DueChip date={row.nextDueOn} status={renewalBadge(row.status)} />
                <div>
                  <span className={`kind-pill renewal ${row.status}`}>{row.kind.replace("_", " ")}</span>
                  <h3>{row.title}</h3>
                </div>
                <Badge status={renewalBadge(row.status)} />
              </header>
              <p>
                Next due {formatDate(row.nextDueOn)}
                {row.lastUploadedOn
                  ? ` · Last uploaded ${formatDate(row.lastUploadedOn)}`
                  : ""}
                {row.lastDocumentTitle ? ` · ${row.lastDocumentTitle}` : ""}
              </p>
              {canUpload && (
                <form
                  className="renewal-upload"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onUpload(
                      row.id,
                      current.kind,
                      current.title || current.file?.name || row.title,
                      current.file,
                    );
                  }}
                >
                  <label>
                    Evidence type
                    <select
                      value={current.kind}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [row.id]: {
                            ...current,
                            kind: e.target.value as ClinicalEvidenceKind,
                          },
                        }))
                      }
                    >
                      {EVIDENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Document title
                    <input
                      value={current.title}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [row.id]: { ...current, title: e.target.value },
                        }))
                      }
                      placeholder="Consultation note, doctor's notes, or PDF"
                    />
                  </label>
                  <label>
                    File
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [row.id]: {
                            ...current,
                            file: e.target.files?.[0],
                            title: current.title || e.target.files?.[0]?.name || "",
                          },
                        }))
                      }
                    />
                  </label>
                  <button className="button primary" type="submit">
                    Upload and reset date
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RequiredList({
  items,
  signingId,

  legalName,
  mark,
  canSign,
  nurseFirst,
  individualName,
  editExtract,
  editDelegation,
  canSubmit,
  submittedAt,
  onSignId,

  onLegalName,
  onMark,
  onOpen,
  onSign,

  onToggle,
  onSubmit,
  discontinueId,
  discontinueTitle,
  discontinueFile,
  onDiscontinueTitle,
  onDiscontinueFile,
  onDiscontinue,
  training,
  onInitialLine,

  onOpenTraining,
  canCheckTraining,
  canSignTrainingStaff,
  canSignTrainingHm,
}: {
  items: ObligationView[];
  signingId: string | null;
  legalName: string;
  mark: string;
  canSign: boolean;
  nurseFirst: boolean;
  individualName: string;
  editExtract: boolean;
  editDelegation: boolean;
  canSubmit: boolean;
  submittedAt: string | null;
  onSignId: (id: string | null) => void;
  onLegalName: (value: string) => void;
  onMark: (value: string) => void;
  onOpen: (id: string) => void;
  onSign: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onSubmit: () => void;
  discontinueId: string | null;
  discontinueTitle: string;
  discontinueFile?: File;
  onDiscontinueTitle: (value: string) => void;
  onDiscontinueFile: (file?: File) => void;
  onDiscontinue: (id: string) => void;
  training: TrainingRowView | null;
  onInitialLine: (checklistId: string, lineId: string) => void;
  onOpenTraining: (mode: "download" | "print") => Promise<void>;
  canCheckTraining: boolean;
  canSignTrainingStaff: boolean;
  canSignTrainingHm: boolean;
}) {
  const visible = items.filter(
    (view) => view.item.enabled || view.item.kind === "delegation",
  );
  return (
    <div className="obligation-list">
      <p className="stack-help">
        The first time you are assigned to this home, check off every in-home
        training item. Then sign the other required documents and submit.
      </p>
      {training && (
        <TrainingSignCard
          row={training}
          canCheck={canCheckTraining}
          canSignStaff={canSignTrainingStaff}
          canSignHm={canSignTrainingHm}
          onInitial={(lineId) => onInitialLine(training.checklist.id, lineId)}
          onDownload={() => {
            void onOpenTraining("download");
          }}
          onPrint={() => {
            void onOpenTraining("print");
          }}
        />
      )}
      {visible.map((view) => {
        const mine = view.mySignature;
        const waitingOnRn =
          view.item.kind === "delegation" &&
          view.item.enabled &&
          !view.item.rnSignedAt;
        const staffMaySign = staffCanSignDelegation(view.item);
        const openForMe =
          view.item.enabled &&
          isObligationActive(view.item) &&
          view.item.mode === "required";
        return (
          <article key={view.item.id} className="obligation-card">
            <header>
              <span className={`kind-pill ${view.item.kind}`}>{view.item.kind.replace("_", " ")}</span>
              <h3>{view.item.title}</h3>
              <Badge
                status={
                  mine?.signedAt
                    ? "Signed"
                    : waitingOnRn
                      ? "Waiting for RN"
                      : view.item.enabled
                        ? "Needs signature"
                        : "Off"
                }
              />
            </header>
            <p>{view.item.detail}</p>
            {waitingOnRn && (
              <p className="rn-gate">
                The delegating RN must sign this form first. Staff cannot sign
                yet, even if a DPM created or turned the form on.
              </p>
            )}
            {view.item.rnSignedAt && (
              <p className="signed-flag">
                <Check size={16} /> Delegating RN signed{" "}
                {formatDate(view.item.rnSignedAt)}
                {view.item.rnSignatureName ? ` · ${view.item.rnSignatureName}` : ""}
              </p>
            )}
            {view.item.shiftPeriods.length > 0 && (
              <p className="shift-periods">
                Shift periods: {view.item.shiftPeriods.join(", ")}
              </p>
            )}
            <small>
              {view.signedCount}/{view.assignedCount} assigned staff signed
              {view.item.sourcePage ? ` · p.${view.item.sourcePage}` : ""}
            </small>
            <div className="obligation-actions">
              {view.item.kind === "delegation" && editDelegation && (
                <button
                  className="button"
                  onClick={() => onToggle(view.item.id, !view.item.enabled)}
                >
                  {view.item.enabled ? "Turn delegation off" : "Turn delegation on"}
                </button>
              )}
              {view.item.discontinueTitle && (
                <p className="quiet-note">
                  Discontinued with {view.item.discontinueTitle}
                </p>
              )}
              {view.item.kind === "delegation" &&
                (waitingOnRn || view.item.rnSignedAt) && (
                  <SignatureField
                    documentType="delegation_form"
                    documentId={view.item.id}
                    fieldName="rn_signature"
                    label="Delegating RN signature"
                    getDocumentPayload={() =>
                      view.item.delegationForm ? delegationFormPayload({
                        obligationId: view.item.id,
                        individualName,
                        taskTitle: view.item.title ?? "",
                        form: view.item.delegationForm,
                      }) : {
                        obligationId: view.item.id, individualName,
                        taskTitle: view.item.title, detail: view.item.detail,
                        sourcePage: view.item.sourcePage,
                        documentVersionId: view.item.documentVersionId,
                      }
                    }
                    canAct={waitingOnRn && nurseFirst}
                    cantActReason={
                      waitingOnRn && !nurseFirst
                        ? "Waiting for the delegating RN."
                        : undefined
                    }
                    legacySigned={
                      view.item.rnSignedAt
                        ? {
                            signerName: view.item.rnSignatureName ?? "Signed",
                            signedAt: view.item.rnSignedAt,
                          }
                        : null
                    }
                  />
                )}
              {openForMe && mine && !mine.signedAt && canSign && staffMaySign && (
                <>
                  <button className="button" onClick={() => onOpen(mine.id)}>
                    <FileText size={16} /> Review
                  </button>
                  <button
                    className="button primary"
                    disabled={!mine.openedAt}
                    onClick={() => onSignId(mine.id)}
                  >
                    <PenLine size={16} /> Sign
                  </button>
                </>
              )}
              {openForMe && mine && !mine.signedAt && canSign && waitingOnRn && !nurseFirst && (
                <button className="button" onClick={() => onOpen(mine.id)}>
                  <FileText size={16} /> Review
                </button>
              )}
              {mine?.signedAt && (
                <span className="signed-flag">
                  <Check size={16} /> Signed {formatDate(mine.signedAt)}
                </span>
              )}
            </div>
            {discontinueId === view.item.id && (
              <form
                className="renewal-upload"
                onSubmit={(e) => {
                  e.preventDefault();
                  onDiscontinue(view.item.id);
                }}
              >
                <label>
                  Discontinuation order title
                  <input
                    value={discontinueTitle}
                    onChange={(e) => onDiscontinueTitle(e.target.value)}
                    placeholder="Physician discontinue order"
                  />
                </label>
                <label>
                  File
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    onChange={(e) => onDiscontinueFile(e.target.files?.[0])}
                  />
                </label>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!discontinueFile}
                >
                  Upload order and turn off
                </button>
              </form>
            )}
            {signingId === mine?.id && (
              <div className="sign-box">
                <label>
                  Printed name
                  <input
                    value={legalName}
                    onChange={(e) => onLegalName(e.target.value)}
                  />
                </label>
                <SignaturePad onChange={onMark} />
                <button
                  className="button primary"
                  disabled={!mark}
                  onClick={() => onSign(mine.id)}
                >
                  Save signature
                </button>
              </div>
            )}
            {editExtract && view.item.kind !== "delegation" && !view.item.enabled && (
              <button className="button" onClick={() => onToggle(view.item.id, true)}>
                Require this item
              </button>
            )}
          </article>
        );
      })}
      {submittedAt ? (
        <p className="quiet-note">
          <LockKeyhole size={15} /> Packet submitted {formatDate(submittedAt)}.
        </p>
      ) : (
        <button className="button primary full" disabled={!canSubmit} onClick={onSubmit}>
          Submit signed packet
        </button>
      )}
    </div>
  );
}

function CheckedList({
  items,
  editExtract,
  shiftDraft,
  onShiftDraft,
  onState,
  onPromote,
}: {
  items: ObligationView[];
  editExtract: boolean;
  shiftDraft: string;
  onShiftDraft: (value: string) => void;
  onState: (id: string, state: "present" | "missing" | "na" | "unchecked") => void;
  onPromote: (id: string) => void;
}) {
  return (
    <div className="obligation-list">
      <p className="stack-help">
        These sections were found in the plan. They are not signature tasks
        unless a DPM turns one into a daily shift requirement.
      </p>
      {editExtract && (
        <label>
          Shift periods for a daily task (comma-separated)
          <input
            value={shiftDraft}
            onChange={(e) => onShiftDraft(e.target.value)}
            placeholder="7a–3p, 3p–11p"
          />
        </label>
      )}
      {items.map((view) => (
        <article key={view.item.id} className="obligation-card">
          <header>
            <span className="kind-pill inventory">checked</span>
            <h3>{view.item.title}</h3>
            <Badge status={view.item.inventoryState} />
          </header>
          <p>{view.item.detail}</p>
          {editExtract && (
            <div className="obligation-actions">
              {(["present", "missing", "na"] as const).map((state) => (
                <button
                  key={state}
                  className="button"
                  onClick={() => onState(view.item.id, state)}
                >
                  Mark {state}
                </button>
              ))}
              <button className="button primary" onClick={() => onPromote(view.item.id)}>
                Make daily shift task
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
