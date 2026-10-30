import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addOneYear,
    isCompletedRightsPacket,
    rightsPacketAlerts,
    rightsRenewalFor,
    rightsTrackingFor,
    rightsTrackingText,
    validateRightsCompletion,
    type RightsPacket,
    type RightsPacketCompletion,
} from './rightsPackets';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { todayStamp } from './status';

const signer = { printedName: 'Dana Hart', authority: 'Guardian', authorityOther: '', signature: 'Dana Hart', witness: 'Casey Adams', accepted: true };
const packet = (patch: Partial<RightsPacket>): RightsPacket => ({
    id: 'p1', agencyId: 'a1', individualId: 'i1', createdBy: 'hm', createdAt: '2026-01-01T10:00:00Z',
    signerName: 'Dana Hart', reviewedBy: '', packetOn: null, status: 'awaiting_signature',
    signer: null, signedAt: null, filedAt: null, evidenceName: null, copyVersion: 'v1', ...patch,
});

test('addOneYear advances a calendar year, clamping Feb 29 to Feb 28', () => {
    assert.equal(addOneYear('2025-07-28'), '2026-07-28');
    assert.equal(addOneYear('2024-02-29'), '2025-02-28');
    assert.equal(addOneYear('2026-12-31'), '2027-12-31');
});

test('countdown text: Renews in / Due in / Due today / Overdue by, singular and plural', () => {
    const today = '2026-10-30';
    assert.equal(rightsRenewalFor('2026-03-21', today).text, 'Renews in 142 days');
    assert.equal(rightsRenewalFor('2025-11-11', today).text, 'Due in 12 days');
    assert.equal(rightsRenewalFor('2025-10-31', today).text, 'Due in 1 day');
    assert.equal(rightsRenewalFor('2025-10-30', today).text, 'Due today');
    assert.equal(rightsRenewalFor('2025-10-25', today).text, 'Overdue by 5 days');
    assert.equal(rightsRenewalFor('2025-10-29', today).text, 'Overdue by 1 day');
    assert.equal(rightsRenewalFor('2025-11-11', today).state, 'due_soon');
    assert.equal(rightsRenewalFor('2025-11-29', today).state, 'due_soon');
    assert.equal(rightsRenewalFor('2025-11-29', today).text, 'Due in 30 days');
    assert.equal(rightsRenewalFor('2025-11-30', today).state, 'current');
    assert.equal(rightsRenewalFor('2025-12-01', today).state, 'current');
    assert.equal(rightsRenewalFor('2025-10-25', today).state, 'overdue');
    assert.equal(rightsRenewalFor('2025-11-11', today).renewalOn, '2026-11-11');
});

test('tracking reflects the LATEST completed packet; awaiting alone is Not yet signed', () => {
    const today = '2026-10-30';
    const older = packet({ id: 'old', packetOn: '2024-05-01', status: 'signed', signer, signedAt: '2024-05-01T10:00:00Z', createdAt: '2024-05-01T09:00:00Z' });
    const latest = packet({ id: 'new', packetOn: '2026-10-01', status: 'filed', signer, signedAt: '2026-10-01T10:00:00Z', createdAt: '2026-10-01T09:00:00Z' });
    const awaiting = packet({ id: 'next', createdAt: '2026-10-29T09:00:00Z' });
    const tracked = rightsTrackingFor([older, awaiting, latest], today);
    assert.equal(tracked.kind, 'tracked');
    if (tracked.kind === 'tracked') {
        assert.equal(tracked.packet.id, 'new');
        assert.equal(tracked.renewal.renewalOn, '2027-10-01');
    }
    const unsigned = rightsTrackingFor([awaiting], today);
    assert.equal(unsigned.kind, 'not_signed');
    assert.equal(rightsTrackingText(unsigned), 'Not yet signed');
    assert.equal(rightsTrackingFor([], today).kind, 'not_signed');
    assert.equal(isCompletedRightsPacket(packet({ status: 'signed', packetOn: null })), false);
});

test('completion validation: typed date required, never future; authority rules', () => {
    const good: RightsPacketCompletion = { reviewedBy: 'James Wilson', packetOn: '2026-10-01', signer };
    validateRightsCompletion(good, '2026-10-30');
    assert.throws(() => validateRightsCompletion({ ...good, packetOn: '2026-10-31' }, '2026-10-30'), /future/);
    assert.throws(() => validateRightsCompletion({ ...good, packetOn: '2026-02-30' }, '2026-10-30'), /valid date/);
    assert.throws(() => validateRightsCompletion({ ...good, reviewedBy: ' ' }, '2026-10-30'), /reviewed/);
    assert.throws(() => validateRightsCompletion({ ...good, signer: { ...signer, authority: 'Other', authorityOther: '' } }, '2026-10-30'), /authority/);
    assert.throws(() => validateRightsCompletion({ ...good, signer: { ...signer, witness: '' } }, '2026-10-30'), /witness/);
    assert.throws(() => validateRightsCompletion({ ...good, signer: { ...signer, accepted: false } }, '2026-10-30'), /agreement/);
});

