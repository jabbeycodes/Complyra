import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
test("operator people search returns actual memberships without credentials and denies all agency roles",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const result=await api.operatorPeople({query:"Sarah Mitchell",agencyId:"",page:0});assert.equal(result.rows.length,1);assert.equal(result.rows[0].memberships[0].agencyCode,DEMO_AGENCY_CODE);
 assert.equal('password' in result.rows[0],false);assert.equal('credentials' in result.rows[0],false);
 assert.equal((await api.operatorPeople({query:"platform.owner",agencyId:store.db.agencies[0].id,page:0})).rows.length,0);
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});await assert.rejects(api.operatorPeople({query:"",agencyId:"",page:0}),/Operator access/);}
});
