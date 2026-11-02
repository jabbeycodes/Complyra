import type {
  PacketChoices,
  PacketSignature,
  PacketSnapshot,
} from './consentPacketContent.ts';
import {
  PacketLayout,
  type PacketBrand,
  type PacketPdfDocument,
} from './packetLayout.ts';

const SECTIONS: Array<{ title: string; keys: string[] }> = [
  {
    title: 'Service and treatment decisions',
    keys: [
      'participation',
      'photograph',
      'medications',
      'emergency',
      'outings',
      'law_enforcement',
    ],
  },
  { title: 'Health information exchange', keys: ['information'] },
  { title: 'Rights information and questions', keys: ['rights'] },
  { title: 'Public media choices', keys: ['media'] },
];

/**
 * Draw the consent choices packet as a formatted print document: branded
 * header (agency logo + name, ComplyRer wordmark), a two-column fact block,
 * one headed section per page with drawn checkbox squares for unrecorded
 * choices, a bordered Signatures box per section, and the Complyrer record
 * footer — mark, copy version, and "Page X of Y" — on every page.
 *
 * Shared by the browser builder (`src/pdf/consentPacketPdf.ts`) and the
 * public signing edge function, which passes its own server-side jsPDF —
 * both renderers satisfy {@link PacketPdfDocument}, so both draw this same
 * document. `brand` is optional: the edge path has no agency logo, so it
 * gets the name-only header. All packet copy, statuses, and recorded-choice
 * semantics are unchanged from the original text layout.
 */
export function drawConsentPacket(
  pdf: PacketPdfDocument,
  snapshot: PacketSnapshot,
  choices?: PacketChoices | null,
  signer?: PacketSignature | null,
  brand?: Pick<PacketBrand, 'logoDataUrl'> | null,
) {
  const layout = new PacketLayout(pdf, {
    agencyName: snapshot.agencyName,
    copyVersion: snapshot.copyVersion,
    logoDataUrl: brand?.logoDataUrl ?? null,
  });

  layout.firstPageHeader();
  layout.title('Consent choices and signature record');
  layout.facts([
    ['Individual', snapshot.individualName],
    ['Agency', snapshot.agencyName],
    ['Expected signer', snapshot.signerName],
    ['Effective', snapshot.effectiveOn],
    ['Expiry/review', snapshot.reviewOn],
  ]);
  layout.body(
    'This packet records separate decisions. A No answer or no media permission is a recorded decision, not permission to proceed. Keep a copy of the completed packet.',
  );
  layout.body(
    'Packet contents: service decisions, health information exchange, rights information, and public media choices. Each section has its own signature record.',
  );

  SECTIONS.forEach((section, sectionIndex) => {
    layout.addPage();
    layout.sectionHeading(`${sectionIndex + 1}. ${section.title}`, 15);
    for (const key of section.keys) {
      const item = snapshot.items.find((entry) => entry.key === key)!;
      layout.itemHeading(item.label);
      layout.body(item.text);
      if (key === 'information') {
        for (const scope of snapshot.healthScope) layout.body(`- ${scope}`);
      }
      if (choices) {
        layout.body(`Recorded choice: ${choices[key]}`);
      } else if (key === 'media') {
        layout.choiceBoxes([
          'Full permission',
          'Group photographs only',
          'No permission',
        ]);
      } else {
        layout.choiceBoxes(['Yes', 'No']);
      }
    }
    layout.signatureBlock(
      signer
        ? {
            printedName: signer.printedName,
            signature: signer.signature,
            authority: signer.authority,
            authorityOther: signer.authorityOther,
            witness: signer.witness,
            signedOn: signer.signedOn,
          }
        : null,
    );
  });

  if (signer) {
    layout.body(
      'The signer confirmed these choices and agreed that the entered signature records their intent for each section above.',
    );
  }

  layout.stampFooters();
  return pdf;
}
