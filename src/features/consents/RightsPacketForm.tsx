import { AUTHORITY_OPTIONS, RIGHTS_PACKET_ACKNOWLEDGEMENTS, type RightsPacketCompletion } from '../../data/rightsPackets';

/**
 * The completion form for a Rights packet: the acknowledgment receipts,
 * who reviewed the rights, the signer's typed signature and legal
 * authority, the witness, and the packet date. The date field starts
 * EMPTY on purpose — a manager types the date the packet was signed;
 * it is never pre-stamped with today.
 */
export default function RightsPacketForm({ value, onChange, paper = false }: {
    value: RightsPacketCompletion;
    onChange: (next: RightsPacketCompletion) => void;
    paper?: boolean;
}) {
    const signer = value.signer;
    const setSigner = (patch: Partial<RightsPacketCompletion['signer']>) =>
        onChange({ ...value, signer: { ...signer, ...patch } });
    return <>
  {RIGHTS_PACKET_ACKNOWLEDGEMENTS.map(item => <fieldset key={item.key}><legend>{item.heading}</legend><p>{item.text}</p></fieldset>)}
  <label>My rights have been reviewed with me by<input required maxLength={500} value={value.reviewedBy} onChange={e => onChange({ ...value, reviewedBy: e.target.value })} /></label>
  <label>Signer printed name<input required maxLength={500} value={signer.printedName} onChange={e => setSigner({ printedName: e.target.value })} /></label>
  <label>Legal authority to make medical decisions<select value={signer.authority} onChange={e => setSigner({ authority: e.target.value })}>{AUTHORITY_OPTIONS.map(a => <option key={a}>{a}</option>)}</select></label>
  {signer.authority === 'Other' && <label>Specify legal authority<input required maxLength={500} value={signer.authorityOther} onChange={e => setSigner({ authorityOther: e.target.value })} /></label>}
  <label>{paper ? 'Signature name shown on paper' : 'Type the signer’s signature'}<input required maxLength={500} value={signer.signature} onChange={e => setSigner({ signature: e.target.value })} /></label>
  <label>Witness name<input required maxLength={500} value={signer.witness} onChange={e => setSigner({ witness: e.target.value })} /></label>
  <label>Packet date (type the date the packet was signed)<input type="date" required value={value.packetOn} onChange={e => onChange({ ...value, packetOn: e.target.value })} /></label>
  <label><input type="checkbox" required checked={signer.accepted} onChange={e => setSigner({ accepted: e.target.checked })} />{paper ? 'I checked that the uploaded copy is signed and that these entries match it.' : 'The signer received the rights materials above, had the chance to ask questions, and signed this packet.'}</label>
 </>;
}
