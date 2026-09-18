-- GER workflow hardening.  Event reports contain PHI, so table access is
-- site-scoped and all writes go through narrowly-scoped RPCs.  Client-side
-- permission checks remain useful UX, but are not the security boundary.

create or replace function private.can_access_ger_site(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (
        m.site_id = p_site_id
        or (
          m.site_id is null
          and coalesce(m.role_key, m.role::text) in
            ('administrator', 'compliance_admin', 'program_manager', 'auditor')
        )
      )
      and (
        private.has_permission(p_agency_id, 'ger.create')
        or private.has_permission(p_agency_id, 'ger.review')
        or private.has_permission(p_agency_id, 'individuals.view')
      )
  );
$$;

revoke all on function private.can_access_ger_site(uuid, uuid) from public;
grant execute on function private.can_access_ger_site(uuid, uuid) to authenticated;

drop policy if exists ger_reports_select on public.ger_reports;
drop policy if exists ger_reports_insert on public.ger_reports;
drop policy if exists ger_reports_update on public.ger_reports;
drop policy if exists ger_reports_delete on public.ger_reports;

create policy ger_reports_select on public.ger_reports
for select to authenticated
using ((select private.can_access_ger_site(agency_id, site_id)));

-- Direct writes are site-scoped. A trigger below makes the workflow itself
-- tamper-resistant: no direct API request can skip review, edit an approved
-- report, forge a reviewer, or move a report to another home.
create policy ger_reports_insert on public.ger_reports
for insert to authenticated
with check (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and reviewer_id is null
  and (select private.has_permission(agency_id, 'ger.create'))
  and (select private.can_access_ger_site(agency_id, site_id))
);

create policy ger_reports_update on public.ger_reports
for update to authenticated
using (
  (select private.can_access_ger_site(agency_id, site_id))
  and (
    (created_by_user_id = auth.uid() and (select private.has_permission(agency_id, 'ger.create')))
    or (select private.has_permission(agency_id, 'ger.review'))
  )
)
with check (
  (select private.can_access_ger_site(agency_id, site_id))
  and (
    (created_by_user_id = auth.uid() and (select private.has_permission(agency_id, 'ger.create')))
    or (select private.has_permission(agency_id, 'ger.review'))
  )
);

create or replace function private.guard_ger_report_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' then
    raise exception 'Approved event reports are final.';
  end if;
  if new.agency_id is distinct from old.agency_id
    or new.site_id is distinct from old.site_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_by_name is distinct from old.created_by_name then
    raise exception 'Event report ownership and site cannot be changed.';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('draft', 'returned') and new.status = 'submitted'
      and ((old.created_by_user_id = auth.uid() and private.has_permission(old.agency_id, 'ger.create'))
        or private.has_permission(old.agency_id, 'ger.review')) then
      -- Completeness is enforced here (not only in submit_ger_report) so a
      -- direct status-only update cannot put an incomplete report on the queue.
      if new.individual_id is null or new.event_date is null
        or btrim(new.location) = '' or btrim(new.description) = ''
        or btrim(new.actions_taken) = '' or btrim(new.reported_by_name) = ''
        or btrim(new.signature_name) = '' then
        raise exception 'Complete all required fields before submitting.';
      end if;
    elsif old.status = 'submitted' and new.status in ('approved', 'returned')
      and private.has_permission(old.agency_id, 'ger.review') then
      if new.reviewer_id is distinct from auth.uid() then
        raise exception 'The reviewer must be the signed-in user.';
      end if;
    else
      raise exception 'Invalid event report workflow transition.';
    end if;
  elsif old.status = 'submitted' and not private.has_permission(old.agency_id, 'ger.review') then
    raise exception 'Only a reviewer may edit a submitted event report.';
  end if;

  if new.status = old.status and (
    new.reviewer_id is distinct from old.reviewer_id
    or new.reviewer_name is distinct from old.reviewer_name
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_note is distinct from old.review_note
  ) then
    raise exception 'Review fields may only change through a review decision.';
  end if;
  return new;
end;
$$;

drop trigger if exists ger_reports_workflow_guard on public.ger_reports;
create trigger ger_reports_workflow_guard
before update on public.ger_reports
for each row execute function private.guard_ger_report_workflow();

create or replace function public.create_ger_report(p_payload jsonb)
returns public.ger_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := (p_payload->>'agency_id')::uuid;
  v_site uuid := (p_payload->>'site_id')::uuid;
  v_individual uuid := nullif(p_payload->>'individual_id', '')::uuid;
  v_row public.ger_reports%rowtype;
