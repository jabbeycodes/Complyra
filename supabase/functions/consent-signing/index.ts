import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { jsPDF } from 'npm:jspdf@4.2.1';
import { validatePacketSubmission, type PacketSnapshot, type PacketSignature } from '../_shared/consentPacketContent.ts';
import { drawConsentPacket } from '../_shared/consentPacketPdf.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
Deno.serve(async (request) => {
    if (request.method === 'OPTIONS')
        return new Response(null, { headers });
    if (request.method !== 'POST')
        return json({ error: 'Unavailable signing request.' }, 405);
    try {
        const body = await request.text();
        if (body.length > 20000)
            return json({ error: 'Signing request is too large.' }, 413);
        const input = JSON.parse(body);
        if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token) || !['open', 'sign'].includes(input.action))
            return json({ error: 'Signing link is unavailable or expired.' }, 400);
        const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
        const { data: packet, error } = await db.rpc('read_consent_packet_token', { p_token: input.token, p_open: input.action === 'open' });
        if (error || !packet)
            return json({ error: 'Signing link is unavailable or expired.' }, 410);
        if (input.action === 'open')
            return json(packet);
        const raw = input.signer ?? {};
        const signer: PacketSignature = { printedName: raw.printedName, authority: raw.authority, authorityOther: raw.authorityOther ?? '', signature: raw.signature, witness: raw.witness, signedOn: raw.signedOn, accepted: raw.accepted === true };
        validatePacketSubmission(input.choices, signer);
        const pdf = new jsPDF();
        drawConsentPacket(pdf, packet.snapshot as PacketSnapshot, input.choices, signer);
        const evidence = { name: 'Signed consent packet.pdf', mime: 'application/pdf', base64: pdf.output('datauristring').split(',')[1] };
        const { error: completeError } = await db.rpc('complete_consent_packet_token', { p_token: input.token, p_choices: input.choices, p_signer: signer, p_evidence: evidence });
        if (completeError)
            return json({ error: 'Packet could not be filed. The link may have expired or already been used. Check all choices and signing details.' }, 409);
        return json(evidence);
    }
    catch {
        return json({ error: 'Check every choice, signer name, authority, witness, date, and signature.' }, 400);
    }
});
