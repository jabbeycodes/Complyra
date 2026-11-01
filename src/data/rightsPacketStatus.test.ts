import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rightsPacketNeedsAttention,
    rightsPacketStatusFor,
    rightsTrackingFor,
    rightsTrackingText,
    type RightsPacket,
} from './rightsPackets';

/**
 * Wave 7E — packet status truth (simulation batch 41).
 *
 * The batch-41 contradiction: the Overview attention section listed
 * "Rights packet: Not yet signed" for all 6 Northstar Individuals
 * while the Consents area showed the same packets "Signed · Renews
 * in 365 days". Production data (verified 2026-10-31) held exactly
 * one packet per Individual, every one status 'signed' with
 * packet_on 2026-10-31 — the packets were never unsigned. The wrong
 * surface was the Overview one: the RightsPackets component rendered
 * verdicts from its initial EMPTY packet list (the pre-load state,
 * indistinguishable from "no packets on file"), so an unloaded list
 * read as "Not yet signed" for everyone in scope.
 *
 * These tests pin the fix: ONE shared selector
 * (rightsPacketStatusFor) that every surface — Overview attention,
 * Consents page + chart, mobile chart card, CommandCenter timeline /
 * attention-feed facts — derives from, with the load state inside the
 * contract: null/undefined input is 'unknown' and carries NO text, so
 * no surface can invent a verdict; a loaded list answers honestly.
 */

const signer = { printedName: 'Sim Guardian', authority: 'Guardian', authorityOther: '', signature: 'Sim Guardian', witness: 'Harper Lane', accepted: true };
const packet = (patch: Partial<RightsPacket>): RightsPacket => ({
    id: 'p1', agencyId: 'a1', individualId: 'i1', createdBy: 'hm', createdAt: '2026-10-31T08:12:07.847725+00:00',
    signerName: 'Sim Guardian', reviewedBy: 'Harper Lane (house manager)', packetOn: null, status: 'awaiting_signature',
    signer: null, signedAt: null, filedAt: null, evidenceName: null, copyVersion: 'complyrer-rights-2026-10-v1', ...patch,
});

/**
 * The batch-41 hosted rows, shaped exactly as hostedApi's
 * listRightsPackets maps the rights_packets table (snake_case row in,
 * RightsPacket out): one signed packet per Individual, typed
 * 2026-10-31. The LocalApi store holds the identical RightsPacket
 * shape, so the same rows stand for both API modes.
 */
const hostedRow = (r: Record<string, unknown>): RightsPacket => ({
    id: r.id as string, agencyId: r.agency_id as string, individualId: r.individual_id as string,
    createdBy: r.created_by as string, createdAt: r.created_at as string, signerName: r.signer_name as string,
    reviewedBy: r.reviewed_by as string, packetOn: r.packet_on as string | null, status: r.status as RightsPacket['status'],
    signer: r.signer as RightsPacket['signer'], signedAt: r.signed_at as string | null, filedAt: r.filed_at as string | null,
    evidenceName: r.evidence_name as string | null, copyVersion: r.copy_version as string,
});
const northstarRows: Record<string, unknown>[] = [
    { id: '261c21b9-8391-40b9-b55f-c1f0ee51b009', agency_id: 'f9cbbba2-a9b1-4ed2-b3e3-f92dfe1367bf', individual_id: '56d265ca-a767-461f-bc7b-9a890df4bdba', created_by: 'hm', created_at: '2026-10-31 08:12:07.847725+00', signer_name: 'Sim Guardian', reviewed_by: 'Harper Lane (house manager)', packet_on: '2026-10-31', status: 'signed', signer, signed_at: '2026-10-31 08:13:16.992+00', filed_at: null, evidence_name: null, copy_version: 'complyrer-rights-2026-10-v1' },
    { id: 'f2652eb9-a3de-4faa-9323-79ba06df3468', agency_id: 'f9cbbba2-a9b1-4ed2-b3e3-f92dfe1367bf', individual_id: '65c862fc-33ab-41a8-b463-7b445d0de833', created_by: 'hm', created_at: '2026-10-31 08:12:22.416099+00', signer_name: 'Sim Guardian', reviewed_by: 'Harper Lane (house manager)', packet_on: '2026-10-31', status: 'signed', signer, signed_at: '2026-10-31 08:13:52.798+00', filed_at: null, evidence_name: null, copy_version: 'complyrer-rights-2026-10-v1' },
    { id: 'd642246c-c978-4627-93cf-b93a7c9876e8', agency_id: 'f9cbbba2-a9b1-4ed2-b3e3-f92dfe1367bf', individual_id: 'df8dfd3f-332a-4015-b5b7-6a941ba121c7', created_by: 'hm', created_at: '2026-10-31 08:12:31.14272+00', signer_name: 'Sim Guardian', reviewed_by: 'Jordan Reyes (house manager)', packet_on: '2026-10-31', status: 'signed', signer, signed_at: '2026-10-31 08:14:19.67+00', filed_at: null, evidence_name: null, copy_version: 'complyrer-rights-2026-10-v1' },
];

