import { useEffect, useMemo, useState } from 'react';
import { createApi } from '../../data';
import { evidenceBlob, type PacketChoices, type PacketSignature, type PacketPublicView, type PacketEvidence } from '../../data/consentPackets';
import { todayStamp } from '../../data/status';
import { downloadBlob } from '../../data/openFile';
import PacketForm from './PacketForm';
import './consents.css';
export default function PublicConsentSigning({ token }: {
    token: string;
}) {
    const api = useMemo(() => createApi(), []);
    const [packet, setPacket] = useState<PacketPublicView | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [receipt, setReceipt] = useState<PacketEvidence | null>(null);
    const [choices, setChoices] = useState<PacketChoices>({});
    const [signer, setSigner] = useState<PacketSignature>({ printedName: '', authority: 'Self', authorityOther: '', signature: '', witness: '', signedOn: todayStamp(), accepted: false });
    useEffect(() => {
        let live = true;
        const meta = document.createElement('meta');
        meta.name = 'referrer';
        meta.content = 'no-referrer';
        document.head.appendChild(meta);
        api.openConsentPacket(token).then(p => { if (live)
            setPacket(p); }).catch(e => { if (live)
            setError(e.message); });
        return () => { live = false; meta.remove(); };
    }, [api, token]);
    return <main className="consents" style={{ maxWidth: 850, margin: '24px auto' }}><h1>ComplyRer consent signing</h1>
  {error && <p role="alert">{error}</p>}
  {receipt ? <><h2>Signed and filed</h2><p>Your choices and signed packet are recorded. This link is now closed.</p><button onClick={() => downloadBlob(receipt.name, evidenceBlob(receipt))}>Download your signed copy</button></> : packet ? <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
            setReceipt(await api.signConsentPacket(token, choices, signer));
            setPacket(null);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Could not sign.');
        }
        finally {
            setBusy(false);
        } }}>
   <PacketForm snapshot={packet.snapshot} choices={choices} signer={signer} onChoices={setChoices} onSigner={setSigner}/><button disabled={busy}>{busy ? 'Filing signed packet…' : 'Sign and submit packet'}</button>
  </form> : !error && <p role="status">Opening your packet…</p>}
 </main>;
}
