import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONSENT_TYPES, canManageConsents, canSeeConsents, consentAlerts, consentGaps, consentOnFile, consentStatus, validateConsentDraft, type ConsentDraft, type ConsentRecord, type ConsentRegister } from './consents';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { todayStamp } from './status';
import { notificationPage } from '../features/notifications/notify';
const draft: ConsentDraft = { individualId: 'i1', typeId: 'media', covers: 'Taking and sharing photographs for the agency newsletter.', giver: 'guardian', giverName: 'Sam Rivera', relationship: 'Parent and guardian', signedOn: '2026-10-01', effectiveOn: '2026-10-01', reviewOn: '2027-10-01', supersedesId: null };
const record: ConsentRecord = { ...draft, id: 'c1', agencyId: 'a1', createdBy: 'hm', createdAt: '2026-10-01T10:00:00Z', activatedAt: '2026-10-01T11:00:00Z', activatedBy: 'hm' };
const register: ConsentRegister = { types: DEFAULT_CONSENT_TYPES, records: [record], revocations: [], individuals: [{ id: 'i1', agencyId: 'a1', siteId: 's1', fullName: 'Taylor' }] };
test('status boundaries, revocation, supersession, and future renewal', () => {
    assert.equal(consentStatus({ ...record, activatedAt: null }, [record], [], '2026-10-27'), 'Draft');
    assert.equal(consentStatus(record, [record], [], '2026-10-27'), 'Active');
    assert.equal(consentStatus(record, [record], [], '2027-09-01'), 'Expiring soon');
    assert.equal(consentStatus(record, [record], [], '2027-10-01'), 'Expiring soon');
    assert.equal(consentStatus(record, [record], [], '2027-10-02'), 'Expired');
    assert.equal(consentStatus(record, [record], [], '2026-09-30'), 'Scheduled');
    const rev = { consentId: 'c1', revokedOn: '2026-10-20', revokedBy: 'nurse', revokedByName: 'Nurse', reason: 'Permission withdrawn' };
    assert.equal(consentStatus(record, [record], [rev], '2026-10-27'), 'Revoked');
    const renewal = { ...record, id: 'c2', supersedesId: 'c1', effectiveOn: '2026-11-01' };
    assert.equal(consentStatus(record, [record, renewal], [], '2026-10-27'), 'Active');
    assert.equal(consentStatus(record, [record, renewal], [], '2026-11-01'), 'Superseded');
    assert.equal(consentOnFile({ ...register, records: [record, renewal] }, 'i1', 'media', '2026-10-27').row?.id, 'c1');
});
test('required missing detection does not mistake drafts, revoked, expired or scheduled consents for coverage', () => {
    const gaps = consentGaps(register, '2026-10-27');
    assert.equal(gaps.length, 8);
    assert.ok(gaps.every(g => g.alert === 'missing'));
    assert.equal(consentGaps({ ...register, records: [] }, '2026-10-27').length, 9);
    assert.equal(consentGaps({ ...register, records: [{ ...record, activatedAt: null }] }, '2026-10-27').find(g => g.type.id === 'media')?.status, 'Draft');
    assert.equal(consentGaps(register, '2027-09-01').find(g => g.type.id === 'media')?.alert, 'expiring');
});
test('alert targets are home HM direct, PM broadcast, medication nurse broadcast with stable per-target keys', () => {
    const memberships = [
        { id: 'm1', agencyId: 'a1', userId: 'hm', role: 'manager' as const, roleKey: 'house_manager', siteId: 's1', expiresOn: null },
        { id: 'm2', agencyId: 'a1', userId: 'other-hm', role: 'manager' as const, roleKey: 'house_manager', siteId: 's2', expiresOn: null },
        { id: 'm3', agencyId: 'a1', userId: 'auditor', role: 'auditor' as const, roleKey: 'auditor', siteId: null, expiresOn: null },
    ];
    const alerts = consentAlerts(register, [...memberships, memberships[0]], '2026-10-27');
    assert.equal(new Set(alerts.map(a => a.dedupeKey)).size, alerts.length);
    assert.deepEqual(alerts, consentAlerts(register, memberships, '2026-10-28'));
    assert.ok(!alerts.some(a => a.userId === 'other-hm' || a.userId === 'auditor' || a.roleKey === 'auditor'));
    assert.equal(alerts.filter(a => a.roleKey === 'nurse').length, 1);
    assert.ok(alerts.filter(a => a.roleKey === 'nurse').every(a => a.entityId.endsWith(':medication')));
    assert.equal(notificationPage('/consents'), 'Consents');
});
test('role gates and invalid signed/date inputs', () => {
    for (const role of ['house_manager', 'program_manager', 'nurse'])
        assert.ok(canManageConsents(role));
    for (const role of ['dsp', 'auditor']) {
        assert.ok(canSeeConsents(role));
        assert.equal(canManageConsents(role), false);
    }
    for (const role of ['hr', 'administrator', 'compliance_admin'])
        assert.equal(canSeeConsents(role), false);
    assert.throws(() => validateConsentDraft({ ...draft, signedOn: '' }, DEFAULT_CONSENT_TYPES, true, '2026-10-27'), /signed date/);
    assert.throws(() => validateConsentDraft({ ...draft, reviewOn: '2026-02-30' }, DEFAULT_CONSENT_TYPES), /valid date/);
});
function localFixture() {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const hm = db.memberships.find(m => m.roleKey === 'house_manager')!;
    store.sessionUserId = hm.userId;
    const person = db.individuals.find(p => p.siteId === hm.siteId)!;
    return { db, store, api, hm, person, draft: { ...draft, individualId: person.id, signedOn: todayStamp(), effectiveOn: todayStamp(), reviewOn: '2099-12-31' } };
}
test('local lifecycle rejects cross-user draft tampering, forged metadata, signed edits and retains version history', async () => {
    const f = localFixture();
    const id = await f.api.saveConsent({ ...f.draft, createdBy: 'forged', activatedBy: 'forged', activatedAt: 'forged' } as ConsentDraft);
    assert.equal(f.db.consents?.[0].createdBy, f.hm.userId);
    assert.equal(f.db.consents?.[0].activatedAt, null);
    const nurse = f.db.memberships.find(m => m.roleKey === 'nurse')!;
    nurse.siteId = f.hm.siteId;
    f.store.sessionUserId = nurse.userId;
    await assert.rejects(() => f.api.saveConsent({ ...f.draft, covers: 'Tampered' }, id), /own draft/);
    await assert.rejects(() => f.api.activateConsent(id), /own draft/);
    f.store.sessionUserId = f.hm.userId;
    await f.api.activateConsent(id);
    await assert.rejects(() => f.api.saveConsent({ ...f.draft, covers: 'Tampered' }, id), /own draft/);
    await f.api.revokeConsent(id, todayStamp(), 'Individual withdrew permission.');
    assert.equal(f.db.consentRevocations?.[0].revokedBy, f.hm.userId);
    await assert.rejects(() => f.api.revokeConsent(id, todayStamp(), 'Again'), /already revoked/);
    const renewed = await f.api.saveConsent({ ...f.draft, supersedesId: id });
    await f.api.activateConsent(renewed);
    const history = await f.api.getConsents();
    assert.equal(history.records.length, 2);
    assert.equal(history.revocations.length, 1);
    history.records[0].covers = 'Mutating returned data';
    assert.equal(f.db.consents?.[0].covers, f.draft.covers);
});
test('local scoped access, DSP active-only and auditor read-only, HR excluded', async () => {
    const f = localFixture();
    const id = await f.api.saveConsent(f.draft);
    await f.api.activateConsent(id);
    const outside = f.db.individuals.find(p => p.siteId !== f.person.siteId)!;
    await assert.rejects(() => f.api.saveConsent({ ...f.draft, individualId: outside.id }), /outside/);
    const dsp = f.db.memberships.find(m => m.roleKey === 'dsp' && m.siteId === f.person.siteId)!;
    f.store.sessionUserId = dsp.userId;
    assert.equal((await f.api.getConsents()).records.length, 1);
    await assert.rejects(() => f.api.revokeConsent(id, todayStamp(), 'Forged'), /permission/);
    f.store.sessionUserId = f.hm.userId;
    await f.api.revokeConsent(id, todayStamp(), 'Withdrawn');
    f.store.sessionUserId = dsp.userId;
    assert.equal((await f.api.getConsents()).records.length, 0);
    for (const role of ['auditor', 'hr'] as const) {
        const member = f.db.memberships.find(m => m.roleKey === 'nurse' || m.roleKey === 'auditor')!;
        member.roleKey = role;
        member.role = role;
        member.siteId = null;
        f.store.sessionUserId = member.userId;
        await assert.rejects(() => f.api.saveConsent(f.draft), /permission/);
        await assert.rejects(() => f.api.revokeConsent(id, todayStamp(), 'Forged'), /permission/);
        if (role === 'auditor')
            assert.equal((await f.api.getConsents()).records.length, 1);
        else
            await assert.rejects(() => f.api.getConsents(), /permission/);
    }
});
test('local notification sweep dedupes repeated refreshes', async () => {
    const f = localFixture();
    await f.api.listNotifications();
    const first = f.db.notifications.filter(n => n.type.startsWith('consent.')).length;
    assert.ok(first > 0);
    await f.api.listNotifications();
    assert.equal(f.db.notifications.filter(n => n.type.startsWith('consent.')).length, first);
});

