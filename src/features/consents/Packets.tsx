import { useEffect, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { canManageConsents, canSeeConsents } from '../../data/consents';
import { packetStatus, packetOutstanding, evidenceBlob, type ConsentPacket, type PacketChoices, type PacketSignature } from '../../data/consentPackets';
import { buildConsentPacketPdf } from '../../pdf/consentPacketPdf';
import { openPrintable, downloadBlob } from '../../data/openFile';
import { todayStamp } from '../../data/status';
import PacketForm from './PacketForm';
export default function Packets({ individualId, attentionOnly = false, siteId, onFiled }: {
    individualId?: string;
    attentionOnly?: boolean;
    siteId?: string | null;
    onFiled?: () => Promise<void>;
}) {
    const { api, session, workspace } = useData();
    const [packets, setPackets] = useState<ConsentPacket[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [signerName, setSignerName] = useState('');
    const [person, setPerson] = useState(individualId ?? '');
    const [effectiveOn, setEffective] = useState(todayStamp());
    const [reviewOn, setReview] = useState('');
    const [windowDays, setWindow] = useState(7);
    const [expiry, setExpiry] = useState(14);
    const [link, setLink] = useState('');
    const [paper, setPaper] = useState<ConsentPacket | null>(null);
    const [file, setFile] = useState<File>();
    const [choices, setChoices] = useState<PacketChoices>({});
    const [signer, setSigner] = useState<PacketSignature>({ printedName: '', authority: 'Self', authorityOther: '', signature: '', witness: '', signedOn: todayStamp(), accepted: false });
    const role = session?.roleKey ?? '';
    const manage = canManageConsents(role);
    const visible = canSeeConsents(role) && role !== 'dsp';
    useEffect(() => { if (!visible)
        return; let live = true; api.listConsentPackets().then(p => { if (live)
        setPackets(p); }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, [api, session?.userId, visible]);
    async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try {
        await action();
        setPackets(await api.listConsentPackets());
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update packet.');
    }
    finally {
        setBusy(false);
    } }
    if (!visible)
        return null;
    const shown = packets.filter(p => (!individualId || p.individualId === individualId) && (!siteId || workspace?.individuals.some(i => i.id === p.individualId && i.siteId === siteId)) && (!attentionOnly || packetOutstanding(p)));
    if (attentionOnly)
        return manage && shown.length > 0 ? <section className="consents"><h2>Outstanding consent packets</h2><ul>{shown.map(p => <li key={p.id}><a href="#/consents">{p.snapshot.individualName}: {packetStatus(p)} — unsigned since {p.sentAt?.slice(0, 10)}</a></li>)}</ul></section> : null;
    return <section aria-label="Consent packets"><h2>Consent packets</h2><p>Prepare a packet, share a secure signing link directly with the signer, or file a signed paper copy. Issuing a replacement link closes the previous link.</p>{error && <p role="alert">{error}</p>}
 {manage && <details><summary>Create a packet</summary><form onSubmit={e => { e.preventDefault(); void run(async () => { await api.createConsentPacket({ individualId: person, signerName, effectiveOn, reviewOn, outstandingAfterDays: windowDays }); }); }}>
 <label>Individual<select required value={person} onChange={e => setPerson(e.target.value)}><option value="">Choose Individual</option>{workspace?.individuals.filter(i => !individualId || i.id === individualId).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Expected signer<input required value={signerName} onChange={e => setSignerName(e.target.value)}/></label>
 <label>Effective date<input type="date" required value={effectiveOn} onChange={e => setEffective(e.target.value)}/></label><label>Expiry/review date<input type="date" required value={reviewOn} onChange={e => setReview(e.target.value)}/></label><label>Alert when unsigned for this many days<input type="number" min={1} max={90} required value={windowDays} onChange={e => setWindow(Number(e.target.value))}/></label><button disabled={busy}>Create draft packet</button></form></details>}
 {link && <div role="status"><p>Signing link issued. Share it only with the intended signer; anyone holding it can sign this packet until it expires.</p><label>Secure signing link<input readOnly value={link}/></label><button onClick={() => void navigator.clipboard.writeText(link).catch(() => setError('Copy the signing link from the field.'))}>Copy signing link</button><a href={`mailto:?subject=${encodeURIComponent('Your ComplyRer consent packet')}&body=${encodeURIComponent('Review and sign your consent packet using this private link: ' + link)}`}>Open email to signer</a><button onClick={() => setLink('')}>Hide link</button></div>}
 {shown.length === 0 && <p>No packets in this scope.</p>}
 {shown.map(p => <article key={p.id}><h3>{p.snapshot.individualName} — {packetStatus(p)}{packetOutstanding(p) ? ' — Outstanding' : ''}</h3><p>Packet {p.id}; expected signer {p.snapshot.signerName}. Follow up after {p.outstandingAfterDays} days.</p><p>Generated {p.generatedAt ?? '—'}; sent/link issued {p.sentAt ?? '—'}; opened {p.openedAt ?? '—'}; signed {p.signedAt ?? '—'}; filed {p.filedAt ?? '—'}</p>
 {p.audit && <details><summary>Packet audit trail</summary><ul>{p.audit.map((a, i) => <li key={i}>{a.event} — {a.at}{a.signerName ? ` — ${a.signerName}; ${a.authority}` : ''}</li>)}</ul></details>}
 {p.signer && <p>Signed by {p.signer.printedName}; authority {p.signer.authority} {p.signer.authorityOther}; witness {p.signer.witness}; date {p.signer.signedOn}.</p>}
 {manage && p.status === 'draft' && <button disabled={busy} onClick={() => void run(() => api.generateConsentPacket(p.id))}>Generate packet</button>}
 {p.generatedAt && <><button onClick={() => downloadBlob('Consent packet.pdf', buildConsentPacketPdf(p.snapshot, p.choices, p.signer).output('blob'))}>Download packet</button><button onClick={() => void openPrintable('Consent packet.pdf', buildConsentPacketPdf(p.snapshot, p.choices, p.signer).output('blob'), 'print')}>Print packet</button></>}
 {manage && p.generatedAt && !p.signedAt && <><label>Signing link expires in days<input type="number" min={1} max={30} value={expiry} onChange={e => setExpiry(Number(e.target.value))}/></label><button disabled={busy} onClick={() => void run(async () => { const token = await api.sendConsentPacket(p.id, expiry); setLink(`${window.location.origin}${window.location.pathname}#/consent-sign/${token}`); })}>Issue secure link for sharing</button><button disabled={busy} onClick={() => { setPaper(p); setChoices({}); setFile(undefined); }}>File signed paper copy</button></>}
 {p.signedAt && <button disabled={busy} onClick={() => void run(async () => { const evidence = await api.getConsentPacketEvidence(p.id); downloadBlob(evidence.name, evidenceBlob(evidence)); })}>Download filed signed evidence</button>}
 </article>)}
 {paper && <form onSubmit={e => { e.preventDefault(); if (file)
        void run(async () => { await api.filePaperConsentPacket(paper.id, choices, signer, file); setPaper(null); await onFiled?.(); }); }}><h3>Confirm paper packet choices and signatures</h3><PacketForm paper snapshot={paper.snapshot} choices={choices} signer={signer} onChoices={setChoices} onSigner={setSigner}/><label>Signed copy (PDF, PNG, JPEG; up to 10 MB)<input required type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0])}/></label><button disabled={busy || !file}>File signed packet</button><button type="button" onClick={() => setPaper(null)}>Cancel</button></form>}
 </section>;
}
