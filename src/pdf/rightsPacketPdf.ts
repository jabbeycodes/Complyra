import { jsPDF } from 'jspdf';
import {
  RIGHTS_PACKET_ACKNOWLEDGEMENTS,
  addOneYear,
  type RightsPacket,
} from '../data/rightsPackets';
import {
  PacketLayout,
  type PacketBrand,
} from '../../supabase/functions/_shared/packetLayout';

/**
 * The Rights packet document — the printable version of the chart record,
 * generated on demand as a formatted print form: branded header (agency
 * logo + name, ComplyRer wordmark), a two-column fact block, numbered
 * acknowledgement sections, and a bordered Signatures box with ruled lines.
 * The box renders in full for a packet still awaiting signature — empty
 * lines a guardian can actually sign — and prints the recorded values on
 * the same lines once completed. Every page carries the footer: the
 * Complyrer record mark, the copy version, and "Page X of Y".
 *
 * `brand.logoDataUrl` is the agency's configured logo when one exists; a
 * missing or unreadable logo falls back to the name-only header, silently.
 */
export function buildRightsPacketPdf(
  packet: RightsPacket,
  individualName: string,
  agencyName: string,
  brand?: Pick<PacketBrand, 'logoDataUrl' | 'complyrerLogoDataUrl'> | null,
) {
  const pdf = new jsPDF();
  const layout = new PacketLayout(pdf, {
    agencyName,
    copyVersion: packet.copyVersion,
    logoDataUrl: brand?.logoDataUrl ?? null,
    complyrerLogoDataUrl: brand?.complyrerLogoDataUrl,
  });
  const signer = packet.signer;

  layout.firstPageHeader();
  layout.title('Individual Rights packet');
  layout.facts([
    ['Individual', individualName],
    ['Agency', agencyName],
    ['Packet date', packet.packetOn ?? '________________'],
    [
      'My rights have been reviewed with me by',
      packet.reviewedBy || '________________________________',
    ],
    ['Printed name of Individual', individualName],
  ]);

  RIGHTS_PACKET_ACKNOWLEDGEMENTS.forEach((item, index) => {
    layout.sectionHeading(`${index + 1}. ${item.heading}`);
    layout.body(item.text);
  });

  layout.signatureBlock({
    printedName: signer?.printedName ?? packet.signerName ?? undefined,
    signature: signer?.signature,
    authority: signer?.authority,
    authorityOther: signer?.authorityOther,
    witness: signer?.witness,
    signedOn: packet.packetOn ?? undefined,
  });

  if (packet.packetOn) {
    layout.body(
      `Packet date ${packet.packetOn} · Annual renewal due ${addOneYear(packet.packetOn)}`,
    );
    layout.body(
      `Status: ${packet.status === 'filed' ? 'Signed paper copy filed' : 'Signed'} (recorded ${packet.signedAt?.slice(0, 10) ?? ''}).`,
    );
  } else {
    layout.body('Status: Awaiting signature.');
  }

  layout.stampFooters();
  return pdf;
}
