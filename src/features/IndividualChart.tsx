import { useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  Pill,
  Printer,
  ShieldAlert,
} from "lucide-react";
import { Badge, DueChip, Empty, formatDate, PageHeading } from "../components";
import { useData } from "../data/DataProvider";
import {
  canLogPrnDose,
  canRecordDelivery,
  canSeeChartOverview,
  canSeeChartWidgets,
  canSeeMeds,
  canSignTrainingAsHm,
  countdownLabel,
  pcspTaskSummary,
  todayIso,
} from "../data/chart";
import {
  canCompleteAppointments,
  canManageAppointments,
  canSeeAppointments,
} from "../data/appointments";
import { openPrintable } from "../data/openFile";
import {
  canSeeRenewals,
  canToggleDelegation,
  canUploadRenewal,
  isObligationActive,
  renewalBadge,
  type ClinicalEvidenceKind,
} from "../data/planStack";
import { can } from "../data/status";
import AssignedDocsPanel from "./AssignedDocsPanel";
import { generateConsultationPacket } from "./appointments/generateConsultationPacket";
import ChartOverview from "./ChartOverview";
import HealthCard from "./HealthCard";
import MonthlyEquipmentCard from "./MonthlyEquipmentCard";
import TrainingSignCard from "./TrainingSignCard";
// Issue #81: agency-branded Individual face sheet (distinct from the
// appointment-scoped consultation packet).
import {
  buildIndividualProfilePdf,
  individualProfileFileName,
} from "../pdf/individualProfilePdf";
// LIFEPATH-P3: hook the delegation form detail into the chart's delegation section.
import DelegationFormDetail from "./delegations/DelegationFormDetail";
// LIFEPATH-P6: med inventory countdown panel (minimal hook — inventory only)
import MedInventoryCard from "./medInventory/MedInventoryCard";
const EVIDENCE_OPTIONS: { value: ClinicalEvidenceKind; label: string }[] = [
  { value: "consultation", label: "Consultation note" },
  { value: "doctor_notes", label: "Doctor's notes" },
  { value: "physician_orders", label: "Physician orders" },
  { value: "pdf", label: "PDF / other" },
];

