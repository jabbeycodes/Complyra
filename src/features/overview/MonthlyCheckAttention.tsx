import { useData } from '../../data/DataProvider';
import { sitesVisibleTo } from '../../data/dashboard';
import { hasPermission } from '../../data/permissions';
import { todayIso } from '../../data/chart';
import { monthlyAttention } from './monthlyAttention';

export default function MonthlyCheckAttention({site,onOpenSite,onOpenPerson}:{site:string;onOpenSite:(name:string)=>void;onOpenPerson:(name:string)=>void}) {
  const {session,workspace}=useData();
  if (!session || !workspace || !hasPermission(session,'individuals.view')) return null;
  const sites=sitesVisibleTo(session,workspace.sites,workspace.staff,workspace.assignmentSiteIds).filter(row=>site==='All sites'||row.name===site);
  const rows=monthlyAttention(workspace,sites,todayIso());
  return <section className="panel" aria-label="Monthly check attention">
    <h2>Monthly check attention</h2>
    <p>Incomplete equipment, drill, and safety records for the current month. These are separate from the requirement register.</p>
    {!rows.length ? <p>No incomplete monthly records in this scope. This does not assess other compliance areas.</p> : <ul className="record-list">{rows.map(row=><li className="record-row" key={row.id}>
      <button type="button" className="text-button" onClick={()=>row.personName?onOpenPerson(row.personName):onOpenSite(row.siteName)}>{row.title} · {row.personName??row.siteName} · due {row.dueOn}</button>
      <span>{row.dueOn<todayIso()?'Overdue':'Due this month'}</span>
    </li>)}</ul>}
  </section>;
}
