import type { ComplyraApi } from "../../data/localApi";
import type {
  QaAudit,
  QaAuditItemState,
  QaAuditSchedule,
  QaPhotoInput,
} from "../../data/qaAudit";

/**
 * QA Review API surface — temporary compile bridge (2026-09-14).
 *
 * The QA data workstream is porting these method declarations onto
 * `ComplyraApi` (see the old `lifepath/qa-audits` branch: these exact
 * signatures lived on `ComplyraApi` there). Until that port lands, the QA
 * Review UI calls them through this intersection type so `npx tsc -b`
 * passes. DELETE this file and use `api` directly once `ComplyraApi`
 * declares these methods natively.
 */
export interface QaApiShim {
  /** Start (or reopen) a draft audit for a site + quarter (qa.audit). */
  createQaAudit(
    siteId: string,
    year: number,
    quarter: number,
  ): Promise<QaAudit>;
  /** Audits visible to the session user (qa.audit / audit.read / audit.export). */
  listQaAudits(filter?: {
    siteId?: string;
    year?: number;
    quarter?: number;
  }): Promise<QaAudit[]>;
  /** One audit, or null. */
  getQaAudit(id: string): Promise<QaAudit | null>;
  /** All item states for an audit (locked system items included). */
  getQaAuditItems(auditId: string): Promise<QaAuditItemState[]>;
  /**
   * Score one auditor-scored item (yes / no / na / skipped). qa.audit.
   * Throws on locked system items or while a dispute is open. Throws
   * QaBlockedError when the system can prove the item is present/available
   * and it is scored "no".
   */
  scoreQaItem(
    auditId: string,
    itemKey: string,
    result: "yes" | "no" | "na" | "skipped",
    comment: string,
  ): Promise<QaAuditItemState>;
  /**
   * Finalize the audit with the auditor's adopted signature. qa.audit.
   * Throws while any item is undecided.
   */
  finalizeQaAudit(
    auditId: string,
    signature: { name: string; mark: string },
  ): Promise<QaAudit>;
  /**
   * Challenge a scored item with a note + at least one photo. qa.dispute
   * (DPM / HM). Locked system items cannot be disputed.
   */
  raiseQaDispute(
    auditId: string,
    itemKey: string,
    note: string,
    photos: QaPhotoInput[],
  ): Promise<QaAuditItemState>;
  /**
   * Approve or reject a dispute with a recorded reason. qa.audit.
   * Approving flips an incorrect No to Yes.
   */
  resolveQaDispute(
    auditId: string,
    itemKey: string,
    approved: boolean,
    reason: string,
  ): Promise<QaAuditItemState>;
  /** Schedules visible to the session user. */
  listQaSchedules(filter?: { siteId?: string }): Promise<QaAuditSchedule[]>;
  /** Create/update a site's QA schedule (qa.schedule). */
  upsertQaSchedule(input: {
    siteId: string;
    nextDue: string;
    assignedAuditorId?: string | null;
    assignedAuditorName?: string | null;
  }): Promise<QaAuditSchedule>;
}

/** ComplyraApi plus the QA Review methods the data workstream is porting. */
export type QaApi = ComplyraApi & QaApiShim;

/**
 * Data-layer contract for the QA blocking rule (2026-09-14):
 * `class QaBlockedError extends Error { evidence: string }`, thrown when an
 * item the system detects as already present/available is scored "no".
 *
 * The class is not yet exported from `../../data/qaAudit`, so this matcher
 * duck-types it (name + string evidence) instead of importing a type that
 * does not exist yet. When the data workstream exports the class, this
 * keeps working unchanged.
 */
export function asQaBlockedError(err: unknown): { evidence: string } | null {
  if (!(err instanceof Error)) return null;
  const named = err as Error & { name?: unknown; evidence?: unknown };
  if (named.name !== "QaBlockedError") return null;
  if (typeof named.evidence !== "string" || named.evidence.length === 0)
    return null;
  return { evidence: named.evidence };
}
