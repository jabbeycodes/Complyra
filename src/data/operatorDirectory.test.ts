import { DEMO_PASSWORD } from "./types";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_AGENCY_CODE, DEMO_ADMIN_USERNAME } from "./seed";
import { filterOperatorAgencies } from "./operator";
import { ROLE_TEMPLATES } from "./permissions";
test("operator directory returns classified seeded records and filters without conflating disabled/rejected", async () => {
 const store=new MemoryStore(structuredClone(createEvergreenSeed())); const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const rows=await api.operatorDirectory(); assert.equal(rows.find(a=>a.agencyCode==="EVERGREEN-MO")?.reportingCategory,"demo");
 assert.equal(filterOperatorAgencies(rows,"evergreen","active","demo").length,1);
 assert.equal(filterOperatorAgencies(rows,"","disabled","all").length,0);
 assert.equal(filterOperatorAgencies(rows,"","all","customer").length,0);
 for(const t of ROLE_TEMPLATES){
 const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!; const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;
 await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});
 await assert.rejects(api.operatorDirectory(),/Operator access/);
 }
});
