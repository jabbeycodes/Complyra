-- Second demo Scheduled appointment. UX completed …940 (Ellis / 2026-09-22);
-- this row is a fresh visit in the live 30-day window so the H1 click path
-- still works. Does not touch …940. Local e2e keeps 2026-09-22 via seed.ts
-- under the Playwright clock of 2026-09-12.

do $$
declare
  v_agency uuid := '00000000-0000-4000-8000-000000000001';
  v_person uuid := '00000000-0000-4000-8000-000000000101';
  v_appt uuid := '00000000-0000-4000-8000-000000000941';
  v_nurse uuid;
  v_start date;
  v_preferred date := date '2026-09-29';
  v_completed date := date '2026-09-22';
  v_address text;
begin
  if to_regclass('public.appointments') is null then
    raise exception 'public.appointments is missing; apply 20260915160000 first.';
  end if;

  if not exists (
    select 1 from public.individuals
    where id = v_person and agency_id = v_agency
  ) then
    -- Fresh projects seed Individuals after migrations (seed-evergreen).
    return;
  end if;

  select id into v_nurse
  from public.profiles
  where full_name = 'Cameron Price'
  order by id
  limit 1;

  select coalesce(nullif(s.address, ''), '418 Cedar Court')
  into v_address
  from public.individuals i
  join public.sites s on s.id = i.site_id
  where i.id = v_person;

  if v_preferred between current_date and (current_date + 29) then
    v_start := v_preferred;
  else
    v_start := current_date + 10;
    -- Keep this row off the completed 2026-09-22 visit.
    if v_start = v_completed then
      v_start := current_date + 11;
    end if;
  end if;

  insert into public.appointments (
    id,
    agency_id,
    individual_id,
    starts_on,
    start_time,
    end_time,
    timezone,
    consultant,
    specialty,
    reason,
    visit_address,
    created_by,
    created_by_name,
    created_at,
    updated_by_name,
    updated_at,
    deleted_at,
    completed_at,
    visit_comments,
    consultation_file_id
  )
  values (
    v_appt,
    v_agency,
    v_person,
    v_start,
    '09:30',
    '10:15',
    'America/Chicago',
    'Dr. Priya Shah',
    'Neurology',
    'Seizure follow-up and medication review',
    coalesce(v_address, '418 Cedar Court'),
    v_nurse,
    'Cameron Price',
    '2026-09-15T19:00:00Z',
    '',
    now(),
    null,
    null,
    '',
    null
  )
  on conflict (id) do update
  set individual_id = excluded.individual_id,
      starts_on = excluded.starts_on,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      timezone = excluded.timezone,
      consultant = excluded.consultant,
      specialty = excluded.specialty,
      reason = excluded.reason,
      visit_address = excluded.visit_address,
      created_by = excluded.created_by,
      created_by_name = excluded.created_by_name,
      deleted_at = null,
      completed_at = null,
      completed_by = null,
      completed_by_name = '',
      visit_comments = '',
      consultation_file_id = null,
      updated_at = now();
end;
$$;
