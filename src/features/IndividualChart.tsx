import Consents from "./consents/Consents";
import CareScreeningSection from "./CareScreeningSection";
import { useEffect, useState } from "react";
import { formatPillCount, medCountdown } from "./mobile/medcount";
import { formatCentralTime } from "./mobile/mar";
import type {
  MedDoseMark,
  MedInventoryView,
  PrnDoseLog,
} from "../data/types";
import {
  ArrowLeft,
  Download,
  FileText,
  Pill,
  Printer,
  ShieldAlert,
} from "lucide-react";
import { Badge, DueChip, Empty, formatDate, PageHeading } from "../components";
import StatusBadge from "../components/StatusBadge";
import {
  medSupplyBadgeLabel,
  medSupplyStatusFromInventory,
} from "../data/complianceStatus";
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
import { shiftClockFromFacts } from "../data/dueItems";
import {
  clinicianScheduleLabel,
  displayStaffTitle,
  progressNoteName,
  waiverServiceNames,
} from "../data/shiftNotes";
import { SERVICE_TYPE_LABELS } from "../data/siteReview";
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
import { can, roleLabel } from "../data/status";
import AssignedDocsPanel from "./AssignedDocsPanel";
import { generateConsultationPacket } from "./appointments/generateConsultationPacket";
import ChartOverview from "./ChartOverview";
import HealthCard from "./HealthCard";
import HealthTrackSection from "./healthTrack/HealthTrackSection";
import BehaviorSection from "./behavior/BehaviorSection";
import MonthlyEquipmentCard from "./MonthlyEquipmentCard";
import AloneTimeCard from "./AloneTimeCard";
import MarCard from "./MarCard";
import MedicationOrdersCard from "./medicationOrders/MedicationOrdersCard";
import ReconciliationCard from "./medicationOrders/ReconciliationCard";
import ChartMessagesCard from "./messaging/ChartMessagesCard";
import TrainingSignCard from "./TrainingSignCard";
// LIFE EVENTS: per-Individual significant-events timeline (context
// section — sits with the profile/context blocks, before the clinical
// trackers below).
import LifeEventsCard from "./lifeEvents/LifeEventsCard";
// Issue #81: agency-branded Individual face sheet (distinct from the
// appointment-scoped consultation packet).
import {
  buildIndividualProfilePdf,
  individualProfileFileName,
} from "../pdf/individualProfilePdf";
import { buildShiftNotesPdf, shiftNotesFileName } from "../pdf/shiftNotesPdf";
// LIFEPATH-P3: hook the delegation form detail into the chart's delegation section.
import DelegationFormDetail from "./delegations/DelegationFormDetail";
// LIFEPATH-P6: med inventory countdown panel (minimal hook — inventory only)
import MedInventoryCard from "./medInventory/MedInventoryCard";
// Issue #80: ISP / PCSP task config + shift-note entry.
import IspConfigSection from "./isp/IspConfigSection";
import ShiftNoteSection from "./isp/ShiftNoteSection";
import { useIspData } from "./isp/useIspData";
import {
  canConfigureIspTasks,
  canEnterShiftNotes,
  canSeeShiftNotes,
  canSeeMenuEntries,
  canViewPersonalSpending,
} from "../data/permissions";
import MenuSection from "./MenuSection";
import PersonalSpendingCard, {
  PersonalFundsGlance,
} from "./personalSpending/PersonalSpendingCard";
const EVIDENCE_OPTIONS: { value: ClinicalEvidenceKind; label: string }[] = [
  { value: "consultation", label: "Consultation note" },
  { value: "doctor_notes", label: "Doctor's notes" },
  { value: "physician_orders", label: "Physician orders" },
  { value: "pdf", label: "PDF / other" },
];

