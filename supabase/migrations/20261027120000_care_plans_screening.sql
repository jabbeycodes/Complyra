-- Intentionally UNAPPLIED. Care records for Individuals already supported in homes.
begin;

create table public.individual_care_plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  individual_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  status text not null default 'draft' check (status in ('draft','active','revised','retired')),
  previous_id uuid references public.individual_care_plans(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  retired_at timestamptz,
  foreign key (individual_id, agency_id) references public.individuals(id, agency_id),
  check ((approved_by is null) = (approved_at is null)),
  check (status not in ('active','revised') or approved_at is not null)
);
create unique index care_one_active on public.individual_care_plans(individual_id) where status = 'active';
create unique index care_one_draft on public.individual_care_plans(individual_id) where status = 'draft';
create index care_agency_individual on public.individual_care_plans(agency_id,individual_id);
create table public.care_plan_acknowledgements (
  plan_id uuid not null references public.individual_care_plans(id),
  user_id uuid not null references public.profiles(id),
  acknowledged_at timestamptz not null default now(),
  primary key(plan_id,user_id)
);
create table public.health_screening_types (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null check (length(trim(name)) > 0),
  due_soon_days integer not null default 30 check (due_soon_days between 0 and 365),
  enabled boolean not null default true,
  unique(id,agency_id)
);
create unique index screening_type_name on public.health_screening_types(agency_id,lower(trim(name)));
create table public.individual_health_screenings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  individual_id uuid not null,
  type_id uuid not null,
  last_completed_on date,
  due_on date not null,
  completed_on date,
  result_note text not null default '',
  follow_up text not null default '',
  foreign key(individual_id,agency_id) references public.individuals(id,agency_id),
  foreign key(type_id,agency_id) references public.health_screening_types(id,agency_id),
  check (completed_on is null or length(trim(result_note)) > 0)
);
create index screening_due on public.individual_health_screenings(agency_id,due_on) where completed_on is null;

-- Existing source-of-truth helpers include agency membership, role permissions,
-- site restrictions, and DSP assignments. Additional roles narrow clinical data.
alter table public.individual_care_plans enable row level security;
alter table public.individual_care_plans force row level security;
alter table public.care_plan_acknowledgements enable row level security;
alter table public.care_plan_acknowledgements force row level security;
alter table public.health_screening_types enable row level security;
alter table public.health_screening_types force row level security;
alter table public.individual_health_screenings enable row level security;
alter table public.individual_health_screenings force row level security;

create policy care_read on public.individual_care_plans for select to authenticated using (
  private.can_read_individual(agency_id,individual_id) and (
    private.role_key_in(agency_id,array['nurse','program_manager','house_manager','auditor','administrator','compliance_admin'])
    or (status='active' and private.role_key_in(agency_id,array['dsp']))
  )
);
create policy care_ack_read on public.care_plan_acknowledgements for select to authenticated using (
  exists(select 1 from public.individual_care_plans p where p.id=plan_id)
);
create policy screening_types_read on public.health_screening_types for select to authenticated using (
  private.has_agency(agency_id) and private.role_key_in(agency_id,array['nurse','program_manager','house_manager','auditor','administrator','compliance_admin'])
);
create policy screening_read on public.individual_health_screenings for select to authenticated using (
  private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,array['nurse','program_manager','house_manager','auditor','administrator','compliance_admin'])
);
-- No direct write policies: validated, atomic RPCs own all lifecycle changes.
revoke insert,update,delete on public.individual_care_plans,public.care_plan_acknowledgements,public.health_screening_types,public.individual_health_screenings from authenticated,anon;
grant select on public.individual_care_plans,public.care_plan_acknowledgements,public.health_screening_types,public.individual_health_screenings to authenticated;

create function public.get_care_screening_data(p_agency_id uuid,p_individual_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
  if not private.has_agency(p_agency_id) then raise exception 'Not allowed'; end if;
  if p_individual_id is not null and not private.can_read_individual(p_agency_id,p_individual_id) then raise exception 'Individual outside your access'; end if;
  select jsonb_build_object(
    'plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from individual_care_plans p where p.agency_id=p_agency_id and (p_individual_id is null or p.individual_id=p_individual_id)),'[]'::jsonb),
    'acknowledgements',coalesce((select jsonb_agg(to_jsonb(a)) from care_plan_acknowledgements a join individual_care_plans p on p.id=a.plan_id where p.agency_id=p_agency_id and (p_individual_id is null or p.individual_id=p_individual_id)),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from health_screening_types t where t.agency_id=p_agency_id),'[]'::jsonb),
    'screenings',coalesce((select jsonb_agg(to_jsonb(s) order by s.due_on) from individual_health_screenings s where s.agency_id=p_agency_id and (p_individual_id is null or s.individual_id=p_individual_id)),'[]'::jsonb)
  ) into result;
  return result;
