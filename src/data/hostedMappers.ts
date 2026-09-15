import type { Appointment } from "./appointments";
import type { DelegationForm, IndividualRecord } from "./types";
import { blankDelegationForm, DELEGATION_ROSTER_ROWS } from "./types";
import type {
  IndividualProfile,
  ObligationItem,
  ObligationSignature,
  ClinicalRenewal,
  ClinicalEvidenceKind,
} from "./planStack";
import type {
  ChartFile,
  ChartFileKind,
  Medication,
  MedicationDelivery,
  TrainingChecklist,
  TrainingLine,
} from "./chart";
import type {
  AdaptiveEquipment,
  EquipmentMonthLog,
  EmergencyDrill,
  HomeSafetyReport,
  SafetyLine,
} from "./monthlyChecks";
import type { SiteReview, SiteReviewLine } from "./siteReview";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 10);
}

function isoDateTime(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonLines<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Db row -> ObligationItem. */
export function mapObligation(row: Row): ObligationItem {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    kind: (row.kind as ObligationItem["kind"]) ?? "protocol",
    mode: (row.mode as ObligationItem["mode"]) ?? "required",
    title: str(row.title),
    detail: str(row.detail),
    sourcePage: typeof row.source_page === "number" ? row.source_page : null,
    documentVersionId: strOrNull(row.document_version_id),
    enabled: bool(row.enabled),
    frequency: str(row.frequency) || "On plan update",
    shiftPeriods: stringArray(row.shift_periods),
    expiresOn: isoDate(row.expires_on),
    createdFrom: (row.created_from as ObligationItem["createdFrom"]) ?? "manual",
    inventoryState: (row.inventory_state as ObligationItem["inventoryState"]) ?? "present",
    proposed: bool(row.proposed),
    delegatingRnUserId: strOrNull(row.delegating_rn_user_id),
    rnSignedAt: isoDateTime(row.rn_signed_at),
    rnSignatureName: strOrNull(row.rn_signature_name),
    rnSignatureMark: strOrNull(row.rn_signature_mark),
    discontinuedAt: isoDateTime(row.discontinued_at),
    discontinueFileId: strOrNull(row.discontinue_file_id),
    discontinueTitle: strOrNull(row.discontinue_title),
    // LIFEPATH-P3 (delegation forms): delegation_form jsonb -> DelegationForm.
    delegationForm: mapDelegationForm(row.delegation_form),
  };
}

/** LIFEPATH-P3 (delegation forms): sanitize the delegation_form jsonb column. */
export function mapDelegationForm(value: unknown): DelegationForm | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const form = blankDelegationForm(
    raw.templateVersion === "complyrer_improved" ? "complyrer_improved" : "lifepath_exact",
  );
  form.purpose = str(raw.purpose);
  form.procedures = str(raw.procedures);
  form.observeReportDo = str(raw.observeReportDo);
  form.nonTransferableAcknowledged = Boolean(raw.nonTransferableAcknowledged);
  form.inspectionInterval = str(raw.inspectionInterval) || form.inspectionInterval;
  form.reviewDate = isoDate(raw.reviewDate);
  form.inspectionCadence = strOrNull(raw.inspectionCadence);
  form.rescindReason =
    raw.rescindReason === "health_status_change" || raw.rescindReason === "other"
      ? raw.rescindReason
      : null;
  form.rescindExplanation = str(raw.rescindExplanation);
  const prof = (raw.instructingProfessional ?? {}) as Record<string, unknown>;
  form.instructingProfessional = {
    name: str(prof.name),
    title: str(prof.title),
    signedAt: isoDateTime(prof.signedAt),
    contactNumber: str(prof.contactNumber),
  };
  const rn = (raw.delegatingRn ?? {}) as Record<string, unknown>;
  form.delegatingRn = {
    name: str(rn.name),
    signatureName: strOrNull(rn.signatureName),
    dateSigned: isoDate(rn.dateSigned),
    contactNumber: str(rn.contactNumber),
  };
  const rows = Array.isArray(raw.roster) ? raw.roster : [];
  form.roster = Array.from({ length: DELEGATION_ROSTER_ROWS }, (_, i) => {
    const r = (rows[i] ?? {}) as Record<string, unknown>;
    return {
      printName: str(r.printName),
      title: str(r.title),
      staffSignature: strOrNull(r.staffSignature),
      signatureName: strOrNull(r.signatureName),
      signedAt: isoDateTime(r.signedAt),
      rescindedDate: isoDate(r.rescindedDate),
      initials: strOrNull(r.initials),
      competency: Array.isArray(r.competency)
        ? (r.competency as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
    };
  });
  return form;
}

