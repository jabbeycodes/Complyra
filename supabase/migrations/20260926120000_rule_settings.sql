-- Per-agency rule settings (Operator console · Rules).
--
-- Every business rule the agency set (note grace, MAR window, lateness
-- points, the 41-hour overtime line, reminders...) is a named setting with a
-- platform default. The Complyrer operator can change any of them per agency
-- (and per site where allowed); agency administrators can change the ones the
-- operator leaves unlocked.
--
-- - rule_definitions: the catalog (platform-owned, read-only to everyone).
-- - rule_values: append-only history. A change is a new row with an effective
--   time; the latest row in force wins. Changes are never retroactive: the
--   resolver answers "what was the value at time T".
-- - private.rule_value(agency, site, key, at) resolves site -> agency ->
--   platform default. The engine, database functions and app all use it.
-- - public.set_rule_value(...) is the only way to write, with lock, type and
--   range checks and a required reason.

begin;

create table public.rule_definitions (
  key text primary key,
  category text not null,
  label text not null,
  help text not null default '',
  value_type text not null check (value_type in ('number', 'boolean', 'enum', 'number_list')),
  unit text not null default '',
  platform_default jsonb not null,
  min_value numeric,
  max_value numeric,
  allowed_values text[] not null default '{}',
  site_adjustable boolean not null default false,
  default_lock text not null default 'operator' check (default_lock in ('operator', 'agency')),
  sort_order integer not null default 0
);

create table public.rule_values (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid,
  key text not null references public.rule_definitions (key) on delete cascade,
  -- null when this row only changes the lock.
  value jsonb,
  -- Operator-set lock for the agency; null = keep the current lock.
  lock text check (lock in ('operator', 'agency')),
  effective_from timestamptz not null default now(),
  reason text not null check (length(trim(reason)) > 0),
  set_by uuid references public.profiles (id) on delete set null,
  set_by_name text not null default '',
  set_as_operator boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade,
  constraint rule_values_value_or_lock check (value is not null or lock is not null)
);

create index rule_values_lookup_idx
  on public.rule_values (agency_id, key, site_id, effective_from desc);

alter table public.rule_definitions enable row level security;
alter table public.rule_definitions force row level security;
alter table public.rule_values enable row level security;
alter table public.rule_values force row level security;

create policy rule_definitions_select on public.rule_definitions
for select to authenticated using (true);

create policy rule_values_select on public.rule_values
for select to authenticated
using ((select private.has_agency(agency_id)) or (select private.is_platform_admin()));

revoke all on public.rule_definitions from anon, authenticated;
revoke all on public.rule_values from anon, authenticated;
grant select on public.rule_definitions to authenticated;
grant select on public.rule_values to authenticated;

-- ---------------------------------------------------------------------------
-- Resolver
-- ---------------------------------------------------------------------------

create or replace function private.rule_value(
  p_agency_id uuid, p_site_id uuid, p_key text, p_at timestamptz default now()
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.value from rule_values v
      where v.agency_id = p_agency_id and v.key = p_key and v.value is not null
        and p_site_id is not null and v.site_id = p_site_id and v.effective_from <= p_at
      order by v.effective_from desc, v.created_at desc limit 1),
    (select v.value from rule_values v
      where v.agency_id = p_agency_id and v.key = p_key and v.value is not null
        and v.site_id is null and v.effective_from <= p_at
      order by v.effective_from desc, v.created_at desc limit 1),
    (select d.platform_default from rule_definitions d where d.key = p_key)
  );
$$;

create or replace function private.rule_number(
  p_agency_id uuid, p_site_id uuid, p_key text, p_at timestamptz default now()
) returns numeric
language sql stable security definer set search_path = public as $$
  select (private.rule_value(p_agency_id, p_site_id, p_key, p_at) #>> '{}')::numeric;
$$;

create or replace function private.rule_lock(p_agency_id uuid, p_key text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.lock from rule_values v
      where v.agency_id = p_agency_id and v.key = p_key and v.lock is not null
      order by v.created_at desc limit 1),
    (select d.default_lock from rule_definitions d where d.key = p_key)
  );
$$;

revoke all on function private.rule_value(uuid, uuid, text, timestamptz) from public;
revoke all on function private.rule_number(uuid, uuid, text, timestamptz) from public;
revoke all on function private.rule_lock(uuid, text) from public;

