import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_CONSENT_TYPES,
    consentStatusFor,
    medConsentWarningText,
    type ConsentRecord,
    type ConsentRegister,
    type ConsentRevocation,
} from './consents';

/**
 * Founder decision 2026-11-11: an expired, missing, or revoked
 * medication administration consent produces a LOUD warning on the
 * medication surfaces and never blocks a medication action. These
 * tests pin the warning half of that rule at the shared selector:
 * which statuses warn, the exact role-dependent wording (a DSP
 * never reads "Missing"/"on file" — their register only carries
 * usable consents), and the statuses that must stay silent
 * (current, expiring soon — which counts as current — draft,
 * scheduled, and the unknown/load state).
 */

const TODAY = '2026-10-31'; // a Saturday; Central day for the fixtures below
const record = (patch: Partial<ConsentRecord> & { id: string; typeId: string }): ConsentRecord => ({
    individualId: 'i1', agencyId: 'a1', covers: 'Covers text', giver: 'guardian', giverName: 'Sam Rivera',
    relationship: 'Parent and guardian', signedOn: '2026-01-12', effectiveOn: '2026-01-12', reviewOn: '2027-01-12',
    supersedesId: null, createdBy: 'hm', createdAt: '2026-01-12T15:00:00.000Z',
    activatedBy: 'hm', activatedAt: '2026-01-12T15:05:00.000Z', ...patch,
});
const individuals = [{ id: 'i1', agencyId: 'a1', siteId: 's1', fullName: 'Taylor' }];
const registerWith = (records: ConsentRecord[], revocations: ConsentRevocation[] = []): ConsentRegister => ({
    types: DEFAULT_CONSENT_TYPES, records, revocations, individuals,
});
const warningFor = (register: ConsentRegister | null, roleKey: string) =>
    medConsentWarningText(consentStatusFor(register, 'i1', 'medication', TODAY), roleKey);

describe('medConsentWarningText', () => {
    test('expired medication consent warns (manager wording)', () => {
        const register = registerWith([
            record({ id: 'c-med', typeId: 'medication', signedOn: '2025-11-01', effectiveOn: '2025-11-01', reviewOn: '2026-10-30' }),
        ]);
        const text = warningFor(register, 'house_manager');
        assert.ok(text?.includes('has expired'), text ?? 'no warning');
        assert.ok(text?.includes('can still be recorded'), 'the warning itself states actions are not blocked');
    });

    test('missing medication consent warns; the wording is role-dependent', () => {
        const register = registerWith([record({ id: 'c-service', typeId: 'service' })]);
        const manager = warningFor(register, 'house_manager');
        assert.ok(manager?.includes('on file'), manager ?? 'no warning');
        const dsp = warningFor(register, 'dsp');
        assert.ok(dsp?.includes('No active medication administration consent is available'), dsp ?? 'no warning');
        assert.ok(!dsp?.includes('on file'), 'a DSP never reads the manager missing wording');
    });

    test('revoked medication consent warns', () => {
        const register = registerWith(
            [record({ id: 'c-med', typeId: 'medication', outcome: 'group' })],
            [{ consentId: 'c-med', revokedOn: '2026-10-20', revokedBy: 'nurse', revokedByName: 'Nurse', reason: 'Permission withdrawn' }],
        );
        const text = warningFor(register, 'house_manager');
        assert.ok(text?.includes('was revoked'), text ?? 'no warning');
    });

    test('current and expiring-soon medication consents stay silent', () => {
        const current = registerWith([record({ id: 'c-med', typeId: 'medication' })]);
        assert.equal(warningFor(current, 'house_manager'), null);
        const expiring = registerWith([
            record({ id: 'c-med', typeId: 'medication', signedOn: '2026-10-01', effectiveOn: '2026-10-01', reviewOn: '2026-11-16' }),
        ]);
        assert.equal(warningFor(expiring, 'house_manager'), null);
    });

    test('draft-only and scheduled medication consents stay silent (the alert sweep owns those)', () => {
        const draft = registerWith([
            record({ id: 'c-med', typeId: 'medication', activatedAt: null, activatedBy: null }),
        ]);
        assert.equal(warningFor(draft, 'house_manager'), null);
        const scheduled = registerWith([
            record({ id: 'c-med', typeId: 'medication', signedOn: '2026-10-15', effectiveOn: '2026-12-01', reviewOn: '2027-12-01' }),
        ]);
        assert.equal(warningFor(scheduled, 'house_manager'), null);
    });

    test('an unloaded register stays silent — unknown never reads as a consent problem', () => {
        assert.equal(warningFor(null, 'house_manager'), null);
        assert.equal(warningFor(null, 'dsp'), null);
    });

    test('a non-medication consent problem does not warn on the medication surfaces', () => {
        const register = registerWith([
            record({ id: 'c-med', typeId: 'medication' }),
            record({ id: 'c-info', typeId: 'information', signedOn: '2025-11-01', effectiveOn: '2025-11-01', reviewOn: '2026-10-30' }),
        ]);
        assert.equal(warningFor(register, 'house_manager'), null);
    });
});
