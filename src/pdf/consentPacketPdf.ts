import { jsPDF } from 'jspdf';
import { drawConsentPacket } from '../../supabase/functions/_shared/consentPacketPdf';
import type { PacketBrand } from '../../supabase/functions/_shared/packetLayout';
import type {
  PacketSnapshot,
  PacketChoices,
  PacketSignature,
} from '../data/consentPackets';

/**
 * The consent choices packet as a formatted print document (see
 * `drawConsentPacket` for the layout). `brand.logoDataUrl` threads the
 * agency's configured logo into the header; when absent, the header is
 * the agency name alone.
 */
export function buildConsentPacketPdf(
  snapshot: PacketSnapshot,
  choices?: PacketChoices | null,
  signer?: PacketSignature | null,
  brand?: Pick<PacketBrand, 'logoDataUrl'> | null,
) {
  const pdf = new jsPDF();
  drawConsentPacket(pdf, snapshot, choices, signer, brand);
  return pdf;
}
