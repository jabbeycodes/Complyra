import { test } from "node:test";
import assert from "node:assert/strict";
import { observeJob } from "./observeJob.ts";
test("job observer records safe success/failure/exception status and tolerates absent telemetry",async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:name==="operator_job_start"?"run-id":null,error:null};}};
 await observeJob(client,"sweep-operating-reminders",async()=>new Response("private payload",{status:200}));assert.equal(calls.at(-1)!.args.p_state,"succeeded");
 await observeJob(client,"sweep-operating-reminders",async()=>new Response("private failure",{status:500}));assert.equal(calls.at(-1)!.args.p_error_code,"http_500");
 await assert.rejects(observeJob(client,"sweep-operating-reminders",async()=>{throw new Error("sensitive detail");}),/sensitive detail/);assert.equal(calls.at(-1)!.args.p_error_code,"unhandled");assert.ok(!JSON.stringify(calls).includes("sensitive detail"));
 assert.equal((await observeJob({rpc:async()=>({data:null,error:"missing migration"})},"job",async()=>new Response("still runs"))).status,200);
});
