/**
 * Packet completion is failure-atomic (PR #252 review).
 *
 * Packet evidence bytes go to the file store (IndexedDB) rather than the
 * localStorage metadata record. If that file write fails — quota, a
 * private-mode storage restriction, an IndexedDB error — the packet must
 * be left exactly as it was: still open, no evidence stub, no signed/filed
 * audit rows, no consent versions, signing token intact. The user then
 * retries and it works.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LocalApi, MemoryStore, packetEvidenceWriter } from './localApi';
import { createEvergreenSeed } from './seed';
import { PACKET_ITEMS, type PacketChoices, type PacketSignature } from './consentPackets';
import { centralTodayIso } from './menuRecords';
import { todayStamp } from './status';
import { buildConsentPacketPdf } from '../pdf/consentPacketPdf';

const realWrite = packetEvidenceWriter.write;
afterEach(() => {
    packetEvidenceWriter.write = realWrite;
});

function failWrites() {
    let attempts = 0;
    packetEvidenceWriter.write = async () => {
        attempts += 1;
        throw new Error('QuotaExceededError: the file store is full.');
    };
    return () => attempts;
}

const choices: PacketChoices = Object.fromEntries(PACKET_ITEMS.map(i => [i.key, i.key === 'media' ? 'group' : 'yes']));
const consentSigner: PacketSignature = { printedName: 'Jordan Lee', signature: 'Jordan Lee', authority: 'Guardian', authorityOther: '', witness: 'Taylor Witness', signedOn: todayStamp(), accepted: true };
const rightsSigner = { printedName: 'Dana Hart', authority: 'Guardian', authorityOther: '', signature: 'Dana Hart', witness: 'Casey Adams', accepted: true };

function fixture() {
    const db = createEvergreenSeed();
    const store = new MemoryStore(db);
    const api = new LocalApi(store);
    const hm = db.memberships.find(m => m.roleKey === 'house_manager')!;
    store.sessionUserId = hm.userId;
    const person = db.individuals.find(p => p.siteId === hm.siteId)!;
    return { db, store, api, hm, person };
}

/** Everything a consent-packet completion would touch, for before/after checks. */
function consentState(db: ReturnType<typeof createEvergreenSeed>, id: string) {
    const packet = db.consentPackets!.find(p => p.id === id)!;
    return {
        status: packet.status,
        signedAt: packet.signedAt ?? null,
        filedAt: packet.filedAt ?? null,
        evidenceName: packet.evidenceName ?? null,
        stub: db.consentPacketEvidence?.[id] ?? null,
        token: db.consentPacketTokens?.[id] ?? null,
        audit: (db.consentPacketAudit ?? []).filter(a => a.packetId === id).map(a => a.event),
        versions: (db.consents ?? []).filter(c => c.packetId === id).length,
    };
}

test('consent signing: a failed evidence write leaves the packet open and retryable', async () => {
    const f = fixture();
    const id = await f.api.createConsentPacket({ individualId: f.person.id, signerName: 'Jordan Lee', effectiveOn: centralTodayIso(), reviewOn: '2099-12-31', outstandingAfterDays: 1 });
    await f.api.generateConsentPacket(id);
    const token = await f.api.sendConsentPacket(id, 7);
    const before = consentState(f.db, id);
    const attempts = failWrites();
    await assert.rejects(() => f.api.signConsentPacket(token, choices, consentSigner), /file store is full/);
    assert.equal(attempts(), 1, 'the evidence write was attempted');
    assert.deepEqual(consentState(f.db, id), before, 'nothing about the packet changed');
    assert.equal(before.status, 'sent');
    // Retry with a working file store: the same link still signs.
    packetEvidenceWriter.write = realWrite;
    await f.api.signConsentPacket(token, choices, consentSigner);
    const after = consentState(f.db, id);
    assert.equal(after.status, 'filed');
    assert.equal(after.versions, PACKET_ITEMS.length);
    assert.equal((await f.api.getConsentPacketEvidence(id)).name, 'Signed consent packet.pdf');
});

test('consent paper filing: a failed evidence write leaves the packet open and retryable', async () => {
    const f = fixture();
    const id = await f.api.createConsentPacket({ individualId: f.person.id, signerName: 'Jordan Lee', effectiveOn: centralTodayIso(), reviewOn: '2099-12-31', outstandingAfterDays: 1 });
    await f.api.generateConsentPacket(id);
    const pdf = buildConsentPacketPdf(f.db.consentPackets!.find(p => p.id === id)!.snapshot, choices, consentSigner);
    const file = new File([pdf.output('arraybuffer')], 'paper.pdf', { type: 'application/pdf' });
    const before = consentState(f.db, id);
    failWrites();
    await assert.rejects(() => f.api.filePaperConsentPacket(id, choices, consentSigner, file), /file store is full/);
    assert.deepEqual(consentState(f.db, id), before, 'nothing about the packet changed');
    assert.notEqual(before.status, 'filed');
    packetEvidenceWriter.write = realWrite;
    await f.api.filePaperConsentPacket(id, choices, consentSigner, file);
    assert.equal(consentState(f.db, id).status, 'filed');
    assert.equal((await f.api.getConsentPacketEvidence(id)).name, 'paper.pdf');
});

