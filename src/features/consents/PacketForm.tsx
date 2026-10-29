import { AUTHORITY_OPTIONS, type PacketChoices, type PacketSignature, type PacketSnapshot } from '../../data/consentPackets';
export default function PacketForm({ snapshot, choices, signer, onChoices, onSigner, paper = false }: {
    snapshot: PacketSnapshot;
    choices: PacketChoices;
    signer: PacketSignature;
    onChoices: (c: PacketChoices) => void;
    onSigner: (s: PacketSignature) => void;
    paper?: boolean;
}) {
    return <>
  <h3>{snapshot.agencyName} — {snapshot.individualName}</h3><p>Effective {snapshot.effectiveOn}; expiry/review {snapshot.reviewOn}. Expected signer: {snapshot.signerName}.</p>
  {snapshot.items.map(item => <fieldset key={item.key}><legend>{item.label}</legend><p>{item.text}</p>{item.key === 'information' && <ul>{snapshot.healthScope.map(scope => <li key={scope}>{scope}</li>)}</ul>}
   <label>Recorded choice<select required value={choices[item.key] ?? ''} onChange={e => onChoices({ ...choices, [item.key]: e.target.value })}><option value="">Choose</option>{(item.key === 'media' ? [['full', 'Full permission'], ['group', 'Group photographs only'], ['none', 'No permission']] : [['yes', 'Yes'], ['no', 'No']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  </fieldset>)}
  <label>Printed signer name<input required maxLength={500} value={signer.printedName} onChange={e => onSigner({ ...signer, printedName: e.target.value })}/></label>
  <label>Legal authority<select value={signer.authority} onChange={e => onSigner({ ...signer, authority: e.target.value })}>{AUTHORITY_OPTIONS.map(a => <option key={a}>{a}</option>)}</select></label>
  {signer.authority === 'Other' && <label>Specify legal authority<input required maxLength={500} value={signer.authorityOther} onChange={e => onSigner({ ...signer, authorityOther: e.target.value })}/></label>}
  <label>{paper ? 'Signature name shown on paper' : 'Type your signature'}<input required maxLength={500} value={signer.signature} onChange={e => onSigner({ ...signer, signature: e.target.value })}/></label>
  <label>Witness name<input required maxLength={500} value={signer.witness} onChange={e => onSigner({ ...signer, witness: e.target.value })}/></label>
  <label>Signature date<input type="date" required value={signer.signedOn} onChange={e => onSigner({ ...signer, signedOn: e.target.value })}/></label>
  <label><input type="checkbox" required checked={signer.accepted} onChange={e => onSigner({ ...signer, accepted: e.target.checked })}/>{paper ? 'I checked that the uploaded copy is signed and that these choices match it.' : 'I reviewed every section. These are my choices, and I intend my typed signature to sign each section. I can download a signed copy after submitting.'}</label>
 </>;
}
