-- Idempotent Evergreen demo roster repair (#58 / PR #61).
-- Preview and production share ynjthbdfuzkqrbvjuvwd, so PR migrations do not
-- auto-run. This function is the hosted reset path: db push applies it once,
-- and `npm run seed:evergreen` / `npm run seed:repair-roster` can re-run it
-- via service_role whenever QA leftover rows appear.

create or replace function public.repair_evergreen_demo_roster()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := '00000000-0000-4000-8000-000000000001';
  v_cedar uuid := '00000000-0000-4000-8000-000000000011';
  v_willow uuid := '00000000-0000-4000-8000-000000000012';
  v_ellis uuid := '00000000-0000-4000-8000-000000000101';
  v_morgan uuid := '00000000-0000-4000-8000-000000000102';
  v_reese uuid := '00000000-0000-4000-8000-000000000103';
  v_harper uuid := '00000000-0000-4000-8000-000000000104';
  v_keep uuid[] := array[v_ellis, v_morgan, v_reese, v_harper];
  v_extra_people int := 0;
  v_extra_sites int := 0;
  v_child text;
  v_tbl text;
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Demo roster repair is server-side only.';
  end if;

  if not exists (
    select 1 from public.agencies
    where id = v_agency and agency_code = 'EVERGREEN-MO'
  ) then
    raise exception 'Evergreen demo agency is missing.';
  end if;

  -- Keep seed site ids. Rename Maple/Oakwood (or already-renamed rows).
  update public.sites
  set name = 'Cedar House', address = '418 Cedar Court'
  where id = v_cedar and agency_id = v_agency;

  update public.sites
  set name = 'Willow House', address = '920 Willow Lane'
  where id = v_willow and agency_id = v_agency;

  if not exists (select 1 from public.sites where id = v_cedar and agency_id = v_agency) then
    raise exception 'Cedar House seed site % is missing.', v_cedar;
  end if;
  if not exists (select 1 from public.sites where id = v_willow and agency_id = v_agency) then
    raise exception 'Willow House seed site % is missing.', v_willow;
  end if;

  -- Canonical 2×2 roster. Reese/Harper may still sit on Cedar from the
  -- old 8-person Maple roster — move them onto Willow.
  update public.individuals
  set full_name = 'Ellis Hart', site_id = v_cedar
  where id = v_ellis and agency_id = v_agency;

  update public.individuals
  set full_name = 'Morgan Pruitt', site_id = v_cedar
  where id = v_morgan and agency_id = v_agency;

  update public.individuals
  set full_name = 'Reese Lang', site_id = v_willow
  where id = v_reese and agency_id = v_agency;

  update public.individuals
  set full_name = 'Harper Soto', site_id = v_willow
  where id = v_harper and agency_id = v_agency;

  foreach v_child in array array[
    'staff_assignments',
    'requirement_definitions',
    'document_uploads',
    'individual_delegation_assignments',
    'isp_note_expectations',
    'isp_notes',
    'training_requirements'
  ]
  loop
    if to_regclass('public.' || v_child) is null then
      continue;
    end if;
    execute format(
      'update public.%I child
       set site_id = i.site_id
       from public.individuals i
       where child.individual_id = i.id
         and child.agency_id = $1
         and child.site_id is distinct from i.site_id',
      v_child
    ) using v_agency;
  end loop;

  create temporary table extra_people on commit drop as
  select id
  from public.individuals
  where agency_id = v_agency
    and id <> all (v_keep);

  select count(*) into v_extra_people from extra_people;

  if v_extra_people > 0 then
    -- Document graph (NO ACTION FKs). Order matters.
    delete from public.acknowledgment_rows
    where packet_id in (
      select p.id from public.acknowledgment_packets p
      where p.individual_id in (select id from extra_people)
    );

    delete from public.acknowledgment_packets
    where individual_id in (select id from extra_people);

    delete from public.requirement_definitions
    where individual_id in (select id from extra_people)
       or document_version_id in (
         select v.id
         from public.document_versions v
         join public.documents d on d.id = v.document_id
         where d.individual_id in (select id from extra_people)
       );

    if to_regclass('public.obligation_signatures') is not null then
      delete from public.obligation_signatures
      where obligation_id in (
        select o.id from public.obligations o
        where o.individual_id in (select id from extra_people)
      );
    end if;

    if to_regclass('public.obligations') is not null then
      delete from public.obligations
      where individual_id in (select id from extra_people);
    end if;

    if to_regclass('public.training_checklists') is not null then
      delete from public.training_checklists
      where individual_id in (select id from extra_people)
         or document_version_id in (
           select v.id
           from public.document_versions v
           join public.documents d on d.id = v.document_id
           where d.individual_id in (select id from extra_people)
         );
    end if;

    foreach v_tbl in array array['signature_events', 'signature_audit_log']
    loop
      if to_regclass('public.' || v_tbl) is null then
        continue;
      end if;
      -- Hosted signature ledgers store document_id as text, not uuid.
      execute format(
        'delete from public.%I
         where document_id::text in (
           select id::text from public.documents
           where individual_id in (select id from extra_people)
         )',
        v_tbl
      );
    end loop;

    delete from public.document_versions
    where document_id in (
      select id from public.documents
      where individual_id in (select id from extra_people)
    );

    delete from public.documents
    where individual_id in (select id from extra_people);

    delete from public.staff_assignments
    where individual_id in (select id from extra_people);

    if to_regclass('public.training_requirements') is not null then
      if to_regclass('public.training_signoffs') is not null then
        delete from public.training_signoffs
        where requirement_id in (
          select id from public.training_requirements
          where individual_id in (select id from extra_people)
        );
      end if;
      delete from public.training_requirements
      where individual_id in (select id from extra_people);
    end if;

    if to_regclass('public.phi_access_log') is not null then
      delete from public.phi_access_log
      where individual_id in (select id from extra_people);
    end if;

    if to_regclass('public.qa_audit_items') is not null then
      update public.qa_audit_items
      set individual_id = null
      where individual_id in (select id from extra_people);
    end if;

    delete from public.individuals
    where id in (select id from extra_people);
  end if;

  -- Leftover houses beyond Cedar + Willow (none on a clean seed).
  update public.memberships
  set site_id = case
    when site_id = v_willow then v_willow
    else v_cedar
  end
  where agency_id = v_agency
    and site_id is not null
    and site_id not in (v_cedar, v_willow);

  delete from public.staff_assignments
  where agency_id = v_agency
    and site_id is not null
    and site_id not in (v_cedar, v_willow);

  delete from public.requirement_definitions
  where agency_id = v_agency
    and site_id not in (v_cedar, v_willow);

  select count(*) into v_extra_sites
  from public.sites
  where agency_id = v_agency
    and id not in (v_cedar, v_willow);

  delete from public.sites
  where agency_id = v_agency
    and id not in (v_cedar, v_willow);

  -- Mileage columns follow current roster; drop leftover rider ids.
  update public.mileage_trips
  set rider_ids = coalesce((
    select array_agg(rid order by ord)
    from unnest(rider_ids) with ordinality as t(rid, ord)
    where rid = any (v_keep)
  ), '{}'::uuid[])
  where agency_id = v_agency;

  delete from public.mileage_trips
  where agency_id = v_agency
    and coalesce(cardinality(rider_ids), 0) = 0;

  -- Visible titles that still say Jodie / Maple after the id remap.
  update public.documents
  set title = replace(replace(replace(replace(replace(replace(
        title,
        'Jodie Williams', 'Ellis Hart'),
        'Brandon Miller', 'Morgan Pruitt'),
        'Sylvester Jones', 'Reese Lang'),
        'Maya Johnson', 'Harper Soto'),
        'Maple House', 'Cedar House'),
        'Oakwood House', 'Willow House')
  where agency_id = v_agency;

  update public.requirement_definitions
  set title = replace(replace(replace(replace(replace(replace(
        title,
        'Jodie Williams', 'Ellis Hart'),
        'Brandon Miller', 'Morgan Pruitt'),
        'Sylvester Jones', 'Reese Lang'),
        'Maya Johnson', 'Harper Soto'),
        'Maple House', 'Cedar House'),
        'Oakwood House', 'Willow House')
  where agency_id = v_agency;

  if to_regclass('public.qa_audit_items') is not null then
    update public.qa_audit_items
    set individual_name = case individual_id
      when v_ellis then 'Ellis Hart'
      when v_morgan then 'Morgan Pruitt'
      when v_reese then 'Reese Lang'
      when v_harper then 'Harper Soto'
      else individual_name
    end
    where agency_id = v_agency
      and individual_id = any (v_keep);
  end if;

  return jsonb_build_object(
    'agency_id', v_agency,
    'sites', (
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address) order by s.name)
      from public.sites s where s.agency_id = v_agency
    ),
    'individuals', (
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'full_name', i.full_name, 'site_id', i.site_id
      ) order by i.full_name)
      from public.individuals i where i.agency_id = v_agency
    ),
    'removed_people', v_extra_people,
    'removed_sites', v_extra_sites
  );
end;
$$;

revoke all on function public.repair_evergreen_demo_roster() from public;
revoke all on function public.repair_evergreen_demo_roster() from anon, authenticated;
grant execute on function public.repair_evergreen_demo_roster() to service_role;

-- Apply now so db push repairs the shared hosted preview, not just schema.
select public.repair_evergreen_demo_roster();
