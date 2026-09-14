import type {
  DelegationForm,
  HmWeeklyChecklist,
  StaffCertificate,
} from "../../data/types";

/**
 * Canonical signable CONTENT builders — one per document type. Every builder
 * returns a deterministic snapshot of the document's content EXCLUDING all
 * signature fields, signer names, and volatile timestamps, so the
 * tamper-evidence seal can recompute the identical hash from the live document
 * at any later time. Signed content changing afterwards -> seal reads invalid.
 */

export function trainingChecklistDocId(userId: string, siteId: string): string {
  return `staff:${userId}:${siteId}`;
}

export function legacyTrainingDocId(checklistId: string): string {
  return `checklist:${checklistId}`;
}

export function delegationFormPayload(input: {
  obligationId: string;
  individualName: string;
  taskTitle: string;
  form: DelegationForm;
}): object {
  const { form } = input;
  return {
    obligationId: input.obligationId,
    individualName: input.individualName,
    taskTitle: input.taskTitle,
    templateVersion: form.templateVersion,
    purpose: form.purpose,
    procedures: form.procedures,
    observeReportDo: form.observeReportDo,
    nonTransferableAcknowledged: form.nonTransferableAcknowledged,
    inspectionInterval: form.inspectionInterval,
    reviewDate: form.reviewDate,
    inspectionCadence: form.inspectionCadence,
    instructingProfessional: {
      name: form.instructingProfessional.name,
      title: form.instructingProfessional.title,
      contactNumber: form.instructingProfessional.contactNumber,
    },
    delegatingRn: {
      name: form.delegatingRn.name,
      contactNumber: form.delegatingRn.contactNumber,
    },
    rescindReason: form.rescindReason,
    rescindExplanation: form.rescindExplanation,
    roster: form.roster.map((row) => ({
      printName: row.printName,
      title: row.title,
      competency: [...row.competency].sort(),
      rescindedDate: row.rescindedDate,
    })),
  };
}

/** P2 training engine: the whole-checklist staff sign / HM countersign. */
export function trainingCountersignPayload(input: {
  userId: string;
  siteId: string;
  lines: Array<{ topicId: string; topicTitle: string; resolvedStatus: string }>;
}): object {
  return {
    userId: input.userId,
    siteId: input.siteId,
    lines: [...input.lines]
      .sort((a, b) => a.topicId.localeCompare(b.topicId))
      .map((line) => ({
        topicId: line.topicId,
        topicTitle: line.topicTitle,
        resolvedStatus: line.resolvedStatus,
      })),
  };
}

/** Legacy (chart) in-home training checklist card. */
export function legacyTrainingPayload(input: {
  checklistId: string;
  staffUserId: string;
  staffName: string;
  items: Array<{ id: string; title: string }>;
}): object {
  return {
    checklistId: input.checklistId,
    staffUserId: input.staffUserId,
    staffName: input.staffName,
    items: [...input.items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({ id: item.id, title: item.title })),
  };
}

export function hmChecklistPayload(checklist: HmWeeklyChecklist): object {
  return {
    checklistId: checklist.id,
    weekOf: checklist.weekOf,
    siteId: checklist.siteId,
    items: checklist.items.map((item) => ({
      key: item.key,
      answer: item.answer,
      note: item.note,
    })),
    serviceLogs: checklist.serviceLogs.map((entry) => ({
      kind: entry.kind,
      detail: entry.detail,
      staffName: entry.staffName ?? null,
      dateTime: entry.dateTime,
    })),
  };
}

export function certificatePayload(cert: StaffCertificate): object {
  return {
    certificateId: cert.id,
    userId: cert.userId,
    certName: cert.certName,
    issuedOn: cert.issuedOn,
    expiresOn: cert.expiresOn,
  };
}