test('batch-41 fixture: signed packets read signed_current with the Consents countdown, in both API shapes', () => {
    const today = '2026-10-31';
    const hostedPackets = northstarRows.map(hostedRow);
    // Grouped per Individual exactly as both surfaces group them.
    for (const person of ['56d265ca-a767-461f-bc7b-9a890df4bdba', '65c862fc-33ab-41a8-b463-7b445d0de833', 'df8dfd3f-332a-4015-b5b7-6a941ba121c7']) {
        const mine = hostedPackets.filter(p => p.individualId === person);
        const status = rightsPacketStatusFor(mine, today);
        assert.equal(status.kind, 'signed_current');
        assert.equal(status.text, 'Renews in 365 days');
        assert.equal(rightsPacketNeedsAttention(status), false);
        // The Overview selector and the Consents selector are the same
        // derivation: identical state and identical string.
        assert.equal(status.text, rightsTrackingText(rightsTrackingFor(mine, today)));
    }
    // Local/demo shape: identical RightsPacket objects, identical answer.
    const localPackets = hostedPackets.map(p => ({ ...p }));
    assert.deepEqual(
        rightsPacketStatusFor(localPackets.filter(p => p.individualId === '56d265ca-a767-461f-bc7b-9a890df4bdba'), today),
        rightsPacketStatusFor(hostedPackets.filter(p => p.individualId === '56d265ca-a767-461f-bc7b-9a890df4bdba'), today),
    );
});

test('an unloaded packet list is unknown — never a verdict (the batch-41 regression)', () => {
    for (const unloaded of [null, undefined] as const) {
        const status = rightsPacketStatusFor(unloaded, '2026-10-31');
        assert.equal(status.kind, 'unknown');
        assert.equal(status.text, null);
        assert.equal(status.packet, null);
        // Unknown must not surface in attention views either.
        assert.equal(rightsPacketNeedsAttention(status), false);
    }
});

test('never-signed is honest once loaded: no packets at all, or only an awaiting one', () => {
    const today = '2026-10-31';
    const none = rightsPacketStatusFor([], today);
    assert.equal(none.kind, 'never_signed');
    assert.equal(none.text, 'Not yet signed');
    assert.equal(none.packet, null);
    assert.equal(rightsPacketNeedsAttention(none), true);

    const awaiting = packet({ id: 'open', status: 'awaiting_signature' });
    const started = rightsPacketStatusFor([awaiting], today);
    assert.equal(started.kind, 'never_signed');
    assert.equal(started.text, 'Not yet signed');
    assert.equal(started.packet?.id, 'open');
    // Same string the tracking derivation has always produced.
    assert.equal(started.text, rightsTrackingText(rightsTrackingFor([awaiting], today)));
});

test('signed states split honestly: current vs renewal-due vs overdue', () => {
    const today = '2026-10-30';
    const current = rightsPacketStatusFor([packet({ status: 'signed', packetOn: '2026-10-01', signer })], today);
    assert.equal(current.kind, 'signed_current');
    assert.equal(current.text, 'Renews in 336 days');
    assert.equal(rightsPacketNeedsAttention(current), false);

    const due = rightsPacketStatusFor([packet({ status: 'filed', packetOn: '2025-11-11', signer })], today);
    assert.equal(due.kind, 'signed_renewal_due');
    assert.equal(due.text, 'Due in 12 days');
    assert.equal(rightsPacketNeedsAttention(due), true);

    const overdue = rightsPacketStatusFor([packet({ status: 'signed', packetOn: '2025-10-25', signer })], today);
    assert.equal(overdue.kind, 'signed_overdue');
    assert.equal(overdue.text, 'Overdue by 5 days');
    assert.equal(rightsPacketNeedsAttention(overdue), true);

    // A signed-but-undated row is NOT a completed packet: never_signed, not a fabricated countdown.
    const undated = rightsPacketStatusFor([packet({ status: 'signed', packetOn: null, signer })], today);
    assert.equal(undated.kind, 'never_signed');
});
