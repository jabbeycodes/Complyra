-- Operating-rule notices (refusals, PRN, late recording, reminders,
-- recognition points). The notifications table is insertable by the
-- service role only. This function lets a signed-in member of the agency
-- queue one of those known types. It does not grant a general insert.

create or replace function public.queue_operating_notice(
  p_agency_id uuid,
  p_user_id uuid,
  p_role_key text,
  p_type text,
  p_title text,
  p_body text,
  p_deep_link text,
  p_entity_id text,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.has_agency(p_agency_id) then
    raise exception 'Not allowed';
  end if;
  if p_user_id is null and (p_role_key is null or length(trim(p_role_key)) = 0) then
    raise exception 'A notice needs a person or a role';
  end if;
  if p_type not in (
    'med.refusal_review',
    'med.prn_followup',
    'med.prn_frequency',
    'med.late_recording',
    'med.unrecorded',
    'med.prn_repeat',
    'documentation.missing_note',
    'accountability.warning',
    'accountability.writeup',
    'recognition.awarded'
  ) then
    raise exception 'Unsupported notice';
  end if;
  -- A member can notify themselves. Notifying someone else, or a role,
  -- requires a clinical, hub, or recognition permission they already hold.
  if p_user_id is distinct from auth.uid()
     and not private.has_permission(p_agency_id, 'clinical.view')
     and not private.has_permission(p_agency_id, 'hub.view_team')
     and not private.has_permission(p_agency_id, 'recognition.manage')
     and not private.has_permission(p_agency_id, 'recognition.review_dsp') then
    raise exception 'Not allowed';
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
      when p_type in ('accountability.warning', 'accountability.writeup', 'recognition.awarded') then 'profile'
      else 'medication'
    end,
    p_entity_id,
    nullif(p_dedupe_key, '')
  )
  on conflict (agency_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.queue_operating_notice(uuid, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.queue_operating_notice(uuid, uuid, text, text, text, text, text, text, text) to authenticated;