/** Partial obligation edits -> db column patch. */
export function obligationPatch(patch: Partial<
  Pick<
    ObligationItem,
    | "title"
    | "detail"
    | "mode"
    | "enabled"
    | "frequency"
    | "shiftPeriods"
    | "inventoryState"
    | "proposed"
  >
>): Row {
  const out: Row = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.detail !== undefined) out.detail = patch.detail;
  if (patch.mode !== undefined) out.mode = patch.mode;
  if (patch.enabled !== undefined) out.enabled = patch.enabled;
  if (patch.frequency !== undefined) out.frequency = patch.frequency;
  if (patch.shiftPeriods !== undefined) out.shift_periods = patch.shiftPeriods;
  if (patch.inventoryState !== undefined) out.inventory_state = patch.inventoryState;
  if (patch.proposed !== undefined) out.proposed = patch.proposed;
  return out;
}

export function mapObligationSignature(row: Row): ObligationSignature {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    obligationId: str(row.obligation_id),
    userId: str(row.user_id),
    staffName: str(row.staff_name),
    openedAt: isoDateTime(row.opened_at),
    signedAt: isoDateTime(row.signed_at),
    signatureName: strOrNull(row.signature_name),
    signatureMark: strOrNull(row.signature_mark),
  };
}

export function mapClinicalRenewal(row: Row): ClinicalRenewal {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    kind: (row.kind as ClinicalRenewal["kind"]) ?? "annual_physical",
    title: str(row.title),
    intervalMonths: num(row.interval_months, 12),
    lastUploadedOn: isoDate(row.last_uploaded_on),
    nextDueOn: isoDate(row.next_due_on) ?? "",
    lastDocumentTitle: strOrNull(row.last_document_title),
    lastEvidenceKind: (row.last_evidence_kind as ClinicalEvidenceKind) ?? null,
    fileId: strOrNull(row.file_id),
  };
}

export function mapChartFile(row: Row): ChartFile {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    kind: (row.kind as ChartFileKind) ?? "other",
    name: str(row.name),
    mime: str(row.mime) || "application/pdf",
    storagePath: str(row.storage_path),
  };
}

function clock(value: unknown): string {
  const raw = str(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw.slice(0, 5);
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function mapAppointment(row: Row): Appointment {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    startsOn: isoDate(row.starts_on) ?? "",
    startTime: clock(row.start_time),
    endTime: clock(row.end_time),
    timezone: str(row.timezone) || "America/Chicago",
    consultant: str(row.consultant),
    specialty: str(row.specialty),
    reason: str(row.reason),
    visitAddress: str(row.visit_address),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: isoDateTime(row.created_at) ?? "",
    updatedBy: str(row.updated_by),
    updatedByName: str(row.updated_by_name),
    updatedAt: isoDateTime(row.updated_at) ?? "",
    deletedBy: str(row.deleted_by),
    deletedByName: str(row.deleted_by_name),
    deletedAt: isoDateTime(row.deleted_at),
  };
}

export function mapMedication(row: Row): Medication {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    name: str(row.name),
    strength: str(row.strength),
    kind: (row.kind as Medication["kind"]) ?? "scheduled",
    controlled: bool(row.controlled),
    pillsPerDay: num(row.pills_per_day),
    remainingPills: num(row.remaining_pills),
    lastDeliveryOn: isoDate(row.last_delivery_on),
    lastCountdownOn: isoDate(row.last_countdown_on),
  };
}

export function mapMedicationDelivery(row: Row): MedicationDelivery {
  return {
    id: str(row.id),
    medicationId: str(row.medication_id),
    countedOn: isoDate(row.counted_on) ?? "",
    remainingPills: num(row.remaining_pills),
    pillsPerDay: num(row.pills_per_day),
    recordedBy: str(row.recorded_by),
  };
}

export function mapTrainingChecklist(row: Row): TrainingChecklist {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    staffUserId: str(row.staff_user_id),
    staffName: str(row.staff_name),
    documentVersionId: strOrNull(row.document_version_id),
    items: jsonLines<TrainingLine>(row.items).map((line) => ({
      id: str(line.id),
      title: str(line.title),
      initialedAt: line.initialedAt ?? null,
    })),
    staffSignedAt: isoDateTime(row.staff_signed_at),
    staffSignatureName: strOrNull(row.staff_signature_name),
    hmSignedAt: isoDateTime(row.hm_signed_at),
    hmSignatureName: strOrNull(row.hm_signature_name),
  };
}

export function mapAdaptiveEquipment(row: Row): AdaptiveEquipment {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    individualId: str(row.individual_id),
    name: str(row.name),
    source: (row.source as AdaptiveEquipment["source"]) ?? "manual",
    active: bool(row.active),
  };
}