begin
  if v_agency is null or v_site is null
    or not private.has_permission(v_agency, 'ger.create')
    or not private.can_access_ger_site(v_agency, v_site) then
    raise exception 'Not authorized to create an event report.';
  end if;
  if v_individual is not null and not exists (
    select 1 from public.individuals i
    where i.id = v_individual and i.agency_id = v_agency and i.site_id = v_site
  ) then raise exception 'The individual is not part of this home.'; end if;
  insert into public.ger_reports (
    agency_id, site_id, individual_id, event_date, event_time, location,
    event_type, severity, description, actions_taken, notifications_made,
    witnesses, reported_by_name, signature_name, signed_at, status,
    created_by_user_id, created_by_name
  ) values (
    v_agency, v_site, v_individual, (p_payload->>'event_date')::date,
    coalesce(p_payload->>'event_time', ''), coalesce(p_payload->>'location', ''),
    coalesce(p_payload->>'event_type', ''), coalesce(p_payload->>'severity', 'low'),
    coalesce(p_payload->>'description', ''), coalesce(p_payload->>'actions_taken', ''),
    coalesce(p_payload->'notifications_made', '[]'::jsonb),
    coalesce(p_payload->>'witnesses', ''), coalesce(p_payload->>'reported_by_name', ''),
    coalesce(p_payload->>'signature_name', ''),
    case when coalesce(p_payload->>'signature_name', '') <> '' then now() else null end,
    'draft', auth.uid(), coalesce(p_payload->>'created_by_name', '')
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_ger_report_body(p_report_id uuid, p_payload jsonb)
returns public.ger_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.ger_reports%rowtype; v_individual uuid := nullif(p_payload->>'individual_id', '')::uuid;
begin
  select * into v_row from public.ger_reports where id = p_report_id for update;
  if not found or not private.can_access_ger_site(v_row.agency_id, v_row.site_id) then raise exception 'Event report not found.'; end if;
  if v_row.status = 'approved' then raise exception 'Approved event reports are final.'; end if;
  if not ((v_row.created_by_user_id = auth.uid() and private.has_permission(v_row.agency_id, 'ger.create'))
    or private.has_permission(v_row.agency_id, 'ger.review')) then raise exception 'Not authorized to edit this event report.'; end if;
  if v_individual is not null and not exists (select 1 from public.individuals i where i.id=v_individual and i.agency_id=v_row.agency_id and i.site_id=v_row.site_id) then raise exception 'The individual is not part of this home.'; end if;
  update public.ger_reports set
    individual_id=v_individual, event_date=(p_payload->>'event_date')::date, event_time=coalesce(p_payload->>'event_time',''), location=coalesce(p_payload->>'location',''),
    event_type=coalesce(p_payload->>'event_type',''), severity=coalesce(p_payload->>'severity','low'), description=coalesce(p_payload->>'description',''),
    actions_taken=coalesce(p_payload->>'actions_taken',''), notifications_made=coalesce(p_payload->'notifications_made','[]'::jsonb), witnesses=coalesce(p_payload->>'witnesses',''),
    reported_by_name=coalesce(p_payload->>'reported_by_name',''), signature_name=coalesce(p_payload->>'signature_name',''),
    signed_at=case when coalesce(p_payload->>'signature_name','') <> '' then coalesce(v_row.signed_at, now()) else null end, updated_at=now()
  where id=p_report_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.submit_ger_report(p_report_id uuid)
returns public.ger_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.ger_reports%rowtype;
begin
  select * into v_row from public.ger_reports where id=p_report_id for update;
  if not found or not private.can_access_ger_site(v_row.agency_id, v_row.site_id) then raise exception 'Event report not found.'; end if;
  if v_row.status not in ('draft','returned') then raise exception 'Only draft or returned event reports may be submitted.'; end if;
  if not ((v_row.created_by_user_id=auth.uid() and private.has_permission(v_row.agency_id,'ger.create')) or private.has_permission(v_row.agency_id,'ger.review')) then raise exception 'Not authorized to submit this event report.'; end if;
  if v_row.individual_id is null or v_row.event_date is null or btrim(v_row.location)='' or btrim(v_row.description)='' or btrim(v_row.actions_taken)='' or btrim(v_row.reported_by_name)='' or btrim(v_row.signature_name)='' then raise exception 'Complete all required fields before submitting.'; end if;
  update public.ger_reports set status='submitted', updated_at=now() where id=p_report_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.review_ger_report(p_report_id uuid, p_decision text, p_review_note text default '')
returns public.ger_reports
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.ger_reports%rowtype;
begin
  select * into v_row from public.ger_reports where id=p_report_id for update;
  if not found or not private.can_access_ger_site(v_row.agency_id, v_row.site_id) then raise exception 'Event report not found.'; end if;
  if not private.has_permission(v_row.agency_id,'ger.review') or v_row.status <> 'submitted' then raise exception 'Not authorized to review this event report.'; end if;
  if p_decision not in ('approve','return') then raise exception 'Invalid review decision.'; end if;
  if p_decision='return' and btrim(coalesce(p_review_note,''))='' then raise exception 'Add a note explaining what needs correction.'; end if;
  update public.ger_reports set status=case when p_decision='approve' then 'approved' else 'returned' end,
    reviewer_id=auth.uid(), reviewer_name=coalesce((select full_name from public.profiles where id=auth.uid()), ''), reviewed_at=now(), review_note=coalesce(p_review_note,''), updated_at=now()
  where id=p_report_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_ger_report(jsonb) from public;
revoke all on function public.update_ger_report_body(uuid, jsonb) from public;
revoke all on function public.submit_ger_report(uuid) from public;
revoke all on function public.review_ger_report(uuid, text, text) from public;
grant execute on function public.create_ger_report(jsonb), public.update_ger_report_body(uuid, jsonb), public.submit_ger_report(uuid), public.review_ger_report(uuid, text, text) to authenticated;
