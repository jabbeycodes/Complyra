import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
import { operatorAuditCsv, type OperatorAuditQuery } from "./operator";
const q:OperatorAuditQuery={start:"2026-01-01",end:"2026-12-31",category:"all",agencyId:"",actorId:"",action:"",source:"all",page:0};
test("operator explorer paginates complete evidence without clinical detail and denies tenant roles",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const agencyId=store.db.agencies[0].id;store.db.audit=[];
 for(let n=0;n<53;n++)store.db.audit.push({id:String(n).padStart(3,"0"),agencyId,actorId:store.sessionUserId,action:"test.action",targetType:"test",targetId:null,detail:"DO NOT EXPOSE CARE DETAIL",createdAt:"2026-09-01T00:00:00.000Z"});
 const first=await api.operatorAudit(q);const second=await api.operatorAudit({...q,page:1});
 assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);assert.equal(second.rows.length,3);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.rows,...second.rows].map(e=>e.id)).size,53);assert.ok(first.rows.every(e=>!e.summary.includes("CARE")));
 assert.equal((await api.operatorAudit({...q,action:"absent"})).rows.length,0);
 assert.match(operatorAuditCsv([{...first.rows[0],summary:'=SUM(1,2)'}]),/"'=SUM/);
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});await assert.rejects(api.operatorAudit(q),/Operator access/);}
});
