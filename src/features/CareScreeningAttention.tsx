import { useEffect } from 'react';
import { useData } from '../data/DataProvider';
import { overdueCare, screeningStatus } from '../data/careScreening';
import { useCareRecords } from './CareScreeningSection';
export default function CareScreeningAttention({
  siteId,
  onOpenPerson
}: {
  siteId: string | null;
  onOpenPerson: (name: string) => void;
}) {
  const {
    api,
    workspace
  } = useData();
  const {
    data,
    error,
    enabled
  } = useCareRecords();
  useEffect(() => {
    if (enabled) void api.sweepCareScreening().catch(() => {});
  }, [api, enabled]);
  if (!enabled) return null;
  const notices = data ? [...data.plans.filter(p => overdueCare(p)).map(p => ({
    id: p.id,
    person: p.individual_id,
    title: `Care plan review overdue: ${p.title}`,
    date: p.items.map(i => i.review_on).sort()[0]
  })), ...data.screenings.flatMap(s => {
    const t = data.types.find(t => t.id === s.type_id)!;
    const status = screeningStatus(s, t);
    return ['due soon', 'overdue'].includes(status) ? [{
      id: s.id,
      person: s.individual_id,
      title: `${t.name}: ${status}`,
      date: s.due_on
    }] : [];
  })].filter(n => !siteId || workspace?.individuals.some(p => p.id === n.person && p.siteId === siteId)) : [];
  return <section className="panel care-records" aria-label="Care reviews and screenings"><h2>Care reviews and screenings</h2>{error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading care deadlines…</p> : !notices.length ? <p>No care reviews or screenings need attention.</p> : <ul>{notices.map(n => {
        const person = workspace?.individuals.find(p => p.id === n.person);
        return <li key={n.id}><button className="button" disabled={!person} onClick={() => person && onOpenPerson(person.name)}>{person?.name ?? 'Individual'} — {n.title} — due {n.date}</button></li>;
      })}</ul>}</section>;
}
