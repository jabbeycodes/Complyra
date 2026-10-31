import { useEffect, useState } from "react";
import { useData } from "../../data/DataProvider";
import type { OperatorAgency } from "../../data/operator";
import type { LocalAgencyAiSettings } from "../../data/seed";
import { PageHeading } from "../../components";
import "./operator.css";
export default function OperatorAiSettings(){
 const {api,session,usingHostedBackend}=useData();const [agencies,setAgencies]=useState<OperatorAgency[]>([]);const [agencyId,setAgencyId]=useState("");
 const [settings,setSettings]=useState<LocalAgencyAiSettings|null>(null);const [model,setModel]=useState("");const [enabled,setEnabled]=useState(false);const [ack,setAck]=useState(false);
 const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
 useEffect(()=>{let cancelled=false;if(!session?.platformAdmin)return;api.operatorDirectory().then(rows=>{if(!cancelled){setAgencies(rows);setAgencyId(rows[0]?.id??"");}}).catch(e=>{if(!cancelled)setError((e as Error).message);});return()=>{cancelled=true;};},[api,session?.platformAdmin]);
 useEffect(()=>{let cancelled=false;setSettings(null);setAck(false);setMessage("");if(!agencyId||!session?.platformAdmin)return;
 api.operatorAi(agencyId).then(s=>{if(!cancelled){setSettings(s);setModel(s.model);setEnabled(s.aiProcessingEnabled);}}).catch(e=>{if(!cancelled)setError((e as Error).message);});return()=>{cancelled=true;};},[api,agencyId,session?.platformAdmin]);
 if(!session?.platformAdmin)return <p role="alert">Operator access required.</p>;
 async function run(verify:boolean){setBusy(true);setError("");setMessage("");try{if(verify){const result=await api.operatorVerifyAi(agencyId);if(!result.ok)throw new Error(result.error??"Verification failed.");setMessage("Hosted service account verified.");}else{await api.operatorSaveAi({agencyId,model,enabled,policyAcknowledged:ack});setMessage("Agency model and processing policy saved.");}setSettings(await api.operatorAi(agencyId));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="operator-console"><PageHeading title="Operator Control Center · AI extraction" /><p>{usingHostedBackend ? "Hosted integration" : "Local demo — verification does not contact Vertex"}. Secrets are provisioned outside this interface and are never displayed.</p>
 <label className="form-label">Agency<select value={agencyId} disabled={busy} onChange={e=>{setError("");setAgencyId(e.target.value);}}>{agencies.map(a=><option value={a.id} key={a.id}>{a.name} · {a.agencyCode}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {settings ? <section className="panel"><h2>Document extraction policy</h2><p>Saved processing state: {settings.aiProcessingEnabled ? "Enabled" : "Disabled"}. Verification: {settings.serviceAccountVerifiedAt??"Not verified"}. Project: {settings.vertexProjectId??"Not recorded"}.</p>
 <label className="form-label">AI model<input maxLength={120} value={model} disabled={busy} onChange={e=>setModel(e.target.value)} /></label>
 <label><input type="checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)} /> Enable processing for this agency</label>
 <p>Enabling requires operator confirmation that required agreements (including the Google Cloud BAA where applicable) and agency authorization are in place. This checkbox does not create or verify an agreement.</p>
 <label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)} /> I confirm authorization and required agreements for this agency.</label>
 <div className="operator-filters"><button className="button primary" disabled={busy||!model.trim()||(enabled&&!ack)} onClick={()=>void run(false)}>{busy ? "Working…" : "Save agency policy"}</button><button className="button" disabled={busy} onClick={()=>void run(true)}>Verify service account</button></div></section> : <p role="status">{agencyId ? "Loading settings…" : "Choose an agency."}</p>}
 </div>;
}
