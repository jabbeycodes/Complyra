/**
 * QA-AUDIT API helpers (2026-09-14).
 *
 * Shared by the local (MemoryStore) and hosted (Supabase) backends:
 *  - row mappers between Supabase qa_* tables and the app shapes
 *  - createQaAudit expansion: build item states for a site + period and apply
 *    the five approved auto-verification mappings as locked system passes
 *  - ranking / site-history derivations from audit lists
 *
 * Everything auto-filled here is provable from existing Complyrer records and
 * locked. Unprovable items are left for the auditor — never auto-failed.
 */
import {
  QA_ITEMS,
  QA_ITEM_MAP,
  applySystemPass,
  autoVerifyItem,
  buildQaAuditItems,
  qaItemKey,
  qaQuarterMonths,
  rankQaSites,
  scoreQaAudit,
  type QaAudit,
  type QaAuditItemState,
  type QaAuditSchedule,
  type QaAutoVerifyContext,
  type QaRankedSite,
} from "./qaAudit";
import { drillsForMonth, type DrillType } from "./monthlyChecks";

/** App-shaped inputs the hosted row mappers need (column -> field). */
export function mapQaAuditRow(row: Record<string, unknown>): QaAudit {
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    siteId: String(row.site_id),
    year: Number(row.year),
    quarter: Number(row.quarter) as 1 | 2 | 3 | 4,
    status: row.status as QaAudit["status"],
    auditorId: row.auditor_id ? String(row.auditor_id) : null,
    auditorName: String(row.auditor_name ?? ""),
    auditorSignatureName: (row.auditor_signature_name as string) ?? null,
    auditorSignatureMark: (row.auditor_signature_mark as string) ?? null,
    signedAt: (row.signed_at as string) ?? null,
    score: (row.score as QaAudit["score"]) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapQaAuditItemRow(row: Record<string, unknown>): QaAuditItemState {
  return {
    key: String(row.item_key),
    itemId: String(row.item_id),
    individualId: row.individual_id ? String(row.individual_id) : null,
    individualName: (row.individual_name as string) ?? null,
    source: row.source as QaAuditItemState["source"],
    locked: Boolean(row.locked),
    result: (row.result as QaAuditItemState["result"]) ?? null,
    comment: String(row.comment ?? ""),
    status: row.status as QaAuditItemState["status"],
    systemEvidence: (row.system_evidence as string) ?? null,
    scoredBy: row.scored_by ? String(row.scored_by) : null,
    scoredByName: (row.scored_by_name as string) ?? null,
    scoredAt: (row.scored_at as string) ?? null,
    disputeNote: (row.dispute_note as string) ?? null,
    disputePhotos: Array.isArray(row.dispute_photos)
      ? (row.dispute_photos as QaAuditItemState["disputePhotos"])
      : [],
    disputeRaisedBy: row.dispute_raised_by ? String(row.dispute_raised_by) : null,
    disputeRaisedByName: (row.dispute_raised_by_name as string) ?? null,
    disputeRaisedAt: (row.dispute_raised_at as string) ?? null,
    disputeResolution:
      (row.dispute_resolution as QaAuditItemState["disputeResolution"]) ?? null,
    history: Array.isArray(row.history)
      ? (row.history as QaAuditItemState["history"])
      : [],
  };
}

export function qaAuditItemToRow(
  auditId: string,
  agencyId: string,
  item: QaAuditItemState,
): Record<string, unknown> {
  return {
    audit_id: auditId,
    agency_id: agencyId,
    item_key: item.key,
    item_id: item.itemId,
    individual_id: item.individualId,
    individual_name: item.individualName,
    source: item.source,
    locked: item.locked,
    result: item.result,
    comment: item.comment,
    status: item.status,
    system_evidence: item.systemEvidence,
    scored_by: item.scoredBy,
    scored_by_name: item.scoredByName,
    scored_at: item.scoredAt,
    dispute_note: item.disputeNote,
    dispute_photos: item.disputePhotos,
    dispute_raised_by: item.disputeRaisedBy,
    dispute_raised_by_name: item.disputeRaisedByName,
    dispute_raised_at: item.disputeRaisedAt,
    dispute_resolution: item.disputeResolution,
    history: item.history,
  };
}

export function mapQaScheduleRow(row: Record<string, unknown>): QaAuditSchedule {
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    siteId: String(row.site_id),
    nextDue: String(row.next_due),
    assignedAuditorId: row.assigned_auditor_id
      ? String(row.assigned_auditor_id)
      : null,
    assignedAuditorName: (row.assigned_auditor_name as string) ?? null,
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Build the item states for a new audit: expand the 74 base items over the
 * site's individuals, then apply the five approved auto-verification mappings
 * as locked system passes. Anything unprovable stays pending for the auditor.
 */
export function expandAndVerifyQaItems(
  individuals: { id: string; fullName: string }[],
  ctx: QaAutoVerifyContext,
): QaAuditItemState[] {
  const items = buildQaAuditItems(individuals);
  return items.map((item) => {
    const def = QA_ITEM_MAP[item.itemId];
    if (!def?.autoVerify) return item;
    const proof = autoVerifyItem(def.autoVerify, ctx, item.individualId);
    if (proof) {
      return applySystemPass(item, proof.evidence);
    }
    return item;
  });
}

/** Drill types required in a month — the agency's configured drill schedule. */
export function requiredDrillTypesForMonth(monthKey: string): DrillType[] {
  return drillsForMonth(monthKey);
}

export { qaItemKey, qaQuarterMonths, rankQaSites, scoreQaAudit, QA_ITEMS };
