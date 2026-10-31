import { useEffect, useState } from "react";
import { useData } from "../../data/DataProvider";
import { jobHealthLabel, type OperatorHealth as Health } from "../../data/operator";
import { PageHeading } from "../../components";
import "./operator.css";
export default function OperatorHealth(){
 const {api,session,usingHostedBackend}=useData();const [data,setData]=useState<Health|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [roundTrip,setRoundTrip]=useState<number|null>(null);const [reload,setReload]=useState(0);const [now,setNow]=useState(Date.now);
 useEffect(()=>{let cancelled=false;if(!session?.platformAdmin)return;setLoading(true);setError("");const started=performance.now();api.operatorHealth().then(d=>{if(!cancelled){setData(d);setRoundTrip(Math.round(performance.now()-started));setNow(Date.now());}}).catch(e=>{if(!cancelled){setError((e as Error).message);setData(null);}}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[api,session?.platformAdmin,reload]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 if(!session?.platformAdmin)return <p role="alert">Operator access required.</p>;
 return <div className="operator-console"><PageHeading title="Operator Control Center · Observed system health" /><p>{usingHostedBackend?"Hosted job observations":"Local demo — scheduled jobs have not run unless explicitly simulated"}. Missing, stale and unfinished observations are never shown as healthy. Runs can include authorized manual invocations.</p><button className="button" disabled={loading} onClick={()=>setReload(v=>v+1)}>Refresh health</button>
 {loading&&<p role="status">Loading observations…</p>}{error&&<p role="alert">{error}</p>}
 {!loading&&!error&&data&&<><section className="panel"><h2>{usingHostedBackend?"Metadata RPC response":"Local metadata response"}</h2><p>Responded at {data.checkedAt}; browser-measured request duration {roundTrip} ms. This measures this request, not historical uptime or external service availability.</p></section>
 <section className="panel"><h2>Scheduled jobs</h2><div className="table-scroll"><table><thead><tr><th>Job</th><th>Observed state</th><th>Last start (UTC)</th><th>Last success (UTC)</th><th>Failures in 24h</th><th>Duration / code</th></tr></thead><tbody>{data.jobs.map(j=><tr key={j.jobKey}><td>{j.jobKey}<small> · stale after {Math.round(j.expectedSeconds/3600*10)/10}h</small></td><td>{jobHealthLabel(j,now)}</td><td>{j.latest?.startedAt??"No observation"}</td><td>{j.lastSuccess??"Not observed"}</td><td>{j.failures24h}</td><td>{j.latest?.durationMs==null?"Not recorded":`${j.latest.durationMs} ms`}{j.latest?.errorCode?` · ${j.latest.errorCode}`:""}</td></tr>)}</tbody></table></div></section><p>External endpoint probes, database resource saturation and continuous Vertex uptime are not instrumented. AI verification remains a point-in-time check.</p></>}
 </div>;
}
