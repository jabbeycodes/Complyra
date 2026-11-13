import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { metrics } from '../domain';
import { parseRequirementScorecard } from './scorecard';
import { readFileSync } from 'node:fs';

const login = (username: string) => ({ agencyCode: 'EVERGREEN-MO', username, password: 'Evergreen!demo1' });
test('scorecard rejects missing/partial/impossible aggregates rather than inventing a pass', () => {
  for (const value of [null, {}, {score:100}, {...metrics([]), total:1}, {...metrics([]), total:-1}, {...metrics([]), score:NaN}]) {
    assert.throws(() => parseRequirementScorecard(value), /unavailable/);
  }
  assert.deepEqual(parseRequirementScorecard(metrics([])), metrics([]));
});
test('local scorecard matches visible source records and excludes another home and agency', async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const hm = await api.signIn(login('james.wilson'));
  const before = await api.loadWorkspace(hm);
  const otherSite = store.db.sites.find(s => s.agencyId === hm.agencyId && s.id !== hm.siteId)!;
  const template = store.db.requirements.find(r => r.agencyId === hm.agencyId)!;
  store.db.requirements.push({...template, id:'outside-home', siteId:otherSite.id, individualId:null, status:'Compliant'});
  store.db.requirements.push({...template, id:'outside-agency', agencyId:'foreign-agency', siteId:hm.siteId!, individualId:null, status:'Compliant'});
  const after = await api.loadWorkspace(hm);
  assert.deepEqual(after.scorecard, metrics(after.requirements));
  assert.deepEqual(after.scorecard, before.scorecard);
  assert.ok(!after.requirements.some(r => ['outside-home','outside-agency'].includes(r.id)));
  await assert.rejects(() => api.loadWorkspace({...hm, agencyId:'foreign-agency'}), /Sign in/);
});
test('active assignment home includes site-wide requirements, ended assignment does not', async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const hm = await api.signIn(login('james.wilson'));
  const other = store.db.sites.find(s => s.agencyId === hm.agencyId && s.id !== hm.siteId)!;
  const template = store.db.requirements.find(r => r.agencyId === hm.agencyId)!;
  store.db.requirements.push({...template,id:'assigned-site-wide',siteId:other.id,individualId:null,status:'Compliant'});
  store.db.assignments.push({id:'score-assignment',agencyId:hm.agencyId,userId:hm.userId,siteId:other.id,individualId:null,startsOn:'2020-01-01',endsOn:null});
  assert.ok((await api.loadWorkspace(hm)).requirements.some(r=>r.id==='assigned-site-wide'));
  store.db.assignments.find(a=>a.id==='score-assignment')!.endsOn='2020-02-01';
  assert.ok(!(await api.loadWorkspace(hm)).requirements.some(r=>r.id==='assigned-site-wide'));
});
test('HR retains aggregate-only access; auditor cannot complete source requirements', async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const hrMember = store.db.memberships.find(m=>m.roleKey==='hr')!;
  const hrProfile = store.db.profiles.find(p=>p.id===hrMember.userId)!;
  const hr = await api.signIn(login(hrProfile.username));
  const view = await api.loadWorkspace(hr);
  assert.equal(view.requirements.length,0);
  assert.equal(view.individuals.length,0);
  assert.ok(view.scorecard.total>0);
  const auditorMember=store.db.memberships.find(m=>m.roleKey==='auditor')!;
  const auditorProfile=store.db.profiles.find(p=>p.id===auditorMember.userId)!;
  const auditor=await api.signIn(login(auditorProfile.username));
  const auditView = await api.loadWorkspace(auditor);
  assert.deepEqual(auditView.scorecard,metrics(auditView.requirements));
  await assert.rejects(() => api.completeRequirement(auditView.requirements[0].id, "Unauthorized"), /access|permission|allowed/i);
});
test('scorecard RPC source explicitly checks membership, permission, home and Individual scope',()=>{
  const sql=readFileSync('supabase/migrations/20261031231000_agency_scorecard_scope.sql','utf8');
  for(const guard of ['private.has_agency(p_agency_id)','private.can_read_site(p_agency_id, r.site_id)','private.can_read_individual(p_agency_id, r.individual_id)',"private.has_permission(p_agency_id, 'individuals.view')", "array['hr']",'r.due_on < current_date']) assert.ok(sql.includes(guard),guard);
});

test('hosted workspace rejects null scorecard and propagates the scoped aggregate without defaults', async()=>{
  const { HostedApi } = await import('./hostedApi');
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const local = new LocalApi(store);
  const member=store.db.memberships.find(m=>m.roleKey==='hr')!;
  const session=await local.signIn(login(store.db.profiles.find(p=>p.id===member.userId)!.username));
  const expected=(await local.loadWorkspace(session)).scorecard;
  let aggregate:unknown=expected;
  const calls:unknown[]=[];
  const client={
    from:()=>{
      const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null,error:null}),then:(ok:any,bad:any)=>Promise.resolve({data:[],error:null}).then(ok,bad)};
      return q;
    },
    rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return {data:aggregate,error:null};},
  };
  const hosted=new HostedApi(client as never);
  assert.deepEqual((await hosted.loadWorkspace(session)).scorecard,expected);
  assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['agency_scorecard',{p_agency_id:session.agencyId}])));
  aggregate=null;
  await assert.rejects(()=>hosted.loadWorkspace(session),/score unavailable/);
});
