-- Open shifts: coverage postings that staff pick up, bid on, or decline.
--
-- Agency rules (2026-09-25):
-- - HMs/PMs post availability for their program site, any time in the
--   future, as TEMPORARY (one dated shift) or PERMANENT (a recurring weekly
--   slot). Staff trained at that site see it and bid, pick up, or decline.
-- - HR posts PERMANENT openings visible to ALL staff in the agency; anyone
--   eligible can apply.
-- - Staff may work up to 40 hours a week (Sunday–Saturday). Overtime is only
--   flagged past 41 hours (an hour's tolerance, so 30 minutes over is
--   ignored). A pickup past 41 hours is never auto-assigned: it becomes a bid
--   that needs a manager's approval.
--
-- Modeled on OpenShifts in scheduling apps (When I Work, Deputy): eligible
-- staff are notified, pickups are first-come or need manager approval
-- ("shift bidding"), and eligibility excludes conflicts and time off. Care-
-- agency additions:
-- - "Trained at this site" = a signed in-home training checklist (staff and
--   HM signatures) for an Individual who lives at that site.
-- - Overtime is checked against the agency's weekly threshold
--   (hr_overtime_rules, default 40). Over-threshold pickups become requests.
-- - Permanent postings are always bids; an approved bid becomes the staff
--   member's recurring pattern (hr_staffing_patterns).
-- - Every response is kept (picked up, requested, declined), so the HM sees
--   who answered and who hasn't.
-- - Pickups run in one locked transaction, so two staff can never take the
--   same last slot.
--
-- The agency work week runs Sunday through Saturday, in America/Chicago
-- (Missouri agencies; same time zone convention as 20260914020000).

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.is_trained_at_site(p_agency_id uuid, p_site_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from training_checklists tc
    join individuals i on i.id = tc.individual_id and i.agency_id = tc.agency_id
    where tc.agency_id = p_agency_id and tc.staff_user_id = p_user_id
      and i.site_id = p_site_id
      and tc.staff_signed_at is not null and tc.hm_signed_at is not null
  );
$$;

