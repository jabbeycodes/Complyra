import { useCallback, useEffect, useState } from 'react';
import { useData } from '../data/DataProvider';
import { canViewCare, canViewScreening, canManageCare, canApproveCare, canAcknowledgeCare, overdueCare, screeningStatus, type CareScreeningData, type CareDraft, type CareAction, type Screening, type ScreeningDraft } from '../data/careScreening';
import { roleLabel } from '../data/status';
import './careScreening.css';
export function useCareRecords(individualId?: string) {
  const {
    api,
    session
  } = useData();
  const [data, setData] = useState<CareScreeningData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = !!session && canViewCare(session.roleKey);
  const reload = useCallback(async () => {
    if (!enabled) {
      setData(null);
      return;
    }
    setError('');
    try {
      setData(await api.getCareScreeningData(individualId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, enabled, individualId]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload, session?.userId, session?.agencyId]);
  async function save(input: CareAction) {
    setBusy(true);
    setError('');
    try {
      await api.mutateCareScreening(input);
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    error,
    busy,
    save,
    reload,
    enabled
  };
}
const blankItem = () => ({
  need: '',
  goal: '',
  interventions: '',
  roles: [] as string[],
  review_on: ''
});
export default function CareScreeningSection({
  individualId
}: {
  individualId: string;
}) {
  const {
    session,
    workspace
  } = useData();
  const records = useCareRecords(individualId);
  const [draft, setDraft] = useState<CareDraft | null>(null);
  const [previous, setPrevious] = useState<string | undefined>();
  const [editing, setEditing] = useState<Screening | 'new' | null>(null);
  const {
    data,
    error,
    busy,
    save
  } = records;
  if (!session || !records.enabled) return null;
  if (!data) return <section className="chart-widget care-records"><h2>Care plans and health screenings</h2>{error ? <><p role="alert">{error}</p><button className="button" onClick={() => void records.reload()}>Retry</button></> : <p role="status">Loading care records…</p>}</section>;
  const manage = canManageCare(session.roleKey);
  const active = data.plans.find(p => p.status === 'active');
  const hasDraft = data.plans.some(p => p.status === 'draft');
  const names = (id: string) => session.userId === id ? session.fullName : workspace?.staff.find(s => s.id === id)?.name ?? 'Staff member';
  return <section className="chart-widget care-records" id="chart-care-plans" aria-label="Care plans and health screenings">
    <h2>Care plans</h2>
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && <p role="status">Saving care record…</p>}
    {!active && <p>No active care plan.</p>}
    {manage && !hasDraft && !draft && <button className="button" onClick={() => {
      setPrevious(active?.id);
      setDraft(active ? {
        title: active.title,
        items: structuredClone(active.items)
      } : {
        title: '',
        items: [blankItem()]
      });
    }}>{active ? 'Revise active plan' : 'Create draft plan'}</button>}
    {draft && <form className="stack" onSubmit={async e => {
      e.preventDefault();
      if (await save({
        action: 'draft',
        individual_id: individualId,
        previous_id: previous,
        draft
      })) setDraft(null);
    }}>
      <h3>{previous ? 'Draft revision' : 'New draft'}</h3>
      <label>Plan title<input required value={draft.title} onChange={e => setDraft({
          ...draft,
          title: e.target.value
        })} /></label>
      {draft.items.map((item, index) => <fieldset key={index}><legend>Care item {index + 1}</legend>
        {(['need', 'goal', 'interventions'] as const).map(key => <label key={key}>{key === 'need' ? 'Health need or risk' : key === 'goal' ? 'Goal' : 'Interventions staff follow'}<textarea required value={item[key]} onChange={e => setDraft({
            ...draft,
            items: draft.items.map((i, n) => n === index ? {
              ...i,
              [key]: e.target.value
            } : i)
          })} /></label>)}
        <fieldset><legend>Responsible roles</legend>{['nurse', 'program_manager', 'house_manager', 'dsp'].map(role => <label className="care-role" key={role}><input type="checkbox" checked={item.roles.includes(role)} onChange={e => setDraft({
              ...draft,
              items: draft.items.map((i, n) => n === index ? {
                ...i,
                roles: e.target.checked ? [...i.roles, role] : i.roles.filter(r => r !== role)
              } : i)
            })} />{roleLabel(role)}</label>)}</fieldset>
        <label>Review date<input required type="date" value={item.review_on} onChange={e => setDraft({
            ...draft,
            items: draft.items.map((i, n) => n === index ? {
              ...i,
              review_on: e.target.value
            } : i)
          })} /></label>
        {draft.items.length > 1 && <button type="button" className="button" onClick={() => setDraft({
          ...draft,
          items: draft.items.filter((_, n) => n !== index)
        })}>Remove item {index + 1}</button>}
      </fieldset>)}
      <div className="chart-actions"><button type="button" className="button" onClick={() => setDraft({
          ...draft,
          items: [...draft.items, blankItem()]
        })}>Add care item</button><button className="button primary" disabled={busy}>Save draft for approval</button><button type="button" className="button" onClick={() => setDraft(null)}>Cancel</button></div>
    </form>}
    {data.plans.filter(p => ['active', 'draft'].includes(p.status)).map(plan => <article className="care-record" key={plan.id}>
      <h3>{plan.title} — {plan.status}</h3>{overdueCare(plan) && <strong>Review overdue</strong>}
      {plan.items.map((item, index) => <div key={index}><h4>{item.need}</h4><p><strong>Goal:</strong> {item.goal}</p><p><strong>Interventions:</strong> {item.interventions}</p><p><strong>Responsible roles:</strong> {item.roles.map(r => roleLabel(r)).join(', ')}</p><p><strong>Review date:</strong> {item.review_on}</p></div>)}
      {plan.approved_at && <p>Approved {plan.approved_at.slice(0, 10)} by {names(plan.approved_by!)}.</p>}
      <div className="chart-actions">
        {plan.status === 'draft' && canApproveCare(session.roleKey) && <button className="button primary" disabled={busy} onClick={() => void save({
          action: 'approve',
          id: plan.id
        })}>Approve and activate</button>}
        {manage && <button className="button" disabled={busy} onClick={() => void save({
          action: 'retire',
          id: plan.id
        })}>Retire {plan.status} plan</button>}
        {plan.status === 'active' && canAcknowledgeCare(session.roleKey) && !data.acknowledgements.some(a => a.plan_id === plan.id && a.user_id === session.userId) && <button className="button" disabled={busy} onClick={() => void save({
          action: 'acknowledge',
          id: plan.id
        })}>I have read and acknowledge this active plan</button>}
      </div>
      <details><summary>Staff acknowledgements ({data.acknowledgements.filter(a => a.plan_id === plan.id).length})</summary>{data.acknowledgements.filter(a => a.plan_id === plan.id).map(a => <p key={a.user_id}>{names(a.user_id)} — {a.acknowledged_at}</p>)}</details>
    </article>)}
    {session.roleKey !== 'dsp' && <details><summary>Care plan history</summary>{data.plans.filter(p => ['retired', 'revised'].includes(p.status)).map(p => <article className="care-record" key={p.id}><h3>{p.title} — {p.status}</h3><p>Created {p.created_at}. Approved {p.approved_at ?? 'Never'}. Closed {p.retired_at}.</p>{p.items.map((i, n) => <p key={n}>{i.need}. Goal: {i.goal}. Interventions: {i.interventions}. Roles: {i.roles.map(r => roleLabel(r)).join(', ')}. Review: {i.review_on}.</p>)}</article>)}</details>}
    {canViewScreening(session.roleKey) && <><h2 id="chart-screenings">Health screenings</h2>
      <p>Schedules and results for this Individual. Completing a screening keeps that occurrence; schedule the next occurrence separately.</p>
      {manage && <><ScreeningTypes data={data} save={save} busy={busy} /><button className="button" disabled={!data.types.some(t => t.enabled) || busy} onClick={() => setEditing('new')}>Schedule screening</button></>}
      {editing && <ScreeningForm key={editing === 'new' ? 'new' : editing.id} row={editing === 'new' ? null : editing} data={data} busy={busy} onCancel={() => setEditing(null)} onSave={async draft => {
        if (await save({
          action: 'screening',
          individual_id: individualId,
          id: editing === 'new' ? undefined : editing.id,
          draft
        })) setEditing(null);
      }} />}
      {!data.screenings.length && <p>No screenings scheduled.</p>}
      {data.screenings.map(s => <article className="care-record" key={s.id}><h3>{data.types.find(t => t.id === s.type_id)?.name} — {screeningStatus(s, data.types.find(t => t.id === s.type_id)!)}</h3><p>Last completed: {s.last_completed_on ?? 'Not recorded'}. Due: {s.due_on}. Completed: {s.completed_on ?? 'Not completed'}.</p><p><strong>Result:</strong> {s.result_note || 'Not recorded'}</p><p><strong>Follow-up:</strong> {s.follow_up || 'None recorded'}</p>{manage && <button className="button" disabled={busy} onClick={() => setEditing(s)}>Update screening</button>}</article>)}
    </>}
    <p>Digital record generated by Complyrer</p>
  </section>;
}
function ScreeningTypes({
  data,
  save,
  busy
}: {
  data: CareScreeningData;
  save: (input: CareAction) => Promise<boolean>;
  busy: boolean;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState(30);
  const [enabled, setEnabled] = useState(true);
  return <details><summary>Agency screening types</summary><p>Changes apply across the agency. Disabled types remain on existing records.</p><form className="stack" onSubmit={async e => {
      e.preventDefault();
      if (await save({
        action: 'type',
        id: id || undefined,
        name,
        due_soon_days: days,
        enabled
      })) {
        setName('');
        setId('');
      }
    }}>
    <label>Type to configure<select value={id} onChange={e => {
          setId(e.target.value);
          const t = data.types.find(t => t.id === e.target.value);
          setName(t?.name ?? '');
          setDays(t?.due_soon_days ?? 30);
          setEnabled(t?.enabled ?? true);
        }}><option value="">New type</option>{data.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Screening type name<input required value={name} onChange={e => setName(e.target.value)} /></label><label>Due-soon window in days<input type="number" required min="0" max="365" value={days} onChange={e => setDays(Number(e.target.value))} /></label><label className="care-role"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enabled for new schedules</label><button className="button" disabled={busy}>Save screening type</button>
  </form></details>;
}
function ScreeningForm({
  row,
  data,
  busy,
  onSave,
  onCancel
}: {
  row: Screening | null;
  data: CareScreeningData;
  busy: boolean;
  onSave: (d: ScreeningDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ScreeningDraft>(row ?? {
    type_id: data.types.find(t => t.enabled)?.id ?? '',
    last_completed_on: null,
    due_on: '',
    completed_on: null,
    result_note: '',
    follow_up: ''
  });
  return <form className="stack care-record" onSubmit={e => {
    e.preventDefault();
    void onSave(draft);
  }}><h3>{row ? 'Update screening' : 'Schedule screening'}</h3><label>Screening type<select required value={draft.type_id} onChange={e => setDraft({
        ...draft,
        type_id: e.target.value
      })}>{data.types.filter(t => t.enabled || t.id === row?.type_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {(['last_completed_on', 'due_on', 'completed_on'] as const).map(key => <label key={key}>{key === 'due_on' ? 'Due date' : key === 'completed_on' ? 'Completed date for this screening' : 'Last completed date'}<input type="date" required={key === 'due_on'} value={draft[key] ?? ''} onChange={e => setDraft({
        ...draft,
        [key]: e.target.value || null,
        ...(key === 'completed_on' && e.target.value ? {
          last_completed_on: e.target.value
        } : {})
      })} /></label>)}
    <label>Result note<textarea required={!!draft.completed_on} value={draft.result_note} onChange={e => setDraft({
        ...draft,
        result_note: e.target.value
      })} /></label><label>Follow-up<textarea value={draft.follow_up} onChange={e => setDraft({
        ...draft,
        follow_up: e.target.value
      })} /></label><div className="chart-actions"><button className="button primary" disabled={busy}>Save screening</button><button className="button" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
