import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_CONSENT_TYPES,
    consentAlerts,
    consentDisplayText,
    consentGaps,
    consentOnFile,
    consentStatus,
    consentStatusFor,
    type ConsentRecord,
    type ConsentRegister,
    type ConsentRevocation,
} from './consents';
import { centralTodayIso } from './menuRecords';
import { consentTypeRows } from '../features/mobile/chartSections';

/**
 * Wave 7J — consent status agreement (simulation batch 38, with the
 * batch 10/24 alert contradictions).
 *
 * The disagreement: one Individual's consent read differently on
 * different surfaces — "Expiring soon" on the chart while the bell
 * said "Missing"/"Expired" for the same consent, DSP wording vs
 * manager wording, alerts naming a state the register did not show.
 * The screens themselves already shared the TS helpers; the divergent
 * computations were (1) "today" itself — the browser's device-local
 * day in TS vs the database's UTC `current_date` in the hosted SQL
 * sweep and the DSP row gate, neither of them the agency's Central
 * day; and (2) the hosted sweep's own SQL re-implementation of the
 * status chain and representative-row pick (aligned by migration
 * 20261031260000). Plus the wave-7E hazard in waiting: a helper that
 * answers "Missing" for any register it is handed would fabricate
 * that verdict from a still-loading (empty) list.
 *
 * These tests pin the fix: ONE shared selector (consentStatusFor)
 * that every surface derives from, with the load state inside the
 * contract — null/undefined register is 'unknown' and carries NO
 * text; a loaded register answers honestly, 'missing' included —
 * judged on the Central calendar day, returning identical text in
 * the LocalApi register shape, the HostedApi register shape, and
 * (for the records it carries) the DSP-scoped register shape.
 */

const TODAY = '2026-10-31'; // a Saturday; Central day for the fixtures below
const record = (patch: Partial<ConsentRecord> & { id: string; typeId: string }): ConsentRecord => ({
    individualId: 'i1', agencyId: 'a1', covers: 'Covers text', giver: 'guardian', giverName: 'Sam Rivera',
    relationship: 'Parent and guardian', signedOn: '2026-01-12', effectiveOn: '2026-01-12', reviewOn: '2027-01-12',
    supersedesId: null, createdBy: 'hm', createdAt: '2026-01-12T15:00:00.000Z',
    activatedBy: 'hm', activatedAt: '2026-01-12T15:05:00.000Z', ...patch,
});
const records: ConsentRecord[] = [
    // service — current, well outside the review window.
    record({ id: 'c-service', typeId: 'service' }),
    // medication — inside the 30-day window: expiring, 16 days left.
    record({ id: 'c-med', typeId: 'medication', signedOn: '2026-10-01', effectiveOn: '2026-10-01', reviewOn: '2026-11-16', createdAt: '2026-10-01T15:00:00.000Z' }),
    // information — review date passed: expired.
    record({ id: 'c-info', typeId: 'information', signedOn: '2025-11-01', effectiveOn: '2025-11-01', reviewOn: '2026-10-30', createdAt: '2025-11-01T15:00:00.000Z' }),
    // emergency — review date IS today: expiring at 0 days, never expired.
    record({ id: 'c-emerg', typeId: 'emergency', signedOn: '2025-01-01', effectiveOn: '2025-01-01', reviewOn: '2026-10-31', createdAt: '2025-01-01T15:00:00.000Z' }),
    // rights — a draft only.
    record({ id: 'c-rights', typeId: 'rights', activatedAt: null, activatedBy: null }),
    // outings — activated but effective in the future: scheduled.
    record({ id: 'c-out', typeId: 'outings', signedOn: '2026-10-15', effectiveOn: '2026-12-01', reviewOn: '2027-12-01', createdAt: '2026-10-15T15:00:00.000Z' }),
    // media — revoked on 2026-10-20.
    record({ id: 'c-media', typeId: 'media', outcome: 'group' }),
    // law_enforcement — backfilled pair: the renewal (created earlier)
    // is itself expired, the superseded original was created later, so
    // the deterministic pick names the original: superseded.
    record({ id: 'c-le-old', typeId: 'law_enforcement', signedOn: '2025-01-01', effectiveOn: '2025-01-01', reviewOn: '2025-12-31', createdAt: '2026-10-25T15:00:00.000Z' }),
    record({ id: 'c-le-new', typeId: 'law_enforcement', supersedesId: 'c-le-old', signedOn: '2025-06-01', effectiveOn: '2025-06-01', reviewOn: '2026-06-30', createdAt: '2025-06-01T15:00:00.000Z' }),
    // photograph — no record at all: missing.
];
const revocations: ConsentRevocation[] = [
    { consentId: 'c-media', revokedOn: '2026-10-20', revokedBy: 'nurse', revokedByName: 'Nurse', reason: 'Permission withdrawn' },
];
const individuals = [{ id: 'i1', agencyId: 'a1', siteId: 's1', fullName: 'Taylor' }];
const register: ConsentRegister = { types: DEFAULT_CONSENT_TYPES, records, revocations, individuals };