create or replace function private.can_manage_site_schedule(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_permission(p_agency_id, 'hub.manage_schedule')
    and private.can_read_site(p_agency_id, p_site_id);
$$;

revoke all on function private.is_trained_at_site(uuid, uuid, uuid) from public;
revoke all on function private.can_manage_site_schedule(uuid, uuid) from public;
grant execute on function private.is_trained_at_site(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_manage_site_schedule(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.hr_open_shifts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  kind text not null default 'temporary' check (kind in ('temporary', 'permanent')),
  -- 'site': staff trained at the site (HM/PM postings). 'agency': all staff (HR).
  audience text not null default 'site' check (audience in ('site', 'agency')),
  title text not null,
  -- Temporary: one dated shift.
  starts_at timestamptz,
  ends_at timestamptz,
  -- Permanent: weekdays (0 = Sunday) + one daily window, from a start date.
  days smallint[] not null default '{}',
  window_start text,
  window_end text,
  effective_from date,
  weekly_hours numeric not null default 0,
  notes text not null default '',
  slots integer not null default 1 check (slots between 1 and 10),
  filled_count integer not null default 0 check (filled_count >= 0),
  pickup_mode text not null default 'approval'
    check (pickup_mode in ('first_come', 'approval')),
  status text not null default 'open'
    check (status in ('open', 'filled', 'cancelled')),
  posted_by uuid not null references public.profiles (id),
  posted_by_name text not null default '',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade,
  constraint hr_open_shifts_fill_limit check (filled_count <= slots),
  constraint hr_open_shifts_shape check (
    (kind = 'temporary' and starts_at is not null and ends_at is not null
       and ends_at > starts_at and ends_at - starts_at <= interval '24 hours'
       and audience = 'site')
    or
    (kind = 'permanent' and cardinality(days) between 1 and 7
       and window_start ~ '^[0-2][0-9]:[0-5][0-9]$' and window_end ~ '^[0-2][0-9]:[0-5][0-9]$'
       and effective_from is not null and pickup_mode = 'approval')
  )
);

create table public.hr_open_shift_responses (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  open_shift_id uuid not null,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  staff_name text not null default '',
  response text not null check (response in ('picked_up', 'requested', 'declined')),
  decision text check (decision in ('approved', 'denied')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  shift_id uuid,
  pattern_id uuid references public.hr_staffing_patterns (id) on delete set null,
  trained_at_site boolean not null default false,
  would_be_overtime boolean not null default false,
  week_hours_before numeric not null default 0,
  responded_at timestamptz not null default now(),
  unique (open_shift_id, staff_id),
  foreign key (open_shift_id, agency_id)
    references public.hr_open_shifts (id, agency_id) on delete cascade,
  foreign key (shift_id, agency_id)
    references public.hr_shifts (id, agency_id) on delete set null
);

create index hr_open_shifts_site_start_idx on public.hr_open_shifts (agency_id, site_id, starts_at);
create index hr_open_shift_responses_shift_idx on public.hr_open_shift_responses (open_shift_id);
create index hr_open_shift_responses_staff_idx on public.hr_open_shift_responses (agency_id, staff_id);

alter table public.hr_open_shifts enable row level security;
alter table public.hr_open_shifts force row level security;
alter table public.hr_open_shift_responses enable row level security;
alter table public.hr_open_shift_responses force row level security;

-- All writes go through the functions below.
revoke all on public.hr_open_shifts from anon, authenticated;
revoke all on public.hr_open_shift_responses from anon, authenticated;
grant select on public.hr_open_shifts to authenticated;
grant select on public.hr_open_shift_responses to authenticated;

-- ---------------------------------------------------------------------------
-- Eligibility (shared by pickup, bids and approval)
-- ---------------------------------------------------------------------------

-- Minutes for an "HH:MM" window; end <= start means it runs past midnight.
create or replace function private.window_minutes(p_start text, p_end text)
returns integer language sql immutable as $$
  select case
    when (split_part(p_end,':',1)::int*60 + split_part(p_end,':',2)::int)
         <= (split_part(p_start,':',1)::int*60 + split_part(p_start,':',2)::int)
    then (split_part(p_end,':',1)::int*60 + split_part(p_end,':',2)::int) + 1440
         - (split_part(p_start,':',1)::int*60 + split_part(p_start,':',2)::int)
    else (split_part(p_end,':',1)::int*60 + split_part(p_end,':',2)::int)
         - (split_part(p_start,':',1)::int*60 + split_part(p_start,':',2)::int)
  end;
$$;

-- Same-day overlap of two daily windows (overnight windows extend past 24:00).
create or replace function private.windows_overlap(a_start text, a_end text, b_start text, b_end text)
returns boolean language sql immutable as $$
  with v as (
    select (split_part(a_start,':',1)::int*60 + split_part(a_start,':',2)::int) as a0,
           (split_part(b_start,':',1)::int*60 + split_part(b_start,':',2)::int) as b0
  )
  select a0 < b0 + private.window_minutes(b_start, b_end)
     and b0 < a0 + private.window_minutes(a_start, a_end)
  from v;
$$;

-- Returns a reason the staff member can't take the posting, or null, plus
-- weekly hours already committed and whether taking it would be overtime.
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
  v_threshold numeric;
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

  select coalesce((select r.weekly_threshold_hours from hr_overtime_rules r
                   where r.agency_id = p_shift.agency_id), 40)
    into v_threshold;

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

    -- Sunday-to-Saturday week: date_trunc('week') is Monday-based, so shift
    -- by a day to land on the Sunday on or before the shift.
    v_week_start := (date_trunc('week', (p_shift.starts_at at time zone 'America/Chicago') + interval '1 day')
                     - interval '1 day') at time zone 'America/Chicago';
    select coalesce(sum(extract(epoch from (least(s.ends_at, v_week_start + interval '7 days')
                                            - greatest(s.starts_at, v_week_start))) / 3600.0), 0)
      into week_hours
    from hr_shifts s
    where s.agency_id = p_shift.agency_id and s.staff_id = p_staff_id
      and s.status <> 'cancelled'
      and s.starts_at < v_week_start + interval '7 days' and s.ends_at > v_week_start;
    v_new_hours := extract(epoch from (p_shift.ends_at - p_shift.starts_at)) / 3600.0;
  else
    -- Permanent: compare with the staff member's recurring patterns.
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

  -- Flag line is the threshold plus an hour's tolerance (41h for a 40-hour
  -- week), so running up to an hour over (e.g. 30 minutes) is ignored.
  would_be_overtime := week_hours + v_new_hours > v_threshold + 1;
end;
$$;

revoke all on function private.open_shift_blocker(public.hr_open_shifts, uuid) from public;

-- Who may post / decide: site managers for site postings; HR-type staffing
-- managers for agency-wide permanent postings.
create or replace function private.can_manage_open_shift(p_shift public.hr_open_shifts)
returns boolean language sql stable security definer set search_path = public as $$
  select private.can_manage_site_schedule(p_shift.agency_id, p_shift.site_id)
      or (p_shift.audience = 'agency'
          and private.has_permission(p_shift.agency_id, 'hub.manage_staffing')
          and private.role_key_in(p_shift.agency_id, '{hr,administrator}'));
$$;

revoke all on function private.can_manage_open_shift(public.hr_open_shifts) from public;
grant execute on function private.can_manage_open_shift(public.hr_open_shifts) to authenticated;

create or replace function private.can_see_open_shift(p_shift public.hr_open_shifts)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_shift.agency_id) and (
    private.can_manage_open_shift(p_shift)
    or (p_shift.audience = 'agency' and private.has_permission(p_shift.agency_id, 'hub.access'))
    or private.is_trained_at_site(p_shift.agency_id, p_shift.site_id, auth.uid())
  );
$$;

revoke all on function private.can_see_open_shift(public.hr_open_shifts) from public;
grant execute on function private.can_see_open_shift(public.hr_open_shifts) to authenticated;

-- Notify everyone who can bid.
create or replace function private.notify_open_shift(p_shift public.hr_open_shifts, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct p_shift.agency_id, m.user_id, 'hr.open_shift_posted', p_title, p_body,
         '/hub/open-shifts', 'hr_open_shift', p_shift.id::text,
         'open_shift:' || p_shift.id || ':' || m.user_id
  from memberships m
  where m.agency_id = p_shift.agency_id
    and (m.expires_on is null or m.expires_on >= current_date)
    and m.user_id <> p_shift.posted_by
    and (
      p_shift.audience = 'agency'
      or private.is_trained_at_site(p_shift.agency_id, p_shift.site_id, m.user_id)
    )
  on conflict (agency_id, dedupe_key) do nothing;
end;
$$;

revoke all on function private.notify_open_shift(public.hr_open_shifts, text, text) from public;

create or replace function private.notify_user(
  p_agency_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_entity_id uuid
) returns void language sql security definer set search_path = public as $$
  insert into notifications (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id)
  values (p_agency_id, p_user_id, p_type, p_title, p_body, '/hub/open-shifts', 'hr_open_shift', p_entity_id::text);
$$;

revoke all on function private.notify_user(uuid, uuid, text, text, text, uuid) from public;

-- Gives the slot to the staff member (a dated shift, or a recurring pattern)
-- and fills one slot. Caller holds the posting lock.
create or replace function private.fill_open_shift_slot(p_shift public.hr_open_shifts, p_staff_id uuid, out shift_id uuid, out pattern_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_shift.kind = 'temporary' then
    insert into hr_shifts (agency_id, site_id, staff_id, title, starts_at, ends_at, status, notes, created_by)
    values (p_shift.agency_id, p_shift.site_id, p_staff_id, p_shift.title, p_shift.starts_at,
            p_shift.ends_at, 'published', nullif(p_shift.notes, ''), p_shift.posted_by)
    returning id into shift_id;
  else
    insert into hr_staffing_patterns (agency_id, site_id, staff_id, shift_label, days, windows,
                                      weekly_hours, notes, effective_from, created_by)
    values (p_shift.agency_id, p_shift.site_id, p_staff_id, p_shift.title, p_shift.days,
            jsonb_build_array(jsonb_build_object('start', p_shift.window_start, 'end', p_shift.window_end)),
            p_shift.weekly_hours, nullif(p_shift.notes, ''), p_shift.effective_from, auth.uid())
    returning id into pattern_id;
  end if;

  update hr_open_shifts
     set filled_count = filled_count + 1,
         status = case when filled_count + 1 >= slots then 'filled' else status end,
         updated_at = now()
   where id = p_shift.id;
end;
$$;

revoke all on function private.fill_open_shift_slot(public.hr_open_shifts, uuid) from public;

-- Visible to its managers, and to staff who can bid on it.
create policy hr_open_shifts_select on public.hr_open_shifts
for select to authenticated
using ((select private.can_see_open_shift(hr_open_shifts)));

-- Staff see their own responses; managers of the posting see all of them.
create policy hr_open_shift_responses_select on public.hr_open_shift_responses
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (
    staff_id = (select auth.uid())
    or exists (
      select 1 from public.hr_open_shifts o
      where o.id = hr_open_shift_responses.open_shift_id
        and private.can_manage_open_shift(o)
    )
  )
);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.post_open_shift(
  p_site_id uuid,
  p_kind text,
  p_title text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_days smallint[] default '{}',
  p_window_start text default null,
  p_window_end text default null,
  p_effective_from date default null,
  p_notes text default '',
  p_slots integer default 1,
  p_pickup_mode text default 'approval',
  p_audience text default 'site'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_agency uuid;
  v_row hr_open_shifts;
  v_name text;
  v_when text;
begin
  select s.agency_id into v_agency from sites s where s.id = p_site_id;
  if v_agency is null then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
  if p_audience = 'agency' then
    if p_kind <> 'permanent' then
      raise exception 'Agency-wide postings are for permanent shifts.' using errcode = 'P0001';
    end if;
    if not (private.has_permission(v_agency, 'hub.manage_staffing')
            and private.role_key_in(v_agency, '{hr,administrator}')) then
      raise exception 'Only HR can post agency-wide openings.' using errcode = '42501';
    end if;
  elsif not private.can_manage_site_schedule(v_agency, p_site_id) then
    raise exception 'You can post open shifts only for sites you manage.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Give the shift a name, e.g. "Evening 2:30–10:30".' using errcode = 'P0001';
  end if;
  if p_kind = 'temporary' and (p_starts_at is null or p_starts_at <= now()) then
    raise exception 'Temporary shifts must start in the future.' using errcode = 'P0001';
  end if;
  if p_kind = 'permanent' and (p_effective_from is null or p_effective_from < current_date) then
    raise exception 'Permanent shifts need a start date today or later.' using errcode = 'P0001';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  insert into hr_open_shifts (agency_id, site_id, kind, audience, title, starts_at, ends_at, days,
                              window_start, window_end, effective_from, weekly_hours, notes, slots,
                              pickup_mode, posted_by, posted_by_name)
  values (v_agency, p_site_id, p_kind, p_audience, trim(p_title),
          case when p_kind = 'temporary' then p_starts_at end,
          case when p_kind = 'temporary' then p_ends_at end,
          case when p_kind = 'permanent' then (select array_agg(distinct d order by d) from unnest(p_days) d) else '{}' end,
          case when p_kind = 'permanent' then p_window_start end,
          case when p_kind = 'permanent' then p_window_end end,
          case when p_kind = 'permanent' then p_effective_from end,
          case when p_kind = 'permanent'
               then round(private.window_minutes(p_window_start, p_window_end) / 60.0
                          * (select count(distinct d) from unnest(p_days) d), 2)
               else 0 end,
          coalesce(p_notes, ''), p_slots,
          case when p_kind = 'permanent' then 'approval' else p_pickup_mode end,
          auth.uid(), coalesce(v_name, ''))
  returning * into v_row;

  v_when := case when v_row.kind = 'temporary' then
      to_char(v_row.starts_at at time zone 'America/Chicago', 'Dy Mon DD, HH12:MI AM') || ' – ' ||
      to_char(v_row.ends_at at time zone 'America/Chicago', 'HH12:MI AM')
    else 'Permanent · ' || v_row.window_start || '–' || v_row.window_end || ' · starts ' ||
      to_char(v_row.effective_from, 'Mon DD') end;
  perform private.notify_open_shift(
    v_row,
    case when v_row.kind = 'permanent' then 'Permanent opening: ' else 'Open shift: ' end || v_row.title,
    v_when || case when v_row.pickup_mode = 'approval' then ' · bid to apply' else ' · first come, first served' end
  );
  return v_row.id;
end;
$$;

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
      case when v_check.would_be_overtime then 'Would go past 41 hours this week: needs your approval.'
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

create or replace function public.decide_open_shift_request(p_response_id uuid, p_approve boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_resp hr_open_shift_responses;
  v_row hr_open_shifts;
  v_check record;
  v_fill record;
begin
  select * into v_resp from hr_open_shift_responses where id = p_response_id;
  if v_resp.id is null then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  select * into v_row from hr_open_shifts where id = v_resp.open_shift_id for update;
  if not private.can_manage_open_shift(v_row) then
    raise exception 'Only a manager of this posting can decide bids.' using errcode = '42501';
  end if;
  if v_resp.response <> 'requested' or v_resp.decision is not null then
    raise exception 'This bid has already been handled.' using errcode = 'P0001';
  end if;

  if not p_approve then
    update hr_open_shift_responses
       set decision = 'denied', decided_by = auth.uid(), decided_at = now()
     where id = v_resp.id;
    perform private.notify_user(v_row.agency_id, v_resp.staff_id, 'hr.open_shift_denied',
      'Not approved: ' || v_row.title, 'Your manager chose someone else for this shift.', v_row.id);
    return 'denied';
  end if;

  if v_row.status <> 'open'
     or (v_row.kind = 'temporary' and v_row.starts_at <= now()) then
    raise exception 'This shift is no longer open.' using errcode = 'P0001';
  end if;
  -- Re-check conflicts at approval time; overtime is allowed here because
  -- approving the bid IS the manager's overtime approval.
  select * into v_check from private.open_shift_blocker(v_row, v_resp.staff_id);
  if v_check.blocker is not null then
    raise exception '%', v_check.blocker using errcode = 'P0001';
  end if;

  select * into v_fill from private.fill_open_shift_slot(v_row, v_resp.staff_id);
  update hr_open_shift_responses
     set decision = 'approved', decided_by = auth.uid(), decided_at = now(),
         shift_id = v_fill.shift_id, pattern_id = v_fill.pattern_id
   where id = v_resp.id;
  perform private.notify_user(v_row.agency_id, v_resp.staff_id, 'hr.open_shift_approved',
    'Approved: ' || v_row.title,
    case when v_row.kind = 'permanent' then 'This is now part of your recurring schedule.'
         else 'The shift is on your schedule.' end, v_row.id);
  return 'approved';
end;
$$;

create or replace function public.cancel_open_shift(p_open_shift_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row hr_open_shifts;
begin
  select * into v_row from hr_open_shifts where id = p_open_shift_id for update;
  if v_row.id is null or not private.can_manage_open_shift(v_row) then
    raise exception 'Only a manager of this posting can cancel it.' using errcode = '42501';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Only open postings can be cancelled.' using errcode = 'P0001';
  end if;
  -- Slots already given out stay on staff schedules; only open slots close.
  update hr_open_shifts set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = v_row.id;
end;
$$;

revoke all on function public.post_open_shift(uuid, text, text, timestamptz, timestamptz, smallint[], text, text, date, text, integer, text, text) from public, anon;
revoke all on function public.respond_open_shift(uuid, text) from public, anon;
revoke all on function public.decide_open_shift_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_open_shift(uuid) from public, anon;
grant execute on function public.post_open_shift(uuid, text, text, timestamptz, timestamptz, smallint[], text, text, date, text, integer, text, text) to authenticated;
grant execute on function public.respond_open_shift(uuid, text) to authenticated;
grant execute on function public.decide_open_shift_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_open_shift(uuid) to authenticated;

commit;
