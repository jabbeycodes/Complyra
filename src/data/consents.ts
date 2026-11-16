import { assertCalendarDate } from './access';
import { centralTodayIso } from './menuRecords';
import { todayStamp } from './status';
import type { Membership, SessionUser } from './types';
export interface ConsentType {
    id: string;
    label: string;
    required: boolean;
    medication: boolean;
}
export const DEFAULT_CONSENT_TYPES: ConsentType[] = [
    { id: 'service', label: 'Service consent', required: true, medication: false },
    { id: 'medication', label: 'Medication administration consent', required: true, medication: true },
    { id: 'information', label: 'Release of information', required: true, medication: false },
    { id: 'media', label: 'Photo/media release', required: true, medication: false },
    { id: 'rights', label: 'Rights acknowledgement', required: true, medication: false },
    { id: 'photograph', label: 'Identification and recreation photographs', required: true, medication: false },
    { id: 'emergency', label: 'Emergency services', required: true, medication: false },
    { id: 'outings', label: 'Supported community activities', required: true, medication: false },
    { id: 'law_enforcement', label: 'Law enforcement safety coordination', required: true, medication: false },
    { id: 'other', label: 'Other', required: false, medication: false },
];
export interface ConsentDraft {
    individualId: string;
    typeId: string;
    covers: string;
    giver: 'individual' | 'guardian' | 'representative';
    giverName: string;
    relationship: string;
    outcome?: string;
    packetId?: string;
    signedOn: string;
    effectiveOn: string;
    reviewOn: string;
    supersedesId: string | null;
}
export interface ConsentRecord extends ConsentDraft {
    id: string;
    agencyId: string;
    createdBy: string;
    createdAt: string;
    activatedBy: string | null;
    activatedAt: string | null;
}
export interface ConsentRevocation {
    consentId: string;
    revokedOn: string;
    revokedBy: string;
    revokedByName: string;
    reason: string;
}
export interface ConsentRegister {
    types: ConsentType[];
    records: ConsentRecord[];
    revocations: ConsentRevocation[];
    individuals: {
        id: string;
        agencyId: string;
        siteId: string;
        fullName: string;
    }[];
}
/**
 * DSP-ASSIGNED-SCOPE (founder ruling, 2026-10-31: "DSPs only see what
 * they are assigned"): narrow a consent register to a set of
 * Individuals — the ones the caller may read. Records and revocations
 * follow their Individual, so nothing about anyone outside the set
 * survives in the result. The Consents view applies this for DSPs with
 * the workspace's readable Individuals, so the register they see holds
 * only consents for Individuals at their assigned homes.
 */
export function scopeConsentRegister(
    register: ConsentRegister,
    individualIds: ReadonlySet<string>,
): ConsentRegister {
    const individuals = register.individuals.filter(p => individualIds.has(p.id));
    const records = register.records.filter(r => individualIds.has(r.individualId));
    const recordIds = new Set(records.map(r => r.id));
    const revocations = register.revocations.filter(v => recordIds.has(v.consentId));
    return { ...register, individuals, records, revocations };
}
export type ConsentStatus = 'Draft' | 'Scheduled' | 'Active' | 'Expiring soon' | 'Expired' | 'Revoked' | 'Superseded' | 'Missing';
export function canSeeConsents(roleKey: string) {
    return ['house_manager', 'program_manager', 'nurse', 'dsp', 'auditor', 'administrator'].includes(roleKey);
}
export function canManageConsents(roleKey: string) {
    return ['house_manager', 'program_manager', 'nurse', 'administrator'].includes(roleKey);
}
export function assertConsentRole(session: SessionUser, write = false) {
    if (!(write ? canManageConsents(session.roleKey) : canSeeConsents(session.roleKey)))
        throw new Error('You do not have permission to access consents.');
}
/**
 * The record-level status primitive. Every consent verdict on every
 * surface is built from this one comparison chain, and its default
 * "today" is the agency's Central calendar day (America/Chicago) —
 * the same day the med dose clock and House Card use — never the
 * viewer's device-local day. (The hosted alert sweep judges the same
 * Central day in SQL; see migration 20261031260000.)
 */