/**
 * The same register in HostedApi's shape: hostedApi.getConsents maps
 * individual_consents rows by spreading the `details` jsonb and
 * overriding with the table columns. Feeding the selector rows built
 * exactly that way proves the verdicts do not depend on the API mode.
 */
function hostedRegister(): ConsentRegister {
    const hostedRow = (r: ConsentRecord) => {
        // The details jsonb carries only the fields that were recorded —
        // an unrecorded outcome is an absent key, never an undefined one.
        const details: Record<string, unknown> = { covers: r.covers, giver: r.giver, giverName: r.giverName, relationship: r.relationship, signedOn: r.signedOn, effectiveOn: r.effectiveOn, reviewOn: r.reviewOn };
        if (r.outcome !== undefined)
            details.outcome = r.outcome;
        return {
            ...details,
            id: r.id, agencyId: r.agencyId, individualId: r.individualId, typeId: r.typeId,
            supersedesId: r.supersedesId, createdBy: r.createdBy, createdAt: r.createdAt, activatedBy: r.activatedBy, activatedAt: r.activatedAt,
        } as ConsentRecord;
    };
    return { types: DEFAULT_CONSENT_TYPES, records: records.map(hostedRow), revocations: [...revocations], individuals };
}

/**
 * The DSP-scoped register shape (PR #218's scoping, unchanged): a DSP
 * receives only currently usable records and no revocations — the
 * LocalApi filter and the hosted RLS gate produce this same shape.
 */
function dspRegister(): ConsentRegister {
    const usable = records.filter(r => ['Active', 'Expiring soon'].includes(consentStatus(r, records, revocations, TODAY)));
    return { types: DEFAULT_CONSENT_TYPES, records: usable, revocations: [], individuals };
}

const EXPECTED: Record<string, { kind: string; text: string; days: number | null }> = {
    service: { kind: 'current', text: 'Active', days: 73 },
    medication: { kind: 'expiring', text: 'Expiring soon', days: 16 },
    information: { kind: 'expired', text: 'Expired', days: -1 },
    emergency: { kind: 'expiring', text: 'Expiring soon', days: 0 },
    rights: { kind: 'draft', text: 'Draft', days: 73 },
    outings: { kind: 'scheduled', text: 'Scheduled', days: 396 },
    media: { kind: 'revoked', text: 'Revoked', days: 73 },
    law_enforcement: { kind: 'superseded', text: 'Superseded', days: -304 },
    photograph: { kind: 'missing', text: 'Missing', days: null },
    other: { kind: 'missing', text: 'Missing', days: null },
};