export default function IndividualChart({
  individualId,
  onBack,
  onOpenMessageThread,
}: {
  individualId: string;
  onBack: () => void;
  onOpenMessageThread?: (threadId: string) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const stack = workspace?.planStacks.find((item) => item.individualId === individualId);
  const person = workspace?.individuals.find((item) => item.id === individualId);
  const [error, setError] = useState("");
  const [followup, setFollowup] = useState<Record<string, { indication: string; result: string }>>({});
  // LIFEPATH-P3: which delegation's form detail is open (template toggle lives there).
  const [formDelegationId, setFormDelegationId] = useState<string | null>(null);
  // Issue #80: ISP data (hook must run before the early return below).
  const ispEnabled = session !== null && canSeeShiftNotes(session.roleKey);
  const isp = useIspData(api, individualId, ispEnabled);

  // Med cluster: the board's headline count is the countdown figure (the
  // same baseline-and-burn-down number the mobile MAR shows), and the PRN
  // section lists the per-dose audit records. Loaded here (hooks before
  // the early return); child cards keep their own loads.
  const medsEnabled = session !== null && canSeeMeds(session.roleKey);
  const [medViews, setMedViews] = useState<MedInventoryView[] | null>(null);
  const [medMarks, setMedMarks] = useState<MedDoseMark[]>([]);
  const [prnLogs, setPrnLogs] = useState<PrnDoseLog[]>([]);
  const [prnDraft, setPrnDraft] = useState<
    Record<string, { reason: string; followUp: string }>
  >({});
  useEffect(() => {
    if (!medsEnabled) return;
    let live = true;
    const today = todayIso();
    const from = new Date(Date.now() - 370 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    Promise.all([
      api.getMedInventory(individualId),
      api.getMedDoseMarksInRange(individualId, from, today),
      api.listPrnDoses(individualId),
    ])
      .then(([views, marks, logs]) => {
        if (!live) return;
        setMedViews(views);
        setMedMarks(marks);
        setPrnLogs(logs);
      })
      .catch(() => {
        if (live) setMedViews(null);
      });
    return () => {
      live = false;
    };
  }, [api, individualId, medsEnabled, workspace]);

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
  // Issue #80: ISP / PCSP tasks config + shift notes.
  const configureIsp = canConfigureIspTasks(chartSession.roleKey);
  const enterShiftNotes = canEnterShiftNotes(chartSession.roleKey);
  const pcspSeedTitles = [...chartStack.required, ...chartStack.checked]
    .filter((view) => view.item.kind === "pcsp" || view.item.kind === "shift_task")
    .map((view) => view.item.title);
  // Both runners resolve to a success flag: errors are swallowed into the
  // chart error banner (existing display behavior), but callers that close
  // a form on completion — the shift-note form above all — must be able to
  // tell a failed save from a saved one. Callers that ignore the return
  // value behave exactly as before.
  async function runIsp(action: () => Promise<unknown>): Promise<boolean> {
    const ok = await run(() => action().then(() => undefined));
    await isp.reload();
    return ok;
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
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
    // LIFE EVENTS: the printed profile carries the timeline too (the PDF
    // builder stamps every page "Digital record generated by Complyrer").
    let lifeEventRows: import("../data/lifeEvents").LifeEventView[] = [];
    try {
      lifeEventRows = await api.listLifeEvents(individualId);
    } catch {
      lifeEventRows = [];
    }
    const doc = buildIndividualProfilePdf({
      agencyName: chartSession.agencyName,
      legalName: profile.legalName.trim() || chartPerson.name,
      lifeEvents: lifeEventRows.map((row) => ({
        eventDate: row.eventDate,
        categoryLabel: row.categoryLabel,
        title: row.title,
        note: row.note,
      })),
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

  async function openShiftNotes(
    mode: "download" | "print",
    reportDescription: string,
    range: { from: string; to: string },
  ) {
    if (!workspace || !isp.data) return;
    const generatedAt = new Date().toISOString();
    const printed = {
      from: range.from,
      to: range.to,
      notes: isp.data.notes.filter((note) => note.noteDate >= range.from && note.noteDate <= range.to),
    };
    const { from, to } = printed;
    const titleById = new Map(
      (workspace.staff ?? []).map((member) => [
        member.id,
        member.role || roleLabel(member.roleKey),
      ]),
    );
    const notes = printed.notes.map((note) => ({
      ...note,
      location: note.location?.trim() || chartPerson.site,
      staffTitle: note.staffTitle?.trim() || titleById.get(note.staffUserId) || "",
    }));
    const program = isp.data.programs.find((row) => notes.some((note) => note.programId === row.id))
      ?? isp.data.programs[0];
    const levelLabels: Record<string, { shortLabel: string; caption: string }> = {};
    for (const method of isp.data.scoringMethods) {
      for (const level of method.levels) {
        levelLabels[level.id] = { shortLabel: level.shortLabel, caption: level.caption };
      }
    }
    const doc = buildShiftNotesPdf({
      agencyName: chartSession.agencyName,
      individualName: progressNoteName(profile.legalName.trim() || chartPerson.name),
      dateOfBirth: chartPerson.dateOfBirth,
      siteName: chartPerson.site,
      programName: program?.name ?? notes[0]?.programName ?? "ISP program",
      from,
      to,
      notes,
      levelLabels,
      reportDescription,
      timeZone: "US/Central",
      programId: program?.id,
      programStatus: program ? (program.status === "approved" ? "Approved" : program.status === "draft" ? "Draft" : "Superseded") : "",
      scheduleLabel: program ? clinicianScheduleLabel(program.schedule) : "",
      frequency: program?.maxEntriesPerDay ?? null,
      scoringMethodName: program?.scoringMethod?.name ?? notes[0]?.scoringMethodName ?? "",
      goalService: program?.goalService,
      completionCriteria: program?.completionCriteria,
      scheduleComment: program?.scheduleComment,
      generatedByName: chartSession.fullName,
      generatedAt,
      logoDataUrl: workspace.branding.logoUrl ?? null,
    });
    await openPrintable(shiftNotesFileName(chartPerson.name, from, to), doc.output("blob") as Blob, mode);
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
        }`}
      >
        <button className="button" onClick={onBack}>
          <ArrowLeft size={16} /> Back to individuals
        </button>
        <PersonalFundsGlance individualId={individualId} />
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
        <CareScreeningSection key={individualId} individualId={individualId} />
        {stack.carePlan && (
          <section className="chart-widget" aria-labelledby="care-plan-heading">
            <h2 id="care-plan-heading">Care plan document</h2>
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

        {/* LIFE EVENTS: life-context timeline, right after the profile /
            care-plan context and before the clinical sections. */}
        <LifeEventsCard individualId={individualId} />

        {/* Issue #80: ISP / PCSP task config sits right after Care plan —
            DPM / administrator only (founder lock: Option A). */}
        {widgets && configureIsp && isp.data && (
          <IspConfigSection
            individualId={individualId}
            data={isp.data}
            api={api}
            runIsp={runIsp}
            pcspSeedTitles={pcspSeedTitles}
          />
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
              ).then(() => undefined)
            }
            onUpdate={(id, draft) => run(() => api.updateAppointment(id, draft)).then(() => undefined)}
            onDelete={(id) => run(() => api.deleteAppointment(id)).then(() => undefined)}
            onGenerate={generatePacket}
            onComplete={(appointment, file, comments) =>
              run(() =>
                api.completeAppointment({
                  appointmentId: appointment.id,
                  file,
                  comments,
                }),
              ).then(() => undefined)
            }
            onOpenConsultation={(fileId) => openFile("consultation", fileId, "download")}
            onSaveAllergies={(allergies) =>
              run(() => api.updateIndividualAllergies(individualId, allergies)).then(() => undefined)
            }
            />
          </div>
        )}

        <MedicationOrdersCard individualId={individualId} />
        <ReconciliationCard
          individualId={individualId}
          individualName={person.name}
          siteName={person.site}
        />
        {/* THERAP-CORE-GAPS-1: health trackers + behavior supports. Both
            sections self-gate on the session (auditors read-only, HR out). */}
        <HealthTrackSection individualId={individualId} individualName={person.name} />
        <BehaviorSection individualId={individualId} individualName={person.name} />

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
                {(() => {
                  // Headline = the countdown figure (newest count baseline
                  // minus Given marks and PRN doses since), the same number
                  // the mobile MAR shows. The stored row drifts on hosted
                  // because scheduled marks never decrement it.
                  const view = medViews?.find(
                    (row) => row.medicationId === med.id,
                  );
                  const countdown = view
                    ? medCountdown(view, medMarks, todayIso())
                    : null;
                  const neverCounted = countdown
                    ? !countdown.hasBaseline
                    : false;
                  const medLogs = prnLogs.filter(
                    (log) => log.medicationId === med.id,
                  );
                  return (
                    <>
                <header>
                  <span className={`kind-pill ${med.kind}`}>{med.kind}</span>
                  {med.controlled && (
                    <span className="kind-pill control">
                      <ShieldAlert size={12} /> Control
                    </span>
                  )}
                  <h3>{med.name}</h3>
                  {/* One supply state per med, from the same inventory
                      status the forecast card below renders — never two
                      different states (e.g. "Due soon" here and a
                      different band there), and never "Expired" for a
                      stocked med. Falls back to the stored-row low flag
                      only until the inventory views load. */}
                  {view ? (
                    !neverCounted && view.status !== "ok" ? (
                      <StatusBadge
                        status={medSupplyStatusFromInventory(view.status)}
                        label={medSupplyBadgeLabel(
                          view.status,
                          view.lastCountedOn,
                        )}
                        size="sm"
                      />
                    ) : null
                  ) : med.low ? (
                    <Badge status="Due soon" />
                  ) : null}
                </header>
                <p>
                  {med.strength} ·{" "}
                  {countdown
                    ? neverCounted
                      ? "No count recorded yet"
                      : `${formatPillCount(countdown.pillsLeft ?? 0)} pills left`
                    : `${med.remainingPills} pills left`}
                  {med.kind === "scheduled"
                    ? countdown && !neverCounted
                      ? ` · ${med.pillsPerDay} per day · ${
                          countdown.daysLeft === null
                            ? "—"
                            : `${countdown.daysLeft} days left`
                        }`
                      : countdown
                        ? ""
                        : ` · ${med.pillsPerDay} per day · ${
                            med.daysLeft === null
                              ? "—"
                              : `${med.daysLeft} days left`
                          }`
                    : " · PRN, no automatic drop"}
                  {view
                    ? view.lastCountedOn
                      ? ` · Last counted ${formatDate(view.lastCountedOn)}`
                      : ""
                    : med.lastDeliveryOn
                      ? ` · Last counted ${formatDate(med.lastDeliveryOn)}`
                      : ""}
                </p>
                {canRecordDelivery(session.roleKey) && (
                  <DeliveryForm
                    defaultRemaining={
                      countdown && !neverCounted
                        ? (countdown.pillsLeft ?? med.remainingPills)
                        : med.remainingPills
                    }
                    defaultPerDay={med.pillsPerDay}
                    scheduled={med.kind === "scheduled"}
                    expectedPills={
                      countdown && !neverCounted ? countdown.pillsLeft : null
                    }
                    onSave={(remainingPills, pillsPerDay, varianceReason) =>
                      run(() =>
                        api.recordMedDelivery({
                          medicationId: med.id,
                          remainingPills,
                          pillsPerDay,
                          varianceReason: varianceReason || undefined,
                        }),
                      )
                    }
                  />
                )}
                {med.kind === "prn" && canLogPrnDose(session.roleKey) && (
                  <div className="stack">
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const draft = prnDraft[med.id] ?? {
                          reason: "",
                          followUp: "",
                        };
                        void run(() =>
                          api
                            .logPrnDose(med.id, {
                              pills: 1,
                              reason: draft.reason,
                              followUp: draft.followUp || undefined,
                            })
                            .then(() => {
                              setPrnDraft((prev) => ({
                                ...prev,
                                [med.id]: { reason: "", followUp: "" },
                              }));
                            }),
                        );
                      }}
                    >
                      <label>
                        Why {med.name} was given (required)
                        <input
                          value={prnDraft[med.id]?.reason ?? ""}
                          onChange={(event) =>
                            setPrnDraft((prev) => ({
                              ...prev,
                              [med.id]: {
                                reason: event.target.value,
                                followUp: prev[med.id]?.followUp ?? "",
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Follow-up note (optional)
                        <input
                          value={prnDraft[med.id]?.followUp ?? ""}
                          onChange={(event) =>
                            setPrnDraft((prev) => ({
                              ...prev,
                              [med.id]: {
                                reason: prev[med.id]?.reason ?? "",
                                followUp: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <button
                        className="button"
                        type="submit"
                        disabled={
                          !(prnDraft[med.id]?.reason ?? "").trim()
                        }
                      >
                        <Pill size={16} /> Log dose
                      </button>
                    </form>
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const draft = followup[med.id] ?? { indication: "", result: "" };
                        void run(() =>
                          api.recordPrnFollowup(med.id, draft).then(() => {
                            setFollowup((prev) => ({ ...prev, [med.id]: { indication: "", result: "" } }));
                          }),
                        );
                      }}
                    >
                      <label>
                        Why {med.name} was given
                        <input
                          value={followup[med.id]?.indication ?? ""}
                          onChange={(event) =>
                            setFollowup((prev) => ({
                              ...prev,
                              [med.id]: {
                                indication: event.target.value,
                                result: prev[med.id]?.result ?? "",
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        What you saw after
                        <input
                          value={followup[med.id]?.result ?? ""}
                          onChange={(event) =>
                            setFollowup((prev) => ({
                              ...prev,
                              [med.id]: {
                                indication: prev[med.id]?.indication ?? "",
                                result: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <button className="button secondary" type="submit">
                        Record follow-up
                      </button>
                    </form>
                  </div>
                )}
                {med.kind === "prn" && medLogs.length > 0 && (
                  <div>
                    <strong>PRN dose history</strong>
                    <ul className="person-renewals">
                      {medLogs.slice(0, 8).map((log) => (
                        <li key={log.id}>
                          {formatDate(log.givenOn)} ·{" "}
                          {formatCentralTime(log.givenAt)} —{" "}
                          {formatPillCount(log.pills)} pill
                          {log.pills === 1 ? "" : "s"} ·{" "}
                          {log.reason || "No reason recorded"} · by{" "}
                          {log.givenByName || "staff"}
                          {log.followUp
                            ? ` · Follow-up: ${log.followUp}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                    </>
                  );
                })()}
              </article>
            ))}
            {/* LIFEPATH-P6: inventory countdown (thresholds, corrections, history) */}
            <MedInventoryCard individualId={individualId} />
          </section>
        )}

        <Consents individualId={individualId} />
        <MonthlyEquipmentCard individualId={individualId} />

        {/* Personal spending: this Individual's own money — its own
            ledger on the chart, separate from the home's house card.
            Self-gated by role (nurses and HR never see it); the section
            loads its own data and contains its own errors. */}
        {canViewPersonalSpending(chartSession.roleKey) && (
          <PersonalSpendingCard
            individualId={individualId}
            individualName={person.name}
            dmhId={profile.dmhId ?? ""}
            dateOfBirth={person.dateOfBirth ?? ""}
            siteName={person.site}
            staffOptions={(workspace?.staff ?? [])
              .filter(
                (member) =>
                  member.siteId === person.siteId &&
                  (!member.expiresOn || member.expiresOn >= todayIso()),
              )
              .map((member) => ({ id: member.id, name: member.name }))}
          />
        )}

        {/* Issue #76: today's scheduled-med MAR check-off (clears Overview
            unmarked-medication due items). */}
        {canSeeChartWidgets(chartSession.roleKey) && (
          <MarCard individualId={individualId} />
        )}

        {/* Issue #75: HM alone-time editor (shrinks the required Shift-note
            range on the site Overview; never flags a missing note). */}
        <AloneTimeCard
          individualId={individualId}
          individualName={person.name}
        />

        {/* MESSAGING: conversations linked to this Individual — visible
            only to their participants (the card renders nothing otherwise). */}
        <ChartMessagesCard
          individualId={individualId}
          onOpenThread={onOpenMessageThread}
        />

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

        {/* Issue #80: Shift notes (ISP Data) — real entry surface. Joshua:
            DPMs also write notes. Keeps the quiet-link anchor honest. */}
        {isp.loading && !isp.data && ispEnabled && (
          <section
            className="chart-widget"
            id="chart-shift-notes"
            aria-labelledby="shift-notes-heading"
          >
            <h2 id="shift-notes-heading">Shift notes</h2>
            <p className="muted">Loading shift notes…</p>
          </section>
        )}
        {ispEnabled && isp.data && (
          <ShiftNoteSection
            individualId={individualId}
            data={isp.data}
            api={api}
            runIsp={runIsp}
            sessionUserId={chartSession.userId}
            roleKey={chartSession.roleKey}
            canEnter={enterShiftNotes}
            canConfigure={configureIsp}
            shiftClock={shiftClockFromFacts(
              workspace?.sites.find((site) => site.id === chartPerson.siteId) ?? {
                dayShiftStart: "06:00",
                eveningShiftStart: "14:00",
                overnightShiftStart: "22:00",
              },
            )}
            defaultLocation={chartPerson.site}
            staffTitle={displayStaffTitle(chartSession.jobTitle, chartSession.roleKey)}
            staffName={chartSession.fullName}
            legalName={profile.legalName.trim() || chartPerson.name}
            dateOfBirth={chartPerson.dateOfBirth}
            defaultWaiverService={(() => {
              const site = workspace?.sites.find((row) => row.id === chartPerson.siteId);
              const label = site?.serviceType ? SERVICE_TYPE_LABELS[site.serviceType] : "";
              return waiverServiceNames().includes(label) ? label : "";
            })()}
            staffTitles={Object.fromEntries(
              (workspace?.staff ?? []).map((member) => [
                member.id,
                member.role || roleLabel(member.roleKey),
              ]),
            )}
            onOpenNotes={openShiftNotes}
          />
        )}
        {ispEnabled && isp.error && !isp.data && (
          <section
            className="chart-widget"
            id="chart-shift-notes"
            aria-labelledby="shift-notes-heading"
          >
            <h2 id="shift-notes-heading">Shift notes</h2>
            <p className="form-error">{isp.error}</p>
          </section>
        )}

        {/* Menu records: what this Individual ate, per day and meal. Lives
            with the person's other daily records, under the Individuals tab. */}
        {canSeeMenuEntries(chartSession.roleKey) && (
          <MenuSection
            individualId={individualId}
            individualName={person.name}
            siteName={person.site}
          />
        )}
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
  expectedPills,
  onSave,
}: {
  defaultRemaining: number;
  defaultPerDay: number;
  scheduled: boolean;
  /** The countdown's expected on-hand figure; a count that differs from
   * it must carry a variance note (the API refuses it otherwise). */
  expectedPills: number | null;
  onSave: (remaining: number, perDay: number, varianceReason: string) => void;
}) {
  const [remaining, setRemaining] = useState(String(defaultRemaining));
  const [perDay, setPerDay] = useState(String(defaultPerDay || 1));
  const [varianceReason, setVarianceReason] = useState("");
  const differs =
    expectedPills !== null &&
    remaining.trim() !== "" &&
    Number(remaining) !== expectedPills;
  return (
    <form
      className="renewal-upload"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          Number(remaining),
          scheduled ? Number(perDay) : 0,
          differs ? varianceReason : "",
        );
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
      {expectedPills !== null && (
        <p className="muted">
          Expected on hand: {formatPillCount(expectedPills)} pills
        </p>
      )}
      {differs && (
        <label>
          Count variance — why the count differs (required)
          <input
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
          />
        </label>
      )}
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
      <button
        className="button primary"
        type="submit"
        disabled={differs && !varianceReason.trim()}
      >
        Record delivery count
      </button>
    </form>
  );
}