export function mapEquipmentMonthLog(row: Row): EquipmentMonthLog {
  return {
    id: str(row.id),
    equipmentId: str(row.equipment_id),
    monthKey: str(row.month_key),
    checkedOn: isoDate(row.checked_on),
    initials: strOrNull(row.initials),
    checkedByUserId: strOrNull(row.checked_by_user_id),
    comments: str(row.comments),
  };
}

export function mapEmergencyDrill(row: Row): EmergencyDrill {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    siteId: str(row.site_id),
    monthKey: str(row.month_key),
    drillType: (row.drill_type as EmergencyDrill["drillType"]) ?? "fire",
    date: isoDate(row.date),
    time: strOrNull(row.time),
    evacTime: strOrNull(row.evac_time),
    leaderName: strOrNull(row.leader_name),
    participants: str(row.participants),
    awakeOrSleep: (row.awake_or_sleep as EmergencyDrill["awakeOrSleep"]) ?? "",
  };
}

export function mapHomeSafetyReport(row: Row): HomeSafetyReport {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    siteId: str(row.site_id),
    monthKey: str(row.month_key),
    lines: jsonLines<SafetyLine>(row.lines).map((line) => ({
      key: line.key,
      dateChecked: line.dateChecked ?? null,
      location: str(line.location),
      temp: str(line.temp),
      extra: str(line.extra),
      checkedBy: line.checkedBy ?? null,
      signature: line.signature ?? null,
    })),
  };
}

export function mapSiteReview(row: Row): SiteReview {
  return {
    id: str(row.id),
    agencyId: str(row.agency_id),
    siteId: str(row.site_id),
    reviewerName: str(row.reviewer_name),
    supportCoordinator: str(row.support_coordinator),
    reviewedOn: isoDate(row.reviewed_on) ?? "",
    providerOwnedControlled:
      row.provider_owned_controlled === null ? null : bool(row.provider_owned_controlled),
    heightenedScrutiny:
      row.heightened_scrutiny === null ? null : bool(row.heightened_scrutiny),
    meetsIndividualNeeds:
      row.meets_individual_needs === null ? null : bool(row.meets_individual_needs),
    part2Verified: bool(row.part2_verified),
    lines: jsonLines<SiteReviewLine>(row.lines).map((line) => ({
      id: str(line.id),
      status: line.status ?? "unchecked",
      comment: str(line.comment),
    })),
    updatedAt: isoDateTime(row.updated_at) ?? new Date().toISOString(),
  };
}

/** Individual profile jsonb -> normalized IndividualProfile for a person. */
export function profileFromRow(
  person: Pick<IndividualRecord, "id" | "fullName" | "dateOfBirth">,
  row: Row | null,
): Partial<IndividualProfile> | null {
  if (!row) return null;
  const stored = (row.profile ?? {}) as Partial<IndividualProfile>;
  return {
    legalName: typeof stored.legalName === "string" ? stored.legalName : person.fullName,
    goesBy: typeof stored.goesBy === "string" ? stored.goesBy : person.fullName.split(" ")[0] ?? person.fullName,
    dmhId: typeof stored.dmhId === "string" ? stored.dmhId : "",
    diagnosis: typeof stored.diagnosis === "string" ? stored.diagnosis : "",
    waiver: typeof stored.waiver === "string" ? stored.waiver : "",
    address: typeof stored.address === "string" ? stored.address : "",
    phone: typeof stored.phone === "string" ? stored.phone : "",
    language: typeof stored.language === "string" ? stored.language : "English",
    implementationStart: typeof stored.implementationStart === "string" ? stored.implementationStart : "",
    implementationEnd: typeof stored.implementationEnd === "string" ? stored.implementationEnd : "",
    serviceCoordinator: typeof stored.serviceCoordinator === "string" ? stored.serviceCoordinator : "",
    guardians: Array.isArray(stored.guardians) ? stored.guardians : [],
    sex: (stored.sex as IndividualProfile["sex"]) ?? "",
    medicaidStatus: (stored.medicaidStatus as IndividualProfile["medicaidStatus"]) ?? "",
    specializedDiet: typeof stored.specializedDiet === "string" ? stored.specializedDiet : "",
    specializedMedical: typeof stored.specializedMedical === "string" ? stored.specializedMedical : "",
    behaviorSupports: typeof stored.behaviorSupports === "string" ? stored.behaviorSupports : "",
    dailyActivities: typeof stored.dailyActivities === "string" ? stored.dailyActivities : "",
    visitHours: typeof stored.visitHours === "string" ? stored.visitHours : "",
    enrolledOn: typeof stored.enrolledOn === "string" ? stored.enrolledOn : "",
    allergies: Array.isArray(stored.allergies) ? stored.allergies : [],
    allergiesStamp: stored.allergiesStamp ?? null,
  };
}