test('one selector, every state: current / expiring-with-days / expired / missing and the record states', () => {
    for (const type of DEFAULT_CONSENT_TYPES) {
        const result = consentStatusFor(register, 'i1', type.id, TODAY);
        const want = EXPECTED[type.id];
        assert.equal(result.kind, want.kind, `${type.id} kind`);
        assert.equal(result.text, want.text, `${type.id} text`);
        assert.equal(result.daysUntilReview, want.days, `${type.id} days`);
    }
    // The verdict names the same record consentOnFile has always picked.
    assert.equal(consentStatusFor(register, 'i1', 'medication', TODAY).row?.id, 'c-med');
    assert.equal(consentStatusFor(register, 'i1', 'law_enforcement', TODAY).row?.id, 'c-le-old');
    assert.equal(consentStatusFor(register, 'i1', 'photograph', TODAY).row, null);
});

test('identical verdicts in the LocalApi and HostedApi register shapes', () => {
    const hosted = hostedRegister();
    for (const type of DEFAULT_CONSENT_TYPES) {
        assert.deepEqual(
            consentStatusFor(hosted, 'i1', type.id, TODAY),
            consentStatusFor(register, 'i1', type.id, TODAY),
            `${type.id} must not depend on the API mode`,
        );
    }
});

test('every surface derives the same text: register selector, mobile rows, attention gaps, alert bodies', () => {
    const rows = consentTypeRows(register, 'i1', 'house_manager');
    const gaps = consentGaps(register, TODAY);
    for (const type of DEFAULT_CONSENT_TYPES) {
        const selector = consentStatusFor(register, 'i1', type.id, TODAY);
        // The mobile chart row renders the selector's word verbatim.
        assert.equal(rows.find(r => r.type.id === type.id)?.status, selector.text, `${type.id} mobile row`);
        // The attention list (Overview + register banner) is the same verdict.
        const gap = gaps.find(g => g.type.id === type.id);
        if (selector.text === 'Active' || !type.required)
            assert.equal(gap, undefined, `${type.id} must not be a gap`);
        else {
            assert.equal(gap?.status, selector.text, `${type.id} gap status`);
            assert.equal(gap?.row?.id, selector.row?.id, `${type.id} gap row`);
            assert.equal(gap?.alert, selector.text === 'Expiring soon' ? 'expiring' : 'missing', `${type.id} gap class`);
        }
    }
    // The LocalApi alert sweep speaks the selector's words too.
    const memberships = [
        { id: 'm1', agencyId: 'a1', userId: 'hm', role: 'manager' as const, roleKey: 'house_manager', siteId: 's1', expiresOn: null },
    ];
    const alerts = consentAlerts(register, memberships, TODAY);
    const medAlert = alerts.find(a => a.entityId === 'c-med');
    assert.equal(medAlert?.type, 'consent.expiring');
    assert.equal(medAlert?.body, 'Taylor: Medication administration consent — Expiring soon.');
    const infoAlert = alerts.find(a => a.entityId === 'c-info');
    assert.equal(infoAlert?.body, 'Taylor: Release of information — Expired.');
});

test('the not-yet-loaded case: an unloaded register is unknown and carries no verdict', () => {
    for (const empty of [null, undefined] as const) {
        const result = consentStatusFor(empty, 'i1', 'service', TODAY);
        assert.deepEqual(result, { kind: 'unknown', text: null, row: null, daysUntilReview: null });
        // No surface can coax a word out of it, for any role.
        assert.equal(consentDisplayText(result, 'house_manager'), null);
        assert.equal(consentDisplayText(result, 'dsp'), null);
    }
    // A LOADED register with no records is a different, honest answer.
    const loadedEmpty: ConsentRegister = { types: DEFAULT_CONSENT_TYPES, records: [], revocations: [], individuals };
    const missing = consentStatusFor(loadedEmpty, 'i1', 'service', TODAY);
    assert.equal(missing.kind, 'missing');
    assert.equal(missing.text, 'Missing');
});

