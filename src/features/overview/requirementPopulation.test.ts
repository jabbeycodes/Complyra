import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementPopulation } from './requirementPopulation';
import { monthlyAttention } from './monthlyAttention';
import { LocalApi, MemoryStore } from '../../data/localApi';
import { createEvergreenSeed } from '../../data/seed';
import { teamComplianceSummary } from '../personalCompliance/personalCompliance';
import type { Requirement } from '../../domain';

const login=(username:string)=>({agencyCode:'EVERGREEN-MO',username,password:'Evergreen!demo1'});
test('simulation PM: empty register beside 18 expiring consents cannot be 100% or On track',()=>{
 const result=requirementPopulation([]);
 assert.equal(result.scoreText,'Not assessed');
 assert.equal(result.assessed,false);
 assert.match(result.explanation,/consents/);
 assert.doesNotMatch(result.status,/On track|clear|current/i);
});
test('Juniper: overdue monthly drill/safety records remain visible when requirement population is empty',async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 const session=await api.signIn(login('sarah.mitchell'));const workspace=await api.loadWorkspace(session);
 workspace.requirements=[];
 const site=workspace.sites[0];
 const drill=workspace.monthly.drills.find(row=>row.siteId===site.id)!;
 const safety=workspace.monthly.safetyReports.find(row=>row.siteId===site.id)!;
 workspace.monthly.drills=[{...drill,id:'juniper-drill',monthKey:'2026-10',date:null,time:null,leaderName:null}];
 workspace.monthly.safetyReports=[{...safety,id:'juniper-safety',monthKey:'2026-10',lines:[]}];
 workspace.monthlyDue={equipmentDay:7,drillDay:7,safetyDay:7};
 const rows=monthlyAttention(workspace,[site],'2026-10-31');
 assert.ok(rows.some(row=>row.id==='juniper-drill'&&row.dueOn==='2026-10-07'));
 assert.ok(rows.some(row=>row.id==='juniper-safety'&&row.dueOn==='2026-10-07'));
 assert.equal(requirementPopulation(workspace.requirements).scoreText,'Not assessed');
 // A same-agency home and a foreign agency record must not enter the cohort.
 workspace.monthly.drills.push({...workspace.monthly.drills[0],id:'other-home',siteId:'another-home'});
 workspace.monthly.drills.push({...workspace.monthly.drills[0],id:'other-agency',agencyId:'foreign-agency'});
 assert.ok(!monthlyAttention(workspace,[site],'2026-10-31').some(row=>['other-home','other-agency'].includes(row.id)));
});
test('HR: inaccessible care population and unassigned staff readiness are not passing assessments',()=>{
 assert.equal(requirementPopulation([],false).status,'Unavailable');
 assert.equal(teamComplianceSummary([[],[]]).fullyCurrent,0);
 assert.equal(teamComplianceSummary([[],[]]).unassessed,2);
});
test('site score and drill-down use exactly the selected register cohort',()=>{
 const rows=[{id:'a',site:'Juniper',status:'Overdue'},{id:'b',site:'Other',status:'Compliant'}] as Requirement[];
 const selected=rows.filter(row=>row.site==='Juniper');
 const result=requirementPopulation(selected);
 assert.equal(result.overdue,1);assert.equal(result.total,1);assert.equal(result.scoreText,'0%');
 assert.equal(requirementPopulation(rows.filter(row=>row.site==='Missing')).scoreText,'Not assessed');
});


test('Juniper phone house card does not render a passing percentage for zero source records',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {MobileComplianceBandHouse}=await import('../mobile/MobileComplianceBand');
 const html=renderToStaticMarkup(createElement(MobileComplianceBandHouse,{row:{siteId:'juniper',siteName:'Juniper',items:[],score:100,total:0,done:0,overdue:0,dueSoon:0,review:0},onOpen:()=>{}}));
 assert.match(html,/Not assessed/);
 assert.doesNotMatch(html,/100%|On track|Nothing overdue/);
});
