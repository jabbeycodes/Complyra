import { useCallback, useEffect, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { canManageConsents, canSeeConsents } from '../../data/consents';
import { evidenceBlob } from '../../data/consentPackets';
import {
    isCompletedRightsPacket,
    rightsTrackingFor,
    rightsTrackingText,
    type RightsPacket,
    type RightsPacketCompletion,
} from '../../data/rightsPackets';
import { buildRightsPacketPdf } from '../../pdf/rightsPacketPdf';
import { openPrintable, downloadBlob } from '../../data/openFile';
import RightsPacketForm from './RightsPacketForm';

const emptyCompletion = (): RightsPacketCompletion => ({
    reviewedBy: '',
    // Deliberately empty: the manager types the packet date.
    packetOn: '',
    signer: { printedName: '', authority: 'Self', authorityOther: '', signature: '', witness: '', accepted: false },
});

/**
 * The Rights packet section of the chart's Consents area. One packet
 * per year; the tracker counts down from the latest completed packet's
 * typed date. Awaiting-signature and due/overdue states surface in the
 * attention view alongside consent gaps.
 */
export default function RightsPackets({ individualId, attentionOnly = false, siteId }: {
    individualId?: string;
    attentionOnly?: boolean;
    siteId?: string | null;
}) {
    const { api, session, workspace } = useData();
    const [packets, setPackets] = useState<RightsPacket[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [startingFor, setStartingFor] = useState<string | null>(null);
    const [signerName, setSignerName] = useState('');
    const [completing, setCompleting] = useState<{ packet: RightsPacket; paper: boolean } | null>(null);
    const [completion, setCompletion] = useState<RightsPacketCompletion>(emptyCompletion());
    const [file, setFile] = useState<File>();
    const role = session?.roleKey ?? '';
    const manage = canManageConsents(role);
    const visible = canSeeConsents(role) && role !== 'dsp';

    const load = useCallback(async () => {
        if (!visible) return;
        try {
            setPackets(await api.listRightsPackets());
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load rights packets.');
        }
    }, [api, visible]);

    useEffect(() => { void load(); }, [load, session?.userId]);

    if (!visible) return null;

    async function run(action: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        try {
            await action();
            setCompleting(null);
            setStartingFor(null);
            setFile(undefined);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update the rights packet.');
        } finally {
            setBusy(false);
        }
    }

    const people = (workspace?.individuals ?? []).filter(p => (!individualId || p.id === individualId) && (!siteId || p.siteId === siteId));
    const byPerson = new Map<string, RightsPacket[]>();
    for (const packet of packets) {
        const list = byPerson.get(packet.individualId) ?? [];
        list.push(packet);
        byPerson.set(packet.individualId, list);
    }
    const tracked = people.map(person => ({ person, packets: byPerson.get(person.id) ?? [], tracking: rightsTrackingFor(byPerson.get(person.id) ?? []) }));
    const needsAttention = (t: (typeof tracked)[number]['tracking']) =>
        t.kind === 'not_signed' || t.renewal.state !== 'current';

    if (attentionOnly) {
        const shown = tracked.filter(t => needsAttention(t.tracking));
        return manage && shown.length > 0 ? <section className="consents"><h2>Rights packets needing attention</h2><ul>{shown.map(({ person, tracking }) => <li key={person.id}><a href="#/consents">{person.name} — Rights packet: {rightsTrackingText(tracking)}</a></li>)}</ul></section> : null;
    }

    const beginComplete = (packet: RightsPacket, paper: boolean) => {
        setCompleting({ packet, paper });
        setFile(undefined);
        setCompletion({ ...emptyCompletion(), signer: { ...emptyCompletion().signer, printedName: packet.signerName } });
    };

    return <section className="rights-packets" aria-label="Rights packet">
    <h2>Rights packet</h2>
    {error && <p role="alert">{error}</p>}
    {people.length === 0 && <p>No Individuals in your scope.</p>}
    {tracked.map(({ person, packets: mine, tracking }) => {
        const latest = tracking.kind === 'tracked' ? tracking.packet : null;
        const awaiting = mine.filter(p => p.status === 'awaiting_signature').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const history = mine.filter(p => p.id !== latest?.id && p.id !== awaiting?.id)
            .sort((a, b) => (b.packetOn ?? b.createdAt).localeCompare(a.packetOn ?? a.createdAt));
        const printable = latest ?? awaiting;
        return <article key={person.id}>
      <h3>{person.name} — Rights packet: {rightsTrackingText(tracking)}</h3>
      {tracking.kind === 'tracked' && <p>Packet date {tracking.packet.packetOn} · Renews {tracking.renewal.renewalOn} · {tracking.renewal.text}</p>}
      {tracking.kind === 'not_signed' && <p>{awaiting ? 'A packet is started and awaiting signature.' : 'No completed rights packet on file.'}</p>}
      {latest && <>
        <p>Rights reviewed with the signer by {latest.reviewedBy}. Signed by {latest.signer?.printedName}; authority {latest.signer?.authority}{latest.signer?.authorityOther ? `: ${latest.signer.authorityOther}` : ''}; witness {latest.signer?.witness}; date {latest.packetOn}. Status: {latest.status === 'filed' ? 'Signed paper copy filed' : 'Signed'}.</p>
      </>}
      {awaiting && <p>Expected signer {awaiting.signerName}. Started {awaiting.createdAt.slice(0, 10)}.</p>}
      <p>
        {printable && <>
          <button onClick={() => downloadBlob('Rights packet.pdf', buildRightsPacketPdf(printable, person.name, session?.agencyName ?? '').output('blob'))}>Download packet</button>
          <button onClick={() => void openPrintable('Rights packet.pdf', buildRightsPacketPdf(printable, person.name, session?.agencyName ?? '').output('blob'), 'print')}>Print packet</button>
        </>}
        {latest?.status === 'filed' && <button disabled={busy} onClick={() => void run(async () => { const evidence = await api.getRightsPacketEvidence(latest.id); downloadBlob(evidence.name, evidenceBlob(evidence)); })}>Download filed signed evidence</button>}
        {manage && awaiting && <>
          <button disabled={busy} onClick={() => beginComplete(awaiting, false)}>Record signature</button>
          <button disabled={busy} onClick={() => beginComplete(awaiting, true)}>File signed paper copy</button>
        </>}
        {manage && !awaiting && <button disabled={busy} onClick={() => { setStartingFor(person.id); setSignerName(''); }}>Start a new Rights packet</button>}
      </p>
      {manage && startingFor === person.id && <form onSubmit={e => { e.preventDefault(); void run(() => api.createRightsPacket({ individualId: person.id, signerName })); }}>
        <h4>Start the annual Rights packet for {person.name}</h4>
        <label>Expected signer<input required value={signerName} onChange={e => setSignerName(e.target.value)} /></label>
        <button disabled={busy}>Start packet</button><button type="button" onClick={() => setStartingFor(null)}>Cancel</button>
      </form>}
      {history.length > 0 && <details><summary>Packet history ({history.length})</summary>{history.map(p => <p key={p.id}>{isCompletedRightsPacket(p) ? `Packet date ${p.packetOn} · signed by ${p.signer?.printedName} (${p.signer?.authority}) · ${p.status}` : `Started ${p.createdAt.slice(0, 10)} · awaiting signature · expected signer ${p.signerName}`}</p>)}</details>}
    </article>;
    })}
    {completing && <form onSubmit={e => { e.preventDefault(); void run(async () => {
        if (completing.paper) {
            if (!file) throw new Error('Attach the signed copy.');
            await api.filePaperRightsPacket(completing.packet.id, completion, file);
        } else {
            await api.signRightsPacket(completing.packet.id, completion);
        }
    }); }}>
      <h3>{completing.paper ? 'File the signed paper Rights packet' : 'Record the Rights packet signature'}</h3>
      <RightsPacketForm paper={completing.paper} value={completion} onChange={setCompletion} />
      {completing.paper && <label>Signed copy (PDF, PNG, JPEG; up to 10 MB)<input required type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0])} /></label>}
      <button disabled={busy || (completing.paper && !file)}>{completing.paper ? 'File signed packet' : 'Complete packet'}</button>
      <button type="button" onClick={() => setCompleting(null)}>Cancel</button>
    </form>}
  </section>;
}
