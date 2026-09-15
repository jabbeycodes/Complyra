-- Complete the integrated QA dispute path and protect parent site boundaries.
create policy qa_items_parent_scope on public.qa_audit_items as restrictive
for all to authenticated
using (exists (select 1 from public.qa_audits a where a.id=audit_id and private.has_permission(a.agency_id,'audit.read') and private.can_read_site(a.agency_id,a.site_id)))
with check (exists (select 1 from public.qa_audits a where a.id=audit_id and private.can_read_site(a.agency_id,a.site_id)));
create policy qa_audits_read_permission on public.qa_audits as restrictive
for select to authenticated using (private.has_permission(agency_id,'audit.read'));

create or replace function public.raise_qa_dispute(
  p_item_id uuid,
  p_note text,
  p_photos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.qa_audit_items%rowtype;
  v_audit public.qa_audits%rowtype;
  v_now timestamptz := now();
  v_history jsonb;
begin
  select * into v_item from public.qa_audit_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'QA audit item not found.';
  end if;
  select * into v_audit from public.qa_audits where id = v_item.audit_id;
  if not private.has_permission(v_item.agency_id, 'qa.dispute') or not private.can_read_site(v_item.agency_id, v_audit.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.locked then
    raise exception 'System-verified items cannot be disputed.';
  end if;
  if v_item.status not in ('scored', 'resolved') or v_item.result is null then
    raise exception 'Only a scored item can be disputed.';
  end if;
  if coalesce(nullif(trim(p_note), ''), '') = '' then
    raise exception 'A note explaining the dispute is required.';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) < 1 then
    raise exception 'At least one photo is required as evidence.';
  end if;

  -- Flag this transaction so the qa_audit_items_guard trigger recognizes
  -- the RPC-driven write below.
  perform set_config('qa.rpc', 'raise_qa_dispute', true);

  v_history := coalesce(v_item.history, '[]'::jsonb) || jsonb_build_object(
    'at', v_now,
    'by', auth.uid(),
    'byName', (select full_name from public.profiles where id = auth.uid()),
    'action', 'dispute_raised',
    'detail', trim(p_note)
  );

  update public.qa_audit_items
  set status = 'disputed',
      dispute_note = trim(p_note),
      dispute_photos = p_photos,
      dispute_raised_by = auth.uid(),
      dispute_raised_by_name = (select full_name from public.profiles where id = auth.uid()),
      dispute_raised_at = v_now,
      dispute_resolution = null,
      history = v_history,
      updated_at = v_now
  where id = p_item_id
  returning * into v_item;

  insert into public.notifications
    (agency_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  values
    (v_item.agency_id,
     'auditor',
     'qa.dispute_raised',
     'QA finding disputed',
     'A QA finding in the ' || v_audit.year || ' Q' || v_audit.quarter ||
       ' audit was disputed with photo evidence and needs review.',
     '/qa-audits/' || v_audit.id::text,
     'qa_audit',
     v_audit.id::text,
     'qa.dispute_raised:' || v_audit.id::text || ':' || v_item.item_key || ':' ||
       to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS'))
  on conflict do nothing;

  return to_jsonb(v_item);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: resolve a QA dispute (auditor). Approving flips an incorrect No to Yes.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_qa_dispute(
  p_item_id uuid,
  p_approved boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.qa_audit_items%rowtype;
  v_now timestamptz := now();
  v_result text;
  v_history jsonb;
begin
  select * into v_item from public.qa_audit_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'QA audit item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'qa.audit') or not exists (select 1 from qa_audits a where a.id=v_item.audit_id and private.can_read_site(a.agency_id,a.site_id)) then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status <> 'disputed' then
    raise exception 'That item is not under dispute.';
  end if;
  if coalesce(nullif(trim(p_reason), ''), '') = '' then
    raise exception 'A reason is required to resolve a dispute.';
  end if;

  -- Flag this transaction so the qa_audit_items_guard trigger recognizes
  -- the RPC-driven write below.
  perform set_config('qa.rpc', 'resolve_qa_dispute', true);

  v_result := v_item.result;
  if p_approved and v_item.result = 'no' then
    v_result := 'yes';
  end if;

  v_history := coalesce(v_item.history, '[]'::jsonb) || jsonb_build_object(
    'at', v_now,
    'by', auth.uid(),
    'byName', (select full_name from public.profiles where id = auth.uid()),
    'action', case when p_approved then 'dispute_approved' else 'dispute_rejected' end,
    'detail', trim(p_reason)
  );

  update public.qa_audit_items
  set status = 'resolved',
      result = v_result,
      scored_by = auth.uid(),
      scored_by_name = (select full_name from public.profiles where id = auth.uid()),
      scored_at = v_now,
      dispute_resolution = jsonb_build_object(
        'approved', p_approved,
        'reason', trim(p_reason),
        'resolvedBy', auth.uid(),
        'resolvedByName', (select full_name from public.profiles where id = auth.uid()),
        'resolvedAt', v_now
      ),
      history = v_history,
      updated_at = v_now
  where id = p_item_id
  returning * into v_item;

  if v_item.dispute_raised_by is not null then
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    values
      (v_item.agency_id,
       v_item.dispute_raised_by,
       'qa.dispute_resolved',
       case when p_approved then 'QA dispute approved' else 'QA dispute not approved' end,
       'The auditor reviewed your dispute: ' || trim(p_reason),
       '/qa-audits/' || v_item.audit_id::text,
       'qa_audit',
       v_item.audit_id::text,
       'qa.dispute_resolved:' || v_item.audit_id::text || ':' || v_item.item_key || ':' ||
         to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS'))
    on conflict do nothing;
  end if;

  return to_jsonb(v_item);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: due/overdue reminders for active QA schedules. Idempotent per
-- schedule per day via the dedupe key; returns notifications inserted.
-- ----------------------------------------------------------------------------
create or replace function public.sweep_qa_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_today date := current_date;
  r record;
begin
  for r in
    select s.*, site.name as site_name
    from public.qa_schedules s
    join public.sites site on site.id = s.site_id
    where s.active
      and s.next_due <= v_today + 14
  loop
    if not private.has_permission(r.agency_id, 'qa.schedule') or not private.can_read_site(r.agency_id, r.site_id) then
      continue;
    end if;
    insert into public.notifications
      (agency_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    values
      (r.agency_id,
       'auditor',
       case when r.next_due < v_today then 'qa.schedule_overdue' else 'qa.schedule_due' end,
       case when r.next_due < v_today then 'QA audit overdue' else 'QA audit due soon' end,
       r.site_name || ' — quarterly QA audit ' ||
         case when r.next_due < v_today then 'was due ' else 'is due ' end || r.next_due::text || '.',
       '/qa-audits?siteId=' || r.site_id::text,
       'qa_schedule',
       r.id::text,
       'qa.schedule:' || r.id::text || ':' || v_today::text)
    on conflict do nothing;
  end loop;
  -- Recompute the true count of today's reminders for the caller's own
  -- agencies (the sweep iterates every agency, but the caller only ever
  -- sees their own).
  select count(*) into v_count
  from public.notifications n
  where n.dedupe_key like 'qa.schedule:%:' || v_today::text
    and n.created_at::date = v_today
    and private.has_permission(n.agency_id, 'qa.schedule');
  return v_count;
end;
$$;


revoke all on function public.raise_qa_dispute(uuid,text,jsonb) from public, anon;
revoke all on function public.resolve_qa_dispute(uuid,boolean,text) from public, anon;
revoke all on function public.sweep_qa_schedule_reminders() from public, anon;
grant execute on function public.raise_qa_dispute(uuid,text,jsonb) to authenticated;
grant execute on function public.resolve_qa_dispute(uuid,boolean,text) to authenticated;
grant execute on function public.sweep_qa_schedule_reminders() to authenticated;
