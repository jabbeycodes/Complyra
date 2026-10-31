/** Observations contain safe status codes only, never error messages or payloads. */
export interface JobObserverClient { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>; }
export async function observeJob(client:JobObserverClient,jobKey:string,work:()=>Promise<Response>):Promise<Response>{
 let id:unknown=null;
 try {const started=await client.rpc("operator_job_start",{p_job:jobKey});if(!started.error)id=started.data;}catch{ /* Deployment may not yet include telemetry. */ }
 const finish=async(state:string,code:string|null)=>{if(typeof id!=="string")return;try{await client.rpc("operator_job_finish",{p_run_id:id,p_state:state,p_error_code:code});}catch{ /* A missing observation must not invent success. */ }};
 try{const response=await work();await finish(response.ok?"succeeded":"failed",response.ok?null:`http_${response.status}`);return response;}
 catch(error){await finish("failed","unhandled");throw error;}
}
