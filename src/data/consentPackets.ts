import { todayStamp } from './status';
import type { ConsentType } from './consents';
export { PACKET_ITEMS, PACKET_COPY_VERSION, AUTHORITY_OPTIONS, HEALTH_SCOPE, validatePacketSubmission } from '../../supabase/functions/_shared/consentPacketContent';
export type { PacketSignature, PacketChoices, PacketSnapshot } from '../../supabase/functions/_shared/consentPacketContent';
import type { PacketSnapshot, PacketSignature, PacketChoices } from '../../supabase/functions/_shared/consentPacketContent';
export interface ConsentPacket {
    audit?: {
        event: string;
        at: string;
        signerName?: string;
        authority?: string;
    }[];
    id: string;
    agencyId: string;
    individualId: string;
    createdBy: string;
    createdAt: string;
    snapshot: PacketSnapshot;
    status: 'draft' | 'generated' | 'sent' | 'signed' | 'filed';
    generatedAt: string | null;
    sentAt: string | null;
    openedAt: string | null;
    signedAt: string | null;
    filedAt: string | null;
    linkExpiresAt: string | null;
    outstandingAfterDays: number;
    choices: PacketChoices | null;
    signer: PacketSignature | null;
    evidenceName: string | null;
}
export interface PacketCreateInput {
    individualId: string;
    signerName: string;
    effectiveOn: string;
    reviewOn: string;
    outstandingAfterDays: number;
}
export interface PacketPublicView {
    id: string;
    snapshot: PacketSnapshot;
}
export interface PacketEvidence {
    name: string;
    mime: string;
    base64: string;
}
export function packetStatus(packet: ConsentPacket, now = new Date()) {
    if (packet.status === 'sent' && packet.linkExpiresAt && new Date(packet.linkExpiresAt) <= now)
        return 'expired';
    return packet.status;
}
export function packetOutstanding(packet: ConsentPacket, now = new Date()) {
    return packet.status === 'sent' && !!packet.sentAt && now.getTime() >= Date.parse(packet.sentAt) + packet.outstandingAfterDays * 86400000;
}
export async function tokenHash(token: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function newPacketToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function assertPacketDates(input: PacketCreateInput) {
    for (const value of [input.effectiveOn, input.reviewOn])
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
            throw new Error('Use valid packet dates.');
    if (input.reviewOn < input.effectiveOn || !input.signerName.trim() || !Number.isInteger(input.outstandingAfterDays) || input.outstandingAfterDays < 1 || input.outstandingAfterDays > 90)
        throw new Error('Specify signer, review date, and an outstanding window from 1 to 90 days.');
}
export function packetSignerDate(signedOn: string) { if (signedOn > todayStamp())
    throw new Error('Signing date cannot be in the future.'); }
export function assertPacketTypes(types: ConsentType[], itemTypes: readonly {
    typeId: string;
}[]) { if (itemTypes.some(i => !types.some(t => t.id === i.typeId)))
    throw new Error('Restore the packet consent types in agency settings.'); }
export async function packetFile(file: File): Promise<PacketEvidence> {
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0)
        throw new Error('Use a PDF, PNG, or JPEG up to 10 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = file.type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' : file.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 : bytes[0] === 255 && bytes[1] === 216;
    if (!valid)
        throw new Error('The file content must match its file type.');
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return { name: file.name, mime: file.type, base64: btoa(binary) };
}
export function evidenceBlob(evidence: PacketEvidence) { return new Blob([Uint8Array.from(atob(evidence.base64), c => c.charCodeAt(0))], { type: evidence.mime }); }
