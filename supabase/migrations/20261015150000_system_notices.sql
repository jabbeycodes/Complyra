-- Unattended reminder inserts. queue_operating_notice refuses a caller
-- with no signed-in user, so a closed-app job cannot use it.
-- This function is granted only to the service role.
-- Not applied to a remote project from this change.

create or replace function public.queue_system_notice(
  p_agency_id uuid,
  p_user_id uuid,
  p_role_key text,
  p_type text,
  p_title text,
  p_body text,
  p_deep_link text,
  p_entity_id text,
  p_dedupe_key text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'Not allowed';
  end if;
  if p_user_id is null and (p_role_key is null or length(trim(p_role_key)) = 0) then
    raise exception 'A notice needs a person or a role';
  end if;
  if p_type not in (
    'med.unrecorded',
    'med.prn_repeat',
    'documentation.missing_note'
  ) then
    raise exception 'Unsupported notice';
  end if;
  insert into public.notifications (
    agency_id, user_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key
  ) values (
    p_agency_id,
    p_user_id,
    nullif(trim(p_role_key), ''),
    p_type,
    p_title,
    p_body,
    p_deep_link,
    case
      when p_type = 'documentation.missing_note' then 'shift_note'
      else 'medication'
    end,
    p_entity_id,
    nullif(p_dedupe_key, '')
  )
  on conflict (agency_id, dedupe_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.queue_system_notice(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.queue_system_notice(uuid, uuid, text, text, text, text, text, text, text) to service_role;

-- The closed-app job reads the same saved settings a signed-in member reads.
-- The service role already bypasses row security on rule_values. This only
-- lets that job use the existing resolver. Signed-in checks are unchanged.
create or replace function public.effective_rules(p_agency_id uuid, p_site_id uuid default null)
returns table (key text, value jsonb, lock text, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (
    private.has_agency(p_agency_id)
    or private.is_platform_admin()
    or coalesce(auth.role(), '') = 'service_role'
  ) then
    raise exception 'You can only read settings for your own agency.' using errcode = '42501';
  end if;
  return query
  select d.key,
         private.rule_value(p_agency_id, p_site_id, d.key),
         private.rule_lock(p_agency_id, d.key),
         case
           when p_site_id is not null and exists (
             select 1 from rule_values v where v.agency_id = p_agency_id and v.key = d.key
               and v.site_id = p_site_id and v.value is not null and v.effective_from <= now())
             then 'site'
           when exists (
             select 1 from rule_values v where v.agency_id = p_agency_id and v.key = d.key
               and v.site_id is null and v.value is not null and v.effective_from <= now())
             then 'agency'
           else 'default'
         end
  from rule_definitions d
  order by d.category, d.sort_order, d.key;
end;
$$;

grant execute on function public.effective_rules(uuid, uuid) to service_role;