test('rights paper filing: a failed evidence write leaves the packet awaiting signature and retryable', async () => {
    const f = fixture();
    const person = f.db.individuals.find(p => p.siteId === f.hm.siteId && !f.db.rightsPackets?.some(r => r.individualId === p.id))!;
    const id = await f.api.createRightsPacket({ individualId: person.id, signerName: 'Dana Hart' });
    const file = new File(['%PDF-signed'], 'rights-packet.pdf', { type: 'application/pdf' });
    const input = { reviewedBy: 'James Wilson', packetOn: '2026-09-01', signer: rightsSigner };
    const snapshot = () => {
        const p = f.db.rightsPackets!.find(r => r.id === id)!;
        return { status: p.status, signedAt: p.signedAt, filedAt: p.filedAt, evidenceName: p.evidenceName, stub: f.db.rightsPacketEvidence?.[id] ?? null };
    };
    const before = snapshot();
    failWrites();
    await assert.rejects(() => f.api.filePaperRightsPacket(id, input, file), /file store is full/);
    assert.deepEqual(snapshot(), before, 'nothing about the packet changed');
    assert.equal(before.status, 'awaiting_signature');
    packetEvidenceWriter.write = realWrite;
    await f.api.filePaperRightsPacket(id, input, file);
    assert.equal(snapshot().status, 'filed');
    assert.equal((await f.api.getRightsPacketEvidence(id)).name, 'rights-packet.pdf');
});

test('rights signing writes no evidence, so a failing file store cannot block it', async () => {
    const f = fixture();
    const person = f.db.individuals.find(p => p.siteId === f.hm.siteId && !f.db.rightsPackets?.some(r => r.individualId === p.id))!;
    const id = await f.api.createRightsPacket({ individualId: person.id, signerName: 'Dana Hart' });
    const attempts = failWrites();
    await f.api.signRightsPacket(id, { reviewedBy: 'James Wilson', packetOn: '2026-09-01', signer: rightsSigner });
    assert.equal(attempts(), 0, 'signing on screen stores no evidence file');
    const saved = f.db.rightsPackets!.find(r => r.id === id)!;
    assert.equal(saved.status, 'signed');
    assert.equal(f.db.rightsPacketEvidence?.[id], undefined);
});

/**
 * Two packets for the SAME Individual across the evidence-write await (PR
 * #252 review): A prepares, then waits on the file store; B completes in
 * full; A resumes. A must be re-validated against the register as it is
 * NOW — exactly one active version per consent type, A superseding B.
 */
function deferredFirstWrite() {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    packetEvidenceWriter.write = async (path, file) => {
        if (first) {
            first = false;
            await gate;
        }
        return realWrite(path, file);
    };
    return () => release();
}

function currentVersions(db: ReturnType<typeof createEvergreenSeed>, individualId: string, typeId: string) {
    const rows = (db.consents ?? []).filter(c => c.individualId === individualId && c.typeId === typeId && c.activatedAt);
    return rows.filter(r => !rows.some(n => n.supersedesId === r.id));
}

test('two packets for one Individual interleaved across the write: one active version per type, A supersedes B', async () => {
    const f = fixture();
    const make = async () => {
        const id = await f.api.createConsentPacket({ individualId: f.person.id, signerName: 'Jordan Lee', effectiveOn: centralTodayIso(), reviewOn: '2099-12-31', outstandingAfterDays: 1 });
        await f.api.generateConsentPacket(id);
        const pdf = buildConsentPacketPdf(f.db.consentPackets!.find(p => p.id === id)!.snapshot, choices, consentSigner);
        return { id, file: new File([pdf.output('arraybuffer')], `${id}.pdf`, { type: 'application/pdf' }) };
    };
    const a = await make();
    const b = await make();
    const releaseA = deferredFirstWrite();
    const pendingA = f.api.filePaperConsentPacket(a.id, choices, consentSigner, a.file);
    // Let A run up to its (blocked) evidence write.
    await new Promise(resolve => setTimeout(resolve, 0));
    await f.api.filePaperConsentPacket(b.id, choices, consentSigner, b.file);
    releaseA();
    await pendingA;
    for (const item of PACKET_ITEMS) {
        const current = currentVersions(f.db, f.person.id, item.typeId);
        assert.equal(current.length, 1, `${item.typeId}: exactly one current version`);
        assert.equal(current[0].packetId, a.id, `${item.typeId}: the later completion (A) is current`);
        const bVersion = (f.db.consents ?? []).find(c => c.packetId === b.id && c.typeId === item.typeId)!;
        assert.equal(current[0].supersedesId, bVersion.id, `${item.typeId}: A supersedes B, not a stale predecessor`);
    }
});

test('a signing link revoked during the evidence write is refused, and the packet is untouched', async () => {
    const f = fixture();
    const id = await f.api.createConsentPacket({ individualId: f.person.id, signerName: 'Jordan Lee', effectiveOn: centralTodayIso(), reviewOn: '2099-12-31', outstandingAfterDays: 1 });
    await f.api.generateConsentPacket(id);
    const token = await f.api.sendConsentPacket(id, 7);
    const releaseWrite = deferredFirstWrite();
    const pending = f.api.signConsentPacket(token, choices, consentSigner);
    await new Promise(resolve => setTimeout(resolve, 0));
    delete f.db.consentPacketTokens![id];
    const before = consentState(f.db, id);
    releaseWrite();
    await assert.rejects(() => pending, /unavailable or expired/);
    assert.deepEqual(consentState(f.db, id), before);
});
