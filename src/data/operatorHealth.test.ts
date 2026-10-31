import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
import { jobHealthLabel } from "./operator";
test("health never fabricates success from missing/stale telemetry and denies tenant roles",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const empty=await api.operatorHealth();assert.ok(empty.jobs.every(j=>jobHealthLabel(j).startsWith("Unknown")));
 store.db.operatorJobRuns=[{id:"run",jobKey:"sweep-operating-reminders",startedAt:new Date(Date.now()-3600000).toISOString(),finishedAt:new Date(Date.now()-3590000).toISOString(),state:"succeeded",errorCode:null,durationMs:10000}];
 const job=(await api.operatorHealth()).jobs.find(j=>j.jobKey==="sweep-operating-reminders")!;assert.match(jobHealthLabel(job),/^Stale/);
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});await assert.rejects(api.operatorHealth(),/Operator access/);}
});
