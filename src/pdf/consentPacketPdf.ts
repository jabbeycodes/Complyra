import { jsPDF } from 'jspdf';
import { drawConsentPacket } from '../../supabase/functions/_shared/consentPacketPdf';
import type { PacketSnapshot, PacketChoices, PacketSignature } from '../data/consentPackets';
export function buildConsentPacketPdf(snapshot: PacketSnapshot, choices?: PacketChoices | null, signer?: PacketSignature | null) {
    const pdf = new jsPDF();
    drawConsentPacket(pdf, snapshot, choices, signer);
    return pdf;
}
