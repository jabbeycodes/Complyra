import type { AgencyStatus, PendingAgency } from "./types";
export interface OperatorAgency extends PendingAgency {
  createdAt: string | null; active: boolean; reportingCategory: "customer" | "demo" | "internal";
}
export function filterOperatorAgencies(rows: OperatorAgency[], query: string, status: string, category: string) {
  const q = query.trim().toLowerCase();
  return rows.filter((a) => (!q || `${a.name} ${a.agencyCode} ${a.stateCode}`.toLowerCase().includes(q))
    && (status === "all" || (status === "disabled" ? !a.active : a.status === status))
    && (category === "all" || a.reportingCategory === category));
}
export const OPERATOR_PAGES = ["Operator agencies"] as const;
export type OperatorStatus = AgencyStatus;

export interface OperatorPeriod { start: string; end: string; category: string; }
export interface OperatorOverviewData { total: number; active: number; inactive: number; pending: number; registrations: number; activity: number; unknownDates: number; series: { date: string; signups: number; growth: number }[]; }
export function validateOperatorPeriod(p: OperatorPeriod) {
 const valid=(s:string)=> /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
 const days=(Date.parse(p.end)-Date.parse(p.start))/86400000;
 if(!valid(p.start)||!valid(p.end)||days<0||days>365||!["customer","demo","internal","all"].includes(p.category)) throw new Error("Choose a valid date range of at most 366 days and reporting group.");
}
export function summarizeOperatorAgencies(rows: OperatorAgency[], p: OperatorPeriod, activity: number): OperatorOverviewData {
 validateOperatorPeriod(p); const selected=rows.filter(a=>p.category==="all"||a.reportingCategory===p.category);
 const series=[];for(let n=Date.parse(p.start);n<=Date.parse(p.end);n+=86400000){const date=new Date(n).toISOString().slice(0,10);series.push({date,signups:selected.filter(a=>a.createdAt?.slice(0,10)===date).length,growth:selected.filter(a=>a.createdAt && a.createdAt.slice(0,10)<=date).length});}
 const active=selected.filter(a=>a.status==="active"&&a.active).length;
 return {total:selected.length,active,inactive:selected.length-active,pending:selected.filter(a=>a.status==="pending").length,registrations:series.reduce((n,d)=>n+d.signups,0),activity,unknownDates:selected.filter(a=>!a.createdAt).length,series};
}

export interface OperatorAiInput { agencyId: string; model: string; enabled: boolean; policyAcknowledged: boolean; }
export function validateOperatorAi(input: OperatorAiInput) {
 if(!input.model.trim() || input.model.length>120) throw new Error("Enter a model name of at most 120 characters.");
 if(input.enabled && !input.policyAcknowledged) throw new Error("Confirm authorization and required agreements before enabling AI processing.");
}

export interface OperatorAuditQuery extends OperatorPeriod { agencyId: string; actorId: string; action: string; source: string; page: number; }
export interface OperatorAuditRow { id: string; agencyId: string; actorId: string | null; action: string; source: string; summary: string; createdAt: string; }
export interface OperatorAuditPage { rows: OperatorAuditRow[]; hasMore: boolean; }
export function validateOperatorAudit(q: OperatorAuditQuery){
 validateOperatorPeriod(q);
 if(!Number.isInteger(q.page)||q.page<0||q.page>2000||q.action.length>80||!["all","application","lifecycle","rules","ai"].includes(q.source))throw new Error("Invalid audit filters.");
 for(const id of [q.agencyId,q.actorId]) if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error("Enter a valid agency/actor ID.");
}
export function operatorAuditCsv(rows: OperatorAuditRow[]){
 const cell=(v:string|null)=>'"'+String(v??"").replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return [["Event ID","Agency ID","Actor ID","Action","Source","Summary","UTC time"],...rows.map(r=>[r.id,r.agencyId,r.actorId,r.action,r.source,r.summary,r.createdAt])].map(r=>r.map(cell).join(",")).join("\r\n");
}

export interface OperatorPeopleQuery { query: string; agencyId: string; page: number; }
export interface OperatorPerson { id:string; fullName:string; username:string; email:string; active:boolean; platformAdmin:boolean; mustChangePassword:boolean; memberships:{agencyId:string;agencyCode:string;roleKey:string;expiresOn:string|null}[]; }
export interface OperatorPeoplePage { rows:OperatorPerson[];hasMore:boolean; }
export function validateOperatorPeople(q:OperatorPeopleQuery){if(q.query.length>80||!Number.isInteger(q.page)||q.page<0||q.page>2000)throw new Error("Invalid people search.");}

export const OPERATOR_JOBS = ["sweep-operating-reminders","delegation-ack-sweep","schedule-hm-checklists","select-weekly-winners"] as const;
export interface OperatorJobRun { id:string;jobKey:string;startedAt:string;finishedAt:string|null;state:"running"|"succeeded"|"failed";errorCode:string|null;durationMs:number|null; }
export interface OperatorJobHealth { jobKey:string;expectedSeconds:number;latest:OperatorJobRun|null;lastSuccess:string|null;failures24h:number; }
export interface OperatorHealth { checkedAt:string;jobs:OperatorJobHealth[]; }
export function jobHealthLabel(job:OperatorJobHealth, now=Date.now()){
 if(!job.latest)return "Unknown — no observations";
 if(now-Date.parse(job.latest.startedAt)>job.expectedSeconds*1000)return "Stale — no recent observation";
 if(job.latest.state==="running"&&now-Date.parse(job.latest.startedAt)>900000)return "Stale — unfinished run";
 return job.latest.state==="succeeded" ? "Observed success" : job.latest.state==="failed" ? "Observed failure" : "Running";
}
