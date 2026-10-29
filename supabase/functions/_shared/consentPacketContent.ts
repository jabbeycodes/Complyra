// Original Complyrer copy. Only section subjects and field requirements follow the intake reference.
export const PACKET_COPY_VERSION = 'complyrer-consents-2026-10-v1';
export const PACKET_ITEMS = [
    { key: 'participation', typeId: 'service', label: 'Participation in agency services', text: 'I choose whether the Individual may take part in the services arranged with this agency.' },
    { key: 'photograph', typeId: 'photograph', label: 'Photographs for identification and recreation', text: 'I choose whether identification and recreational photographs may be kept in the case record, including sharing an identification photograph with law enforcement during an emergency.' },
    { key: 'medications', typeId: 'medication', label: 'Prescribed medication support', text: 'I choose whether the agency may support medication administration under physician or psychiatrist orders for medical or mental health needs. Before a non-emergency medication begins, the prescriber explains its purpose and possible side effects.' },
    { key: 'emergency', typeId: 'emergency', label: 'Urgent medical assistance', text: 'I choose whether emergency medical care, including surgery when needed, may be arranged when the guardian cannot be reached.' },
    { key: 'outings', typeId: 'outings', label: 'Supported community activities', text: 'I choose whether the Individual may join activities away from home with education, support, and oversight appropriate to the activity.' },
    { key: 'law_enforcement', typeId: 'law_enforcement', label: 'Safety coordination with law enforcement', text: 'I choose whether the agency may contact police and provide relevant information when the Individual is missing or there is a safety concern.' },
    { key: 'information', typeId: 'information', label: 'Health information exchange', text: 'I choose whether the agency may exchange the listed health information with healthcare providers to keep the required medical file current and support coordinated care. This permission lasts while the agency provides residential services, subject to the review date shown. I may end it by written notice; that notice cannot reverse information already shared. I receive a copy. My choice is voluntary and does not determine treatment, payment, or eligibility.' },
    { key: 'rights', typeId: 'rights', label: 'Rights information and grievance process', text: 'I received the state Individual Rights publication and this agency\'s grievance procedure. I was offered time to read them, discuss concerns, and ask questions.' },
    { key: 'media', typeId: 'media', label: 'Public media and social media', text: 'Choose how names, event information, photographs, sound recordings, and video may be used for recreation or promotion in public settings: full permission, group photographs only, or no permission.' },
] as const;
export const HEALTH_SCOPE = ['Visit notes: specialists, urgent care, emergency department, and annual physicals', 'Mental health assessments and recommendations', 'Immunization records', 'Laboratory and other test results', 'Prescriber orders', 'Behavior reports'] as const;
export const AUTHORITY_OPTIONS = ['Self', 'Parent', 'Guardian', 'Medical Power of Attorney', 'Other'] as const;
export type PacketChoices = Record<string, string>;
export interface PacketSignature {
    printedName: string;
    authority: string;
    authorityOther: string;
    signature: string;
    witness: string;
    signedOn: string;
    accepted: boolean;
}
export interface PacketSnapshot {
    individualName: string;
    agencyName: string;
    signerName: string;
    effectiveOn: string;
    reviewOn: string;
    copyVersion: string;
    items: typeof PACKET_ITEMS;
    healthScope: readonly string[];
}
export function validatePacketSubmission(choices: PacketChoices, signer: PacketSignature) {
    for (const item of PACKET_ITEMS) {
        const allowed = item.key === 'media' ? ['full', 'group', 'none'] : ['yes', 'no'];
        if (!allowed.includes(choices[item.key]))
            throw new Error(`Choose an answer for ${item.label}.`);
    }
    if (Object.keys(choices).length !== PACKET_ITEMS.length)
        throw new Error('Unexpected packet choices.');
    if (!signer.printedName?.trim() || !signer.signature?.trim() || !signer.witness?.trim() || !signer.accepted)
        throw new Error('Complete the signer, signature, witness, and signing agreement.');
    if (!(AUTHORITY_OPTIONS as readonly string[]).includes(signer.authority) || (signer.authority === 'Other' && !signer.authorityOther?.trim()))
        throw new Error('State the signer’s legal authority.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signer.signedOn) || new Date(signer.signedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== signer.signedOn)
        throw new Error('Use a valid signing date.');
    for (const text of [signer.printedName, signer.authorityOther, signer.signature, signer.witness])
        if (text.length > 500)
            throw new Error('Keep signature fields within 500 characters.');
}
