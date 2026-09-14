import type {
  DelegationForm,
  HmWeeklyChecklist,
  SignatureEvent,
  StaffCertificate,
  TrainingRequirementView,
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

/**
 * Per-line e-initials: the signature field name for one initialing of one
 * training line. Versioned so an edited line (void-and-redo) gets a fresh
 * field — the old version's event stays as history and can never collide.
 */
export function trainingLineFieldName(
  requirementId: string,
  signoffVersion: number,
): string {
  return `line:${requirementId}:v${signoffVersion}`;
}

/** Parse a `line:<requirementId>:v<version>` field name; null for anything else. */
export function parseTrainingLineField(fieldName: string): {
  requirementId: string;
  version: number;
} | null {
  const match = /^line:(.+):v(\d+)$/.exec(fieldName);
  if (!match) return null;
  return { requirementId: match[1], version: Number(match[2]) };
}

/**
 * The LATEST per-line initials event for one requirement (highest version
 * wins; older versions stay as history). Null when the line was never
 * stamped. The UI stamp always reflects this event — never an older one.
 */
export function latestLineEvent(
  events: SignatureEvent[],
  requirementId: string,
): SignatureEvent | null {
  let latest: SignatureEvent | null = null;
  let latestVersion = 0;
  for (const event of events) {
    const parsed = parseTrainingLineField(event.fieldName);
    if (!parsed || parsed.requirementId !== requirementId) continue;
    if (parsed.version >= latestVersion) {
      latest = event;
      latestVersion = parsed.version;
    }
  }
  return latest;
}

/** True when the line's current sign-off version has no matching stamp. */
export function lineNeedsReinitial(
  signoff: { na: boolean; signoffVersion: number } | null,
  events: SignatureEvent[],
  requirementId: string,
): boolean {
  if (!signoff || signoff.na) return false;
  const latest = latestLineEvent(events, requirementId);
  const latestVersion = latest
    ? (parseTrainingLineField(latest.fieldName)?.version ?? 0)
    : 0;
  return latestVersion !== signoff.signoffVersion;
}

/** Deterministic signable CONTENT of one training-line initialing. */
export interface TrainingLinePayloadInput {
  topicId: string;
  topicTitle: string;
  resolvedStatus: string;
  trainerName: string;
  hoursTotal: number;
  hoursWithHm: number;
  signedOn: string;
  na: boolean;
  naReason: string | null;
  signoffVersion: number;
}

/**
 * Per-line e-initials payload: a deterministic snapshot of the line,
 * EXCLUDING all signature fields, signer names, and volatile timestamps, so
 * the tamper-evidence seal recomputes the identical hash from the live line
 * at any later time. Signed content changing afterwards -> seal reads invalid.
 */
export function trainingLinePayload(input: TrainingLinePayloadInput): object {
  return {
    topicId: input.topicId,
    topicTitle: input.topicTitle,
    resolvedStatus: input.resolvedStatus,
    trainerName: input.trainerName,
    hoursTotal: input.hoursTotal,
    hoursWithHm: input.hoursWithHm,
    signedOn: input.signedOn.slice(0, 10),
    na: input.na,
    naReason: input.naReason,
    signoffVersion: input.signoffVersion,
  };
}

/**
 * Rebuild the per-line payload from the LIVE requirement view. The seal on a
 * line-initials stamp calls this — it must produce the identical object the
 * initialing modal signed, or the seal reads invalid (tamper evidence).
 * Only valid for the line's LATEST sign-off version: after a void-and-redo
 * edit the old version's event is history and is never re-verified.
 */
export function trainingLinePayloadFromView(
  line: TrainingRequirementView,
): object {
  const signoff = line.signoff;
  if (!signoff) throw new Error("Training line has no sign-off.");
  return trainingLinePayload({
    topicId: line.topicId,
    topicTitle: line.topicTitle,
    resolvedStatus: line.resolvedStatus,
    trainerName: signoff.trainerName,
    hoursTotal: signoff.hoursTotal,
    hoursWithHm: signoff.hoursWithHm,
    signedOn: signoff.signedOn,
    na: signoff.na,
    naReason: signoff.naReason,
    signoffVersion: signoff.signoffVersion,
  });
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

/**
 * Delegation roster row initials (the paper form's per-row "Initials"
 * column): the whole-form snapshot plus the stable row key being initialed,
 * so the tamper-evidence seal binds the initials to this exact form content.
 * Excludes all signature/initials fields, signer names, and timestamps.
 */
export function delegationRowInitialsPayload(input: {
  obligationId: string;
  individualName: string;
  taskTitle: string;
  form: DelegationForm;
  rowKey: string;
}): object {
  return {
    ...delegationFormPayload({
      obligationId: input.obligationId,
      individualName: input.individualName,
      taskTitle: input.taskTitle,
      form: input.form,
    }),
    rowKey: input.rowKey,
  };
}