end; $$;

create function public.mutate_care_screening(p_agency_id uuid,p_input jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  action text := p_input->>'action';
  person_id uuid;
  row_id uuid := nullif(p_input->>'id','')::uuid;
  prev_id uuid := nullif(p_input->>'previous_id','')::uuid;
  active_id uuid;
  plan individual_care_plans%rowtype;
  draft jsonb := p_input->'draft';
  item jsonb;
  date_value text;
  old_screen individual_health_screenings%rowtype;
  nurse boolean;
  approver boolean;
begin
  if not private.has_agency(p_agency_id) then raise exception 'Not allowed'; end if;
  nurse := private.role_key_in(p_agency_id,array['nurse']);
  approver := private.role_key_in(p_agency_id,array['nurse','program_manager']);
  if action='type' then
    if not nurse then raise exception 'Only nurses manage screening types'; end if;
    if coalesce(length(trim(p_input->>'name')),0)=0 or (p_input->>'due_soon_days')::integer not between 0 and 365 or p_input->>'due_soon_days' is null then raise exception 'Invalid screening type'; end if;
    if row_id is null then
      insert into health_screening_types(agency_id,name,due_soon_days,enabled) values(p_agency_id,trim(p_input->>'name'),(p_input->>'due_soon_days')::integer,coalesce((p_input->>'enabled')::boolean,true));
    else
      update health_screening_types set name=trim(p_input->>'name'),due_soon_days=(p_input->>'due_soon_days')::integer,enabled=(p_input->>'enabled')::boolean where id=row_id and agency_id=p_agency_id;
      if not found then raise exception 'Screening type not found'; end if;
    end if;
    return;
  end if;
  if action in ('draft','screening') then
    person_id := (p_input->>'individual_id')::uuid;
  else
    select * into plan from individual_care_plans where id=row_id and agency_id=p_agency_id;
    if not found then raise exception 'Care plan not found'; end if;
    person_id := plan.individual_id;
  end if;
  if not coalesce(private.can_read_individual(p_agency_id,person_id),false) then raise exception 'Individual outside your access'; end if;
  -- Lock the Individual first for every plan action, serializing revisions,
  -- approvals and acknowledgements, including concurrent first-plan creation.
  perform 1 from individuals where id=person_id and agency_id=p_agency_id for update;
  if row_id is not null and action not in ('screening','draft') then
    select * into plan from individual_care_plans where id=row_id and agency_id=p_agency_id for update;
  end if;
  if action='draft' then
    if not nurse then raise exception 'Only nurses draft care plans'; end if;
    if coalesce(length(trim(draft->>'title')),0)=0 or jsonb_typeof(draft->'items') is distinct from 'array' then raise exception 'Add a title and care items'; end if;
    if jsonb_array_length(draft->'items')=0 then raise exception 'Add at least one care item'; end if;
    for item in select value from jsonb_array_elements(draft->'items') loop
      if coalesce(length(trim(item->>'need')),0)=0 or coalesce(length(trim(item->>'goal')),0)=0 or coalesce(length(trim(item->>'interventions')),0)=0 or (item->>'review_on') is null then raise exception 'Incomplete care item'; end if;
      if (item->>'review_on') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid review date'; end if;
      perform (item->>'review_on')::date;
      if jsonb_typeof(item->'roles') is distinct from 'array' then raise exception 'Choose responsible roles'; end if;
      if jsonb_array_length(item->'roles')=0 or exists(select 1 from jsonb_array_elements_text(item->'roles') r where r is null or r not in ('nurse','program_manager','house_manager','dsp')) then raise exception 'Invalid responsible roles'; end if;
    end loop;
    select id into active_id from individual_care_plans where individual_id=person_id and status='active';
    if active_id is distinct from prev_id then raise exception 'Revise the current active plan'; end if;
    insert into individual_care_plans(agency_id,individual_id,title,items,previous_id,created_by) values(p_agency_id,person_id,trim(draft->>'title'),draft->'items',prev_id,auth.uid());
  elsif action='approve' then
    if not approver or plan.status<>'draft' then raise exception 'Only nurses or Program Managers approve drafts'; end if;
    select id into active_id from individual_care_plans where individual_id=person_id and status='active';
    if active_id is distinct from plan.previous_id then raise exception 'The active plan changed; create a new revision'; end if;
    update individual_care_plans set status='revised',retired_at=now() where id=active_id;
    update individual_care_plans set status='active',approved_by=auth.uid(),approved_at=now() where id=row_id;
  elsif action='retire' then
    if not nurse or plan.status not in ('active','draft') then raise exception 'Only nurses retire current plans'; end if;
    update individual_care_plans set status='retired',retired_at=now() where id=row_id;
  elsif action='acknowledge' then
    if plan.status<>'active' or not private.role_key_in(p_agency_id,array['nurse','program_manager','house_manager','dsp']) then raise exception 'Only supporting staff acknowledge active plans'; end if;
    insert into care_plan_acknowledgements(plan_id,user_id) values(row_id,auth.uid()) on conflict do nothing;
  elsif action='screening' then
    if not nurse then raise exception 'Only nurses manage screenings'; end if;
    if row_id is not null then
      select * into old_screen from individual_health_screenings where id=row_id and agency_id=p_agency_id and individual_id=person_id for update;
      if not found then raise exception 'Screening not found'; end if;
    end if;
    if not exists(select 1 from health_screening_types t where t.id=(draft->>'type_id')::uuid and t.agency_id=p_agency_id and (t.enabled or t.id=old_screen.type_id)) then raise exception 'Choose an enabled screening type'; end if;
    for date_value in select unnest(array[draft->>'due_on',draft->>'last_completed_on',draft->>'completed_on']) loop
      if date_value is not null and date_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use a valid calendar date'; end if;
    end loop;
    if (draft->>'last_completed_on')::date>current_date or (draft->>'completed_on')::date>current_date then raise exception 'Completion cannot be in the future'; end if;
    if row_id is null then
      insert into individual_health_screenings(agency_id,individual_id,type_id,last_completed_on,due_on,completed_on,result_note,follow_up) values(p_agency_id,person_id,(draft->>'type_id')::uuid,(draft->>'last_completed_on')::date,(draft->>'due_on')::date,(draft->>'completed_on')::date,coalesce(draft->>'result_note',''),coalesce(draft->>'follow_up',''));
    else
      update individual_health_screenings set type_id=(draft->>'type_id')::uuid,last_completed_on=(draft->>'last_completed_on')::date,due_on=(draft->>'due_on')::date,completed_on=(draft->>'completed_on')::date,result_note=coalesce(draft->>'result_note',''),follow_up=coalesce(draft->>'follow_up','') where id=row_id;
    end if;
  else raise exception 'Unknown care action'; end if;
end; $$;

-- Idempotent, targeted notices, following the existing notifications contract.
-- Authenticated callers can only sweep Individuals they may read; the existing
-- scheduled operating-reminder function uses service_role for all agencies.
create function public.sweep_care_screening(p_agency_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare queued integer;
begin
  if auth.role() is distinct from 'service_role' and not private.has_agency(p_agency_id) then raise exception 'Not allowed'; end if;
  with deadlines as (
    select p.id,p.individual_id,'care.review_overdue'::text as type,'Care plan review overdue'::text as title,min((j->>'review_on')::date) as due_on
    from individual_care_plans p cross join lateral jsonb_array_elements(p.items) j
    where p.agency_id=p_agency_id and p.status='active'
    group by p.id,p.individual_id having min((j->>'review_on')::date)<current_date
    union all
    select s.id,s.individual_id,case when s.due_on<current_date then 'screening.overdue' else 'screening.due_soon' end,
      'Health screening: '||t.name,s.due_on
    from individual_health_screenings s join health_screening_types t on t.id=s.type_id
    where s.agency_id=p_agency_id and s.completed_on is null and s.due_on<=current_date+t.due_soon_days
  )
  insert into notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
  select p_agency_id,m.user_id,d.type,d.title,i.full_name||': due '||d.due_on::text,
    '/plans/'||i.id::text||'#chart-care-plans','individual',i.id::text,d.type||':'||d.id::text||':'||d.due_on::text||':'||m.user_id::text
  from deadlines d join individuals i on i.id=d.individual_id and i.agency_id=p_agency_id
  join memberships m on m.agency_id=p_agency_id
    and (m.expires_on is null or m.expires_on>=current_date)
    and ((m.role_key in ('nurse','house_manager') and m.site_id=i.site_id)
      or (m.role_key='program_manager' and d.type<>'care.review_overdue'))
  join profiles recipient on recipient.id=m.user_id and recipient.active and not recipient.must_change_password
  join agencies agency on agency.id=m.agency_id and agency.active and agency.status='active'
  where (auth.role()='service_role' or private.can_read_individual(p_agency_id,i.id))
    and (auth.role()='service_role' or private.has_agency(p_agency_id))
  on conflict(agency_id,dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end; $$;

revoke all on function public.get_care_screening_data(uuid,uuid),public.mutate_care_screening(uuid,jsonb),public.sweep_care_screening(uuid) from public;
grant execute on function public.get_care_screening_data(uuid,uuid),public.mutate_care_screening(uuid,jsonb),public.sweep_care_screening(uuid) to authenticated;
grant execute on function public.sweep_care_screening(uuid) to service_role;
commit;
