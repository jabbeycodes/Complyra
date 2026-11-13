import type { CommandCenterData } from '../components/CommandCenter';

export interface AuditSourceRecord {
  key: string;
  aliases: string[];
  title: string;
  kind: string;
  recordId: string;
  siteId: string | null;
  scoreFact: boolean;
  fields: [string, string][];
}

/** Only records already returned by authorized API calls may be inspected.
 * No path/ID supplied by the browser is used to fetch an arbitrary record.
 */
export function auditSourceRecords(data: CommandCenterData): AuditSourceRecord[] {
  const result: AuditSourceRecord[] = [];
  const staffSite = (id: string) => data.staff.find(row => row.id === id)?.siteId ?? null;
  const bySiteName = (name: string) => data.sites.find(row => row.name === name)?.id ?? null;
  const add = (kind: string, id: string, title: string, siteId: string | null, fields: [string, unknown][], scoreFact = true, aliases: string[] = []) => {
    result.push({key:`${kind}:${id}`,aliases:[`${kind}:${id}`,...aliases],kind,title,recordId:id,siteId,scoreFact,
      fields:fields.map(([label,value])=>[label,value===null||value===undefined||value===''?'Not recorded':Array.isArray(value)?value.join('; '):String(value)])});
  };
  for (const r of data.requirements) add('requirements',r.id,r.title,bySiteName(r.site),[['Individual',r.person],['Site',r.site],['Status',r.status],['Due',r.due],['Owner',r.owner],['Source',r.source],['Source page',r.page],['Evidence',r.evidence]],r.status!=='Pending review');
  for (const r of data.certs) add('certificates',r.id,`${r.staffName} — ${r.certName}`,staffSite(r.userId),[['Staff',r.staffName],['Certificate',r.certName],['Issued',r.issuedOn],['Expires',r.expiresOn],['Evidence file',r.fileName]],true,[`certificate:${r.id}`]);
  for (const r of data.clearance) add('training',r.userId,`${r.fullName} — Training clearance`,staffSite(r.userId),[['Staff',r.fullName],['Site',r.siteName],['Pending',r.pendingCount],['Overdue',r.overdueCount],['Readiness reasons',r.gateReasons]]);
  for (const r of data.checklists) add('checklists',r.id,`Weekly checklist — ${r.weekOf}`,r.siteId,[['Week',r.weekOf],['Status',r.status],['Due',r.dueAt],['Late',r.late]],true,[`checklist:${r.id}`]);
  for (const r of data.medications??[]) {
    const person=data.individuals.find(row=>row.id===r.individualId);
    if(!person)continue;
    add('medications',r.medicationId,r.medicationName,person.siteId,[['Individual',person.name],['Site',person.site],['Supply status',r.status],['Days remaining',r.daysRemaining],['Last counted',r.lastCountedOn]],true,[`medication:${r.medicationId}`]);
  }
  for (const r of data.actions) add('corrective-actions',r.id,r.title,r.siteId,[['Description',r.description],['Owner',r.assignedToName],['Due',r.dueOn],['Status',r.storedStatus],['Resolved',r.resolvedAt],['Linked risk',r.linkedRiskId]],false,[`corrective-action:${r.id}`]);
  for (const stack of data.planStacks??[]) for(const r of stack.renewals) {
    const person=data.individuals.find(row=>row.id===stack.individualId);
    add('plan-renewal',r.id,r.title,person?.siteId??null,[['Individual',stack.individualName],['Next due',r.nextDueOn]],false);
  }
  for(const r of data.rightsPackets??[]) {
    const person=data.individuals.find(row=>row.id===r.individualId);
    if(!person)continue;
    add('rights-renewal',r.id,`Rights packet — ${person.name}`,person.siteId,[['Individual',person.name],['Status',r.status],['Packet date',r.packetOn],['Expected signer',r.signerName],['Signed',r.signedAt],['Filed',r.filedAt],['Evidence file',r.evidenceName]],false);
  }
  return result;
}

/** Fail closed on stale or guessed source IDs. Aliases preserve existing feed IDs. */
export function selectAuditSources(records: AuditSourceRecord[], ids: string[]): AuditSourceRecord[] {
  const keys=new Set(ids);
  return records.filter(record=>record.aliases.some(key=>keys.has(key)));
}