test('local activation rejects contradictory standalone and future versions; renewals give DSPs one current decision', async () => {
    const f = localFixture();
    const first = await f.api.saveConsent({...f.draft, outcome: 'none'});
    await f.api.activateConsent(first);
    const duplicate = await f.api.saveConsent({...f.draft, outcome: 'full'});
    await assert.rejects(() => f.api.activateConsent(duplicate), /Another consent covers this period/);
    assert.equal(f.db.consents?.find(r => r.id === duplicate)?.activatedAt, null);
    const renewed = await f.api.saveConsent({...f.draft, outcome:'full', supersedesId:first});
    await f.api.activateConsent(renewed);
    const dsp = f.db.memberships.find(m => m.roleKey === 'dsp' && m.siteId === f.person.siteId)!;
    f.store.sessionUserId = dsp.userId;
    assert.deepEqual((await f.api.getConsents()).records.map(r => r.id), [renewed]);
    f.store.sessionUserId = f.hm.userId;
    const scheduled = await f.api.saveConsent({...f.draft, supersedesId:renewed, effectiveOn:'2090-01-01'});
    await f.api.activateConsent(scheduled);
    const future = await f.api.saveConsent({...f.draft, effectiveOn:'2091-01-01'});
    await assert.rejects(() => f.api.activateConsent(future), /Another consent covers this period/);
    const all = await f.api.getConsents();
    assert.equal(consentOnFile(all, f.person.id, 'media', '2089-12-31').row?.id, renewed);
    assert.equal(consentOnFile(all, f.person.id, 'media', '2090-01-01').row?.id, scheduled);
    assert.equal(all.records.filter(r => ['Active','Expiring soon'].includes(consentStatus(r,all.records,all.revocations,'2090-01-01'))).length, 1);
});
