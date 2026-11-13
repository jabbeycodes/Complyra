import type { WorkspaceView } from '../../data/localApi';
import { asMonthlyCollections, drillComplete, equipmentViewForPerson, monthDueOn, monthKeyFrom, safetyComplete } from '../../data/monthlyChecks';

export interface MonthlyAttentionItem { id: string; title: string; dueOn: string; siteName: string; personName?: string; }
/** Uses only the caller's already-authorized workspace; never an agency-wide fetch. */
export function monthlyAttention(workspace: WorkspaceView, visibleSites: { id: string; name: string }[], today: string): MonthlyAttentionItem[] {
  const result: MonthlyAttentionItem[] = [];
  const key = monthKeyFrom(today);
  const due = workspace.monthlyDue;
  const collections = asMonthlyCollections(workspace.monthly);
  for (const site of visibleSites) {
    const drills = workspace.monthly.drills.filter(row => row.agencyId === workspace.session.agencyId && row.siteId === site.id && row.monthKey === key);
    for (const drill of drills.filter(row => !drillComplete(row))) {
      result.push({id:drill.id,title:'Emergency drill',dueOn:monthDueOn(key,due.drillDay),siteName:site.name});
    }
    for (const safety of workspace.monthly.safetyReports.filter(row => row.agencyId === workspace.session.agencyId && row.siteId === site.id && row.monthKey === key && !safetyComplete(row))) {
      result.push({id:safety.id,title:'Home safety report',dueOn:monthDueOn(key,due.safetyDay),siteName:site.name});
    }
    for (const person of workspace.individuals.filter(row => row.siteId === site.id)) {
      const view = equipmentViewForPerson(collections,person.id,key,today,due.equipmentDay);
      if (view.items.length && !view.complete) result.push({id:`equipment-${person.id}-${key}`,title:'Adaptive equipment check',dueOn:monthDueOn(key,due.equipmentDay),siteName:site.name,personName:person.name});
    }
  }
  return result.sort((a,b)=>a.dueOn.localeCompare(b.dueOn));
}