-- Effective settings for an agency (and optionally a site), for the app.
create or replace function public.effective_rules(p_agency_id uuid, p_site_id uuid default null)
returns table (key text, value jsonb, lock text, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (private.has_agency(p_agency_id) or private.is_platform_admin()) then
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

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.set_rule_value(
  p_agency_id uuid,
  p_key text,
  p_value jsonb,
  p_reason text,
  p_site_id uuid default null,
  p_effective_from timestamptz default now(),
  p_lock text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_def rule_definitions;
  v_operator boolean := private.is_platform_admin();
  v_num numeric;
  v_item jsonb;
  v_id uuid;
  v_name text;
begin
  select * into v_def from rule_definitions where key = p_key;
  if v_def.key is null then
    raise exception 'Unknown setting.' using errcode = 'P0002';
  end if;

  if not v_operator then
    if not (private.has_agency(p_agency_id) and private.role_key_in(p_agency_id, '{administrator}')) then
      raise exception 'Only the Complyrer operator or an agency administrator can change settings.' using errcode = '42501';
    end if;
    if private.rule_lock(p_agency_id, p_key) <> 'agency' then
      raise exception 'This setting is locked by Complyrer.' using errcode = '42501';
    end if;
    if p_lock is not null then
      raise exception 'Only the Complyrer operator can lock or unlock settings.' using errcode = '42501';
    end if;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add a reason for the change.' using errcode = 'P0001';
  end if;
  if p_effective_from < now() - interval '5 minutes' then
    raise exception 'Changes can''t be backdated; they apply from now or a future time.' using errcode = 'P0001';
  end if;
  if p_site_id is not null and not v_def.site_adjustable then
    raise exception 'This setting applies to the whole agency, not one site.' using errcode = 'P0001';
  end if;
  if p_value is null and p_lock is null then
    raise exception 'Nothing to change.' using errcode = 'P0001';
  end if;

  if p_value is not null then
    case v_def.value_type
      when 'number' then
        if jsonb_typeof(p_value) <> 'number' then
          raise exception '% must be a number.', v_def.label using errcode = 'P0001';
        end if;
        v_num := (p_value #>> '{}')::numeric;
        if (v_def.min_value is not null and v_num < v_def.min_value)
           or (v_def.max_value is not null and v_num > v_def.max_value) then
          raise exception '% must be between % and %.', v_def.label,
            coalesce(v_def.min_value::text, '…'), coalesce(v_def.max_value::text, '…') using errcode = 'P0001';
        end if;
      when 'boolean' then
        if jsonb_typeof(p_value) <> 'boolean' then
          raise exception '% must be on or off.', v_def.label using errcode = 'P0001';
        end if;
      when 'enum' then
        if jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any (v_def.allowed_values)) then
          raise exception '% must be one of: %.', v_def.label, array_to_string(v_def.allowed_values, ', ') using errcode = 'P0001';
        end if;
      when 'number_list' then
        if jsonb_typeof(p_value) <> 'array' then
          raise exception '% must be a list of numbers.', v_def.label using errcode = 'P0001';
        end if;
        for v_item in select * from jsonb_array_elements(p_value) loop
          if jsonb_typeof(v_item) <> 'number'
             or (v_def.min_value is not null and (v_item #>> '{}')::numeric < v_def.min_value)
             or (v_def.max_value is not null and (v_item #>> '{}')::numeric > v_def.max_value) then
            raise exception '% must be numbers between % and %.', v_def.label,
              coalesce(v_def.min_value::text, '…'), coalesce(v_def.max_value::text, '…') using errcode = 'P0001';
          end if;
        end loop;
    end case;
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  insert into rule_values (agency_id, site_id, key, value, lock, effective_from, reason,
                           set_by, set_by_name, set_as_operator)
  values (p_agency_id, p_site_id, p_key, p_value, p_lock, greatest(p_effective_from, now()),
          trim(p_reason), auth.uid(), coalesce(v_name, ''), v_operator)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.effective_rules(uuid, uuid) from public, anon;
revoke all on function public.set_rule_value(uuid, text, jsonb, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.effective_rules(uuid, uuid) to authenticated;
grant execute on function public.set_rule_value(uuid, text, jsonb, text, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog (agreed with the platform owner, 2026-09-24/25). Mirrors
-- RULE_CATALOG in src/data/rules.ts.
-- ---------------------------------------------------------------------------

insert into public.rule_definitions
  (key, category, label, help, value_type, unit, platform_default, min_value, max_value, allowed_values, site_adjustable, default_lock, sort_order)
values
  ('documentation.note_grace_minutes', 'documentation', 'Note grace after shift end', 'Notes are due before the shift ends; this much grace before a late deduction.', 'number', 'minutes', '30', 0, 240, '{}', false, 'operator', 10),
  ('medication.window_before_minutes', 'medication', 'MAR window before the dose time', 'A dose may be given this early.', 'number', 'minutes', '60', 0, 180, '{}', false, 'operator', 10),
  ('medication.window_after_minutes', 'medication', 'MAR window after the dose time', 'A dose given within this is on time.', 'number', 'minutes', '60', 0, 180, '{}', false, 'operator', 20),
  ('medication.block_early_recording', 'medication', 'Block recording before the window', 'Recording a dose earlier than the window is blocked.', 'boolean', '', 'true', null, null, '{}', false, 'operator', 30),
  ('medication.late_recording_after_hours', 'medication', 'Late-recording deduction after', 'Hours after the window closes before recording costs a point.', 'number', 'hours', '8', 0, 48, '{}', false, 'operator', 40),
  ('medication.unrecorded_reminder_minutes', 'medication', 'Unrecorded-dose reminder interval', 'Reminders to the staff member and manager repeat this often.', 'number', 'minutes', '60', 5, 480, '{}', false, 'agency', 50),
  ('medication.refusals_before_rn', 'medication', 'Refusals in a row before RN is notified', '', 'number', 'refusals', '2', 1, 10, '{}', false, 'agency', 60),
  ('prn.followup_minutes', 'prn', 'PRN follow-up due after', 'Effectiveness follow-up is due this long after a PRN.', 'number', 'minutes', '60', 5, 480, '{}', false, 'agency', 10),
  ('prn.reminder_repeat_minutes', 'prn', 'PRN follow-up reminder interval', 'Everyone on shift is reminded this often until it is recorded.', 'number', 'minutes', '15', 5, 120, '{}', false, 'agency', 20),
  ('prn.frequency_review_count', 'prn', 'PRN uses in 7 days before RN review', '', 'number', 'uses', '3', 1, 20, '{}', false, 'agency', 30),
  ('accountability.points_per_late_item', 'accountability', 'Deduction per late item', 'Late note, late-recorded med, or late clock-in.', 'number', 'points', '1', 1, 5, '{}', false, 'operator', 10),
  ('accountability.writeup_threshold', 'accountability', 'Write-up at', 'A lateness balance of minus this many points flags a write-up.', 'number', 'points', '10', 3, 50, '{}', false, 'operator', 20),
  ('accountability.warning_levels', 'accountability', 'Warn staff at', 'Balances (as positive numbers) that trigger a warning banner.', 'number_list', 'points', '[5, 8, 9]', 1, 50, '{}', false, 'agency', 30),
  ('accountability.late_clock_in_minutes', 'accountability', 'Late clock-in after', 'Clocking in more than this late costs a point.', 'number', 'minutes', '15', 0, 120, '{}', false, 'operator', 40),
  ('accountability.reset_after_writeup', 'accountability', 'Reset balance after a write-up', 'An issued write-up resets the balance to 0 (history kept).', 'boolean', '', 'true', null, null, '{}', false, 'operator', 50),
  ('accountability.dispute_window_days', 'accountability', 'Days to dispute a deduction', '', 'number', 'days', '7', 0, 60, '{}', false, 'agency', 60),
  ('overtime.weekly_limit_hours', 'overtime', 'Weekly hours limit', 'Staff may work up to this many hours in the work week.', 'number', 'hours', '40', 1, 80, '{}', false, 'operator', 10),
  ('overtime.tolerance_hours', 'overtime', 'Overtime tolerance', 'Only flag overtime past the limit plus this much (1 hour: 30 minutes over is ignored).', 'number', 'hours', '1', 0, 8, '{}', false, 'operator', 20),
  ('overtime.approaching_hours', 'overtime', 'Approaching-overtime notice at', 'Heads-up to the staff member and managers.', 'number', 'hours', '36', 1, 80, '{}', false, 'agency', 30),
  ('overtime.week_starts_on', 'overtime', 'Work week starts on', '', 'enum', '', '"sunday"', null, null, '{sunday,monday}', false, 'operator', 40),
  ('recognition.monthly_cap_per_manager', 'recognition', 'Recognition points a manager can award per month', '', 'number', 'points', '20', 1, 500, '{}', false, 'agency', 10),
  ('expirations.order_reminder_days', 'expirations', 'Medication and physician order reminders', 'Days before an order''s stop or renewal date.', 'number_list', 'days', '[30, 14, 7]', 1, 365, '{}', false, 'agency', 10),
  ('expirations.certification_reminder_days', 'expirations', 'Certification expiry reminders', 'Days before a certification expires (staff + HR).', 'number_list', 'days', '[60, 30, 7]', 1, 365, '{}', false, 'agency', 20),
  ('onboarding.cpi_pbs_due_days', 'onboarding', 'Days to finish CPI and PBS after hire', '', 'number', 'days', '30', 1, 180, '{}', false, 'agency', 10),
  ('delegations.expire', 'delegations', 'Delegations expire', 'Off: a delegation stays active until the RN rescinds it.', 'boolean', '', 'false', null, null, '{}', false, 'operator', 10);

-- ---------------------------------------------------------------------------
-- First consumer: open shifts read the weekly limit, tolerance and week start
-- from settings instead of fixed numbers.
-- ---------------------------------------------------------------------------

create or replace function private.work_week_start(p_agency_id uuid, p_at timestamptz)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when (private.rule_value(p_agency_id, null, 'overtime.week_starts_on') #>> '{}') = 'monday'
    then date_trunc('week', p_at at time zone 'America/Chicago') at time zone 'America/Chicago'
    else (date_trunc('week', (p_at at time zone 'America/Chicago') + interval '1 day') - interval '1 day')
           at time zone 'America/Chicago'
  end;
$$;

revoke all on function private.work_week_start(uuid, timestamptz) from public;

create or replace function private.open_shift_blocker(
  p_shift public.hr_open_shifts,
  p_staff_id uuid,
  out blocker text,
  out week_hours numeric,
  out would_be_overtime boolean,
  out trained boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_week_start timestamptz;
  v_flag_line numeric;
  v_new_hours numeric;
begin
  blocker := null;
  week_hours := 0;
  would_be_overtime := false;
  trained := private.is_trained_at_site(p_shift.agency_id, p_shift.site_id, p_staff_id);

  if p_shift.audience = 'site' and not trained then
    blocker := 'Not trained at this program site yet.';
    return;
  end if;

  -- Flag line = weekly limit + tolerance (default 40 + 1 = 41 hours).
  v_flag_line := private.rule_number(p_shift.agency_id, null, 'overtime.weekly_limit_hours')
               + private.rule_number(p_shift.agency_id, null, 'overtime.tolerance_hours');

  if p_shift.kind = 'temporary' then
    if exists (
      select 1 from hr_shifts s
      where s.agency_id = p_shift.agency_id and s.staff_id = p_staff_id
        and s.status <> 'cancelled'
        and s.starts_at < p_shift.ends_at and s.ends_at > p_shift.starts_at
    ) then
      blocker := 'Already scheduled during this time.';
      return;
    end if;

    if exists (
      select 1 from hr_time_off_requests t
      where t.agency_id = p_shift.agency_id and t.staff_id = p_staff_id
        and t.status = 'approved'
        and t.starts_on <= (p_shift.ends_at at time zone 'America/Chicago')::date
        and t.ends_on >= (p_shift.starts_at at time zone 'America/Chicago')::date
    ) then
      blocker := 'Approved time off during this shift.';
      return;
    end if;

    v_week_start := private.work_week_start(p_shift.agency_id, p_shift.starts_at);
    select coalesce(sum(extract(epoch from (least(s.ends_at, v_week_start + interval '7 days')
                                            - greatest(s.starts_at, v_week_start))) / 3600.0), 0)
      into week_hours
    from hr_shifts s
    where s.agency_id = p_shift.agency_id and s.staff_id = p_staff_id
      and s.status <> 'cancelled'
      and s.starts_at < v_week_start + interval '7 days' and s.ends_at > v_week_start;
    v_new_hours := extract(epoch from (p_shift.ends_at - p_shift.starts_at)) / 3600.0;
  else
    if exists (
      select 1 from hr_staffing_patterns sp,
           jsonb_to_recordset(sp.windows) as w(start text, "end" text)
      where sp.agency_id = p_shift.agency_id and sp.staff_id = p_staff_id and sp.active
        and (sp.effective_to is null or sp.effective_to >= p_shift.effective_from)
        and sp.days && p_shift.days
        and private.windows_overlap(w.start, w."end", p_shift.window_start, p_shift.window_end)
    ) then
      blocker := 'Overlaps your current recurring schedule.';
      return;
    end if;

    select coalesce(sum(sp.weekly_hours), 0) into week_hours
    from hr_staffing_patterns sp
    where sp.agency_id = p_shift.agency_id and sp.staff_id = p_staff_id and sp.active
      and (sp.effective_to is null or sp.effective_to >= p_shift.effective_from);
    v_new_hours := p_shift.weekly_hours;
  end if;

  would_be_overtime := week_hours + v_new_hours > v_flag_line;
end;
$$;

revoke all on function private.open_shift_blocker(public.hr_open_shifts, uuid) from public;

-- Bid notification names the configured overtime line.
create or replace function public.respond_open_shift(p_open_shift_id uuid, p_response text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_row hr_open_shifts;
  v_uid uuid := auth.uid();
  v_name text;
  v_existing hr_open_shift_responses;
  v_check record;
  v_fill record;
  v_direct boolean;
begin
  if p_response not in ('pick_up', 'decline') then
    raise exception 'Choose pick up or decline.' using errcode = 'P0001';
  end if;

  select * into v_row from hr_open_shifts where id = p_open_shift_id for update;
  if v_row.id is null or not private.can_see_open_shift(v_row) then
    raise exception 'This open shift isn''t available to you.' using errcode = '42501';
  end if;
  if v_row.status <> 'open'
     or (v_row.kind = 'temporary' and v_row.starts_at <= now()) then
    raise exception 'This shift is no longer open.' using errcode = 'P0001';
  end if;

  select full_name into v_name from profiles where id = v_uid;
  select * into v_existing from hr_open_shift_responses
   where open_shift_id = v_row.id and staff_id = v_uid;
  if v_existing.response = 'picked_up' or v_existing.decision = 'approved' then
    raise exception 'You already have this shift.' using errcode = 'P0001';
  end if;

  if p_response = 'decline' then
    insert into hr_open_shift_responses (agency_id, open_shift_id, staff_id, staff_name, response)
    values (v_row.agency_id, v_row.id, v_uid, coalesce(v_name, ''), 'declined')
    on conflict (open_shift_id, staff_id)
    do update set response = 'declined', decision = null, responded_at = now();
    return 'declined';
  end if;

  select * into v_check from private.open_shift_blocker(v_row, v_uid);
  if v_check.blocker is not null then
    raise exception '%', v_check.blocker using errcode = 'P0001';
  end if;

  -- First come, first served only for temporary shifts within the 40-hour
  -- limit; anything else is a bid for a manager to approve.
  v_direct := v_row.kind = 'temporary' and v_row.pickup_mode = 'first_come'
              and not v_check.would_be_overtime;

  if not v_direct then
    insert into hr_open_shift_responses (agency_id, open_shift_id, staff_id, staff_name, response,
                                         trained_at_site, would_be_overtime, week_hours_before)
    values (v_row.agency_id, v_row.id, v_uid, coalesce(v_name, ''), 'requested',
            v_check.trained, v_check.would_be_overtime, v_check.week_hours)
    on conflict (open_shift_id, staff_id)
    do update set response = 'requested', decision = null, responded_at = now(),
                  trained_at_site = excluded.trained_at_site,
                  would_be_overtime = excluded.would_be_overtime,
                  week_hours_before = excluded.week_hours_before;
    perform private.notify_user(v_row.agency_id, v_row.posted_by, 'hr.open_shift_bid',
      coalesce(v_name, 'A staff member') || ' bid on ' || v_row.title,
      case when v_check.would_be_overtime then 'Past the weekly overtime line (' || trim(to_char(private.rule_number(v_row.agency_id, null, 'overtime.weekly_limit_hours') + private.rule_number(v_row.agency_id, null, 'overtime.tolerance_hours'), 'FM999990.##')) || ' hours): needs your approval.'
           else 'Approve or deny in Open shifts.' end, v_row.id);
    return 'requested';
  end if;

  select * into v_fill from private.fill_open_shift_slot(v_row, v_uid);
  insert into hr_open_shift_responses (agency_id, open_shift_id, staff_id, staff_name, response,
                                       shift_id, trained_at_site, would_be_overtime, week_hours_before)
  values (v_row.agency_id, v_row.id, v_uid, coalesce(v_name, ''), 'picked_up',
          v_fill.shift_id, v_check.trained, false, v_check.week_hours)
  on conflict (open_shift_id, staff_id)
  do update set response = 'picked_up', decision = null, shift_id = excluded.shift_id,
                responded_at = now(), trained_at_site = excluded.trained_at_site,
                would_be_overtime = false, week_hours_before = excluded.week_hours_before;
  perform private.notify_user(v_row.agency_id, v_row.posted_by, 'hr.open_shift_picked_up',
    coalesce(v_name, 'A staff member') || ' picked up ' || v_row.title,
    'The shift is on their schedule.', v_row.id);
  return 'picked_up';
end;
$$;


commit;
