import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
import { renderNoticeTemplate } from "./operator";
test("notice operations preserve original safety content, validate versions and deny all agency roles",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const period={start:"2026-01-01",end:"2026-12-31",category:"all"};
 const before=await api.operatorCommunications(period);assert.equal(before.types.length,3);assert.ok(before.types.every(t=>t.channel==="in_app"&&t.provider==="database"));
 const input={type:"med.unrecorded",titleTemplate:"Reminder: {{title}}",bodyTemplate:"{{body}} Contact your manager if needed.",reason:"Add escalation guidance",expectedVersion:1};
 await assert.rejects(api.operatorSaveTemplate({...input,bodyTemplate:"remove context"}),/Preserve/);
 await api.operatorSaveTemplate(input);await assert.rejects(api.operatorSaveTemplate(input),/Template changed/);
 const rendered=renderNoticeTemplate(input.type,"Original title","Original body",store.db.operatorNoticeTemplates);assert.equal(rendered.title,"Reminder: Original title");assert.match(rendered.body,/Original body/);
 assert.equal(store.db.operatorNoticeTemplateHistory!.at(-1)!.actorId,store.sessionUserId);
 assert.equal((await api.operatorCommunications(period)).types.find(t=>t.type===input.type)!.version,2);
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});await assert.rejects(api.operatorCommunications(period),/Operator access/);await assert.rejects(api.operatorSaveTemplate(input),/Operator access/);}
});
