import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
import { validateOperatorPeriod } from "./operator";
const period={start:"2026-09-01",end:"2026-09-02",category:"demo"};
test("overview reconciles source counts, excludes demo/internal customers and denies all tenant roles",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const d=await api.operatorOverview(period);assert.equal(d.total,1);assert.equal(d.registrations,1);assert.equal(d.series[0].growth,1);assert.equal(d.series[1].signups,0);
 assert.equal((await api.operatorOverview({...period,category:"customer"})).total,0);
 assert.throws(()=>validateOperatorPeriod({...period,start:"2026-02-30"}),/valid date/);
 assert.throws(()=>validateOperatorPeriod({...period,end:"2028-01-01"}),/valid date/);
 assert.equal("revenue" in d,false);
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});await assert.rejects(api.operatorOverview(period),/Operator access/);}
});