test('DSP shape: usable verdicts identical, non-usable types honestly masked — the #218 scoping, pinned', () => {
    const dsp = dspRegister();
    for (const typeId of ['service', 'medication', 'emergency']) {
        assert.equal(consentStatusFor(dsp, 'i1', typeId, TODAY).text, EXPECTED[typeId].text, `${typeId} agrees across shapes`);
    }
    // An expired-only type is outside the DSP register entirely: the
    // selector answers missing over that shape, and the shared display
    // rule masks the word — the same text on the register page and the
    // mobile rows, and never the manager's word.
    const scoped = consentStatusFor(dsp, 'i1', 'information', TODAY);
    assert.equal(scoped.kind, 'missing');
    assert.equal(consentDisplayText(scoped, 'dsp'), 'No active consent available');
    assert.equal(consentTypeRows(dsp, 'i1', 'dsp').find(r => r.type.id === 'information')?.status, 'No active consent available');
    assert.equal(consentDisplayText(consentStatusFor(register, 'i1', 'information', TODAY), 'house_manager'), 'Expired');
    assert.equal(consentDisplayText(consentStatusFor(register, 'i1', 'photograph', TODAY), 'dsp'), 'No active consent available');
    assert.equal(consentDisplayText(consentStatusFor(register, 'i1', 'photograph', TODAY), 'auditor'), 'Missing');
});

test('the representative-row pick is deterministic — never the register array order', () => {
    const older = record({ id: 'c-other-old', typeId: 'other', activatedAt: null, activatedBy: null, createdAt: '2026-10-01T15:00:00.000Z' });
    const newer = record({ id: 'c-other-new', typeId: 'other', activatedAt: null, activatedBy: null, createdAt: '2026-10-20T15:00:00.000Z' });
    const forward: ConsentRegister = { types: DEFAULT_CONSENT_TYPES, records: [older, newer], revocations: [], individuals };
    const reversed: ConsentRegister = { types: DEFAULT_CONSENT_TYPES, records: [newer, older], revocations: [], individuals };
    assert.equal(consentOnFile(forward, 'i1', 'other', TODAY).row?.id, 'c-other-new');
    assert.equal(consentOnFile(reversed, 'i1', 'other', TODAY).row?.id, 'c-other-new');
    assert.equal(consentStatusFor(reversed, 'i1', 'other', TODAY).text, 'Draft');
});

test('dates are judged on the Central calendar, not the device or UTC day', () => {
    // 2026-11-01T01:30:00Z is Oct 31, 8:30 PM in Chicago (CDT): the
    // Central day is still Oct 31 while the UTC day is already Nov 1.
    assert.equal(centralTodayIso(new Date('2026-11-01T01:30:00Z')), '2026-10-31');
    assert.equal(centralTodayIso(new Date('2026-11-01T04:30:00Z')), '2026-10-31');
    // Fall-back day: 2026-11-01T06:30:00Z is 1:30 AM CST — Nov 1 Central.
    assert.equal(centralTodayIso(new Date('2026-11-01T06:30:00Z')), '2026-11-01');
    // The batch-38 evening split, pinned: the emergency consent whose
    // review date is Oct 31 reads "Expiring soon" (0 days) on the
    // Central day and "Expired" on the UTC day. The selector's default
    // is the Central reading.
    const centralDay = centralTodayIso(new Date('2026-11-01T01:30:00Z'));
    assert.equal(consentStatusFor(register, 'i1', 'emergency', centralDay).text, 'Expiring soon');
    assert.equal(consentStatusFor(register, 'i1', 'emergency', centralDay).daysUntilReview, 0);
    assert.equal(consentStatusFor(register, 'i1', 'emergency', '2026-11-01').text, 'Expired');
    // And the defaults across the whole status family are Central.
    assert.deepEqual(consentStatusFor(register, 'i1', 'service'), consentStatusFor(register, 'i1', 'service', centralTodayIso()));
    const service = records.find(r => r.id === 'c-service')!;
    assert.equal(consentStatus(service, records, revocations), consentStatus(service, records, revocations, centralTodayIso()));
    assert.deepEqual(consentGaps(register), consentGaps(register, centralTodayIso()));
});
