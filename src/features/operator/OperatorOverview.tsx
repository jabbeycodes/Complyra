import { useEffect, useState } from "react";
import { useData } from "../../data/DataProvider";
import type { OperatorOverviewData } from "../../data/operator";
import { PageHeading } from "../../components";
import "./operator.css";
const param=(key:string)=>typeof window === "undefined" ? null : new URLSearchParams(decodeURIComponent(window.location.hash).split("?")[1]).get(key);
const today=()=>new Date().toISOString().slice(0,10);
export default function OperatorOverview(){
 const {api,session,usingHostedBackend}=useData();
 const [start,setStart]=useState(()=>param("from")??new Date(Date.now()-29*86400000).toISOString().slice(0,10));const [end,setEnd]=useState(()=>param("to")??today());
 const [category,setCategory]=useState(()=>param("category")??"customer");const [data,setData]=useState<OperatorOverviewData|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
 useEffect(()=>{window.history.replaceState(null,"",`#Operator%20overview?from=${start}&to=${end}&category=${encodeURIComponent(category)}`);},[start,end,category]);
 useEffect(()=>{let cancelled=false;if(!session?.platformAdmin)return;setLoading(true);setError("");
 api.operatorOverview({start,end,category}).then(d=>{if(!cancelled)setData(d);}).catch(e=>{if(!cancelled){setError((e as Error).message);setData(null);}}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[api,session?.platformAdmin,start,end,category]);
 if(!session?.platformAdmin)return <p role="alert">Operator access required.</p>;
 const link=(date?:string,status="all")=>`#Operator%20agencies?category=${encodeURIComponent(category)}${date ? `&from=${date}&to=${date}` : ""}&status=${status}`;
 return <div className="operator-console"><PageHeading title="Operator Control Center · Overview" />
 <p>{usingHostedBackend ? "Hosted source data" : "Local seeded demonstration — not production customers"}. All dates use UTC. Customer reporting excludes demo/internal agencies; choose a group explicitly.</p>
 <div className="operator-filters"><label>From<input type="date" value={start} onChange={e=>setStart(e.target.value)} /></label><label>Through<input type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label><label>Reporting group<select value={category} onChange={e=>setCategory(e.target.value)}>{["customer","demo","internal","all"].map(v=><option key={v}>{v}</option>)}</select></label></div>
 {loading && <p role="status">Loading metrics…</p>}{error && <p role="alert">{error}</p>}
 {!loading && !error && data && <><section className="panel"><h2>Current snapshot</h2><div className="operator-metrics">{Object.entries({"Total agencies":data.total,"Operationally active":data.active,"Other statuses / disabled":data.inactive,"Pending approvals":data.pending}).map(([label,value])=><a key={label} href={link(undefined, label === "Pending approvals" ? "pending" : label === "Operationally active" ? "active" : label === "Other statuses / disabled" ? "inactive" : "all")}><strong>{value}</strong><span>{label}</span></a>)}</div></section>
 <section className="panel"><h2>Selected period</h2><p>{data.registrations} persisted registrations · {data.activity} recorded application actions.</p><p>Registrations measure agency creation, not signup attempts or approvals. Activity counts only recorded audit events and may include multiple records for one workflow. {data.unknownDates} agencies have no recorded creation date.</p></section>
 {(["signups","growth"] as const).map(kind=>{const max=Math.max(1,...data.series.map(d=>d[kind]));return <section className="panel" key={kind}><h2>{kind==="signups" ? "Daily registrations" : "Cumulative persisted agencies"}</h2><p>Click a point or a date below to open that day's registrations. Growth does not reconstruct deletions or historical active customers.</p>
 <svg viewBox="0 0 700 160" role="img" aria-label={`${kind} over selected UTC dates`} className="operator-chart"><title>{kind} over selected dates</title><text x="0" y="12" fontSize="11">{max} agencies</text><text x="0" y="155" fontSize="11">{start}</text><text x="620" y="155" fontSize="11">{end}</text><polyline fill="none" stroke="currentColor" strokeWidth="2" points={data.series.map((d,i)=>`${20+i*660/Math.max(1,data.series.length-1)},${140-d[kind]*120/max}`).join(" ")} />{data.series.map((d,i)=><a key={d.date} href={link(d.date)} aria-label={`${d.date}: ${d[kind]}; open registrations`}><circle cx={20+i*660/Math.max(1,data.series.length-1)} cy={140-d[kind]*120/max} r="5" fill="currentColor"><title>{d.date}: {d[kind]}</title></circle></a>)}</svg>
 <details><summary>Accessible data table and drill-downs</summary><div className="table-scroll"><table><thead><tr><th>Date (UTC)</th><th>Agencies</th></tr></thead><tbody>{data.series.map(d=><tr key={d.date}><td><a href={link(d.date)}>{d.date}</a></td><td>{d[kind]}</td></tr>)}</tbody></table></div></details></section>;})}
 <p>Subscriptions, revenue and customer retention are not measured: billing/subscription and validated lifecycle sources do not exist. No commercial values are estimated.</p></>}
 </div>;
}
