import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSourceRecords, selectAuditSources } from './auditSourceRecords';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { buildScoreFactsForData, type CommandCenterData } from '../components/CommandCenter';

const login=(username:string)=>({agencyCode:'EVERGREEN-MO',username,password:'Evergreen!demo1'});
async function view(username='james.wilson') {
 const store=new MemoryStore(structuredClone(createEvergreenSeed())); const api=new LocalApi(store);
 const session=await api.signIn(login(username)); const workspace=await api.loadWorkspace(session);
 const data:CommandCenterData={...workspace,actions:await api.listCorrectiveActions(),certs:[],clearance:[],checklists:[],snapshots:[]};
 return {store,api,session,data};
}
test('record drill-down fails closed for another home, another agency, stale and guessed IDs',async()=>{
 const {store,session,data}=await view();const records=auditSourceRecords(data);
 const foreignHome=store.db.requirements.find(r=>r.agencyId===session.agencyId&&r.siteId!==session.siteId)!;
 assert.deepEqual(selectAuditSources(records,[`requirements:${foreignHome.id}`]),[]);
 assert.deepEqual(selectAuditSources(records,['requirements:foreign-agency-record','requirements:deleted','../../../secrets']),[]);
 assert.ok(records.filter(r=>r.kind==='requirements').every(r=>r.siteId===session.siteId));
});
test('requirement link returns exactly the underlying record with source page, evidence and due date',async()=>{
 const {data}=await view();const req=data.requirements[0];const sources=selectAuditSources(auditSourceRecords(data),[`requirements:${req.id}`]);
 assert.equal(sources.length,1);assert.equal(sources[0].recordId,req.id);
 assert.ok(sources[0].fields.some(([label,value])=>label==='Due'&&value===req.due));
 assert.ok(sources[0].fields.some(([label,value])=>label==='Source page'&&value===String(req.page)));
});
test('score source record cohort equals score fact population, excluding draft requirements',async()=>{
 const {data}=await view('sarah.mitchell');
 const facts=buildScoreFactsForData(data);
 const count=facts.reduce((sum,f)=>sum+f.requirements.length+f.certificates.length+f.training.length+f.checklists.length+f.medications.length,0);
 assert.equal(auditSourceRecords(data).filter(row=>row.scoreFact).length,count);
});
test('existing risk and timeline source-ID aliases resolve to one certificate or corrective record',async()=>{
 const {data}=await view('sarah.mitchell');
 const template={id:'cert-1',agencyId:data.actions[0]?.agencyId??'agency',userId:data.staff[0].id,staffName:data.staff[0].name,certName:'CPR',issuedOn:'2025-01-01',expiresOn:'2026-01-01',filePath:null,fileName:'cpr.pdf',enteredBy:data.staff[0].id,createdAt:'2025-01-01',daysRemaining:-1};
 data.certs=[template];const records=auditSourceRecords(data);
 assert.equal(selectAuditSources(records,['certificate:cert-1','certificates:cert-1']).length,1);
 assert.ok(selectAuditSources(records,['certificate:cert-1'])[0].fields.some(([label,value])=>label==='Evidence file'&&value==='cpr.pdf'));
});
test('auditor source inspection adds no mutation capability',async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const member=store.db.memberships.find(m=>m.roleKey==='auditor')!;
 const profile=store.db.profiles.find(p=>p.id===member.userId)!;const api=new LocalApi(store);const session=await api.signIn(login(profile.username));
 const workspace=await api.loadWorkspace(session);const data:CommandCenterData={...workspace,actions:[],certs:[],clearance:[],checklists:[],snapshots:[]};
 const row=auditSourceRecords(data).find(r=>r.kind==='requirements')!;assert.ok(selectAuditSources(auditSourceRecords(data),[row.key]).length===1);
 await assert.rejects(()=>api.completeRequirement(row.recordId,'Unauthorized'),/access|permission|allowed/i);
});