export function consentStatus(row: ConsentRecord, records: ConsentRecord[], revocations: ConsentRevocation[], today = centralTodayIso()): ConsentStatus {
    if (!row.activatedAt)
        return 'Draft';
    if (revocations.some(r => r.consentId === row.id && r.revokedOn <= today))
        return 'Revoked';
    if (records.some(r => r.supersedesId === row.id && r.activatedAt && r.effectiveOn <= today))
        return 'Superseded';
    if (row.effectiveOn > today)
        return 'Scheduled';
    if (row.reviewOn < today)
        return 'Expired';
    const days = (Date.parse(row.reviewOn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000;
    return days <= 30 ? 'Expiring soon' : 'Active';
}
export function consentOnFile(register: ConsentRegister, individualId: string, typeId: string, today = centralTodayIso()) {
    const rows = register.records.filter(r => r.individualId === individualId && r.typeId === typeId);
    const usable = rows.filter(r => ['Active', 'Expiring soon'].includes(consentStatus(r, register.records, register.revocations, today)))
        .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || b.createdAt.localeCompare(a.createdAt));
    // Fallback order is fully deterministic — latest created wins at each
    // tier, never the register's array order (the hosted register arrives
    // in unspecified database order, so rows[0] could name different
    // versions on different loads). The hosted sweep picks in exactly
    // this order: usable (effective, then created), activated, any.
    const row = usable[0]
        ?? rows.filter(r => r.activatedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        ?? [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { row, status: row ? consentStatus(row, register.records, register.revocations, today) : 'Missing' as ConsentStatus };
}
export type ConsentStatusKind =
    /** The register has not loaded (or its load failed): NO surface may render a verdict. */
    | 'unknown'
    | 'current'
    | 'expiring'
    | 'expired'
    | 'missing'
    | 'draft'
    | 'scheduled'
    | 'revoked'
    | 'superseded';
export interface ConsentStatusResult {
    kind: ConsentStatusKind;
    /** The one status word every surface renders ('Active', 'Expiring soon', …); null while unknown. */
    text: ConsentStatus | null;
    /** The record the verdict describes (the consentOnFile pick); null for unknown and missing. */
    row: ConsentRecord | null;
    /** Whole Central days from today until the picked record's review date; null when no record is picked. */
    daysUntilReview: number | null;
}
const CONSENT_KIND_BY_STATUS: Record<ConsentStatus, ConsentStatusKind> = {
    Active: 'current', 'Expiring soon': 'expiring', Expired: 'expired', Missing: 'missing',
    Draft: 'draft', Scheduled: 'scheduled', Revoked: 'revoked', Superseded: 'superseded',
};
/**
 * THE shared consent-status selector. Every surface that renders a
 * consent verdict for one Individual and consent type — the Consents
 * register, the Individual chart Consents tab, the mobile chart rows,
 * the printed summary, the Overview attention list (via consentGaps),
 * and the LocalApi alert sweep (via consentAlerts) — derives it here,
 * from the register rows themselves, so one consent can never read two
 * ways on two screens. The hosted alert sweep mirrors this computation
 * in SQL on the same Central day (migration 20261031260000).
 *
 * The load state is part of the contract: callers pass `null` (or
 * `undefined`) until their register has actually loaded, and the
 * status is `unknown` — text is null and surfaces render nothing
 * rather than a verdict. A LOADED register with no record for the
 * type is different: it honestly answers `missing`. (The rights
 * packets learned this in wave 7E: an empty, still-loading list read
 * as "Not yet signed" for everyone. An unloaded register must never
 * read as "Missing" the same way.)
 */
export function consentStatusFor(register: ConsentRegister | null | undefined, individualId: string, typeId: string, today = centralTodayIso()): ConsentStatusResult {
    if (!register)
        return { kind: 'unknown', text: null, row: null, daysUntilReview: null };
    const { row, status } = consentOnFile(register, individualId, typeId, today);
    return {
        kind: CONSENT_KIND_BY_STATUS[status],
        text: status,
        row: row ?? null,
        daysUntilReview: row ? (Date.parse(row.reviewOn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000 : null,
    };
}
/**
 * The one display rule over the selector's text: a DSP never sees the
 * word "Missing" — for them a missing consent reads "No active consent
 * available" (their register only ever carries currently usable
 * consents; that scoping is unchanged). Every other role sees the
 * status word itself. Unknown stays null: no text, no verdict.
 */
export function consentDisplayText(status: ConsentStatusResult, roleKey: string): string | null {
    if (status.text === null)
        return null;
    return roleKey === 'dsp' && status.kind === 'missing' ? 'No active consent available' : status.text;
}
/**
 * The medication-administration consent warning (founder decision
 * 2026-11-11): when an Individual's medication consent is expired,
 * missing, or revoked, the medication surfaces (chart banner, chart
 * MAR card, phone MAR) show a LOUD warning — and nothing else
 * changes. Medication actions are never blocked by consent state.
 * Every other status returns null: current and expiring soon (which
 * counts as current — the bells and lists carry that warning),
 * draft, scheduled, superseded, and the unknown/load state (an
 * unloaded register must never read as a consent problem). The DSP
 * wording follows the register's own display rule above: a DSP
 * never reads "Missing"; their register only carries usable
 * consents, so for them the warning uses the available-consent
 * wording.
 */
export function medConsentWarningText(status: ConsentStatusResult, roleKey: string): string | null {
    switch (status.kind) {
        case 'expired':
            return 'The medication administration consent has expired. Doses can still be recorded — this consent needs renewal.';
        case 'revoked':
            return 'The medication administration consent was revoked. Doses can still be recorded — check with your house manager.';
        case 'missing':
            return roleKey === 'dsp'
                ? 'No active medication administration consent is available. Doses can still be recorded — tell your house manager.'
                : 'No medication administration consent is on file. Doses can still be recorded — this consent is required.';
        default:
            return null;
    }
}
export function consentGaps(register: ConsentRegister, today = centralTodayIso()) {
    return register.individuals.flatMap(person => register.types.filter(t => t.required).flatMap(type => {
        const { row, text: status } = consentStatusFor(register, person.id, type.id, today);
        if (status === 'Active' || status === null)
            return [];
        return [{ person, type, row: row ?? undefined, status, alert: status === 'Expiring soon' ? 'expiring' : 'missing' }];
    }));
}
export function validateConsentDraft(draft: ConsentDraft, types: ConsentType[], activating = false, today = todayStamp()) {
    if (!types.some(t => t.id === draft.typeId))
        throw new Error('Choose a consent type.');
    if (draft.outcome && !['yes', 'no', 'full', 'group', 'none'].includes(draft.outcome))
        throw new Error('Choose a valid consent decision.');
    if (!['individual', 'guardian', 'representative'].includes(draft.giver))
        throw new Error('Choose who gave consent.');
    if (!draft.covers.trim() || !draft.giverName.trim() || !draft.relationship.trim())
        throw new Error('Describe the consent, giver name, and relationship.');
    for (const date of [draft.effectiveOn, draft.reviewOn])
        assertCalendarDate(date);
    if (draft.signedOn)
        assertCalendarDate(draft.signedOn);
    if (draft.reviewOn < draft.effectiveOn)
        throw new Error('Review date must be on or after the effective date.');
    if (activating && (!draft.signedOn || draft.signedOn > today || draft.signedOn > draft.reviewOn))
        throw new Error('Record a valid signed date before activation.');
}
export function validateConsentTypes(types: ConsentType[]) {
    if (!types.length || types.length > 50 || new Set(types.map(t => t.id)).size !== types.length ||
        types.some(t => !/^[a-z][a-z0-9_-]{0,49}$/.test(t.id) || !t.label.trim() || typeof t.required !== 'boolean' || typeof t.medication !== 'boolean'))
        throw new Error('Use unique consent type keys and nonempty labels (up to 50 types).');
    if (!types.some(t => t.id === 'medication' && t.medication))
        throw new Error('Keep the medication administration consent type.');
}
/**
 * The entity ids under which one consent gap's alerts can appear: the
 * consent record id once a record exists, and the person:type form used
 * before any record exists. A fresh alert for a gap retires the gap's
 * other UNREAD incarnations for the same recipient (LocalApi sweep +
 * private.sweep_consents, migration 20261031250000), so the bell never
 * shows one consent as both "missing" and "expiring" (batches 51/52/58).
 */
export function consentAlertEntityIds(register: ConsentRegister, entityId: string): string[] {
    const record = register.records.find((row) => row.id === entityId);
    if (!record)
        return [entityId];
    return [record.id, `${record.individualId}:${record.typeId}`];
}
// Missing/expiring notices fire once per consent and target on entering the window.
// Repeated sweeps dedupe permanently; there is no repeating alert cadence.
export function consentAlerts(register: ConsentRegister, memberships: Membership[], today = centralTodayIso()) {
    return consentGaps(register, today).flatMap(gap => {
        const targets = new Map<string, {
            userId: string | null;
            roleKey: string | null;
        }>();
        for (const m of memberships) {
            if (m.agencyId === gap.person.agencyId && m.roleKey === 'house_manager' && (!m.siteId || m.siteId === gap.person.siteId) && (!m.expiresOn || m.expiresOn >= today))
                targets.set(m.userId, { userId: m.userId, roleKey: null });
        }
        targets.set('role:program_manager', { userId: null, roleKey: 'program_manager' });
        targets.set('role:administrator', { userId: null, roleKey: 'administrator' });
        if (gap.type.medication)
            targets.set('role:nurse', { userId: null, roleKey: 'nurse' });
        return [...targets].map(([target, address]) => ({
            agencyId: gap.person.agencyId, ...address, type: `consent.${gap.alert}`,
            title: gap.alert === 'expiring' ? 'Consent expiring soon' : 'Consent needs attention',
            body: `${gap.person.fullName}: ${gap.type.label} — ${gap.status}.`, deepLink: '/consents',
            entityType: 'consent', entityId: gap.row?.id ?? `${gap.person.id}:${gap.type.id}`,
            dedupeKey: `consent.${gap.alert}:${gap.row?.id ?? `${gap.person.id}:${gap.type.id}`}:${target}`,
        }));
    });
}
/** Notification types whose stored rows live only while the underlying gap persists. */
export const CONSENT_ALERT_TYPES = ['consent.missing', 'consent.expiring', 'consent.packet_outstanding'] as const;
/**
 * The (type, entityId) pairs whose consent alert is currently true,
 * from the same gap computation that queues the alerts. A consent
 * carries exactly ONE current status, so at most one alert pair exists
 * per (Individual, consent type): an "Expiring soon" consent has no
 * live "missing" pair, an Active consent has neither. Stored rows
 * outside this set are stale and must retire (batch 24: the bell kept
 * saying "Consent needs attention — Missing" for consents the chart
 * already showed Active, because nothing ever retired the row).
 *
 * "Today" is the agency's Central day, the same day consentGaps and the
 * SQL sweep (America/Chicago) judge. It used to default to the device's
 * local day, so a viewer outside Central near midnight judged a consent
 * reviewed "today" as Expired and dropped the sweep's live expiring row
 * as stale (Wave 4A).
 */
export function consentAlertPairs(register: ConsentRegister, today = centralTodayIso()): Set<string> {
    return new Set(consentGaps(register, today).map(gap => `consent.${gap.alert}:${gap.row?.id ?? `${gap.person.id}:${gap.type.id}`}`));
}
export function consentAlertPairKey(type: string, entityId: string | null): string {
    return `${type}:${entityId ?? ''}`;
}
/**
 * True when a stored consent alert no longer matches reality: its
 * (type, entity) pair is not a current gap, or its packet is no
 * longer outstanding. Non-alert types (e.g. consent.packet_signed)
 * are never stale — they are the record that the work happened.
 * Rights-packet alerts REUSE the consent.missing / consent.expiring
 * types with entityType 'rights_packet', but they track packet
 * states, not consent gaps — an explicit non-'consent' entityType
 * exempts a row from the gap rule.
 */
export function isStaleConsentNotification(row: {
    type: string;
    entityId: string | null;
    entityType?: string | null;
}, livePairs: ReadonlySet<string>, outstandingPacketIds: ReadonlySet<string>): boolean {
    if (row.type === 'consent.missing' || row.type === 'consent.expiring') {
        if (row.entityType && row.entityType !== 'consent')
            return false;
        return !livePairs.has(consentAlertPairKey(row.type, row.entityId));
    }
    if (row.type === 'consent.packet_outstanding')
        return !(row.entityId !== null && outstandingPacketIds.has(row.entityId));
    return false;
}
/** Only business fields cross the local write boundary; ignore forged metadata. */
export function consentDraftFields(input: ConsentDraft): ConsentDraft {
    return { individualId: input.individualId, typeId: input.typeId, covers: input.covers,
        giver: input.giver, giverName: input.giverName, relationship: input.relationship,
        signedOn: input.signedOn, effectiveOn: input.effectiveOn, reviewOn: input.reviewOn,
        supersedesId: input.supersedesId ?? null, outcome: input.outcome };
}
export function consentOutcomeLabel(outcome?: string) {
    return ({ yes: 'Yes - permission given', no: 'No - permission not given', full: 'Full media permission', group: 'Group photographs only', none: 'No media permission' } as Record<string, string>)[outcome ?? ''] ?? 'See consent details';
}

/** Enforce the same effective-period invariant as the database signing trigger. */
export function assertSingleConsentActivation(row: ConsentRecord, records: ConsentRecord[], revocations: ConsentRevocation[]) {
    const day = (value: string) => Date.parse(value + 'T00:00:00Z');
    if (row.supersedesId) {
        const prior = records.find(r => r.id === row.supersedesId);
        if (!prior?.activatedAt || prior.agencyId !== row.agencyId || prior.individualId !== row.individualId || prior.typeId !== row.typeId || row.effectiveOn < prior.effectiveOn)
            throw new Error('Renew the same Individual and consent type on or after the prior effective date.');
        if (records.some(r => r.id !== row.id && r.supersedesId === prior.id && r.activatedAt))
            throw new Error('This consent already has a renewal.');
    }
    const conflict = records.some(r => {
        if (r.id === row.id || r.id === row.supersedesId || !r.activatedAt || r.agencyId !== row.agencyId || r.individualId !== row.individualId || r.typeId !== row.typeId) return false;
        const end = Math.min(day(r.reviewOn) + 86400000,
            ...revocations.filter(v => v.consentId === r.id).map(v => day(v.revokedOn)),
            ...records.filter(n => n.supersedesId === r.id && n.activatedAt).map(n => day(n.effectiveOn)));
        return day(r.effectiveOn) < end && day(r.effectiveOn) < day(row.reviewOn) + 86400000 && day(row.effectiveOn) < end;
    });
    if (conflict) throw new Error('Another consent covers this period. Renew the existing version or revoke it before the new effective date.');
}