test('alerts target the home HM and program managers, with stable dedupe keys', () => {
    const memberships = [
        { id: 'm1', agencyId: 'a1', userId: 'hm', role: 'manager' as const, roleKey: 'house_manager', siteId: 's1', expiresOn: null },
        { id: 'm2', agencyId: 'a1', userId: 'other-hm', role: 'manager' as const, roleKey: 'house_manager', siteId: 's2', expiresOn: null },
        { id: 'm3', agencyId: 'a1', userId: 'aud', role: 'auditor' as const, roleKey: 'auditor', siteId: null, expiresOn: null },
    ];
    const person = { id: 'i1', agencyId: 'a1', siteId: 's1', fullName: 'Ellis Hart' };
    const dueSoon = rightsPacketAlerts([{ person, tracking: { kind: 'tracked', packet: packet({ id: 'p9', packetOn: '2025-11-11', status: 'signed', signer }), renewal: rightsRenewalFor('2025-11-11', '2026-10-30') } }], memberships, '2026-10-30');
    assert.equal(dueSoon.length, 2);
    assert.ok(dueSoon.every(a => a.type === 'consent.expiring' && a.entityType === 'rights_packet'));
    assert.ok(!dueSoon.some(a => a.userId === 'other-hm' || a.userId === 'aud'));
    const missing = rightsPacketAlerts([{ person, tracking: { kind: 'not_signed', packet: null } }], memberships, '2026-10-30');
    assert.equal(missing.length, 2);
    assert.ok(missing.every(a => a.type === 'consent.missing'));
    const current = rightsPacketAlerts([{ person, tracking: { kind: 'tracked', packet: packet({ id: 'p8', packetOn: '2026-10-01', status: 'signed', signer }), renewal: rightsRenewalFor('2026-10-01', '2026-10-30') } }], memberships, '2026-10-30');
    assert.equal(current.length, 0);
});

function localFixture() {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const hm = db.memberships.find(m => m.roleKey === 'house_manager')!;
    store.sessionUserId = hm.userId;
    const person = db.individuals.find(p => p.siteId === hm.siteId && !db.rightsPackets?.some(r => r.individualId === p.id))!;
    return { db, store, api, hm, person };
}

test('local lifecycle: start, sign with a TYPED past date, immutability, renewal year', async () => {
    const f = localFixture();
    const id = await f.api.createRightsPacket({ individualId: f.person.id, signerName: 'Dana Hart' });
    const typedDate = '2025-11-15';
    await f.api.signRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: typedDate, signer });
    const saved = f.db.rightsPackets?.find(p => p.id === id)!;
    // The typed date is stored exactly as entered — never re-stamped.
    assert.equal(saved.packetOn, typedDate);
    assert.equal(saved.status, 'signed');
    assert.ok(saved.signedAt && saved.signedAt.slice(0, 10) === todayStamp());
    const list = await f.api.listRightsPackets();
    const mine = list.filter(p => p.individualId === f.person.id);
    assert.equal(rightsTrackingText(rightsTrackingFor(mine)), rightsRenewalFor(typedDate).text);
    // Completed packets cannot be completed again; a new packet starts the next year.
    await assert.rejects(() => f.api.signRightsPacket(id, { reviewedBy: 'X', packetOn: '2026-01-01', signer }), /immutable/);
    const next = await f.api.createRightsPacket({ individualId: f.person.id, signerName: 'Dana Hart' });
    assert.notEqual(next, id);
    assert.equal(rightsTrackingFor((await f.api.listRightsPackets()).filter(p => p.individualId === f.person.id)).kind, 'tracked');
});

test('local gates: DSP sees no packets, auditor reads but cannot write, future dates rejected', async () => {
    const f = localFixture();
    const id = await f.api.createRightsPacket({ individualId: f.person.id, signerName: 'Dana Hart' });
    await assert.rejects(() => f.api.signRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: '2999-01-01', signer }), /future/);
    const dsp = f.db.memberships.find(m => m.roleKey === 'dsp' && m.siteId === f.hm.siteId)!;
    f.store.sessionUserId = dsp.userId;
    assert.deepEqual(await f.api.listRightsPackets(), []);
    await assert.rejects(() => f.api.createRightsPacket({ individualId: f.person.id, signerName: 'X' }), /permission/);
    // The demo seed has no auditor membership; promote the nurse row the
    // way consents.test.ts does to exercise the auditor's read-only door.
    const auditor = f.db.memberships.find(m => m.roleKey === 'nurse')!;
    auditor.roleKey = 'auditor';
    auditor.role = 'auditor' as typeof auditor.role;
    auditor.siteId = null;
    f.store.sessionUserId = auditor.userId;
    assert.equal((await f.api.listRightsPackets()).filter(p => p.id === id).length, 1);
    await assert.rejects(() => f.api.signRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: '2026-01-01', signer }), /permission/);
    await assert.rejects(() => f.api.filePaperRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: '2026-01-01', signer }, new File(['%PDF-'], 'scan.pdf', { type: 'application/pdf' })), /permission/);
});

test('filed paper copy stores evidence and marks the packet filed', async () => {
    const f = localFixture();
    const id = await f.api.createRightsPacket({ individualId: f.person.id, signerName: 'Dana Hart' });
    const file = new File(['%PDF-signed'], 'rights-packet.pdf', { type: 'application/pdf' });
    await f.api.filePaperRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: '2026-09-01', signer }, file);
    const saved = f.db.rightsPackets?.find(p => p.id === id)!;
    assert.equal(saved.status, 'filed');
    assert.equal(saved.evidenceName, 'rights-packet.pdf');
    const evidence = await f.api.getRightsPacketEvidence(id);
    assert.equal(evidence.name, 'rights-packet.pdf');
    assert.equal(evidence.mime, 'application/pdf');
});

test('notification sweep emits rights alerts once and dedupes on refresh', async () => {
    const f = localFixture();
    await f.api.listNotifications();
    const rights = () => (f.db.notifications ?? []).filter(n => n.entityType === 'rights_packet');
    const first = rights().length;
    assert.ok(first > 0, 'expected rights alerts from the seeded demo states');
    assert.ok(rights().every(n => n.type === 'consent.expiring' || n.type === 'consent.missing' || n.type === 'consent.packet_signed'));
    await f.api.listNotifications();
    assert.equal(rights().length, first);
});
