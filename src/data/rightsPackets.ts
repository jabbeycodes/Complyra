import { assertCalendarDate } from './access';
import { todayStamp } from './status';
import type { Membership } from './types';
import { AUTHORITY_OPTIONS, type PacketEvidence } from './consentPackets';
export { AUTHORITY_OPTIONS };
export type { PacketEvidence };

/**
 * The Rights packet — an Individual's annual rights signoff record on
 * the chart's Consents area. The acknowledgment wording is
 * ComplyRer-original: it covers the same receipts (the state Individual
 * Rights publication, the agency's grievance process, and the agency
 * handbook) without copying any provider's form.
 */
export const RIGHTS_PACKET_COPY_VERSION = 'complyrer-rights-2026-10-v1';
export const RIGHTS_PACKET_ACKNOWLEDGEMENTS = [
    {
        key: 'rights_publication',
        heading: 'Individual Rights publication',
        text: 'I received the state Individual Rights publication for persons receiving developmental disabilities services. I was offered time to read it, discuss it, and ask questions before signing.',
    },
    {
        key: 'grievance_process',
        heading: 'Agency grievance process',
        text: "I received the agency's grievance process. It explains how to raise a concern about services or rights, who reviews it, and how the outcome is shared. Raising a grievance never changes the services an Individual receives.",
    },
    {
        key: 'agency_handbook',
        heading: 'Agency handbook and participant rights',
        text: 'I received the agency handbook. It describes my rights as a participant in home and community based services, including being free from abuse, neglect, and exploitation, and reporting concerns without retaliation.',
    },
] as const;

export interface RightsPacketSigner {
    printedName: string;
    authority: string;
    authorityOther: string;
    /** The typed signature, captured with the platform's signature fields. */
    signature: string;
    witness: string;
    accepted: boolean;
}

export interface RightsPacket {
    id: string;
    agencyId: string;
    individualId: string;
    createdBy: string;
    createdAt: string;
    /** Who is expected to sign (often a guardian or representative). */
    signerName: string;
    /** "My rights have been reviewed with me by" — the reviewer. */
    reviewedBy: string;
    /**
     * The packet date, typed by a manager. It is authoritative as
     * entered: signing or filing never overwrites it, and the annual
     * renewal countdown anchors on it.
     */
    packetOn: string | null;
    status: 'awaiting_signature' | 'signed' | 'filed';
    signer: RightsPacketSigner | null;
    signedAt: string | null;
    filedAt: string | null;
    evidenceName: string | null;
    copyVersion: string;
}

export interface RightsPacketCompletion {
    reviewedBy: string;
    packetOn: string;
    signer: RightsPacketSigner;
}

/** One calendar year after a YYYY-MM-DD date; Feb 29 lands on Feb 28. */
export function addOneYear(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const next = new Date(Date.UTC(year + 1, month - 1, day));
    if (next.getUTCMonth() !== month - 1)
        return `${year + 1}-02-28`;
    return next.toISOString().slice(0, 10);
}

function dayDiff(fromIso: string, toIso: string): number {
    return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
}

export type RightsRenewalState = 'current' | 'due_soon' | 'due_today' | 'overdue';

export interface RightsRenewal {
    renewalOn: string;
    daysRemaining: number;
    state: RightsRenewalState;
    /** Plain-text countdown, e.g. "Renews in 142 days". Never color alone. */
    text: string;
}

/**
 * THE shared countdown derivation for the Rights packet. Both Consents
 * surfaces (desktop chart and mobile) and the due-items timeline read
 * this one function, so the number can never drift between screens.
 * The renewal date is the typed packet date plus one year.
 */
export function rightsRenewalFor(packetOn: string, today = todayStamp()): RightsRenewal {
    const renewalOn = addOneYear(packetOn);
    const daysRemaining = dayDiff(today, renewalOn);
    const plural = (n: number) => (n === 1 ? 'day' : 'days');
    if (daysRemaining < 0)
        return { renewalOn, daysRemaining, state: 'overdue', text: `Overdue by ${-daysRemaining} ${plural(-daysRemaining)}` };
    if (daysRemaining === 0)
        return { renewalOn, daysRemaining, state: 'due_today', text: 'Due today' };
    if (daysRemaining <= 30)
        return { renewalOn, daysRemaining, state: 'due_soon', text: `Due in ${daysRemaining} ${plural(daysRemaining)}` };
    return { renewalOn, daysRemaining, state: 'current', text: `Renews in ${daysRemaining} ${plural(daysRemaining)}` };
}

export type RightsTracking =
    | { kind: 'tracked'; packet: RightsPacket; renewal: RightsRenewal }
    | { kind: 'not_signed'; packet: RightsPacket | null };

/** A completed (signed or filed) packet is one that carries a typed date. */
export function isCompletedRightsPacket(packet: RightsPacket): boolean {
    return packet.status !== 'awaiting_signature' && !!packet.packetOn;
}

/**
 * The tracking state for one Individual. The countdown always reflects
 * the LATEST completed packet's typed date; with none completed, the
 * state is "Not yet signed" — itself a due/attention state.
 */
