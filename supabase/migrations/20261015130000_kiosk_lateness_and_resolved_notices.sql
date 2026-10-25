-- A hosted kiosk has no signed-in user, so it cannot call
-- queue_operating_notice. This function records a late clock-in only when
-- the kiosk token is valid and a matching clock-in punch is already stored.
-- Filing a shift note marks that shift's missing-note notices read.

create or replace function public.note_kiosk_late_clock_in(
  p_token text,
  p_staff_id uuid,
  p_scheduled_start timestamptz,
  p_punched_at timestamptz,
  p_source_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.hr_kiosk_tokens%rowtype;
  v_minutes integer := 15;
  v_points integer := 1;
  v_source text := left(btrim(coalesce(p_source_key, '')), 200);
  v_notice_id uuid;
begin
  if v_source = '' or p_scheduled_start is null or p_punched_at is null then
    return false;
  end if;

  select * into v_token
  from public.hr_kiosk_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and active
    and revoked_at is null
  limit 1;

  if v_token.id is null then
    raise exception 'invalid kiosk token';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.user_id = p_staff_id
      and m.agency_id = v_token.agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
  ) then
    return false;
  end if;

  -- The point follows a real kiosk clock-in. A token alone cannot invent one.
  if not exists (
    select 1
    from public.hr_punches p
    where p.agency_id = v_token.agency_id
      and p.site_id = v_token.site_id
      and p.staff_id = p_staff_id
      and p.kind = 'in'
      and p.verification_method = 'kiosk_pin'
      and p.punched_at = p_punched_at
  ) then
    return false;
  end if;

  begin
    v_minutes := greatest(0, coalesce(
      private.rule_number(v_token.agency_id, v_token.site_id, 'accountability.late_clock_in_minutes'),
      15
    )::integer);
    v_points := greatest(1, coalesce(
      private.rule_number(v_token.agency_id, v_token.site_id, 'accountability.points_per_late_item'),
      1
    )::integer);
  exception
    when undefined_function or undefined_table then
      v_minutes := 15;
      v_points := 1;
  end;

  -- On time, or exactly at the saved minutes, is not late.
  if p_punched_at <= p_scheduled_start + make_interval(mins => v_minutes) then
    return false;
  end if;

  insert into public.notifications (
    agency_id, user_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key
  ) values (
    v_token.agency_id,
    p_staff_id,
    null,
    'accountability.warning',
    'Late clock-in',
    format(
      'Clocking in more than %s minutes late costs %s point.',
      v_minutes,
      v_points
    ),
    '/hub',
    'profile',
    v_source,
    v_source
  )
  on conflict (agency_id, dedupe_key) do nothing
  returning id into v_notice_id;

  if v_notice_id is null then
    return false;
  end if;

  insert into public.audit_events (agency_id, actor_id, action, target_type, target_id, detail)
  values (
    v_token.agency_id,
    p_staff_id,
    'accountability.point',
    'profile',
    p_staff_id,
    format('Late clock-in costs %s point. source=%s', v_points, v_source)
  );

  return true;
end;
$$;

comment on function public.note_kiosk_late_clock_in(text, uuid, timestamptz, timestamptz, text) is
  'Records a lateness point for a kiosk clock-in. The raw token is hashed inside the function. The point is written only when that token is active and a matching kiosk clock-in punch already exists.';

revoke all on function public.note_kiosk_late_clock_in(text, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.note_kiosk_late_clock_in(text, uuid, timestamptz, timestamptz, text) to anon, authenticated;

create or replace function public.resolve_missing_note_notices(
  p_individual_id uuid,
  p_note_date date,
  p_block text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_cleared integer;
begin
  if auth.uid() is null then
    raise exception 'Not allowed';
  end if;
  if p_block not in ('day', 'evening', 'overnight') then
    return 0;
  end if;

  select i.agency_id into v_agency
  from public.individuals i
  where i.id = p_individual_id;

  if v_agency is null or not private.has_agency(v_agency) then
    raise exception 'Not allowed';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = v_agency
      and (m.expires_on is null or m.expires_on >= current_date)
      and coalesce(m.role_key, m.role::text) in (
        'administrator', 'program_manager', 'house_manager', 'nurse', 'dsp'
      )
  ) then
    raise exception 'Not allowed';
  end if;

  update public.notifications
  set read_at = now()
  where agency_id = v_agency
    and type = 'documentation.missing_note'
    and read_at is null
    and dedupe_key like (
      'documentation.missing_note:sn:'
      || to_char(p_note_date, 'YYYY-MM-DD')
      || ':'
      || p_individual_id::text
      || ':'
      || p_block
      || ':%'
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

comment on function public.resolve_missing_note_notices(uuid, date, text) is
  'Marks missing-note notices read for one person, date, and shift after that shift note is filed.';

revoke all on function public.resolve_missing_note_notices(uuid, date, text) from public;
grant execute on function public.resolve_missing_note_notices(uuid, date, text) to authenticated;
