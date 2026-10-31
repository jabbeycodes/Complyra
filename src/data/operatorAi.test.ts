import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";
test("operator AI settings target a chosen agency, require acknowledgement and never fake local verification",async()=>{
 const store=new MemoryStore(structuredClone(createEvergreenSeed()));const api=new LocalApi(store);
 await api.signIn({agencyCode:"COMPLYRER-MO",username:"platform.owner",password:DEMO_PASSWORD});
 const agencyId=store.db.agencies.find(a=>a.agencyCode===DEMO_AGENCY_CODE)!.id;
 const input={agencyId,model:"gemini-2.5-flash",enabled:true,policyAcknowledged:false};
 await assert.rejects(api.operatorSaveAi(input),/Confirm authorization/);
 await api.operatorSaveAi({...input,policyAcknowledged:true});assert.equal((await api.operatorAi(agencyId)).aiProcessingEnabled,true);
 assert.equal((await api.operatorAi(store.db.agencies[1].id)).aiProcessingEnabled,false);
 assert.equal((await api.operatorVerifyAi(agencyId)).ok,false);assert.equal((await api.operatorAi(agencyId)).serviceAccountVerifiedAt,null);
 assert.ok(store.db.audit.some(e=>e.agencyId===agencyId&&e.action==="ai_settings_changed"));
 for(const t of ROLE_TEMPLATES){const p=store.db.profiles.find(p=>p.username===DEMO_ADMIN_USERNAME)!;const m=store.db.memberships.find(m=>m.userId===p.id)!;m.roleKey=t.key;m.role=t.capability;await api.signIn({agencyCode:DEMO_AGENCY_CODE,username:DEMO_ADMIN_USERNAME,password:DEMO_PASSWORD});
 await assert.rejects(api.operatorAi(agencyId),/Operator access/);await assert.rejects(api.operatorSaveAi(input),/Operator access/);await assert.rejects(api.operatorVerifyAi(agencyId),/Operator access/);}
});