export function rightsTrackingFor(packets: RightsPacket[], today = todayStamp()): RightsTracking {
    const completed = packets
        .filter(isCompletedRightsPacket)
        .sort((a, b) => (b.packetOn as string).localeCompare(a.packetOn as string) || b.createdAt.localeCompare(a.createdAt));
    if (completed.length > 0) {
        const packet = completed[0];
        return { kind: 'tracked', packet, renewal: rightsRenewalFor(packet.packetOn as string, today) };
    }
    const awaiting = [...packets]
        .filter(p => p.status === 'awaiting_signature')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { kind: 'not_signed', packet: awaiting[0] ?? null };
}

/** The one-line tracking summary both surfaces show. */
export function rightsTrackingText(tracking: RightsTracking): string {
    return tracking.kind === 'tracked' ? tracking.renewal.text : 'Not yet signed';
}

export function validateRightsPacketStart(input: { signerName: string }) {
    if (!input.signerName.trim())
        throw new Error('Name the expected signer for the rights packet.');
    if (input.signerName.length > 500)
        throw new Error('Keep the signer name within 500 characters.');
}

export function validateRightsCompletion(input: RightsPacketCompletion, today = todayStamp()) {
    if (!input.reviewedBy.trim())
        throw new Error('Record who reviewed the rights with the signer.');
    assertCalendarDate(input.packetOn);
    if (input.packetOn > today)
        throw new Error('The packet date cannot be in the future. Type the date the packet was signed.');
    const signer = input.signer;
    if (!signer.printedName?.trim() || !signer.signature?.trim() || !signer.witness?.trim() || !signer.accepted)
        throw new Error('Complete the signer, signature, witness, and signing agreement.');
    if (!(AUTHORITY_OPTIONS as readonly string[]).includes(signer.authority) || (signer.authority === 'Other' && !signer.authorityOther?.trim()))
        throw new Error('State the signer’s legal authority.');
    for (const text of [signer.printedName, signer.authorityOther, signer.signature, signer.witness, input.reviewedBy])
        if (text.length > 500)
            throw new Error('Keep packet fields within 500 characters.');
}

/** Only the completion fields cross the write boundary. */
export function rightsCompletionFields(input: RightsPacketCompletion): RightsPacketCompletion {
    return {
        reviewedBy: input.reviewedBy,
        packetOn: input.packetOn,
        signer: {
            printedName: input.signer.printedName,
            authority: input.signer.authority,
            authorityOther: input.signer.authorityOther ?? '',
            signature: input.signer.signature,
            witness: input.signer.witness,
            accepted: input.signer.accepted,
        },
    };
}

/**
 * Notification payloads for the rights tracker, mirroring consentAlerts:
 * the home house manager is targeted directly, program managers by
 * role, and the sweep dedupes permanently per packet and target. Types
 * reuse the existing consent notification types — no new types.
 */
export function rightsPacketAlerts(
    people: { person: { id: string; agencyId: string; siteId: string; fullName: string }; tracking: RightsTracking }[],
    memberships: Membership[],
    today = todayStamp(),
) {
    return people.flatMap(({ person, tracking }) => {
        let type: string;
        let title: string;
        let body: string;
        let entityId: string;
        let keyPart: string;
        if (tracking.kind === 'not_signed') {
            type = 'consent.missing';
            title = 'Rights packet not yet signed';
            body = `${person.fullName}: the annual Rights packet has not been signed.`;
            entityId = tracking.packet?.id ?? person.id;
            keyPart = `missing:${tracking.packet?.id ?? person.id}`;
        }
        else if (tracking.renewal.state === 'due_soon' || tracking.renewal.state === 'due_today') {
            type = 'consent.expiring';
            title = 'Rights packet renewal due soon';
            body = `${person.fullName}: Rights packet renews ${tracking.renewal.renewalOn} — ${tracking.renewal.text.toLowerCase()}.`;
            entityId = tracking.packet.id;
            keyPart = `expiring:${tracking.packet.id}`;
        }
        else if (tracking.renewal.state === 'overdue') {
            type = 'consent.expiring';
            title = 'Rights packet renewal overdue';
            body = `${person.fullName}: Rights packet renewal was due ${tracking.renewal.renewalOn} — ${tracking.renewal.text.toLowerCase()}.`;
            entityId = tracking.packet.id;
            keyPart = `expiring:${tracking.packet.id}`;
        }
        else
            return [];
        const targets = new Map<string, { userId: string | null; roleKey: string | null }>();
        for (const m of memberships) {
            if (m.agencyId === person.agencyId && m.roleKey === 'house_manager' && (!m.siteId || m.siteId === person.siteId) && (!m.expiresOn || m.expiresOn >= today))
                targets.set(m.userId, { userId: m.userId, roleKey: null });
        }
        targets.set('role:program_manager', { userId: null, roleKey: 'program_manager' });
        return [...targets].map(([target, address]) => ({
            agencyId: person.agencyId, ...address, type,
            title, body, deepLink: '/consents',
            entityType: 'rights_packet', entityId,
            dedupeKey: `rights.${keyPart}:${target}`,
        }));
    });
}
