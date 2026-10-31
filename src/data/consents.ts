import { assertCalendarDate } from './access';
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
export function consentStatus(row: ConsentRecord, records: ConsentRecord[], revocations: ConsentRevocation[], today = todayStamp()): ConsentStatus {
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
export function consentOnFile(register: ConsentRegister, individualId: string, typeId: string, today = todayStamp()) {
    const rows = register.records.filter(r => r.individualId === individualId && r.typeId === typeId);
    const usable = rows.filter(r => ['Active', 'Expiring soon'].includes(consentStatus(r, register.records, register.revocations, today)))
        .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || b.createdAt.localeCompare(a.createdAt));
    const row = usable[0] ?? rows.filter(r => r.activatedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? rows[0];
    return { row, status: row ? consentStatus(row, register.records, register.revocations, today) : 'Missing' as ConsentStatus };
}
export function consentGaps(register: ConsentRegister, today = todayStamp()) {
    return register.individuals.flatMap(person => register.types.filter(t => t.required).flatMap(type => {
        const { row, status } = consentOnFile(register, person.id, type.id, today);
        if (status === 'Active')
            return [];
        return [{ person, type, row, status, alert: status === 'Expiring soon' ? 'expiring' : 'missing' }];
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
// Missing/expiring notices fire once per consent and target on entering the window.
// Repeated sweeps dedupe permanently; there is no repeating alert cadence.
export function consentAlerts(register: ConsentRegister, memberships: Membership[], today = todayStamp()) {
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