export default function IndividualChart({
  individualId,
  onBack,
}: {
  individualId: string;
  onBack: () => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const stack = workspace?.planStacks.find((item) => item.individualId === individualId);
  const person = workspace?.individuals.find((item) => item.id === individualId);
  const [error, setError] = useState("");
  // LIFEPATH-P3: which delegation's form detail is open (template toggle lives there).
  const [formDelegationId, setFormDelegationId] = useState<string | null>(null);

  if (!session || !stack || !person) return null;

  const chartSession = session;
  const chartStack = stack;
  const chartPerson = person;
  const widgets = canSeeChartWidgets(chartSession.roleKey);
  const showOverview = canSeeChartOverview(chartSession.roleKey);
  const showAnnuals = canSeeRenewals(chartSession.roleKey);
  const showMeds = canSeeMeds(chartSession.roleKey);
  const showHealth = canSeeAppointments(chartSession.roleKey);
  const manageAppointments = canManageAppointments(chartSession.roleKey);
  const completeAppointments = canCompleteAppointments(chartSession.roleKey);
  const profile = chartStack.profile;
  const delegations = chartStack.required.filter((view) => view.item.kind === "delegation");

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Issue #81: "Print profile" — agency-branded Individual face sheet with the
  // Overview content. Kept distinct from "Generate consultation", which is
  // appointment-scoped.
  async function printProfile() {
    if (!workspace) return;
    const generatedAt = new Date().toISOString();
    const summary = pcspTaskSummary([...chartStack.required, ...chartStack.checked]);
    const today = todayIso();
    const siteManagers = (workspace.staff ?? []).filter(
      (member) =>
        ["house_manager", "program_manager"].includes(member.roleKey) &&
        member.siteId === chartPerson.siteId &&
        (!member.expiresOn || member.expiresOn >= today),
    );
    const admins = (workspace.staff ?? []).filter(
      (member) =>
        member.roleKey === "administrator" && (!member.expiresOn || member.expiresOn >= today),
    );
    const doc = buildIndividualProfilePdf({
      agencyName: chartSession.agencyName,
      legalName: profile.legalName.trim() || chartPerson.name,
      goesBy: profile.goesBy,
      dmhId: profile.dmhId,
      siteName: chartPerson.site,
      dateOfBirth: chartPerson.dateOfBirth,
      pcspActive: summary.active,
      pcspCompleted: summary.completed,
      pcspTasks: summary.tasks,
      diagnosis: profile.diagnosis,
      medications: chartStack.medications.map((med) => ({
        name: med.name,
        strength: med.strength,
        kind: med.kind,
      })),
      agencyContacts: [
        ...siteManagers.map((member) => ({
          name: member.name,
          role: `${member.role} · ${chartPerson.site}`,
        })),
        ...admins.map((member) => ({ name: member.name, role: "Agency administrator" })),
      ],
      guardians: profile.guardians,
      providers: profile.providerContacts,
      generatedByName: chartSession.fullName,
      generatedAt,
      logoDataUrl: workspace.branding.logoUrl ?? null,
    });
    await openPrintable(
      individualProfileFileName(chartPerson.name, generatedAt),
      doc.output("blob") as Blob,
      "print",
    );
  }

  async function openFile(
    type: "renewal" | "discontinue" | "training" | "version" | "consultation",
    id: string,
    mode: "download" | "print",
  ) {
    await run(async () => {
      const file = await api.getChartFile({ type, id });
      if (!file) throw new Error("That file is not stored yet.");
      await openPrintable(file.name, file.blob, mode);
    });
  }

  async function generatePacket(
    appointment: (typeof chartStack.appointments)[number],
    mode: "download" | "print",
  ) {
    if (!workspace) return;
    setError("");
    try {
      await generateConsultationPacket({
        recordGenerated: (id) => api.recordConsultationPacketGenerated(id),
        session: chartSession,
        workspace,
        person: chartPerson,
        profile,
        appointment,
        medications: chartStack.medications,
        mode,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="individual-chart">
      <PageHeading
        title={person.name}
        description={`${person.site}${
          profile.dmhId ? ` · DMH ${profile.dmhId}` : ""
        }${person.dateOfBirth ? ` · DOB ${formatDate(person.dateOfBirth)}` : ""} · ${
          profile.legalName
        }`}
      >
        <button className="button" onClick={onBack}>
          <ArrowLeft size={16} /> Back to individuals
        </button>
      </PageHeading>

      {error && <p className="form-error">{error}</p>}

      {showOverview && workspace && (
        <ChartOverview
          person={chartPerson}
          profile={profile}
          stack={chartStack}
          staff={workspace.staff ?? []}
          sessionRoleKey={chartSession.roleKey}
          onUpdateContacts={(patch) =>
            api.updateIndividualContacts(chartPerson.id, patch).then(() => undefined)
          }
          onUpdateDiagnosis={(diagnosis) =>
            api.updateIndividualDiagnosis(chartPerson.id, diagnosis).then(() => undefined)
          }
          onPrintProfile={printProfile}
          run={run}
        />
      )}

      <div className="chart-grid">
        {stack.carePlan && (
          <section className="chart-widget" aria-labelledby="care-plan-heading">
            <h2 id="care-plan-heading">Care plan</h2>
            <p>{stack.carePlan.title}</p>
            <p>
              {stack.carePlan.versionLabel ? `${stack.carePlan.versionLabel} · ` : ""}
              {stack.carePlan.signedCount}/{stack.carePlan.assignedCount} assigned
              staff signed
            </p>
            {stack.carePlan.documentVersionId && (
              <div className="chart-actions">
                <button
                  className="button"
                  onClick={() =>
                    openFile("version", stack.carePlan!.documentVersionId!, "download")
                  }
                >
                  <Download size={16} /> Download
                </button>
                <button
                  className="button"
                  onClick={() =>
                    openFile("version", stack.carePlan!.documentVersionId!, "print")
                  }
                >
                  <Printer size={16} /> Print
                </button>
              </div>
            )}
          </section>
        )}

        {widgets && (
          <section className="chart-widget" aria-labelledby="delegations-heading">
            <h2 id="delegations-heading">Delegations</h2>
            <p className="stack-help">
              Delegations do not expire. Turn one off only after a discontinuation
              order is uploaded. The order stays on the chart.
            </p>
            {delegations.length === 0 && <p>No delegations on this chart.</p>}
            {delegations.map((view) => (
              <DelegationBlock
                key={view.item.id}
                title={view.item.title}
                enabled={view.item.enabled && isObligationActive(view.item)}
                discontinueTitle={view.item.discontinueTitle}
                discontinueFileId={view.item.discontinueFileId}
                canDiscontinue={canToggleDelegation(
                  session.roleKey,
                  session.role,
                  can(session, "requirements.approve"),
                )}
                onOpen={(mode) =>
                  view.item.discontinueFileId
                    ? openFile("discontinue", view.item.discontinueFileId, mode)
                    : Promise.resolve()
                }
                // LIFEPATH-P3: open the RN delegation form detail (exact/improved toggle).
                onViewForm={() => setFormDelegationId(view.item.id)}
                onDiscontinue={(title, file) =>
                  run(() =>
                    api.discontinueDelegation({
                      obligationId: view.item.id,
                      title,
                      file,
                    }),
                  )
                }
              />
            ))}
            {/* LIFEPATH-P3: delegation form detail dialog. */}
            {formDelegationId && (
              <DelegationFormDetail
                obligationId={formDelegationId}
                onClose={() => setFormDelegationId(null)}
              />
            )}
          </section>
        )}

        {showAnnuals && (
          <section className="chart-widget" aria-labelledby="annuals-heading">
            <h2 id="annuals-heading">Upcoming clinical renewals</h2>
            <p className="stack-help">
              Date completed plus days until the exam expires. Uploading a new
              document resets the due date to 12 months later.
            </p>
            {stack.renewals.map((row) => (
              <article key={row.id} className="obligation-card renewal-card">
                <header>
                  <DueChip date={row.nextDueOn} status={renewalBadge(row.status)} />
                  <div>
                    <span className={`kind-pill renewal ${row.status}`}>
                      {row.kind.replace("_", " ")}
                    </span>
                    <h3>{row.title}</h3>
                  </div>
                  <Badge status={renewalBadge(row.status)} />
                </header>
                <p>
                  {row.lastUploadedOn
                    ? `Date done ${formatDate(row.lastUploadedOn)} · `
                    : "No exam on file · "}
                  {countdownLabel(row.nextDueOn)} · Next due {formatDate(row.nextDueOn)}
                  {row.lastDocumentTitle ? ` · ${row.lastDocumentTitle}` : ""}
                </p>
                {row.fileId && (
                  <div className="chart-actions">
                    <button
                      className="button"
                      onClick={() => openFile("renewal", row.fileId!, "download")}
                    >
                      <Download size={16} /> Download
                    </button>
                    <button
                      className="button"
                      onClick={() => openFile("renewal", row.fileId!, "print")}
                    >
                      <Printer size={16} /> Print
                    </button>
                  </div>
                )}
                {canUploadRenewal(session.roleKey) && (
                  <RenewalUpload
                    defaultTitle={row.title}
                    onUpload={(evidenceKind, documentTitle, file) =>
                      run(() =>
                        api.uploadRenewalEvidence({
                          renewalId: row.id,
                          evidenceKind,
                          documentTitle,
                          file,
                        }),
                      )
                    }
                  />
                )}
              </article>
            ))}
          </section>
        )}

        {showHealth && (
          <div id="chart-appointments" className="chart-anchor">
            <HealthCard
            individualName={person.name}
            defaultVisitAddress={profile.address}
            appointments={stack.appointments}
            profile={profile}
            canManage={manageAppointments}
            canComplete={completeAppointments}
            onCreate={(draft) =>
              run(() =>
                api.createAppointment({
                  individualId,
                  ...draft,
                }).then(() => undefined),
              )
            }
            onUpdate={(id, draft) => run(() => api.updateAppointment(id, draft))}
            onDelete={(id) => run(() => api.deleteAppointment(id))}
            onGenerate={generatePacket}
            onComplete={(appointment, file, comments) =>
              run(() =>
                api.completeAppointment({
                  appointmentId: appointment.id,
                  file,
                  comments,
                }),
              )
            }
            onOpenConsultation={(fileId) => openFile("consultation", fileId, "download")}
            onSaveAllergies={(allergies) =>
              run(() => api.updateIndividualAllergies(individualId, allergies))
            }
            />
          </div>
        )}

        {showMeds && (
          <section className="chart-widget" id="chart-meds" aria-labelledby="meds-heading">
            <h2 id="meds-heading">Medication board</h2>
            <p className="stack-help">
              After a delivery, set remaining pills to the counted bottle.
              Scheduled meds drop by pills-per-day each calendar day. PRN does
              not auto-drop.
            </p>
            {stack.medications.length === 0 && <p>No medications on this chart.</p>}
            {stack.medications.map((med) => (
              <article key={med.id} className="obligation-card med-card">
                <header>
                  <span className={`kind-pill ${med.kind}`}>{med.kind}</span>
                  {med.controlled && (
                    <span className="kind-pill control">
                      <ShieldAlert size={12} /> Control
                    </span>
                  )}
                  <h3>{med.name}</h3>
                  {med.low && <Badge status="Due soon" />}
                </header>
                <p>
                  {med.strength} · {med.remainingPills} pills left
                  {med.kind === "scheduled"
                    ? ` · ${med.pillsPerDay} per day · ${
                        med.daysLeft === null ? "—" : `${med.daysLeft} days left`
                      }`
                    : " · PRN, no automatic drop"}
                  {med.lastDeliveryOn
                    ? ` · Last counted ${formatDate(med.lastDeliveryOn)}`
                    : ""}
                </p>
                {canRecordDelivery(session.roleKey) && (
                  <DeliveryForm
                    defaultRemaining={med.remainingPills}
                    defaultPerDay={med.pillsPerDay}
                    scheduled={med.kind === "scheduled"}
                    onSave={(remainingPills, pillsPerDay) =>
                      run(() =>
                        api.recordMedDelivery({
                          medicationId: med.id,
                          remainingPills,
                          pillsPerDay,
                        }),
                      )
                    }
                  />
                )}
                {med.kind === "prn" && canLogPrnDose(session.roleKey) && (
                  <button
                    className="button"
                    onClick={() => run(() => api.logPrnDose(med.id, 1))}
                  >
                    <Pill size={16} /> PRN given
                  </button>
                )}
              </article>
            ))}
            {/* LIFEPATH-P6: inventory countdown (thresholds, corrections, history) */}
            <MedInventoryCard individualId={individualId} />
          </section>
        )}

        <MonthlyEquipmentCard individualId={individualId} />

        <section className="chart-widget" aria-labelledby="staff-heading">
          <h2 id="staff-heading">Assigned staff</h2>
          <p className="stack-help">
            Every staff member assigned to this home gets an in-home training
            checklist the first time they are assigned. They check off each
            item, then sign. House manager countersigns.
          </p>
          {stack.staffTraining.length === 0 && (
            <p>No assigned staff training sheets yet.</p>
          )}
          {stack.staffTraining.map((row) => (
            <TrainingSignCard
              key={row.checklist.id}
              row={row}
              canCheck={
                session.userId === row.checklist.staffUserId &&
                !row.checklist.staffSignedAt
              }
              canSignStaff={session.userId === row.checklist.staffUserId}
              canSignHm={canSignTrainingAsHm(session.roleKey)}
              onInitial={(lineId) =>
                run(() => api.initialTrainingLine(row.checklist.id, lineId))
              }
              onDownload={() => openFile("training", row.checklist.id, "download")}
              onPrint={() => openFile("training", row.checklist.id, "print")}
            />
          ))}
        </section>

        {/* Issue #81: quiet-link anchor. Shift note entry ships in a later
            update; this placeholder keeps the Overview link honest. */}
        <section
          className="chart-widget"
          id="chart-shift-notes"
          aria-labelledby="shift-notes-heading"
        >
          <h2 id="shift-notes-heading">Shift notes</h2>
          <Empty
            mark="quiet"
            title="Shift notes live here soon"
            text="Shift note entry is coming in a later update."
          />
        </section>
      </div>

      <AssignedDocsPanel
        individualId={individualId}
        hideIdentity
        hideRenewals
      />
    </div>
  );
}

function DelegationBlock({
  title,
  enabled,
  discontinueTitle,
  discontinueFileId,
  canDiscontinue,
  onOpen,
  onViewForm,
  onDiscontinue,
}: {
  title: string;
  enabled: boolean;
  discontinueTitle: string | null;
  discontinueFileId: string | null;
  canDiscontinue: boolean;
  onOpen: (mode: "download" | "print") => void;
  /** LIFEPATH-P3: open the delegation form detail. */
  onViewForm: () => void;
  onDiscontinue: (title: string, file: File) => void;
}) {
  const [titleDraft, setTitleDraft] = useState("");
  const [file, setFile] = useState<File | undefined>();
  return (
    <article className="obligation-card">
      <header>
        <span className="kind-pill delegation">delegation</span>
        <h3>{title}</h3>
        <Badge status={enabled ? "Current" : "Off"} />
      </header>
      {discontinueFileId && (
        <p>
          <FileText size={14} /> {discontinueTitle || "Discontinuation order"} on
          file
        </p>
      )}
      <div className="chart-actions">
        {/* LIFEPATH-P3: entry point to the exact/improved delegation form. */}
        <button className="button" onClick={onViewForm}>
          <FileText size={16} /> Open form
        </button>
        {discontinueFileId && (
          <>
            <button className="button" onClick={() => onOpen("download")}>
              <Download size={16} /> Download order
            </button>
            <button className="button" onClick={() => onOpen("print")}>
              <Printer size={16} /> Print order
            </button>
          </>
        )}
      </div>
      {enabled && canDiscontinue && (
        <form
          className="renewal-upload"
          onSubmit={(e) => {
            e.preventDefault();
            if (file) onDiscontinue(titleDraft || file.name, file);
          }}
        >
          <label>
            Discontinuation order title
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Physician discontinue order"
            />
          </label>
          <label>
            File
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <button className="button" type="submit" disabled={!file}>
            Upload order and turn off
          </button>
        </form>
      )}
    </article>
  );
}

function RenewalUpload({
  defaultTitle,
  onUpload,
}: {
  defaultTitle: string;
  onUpload: (
    evidenceKind: ClinicalEvidenceKind,
    documentTitle: string,
    file?: File,
  ) => void;
}) {
  const [kind, setKind] = useState<ClinicalEvidenceKind>("consultation");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | undefined>();
  return (
    <form
      className="renewal-upload"
      onSubmit={(e) => {
        e.preventDefault();
        onUpload(kind, title || file?.name || defaultTitle, file);
      }}
    >
      <label>
        Evidence type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ClinicalEvidenceKind)}
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Consultation note, doctor's notes, or PDF"
        />
      </label>
      <label>
        File
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
          onChange={(e) => {
            const next = e.target.files?.[0];
            setFile(next);
            if (next && !title) setTitle(next.name);
          }}
        />
      </label>
      <button className="button primary" type="submit">
        Upload and reset date
      </button>
    </form>
  );
}

function DeliveryForm({
  defaultRemaining,
  defaultPerDay,
  scheduled,
  onSave,
}: {
  defaultRemaining: number;
  defaultPerDay: number;
  scheduled: boolean;
  onSave: (remaining: number, perDay: number) => void;
}) {
  const [remaining, setRemaining] = useState(String(defaultRemaining));
  const [perDay, setPerDay] = useState(String(defaultPerDay || 1));
  return (
    <form
      className="renewal-upload"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Number(remaining), scheduled ? Number(perDay) : 0);
      }}
    >
      <label>
        Pills remaining
        <input
          type="number"
          min="0"
          value={remaining}
          onChange={(e) => setRemaining(e.target.value)}
        />
      </label>
      {scheduled && (
        <label>
          Pills per day
          <input
            type="number"
            min="1"
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
          />
        </label>
      )}
      <button className="button primary" type="submit">
        Record delivery count
      </button>
    </form>
  );
}
