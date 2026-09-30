-- 2026-09-18: Health Track — per-individual health logging (Complyrer-original).
-- 2026-09-19: PR-review security follow-up — database-enforced authorization.
-- 2026-09-19 (pm): Joshua — "Auditors see everything actually." Auditors get
--   agency-wide READ access to health entries, revisions, the alert outbox,
--   and health photos via the new health.view permission. Read-only: the
--   write RPCs still require health.record / health.review, which auditors
--   do not hold, and alert fan-out stays HM/PM/nurse.
--
-- Tables:
--   health_track_entries           — one row per logged event (meal, fluid,
--                                    bowel, bladder, emesis, skin check,
--                                    vitals, seizure, menses, blood sugar).
--   health_track_entry_revisions   — immutable, append-only revision trail.
--   health_alert_outbox            — abnormal-finding alert delivery ledger
--                                    (pending → sent/failed, retryable).
--
-- Security model (addresses every PR-review "do not merge" finding):
--   1. Reads are role- AND site-scoped (private.health_track_read_ok):
--      holders of health.record or health.review may read rows for sites
--      they can access (agency-wide: administrator, compliance_admin,
--      program_manager; everyone else locked to their membership site).
--      Auditors hold the read-only health.view permission: agency-wide
--      read access to entries, revisions, the alert outbox, and photos —
--      but no write path. HR holds none of the three permissions and sees
--      nothing — including through direct Supabase access. The same
--      scoping guards the health-photos storage bucket.
--   2. Direct writes are DENIED: no insert/update/delete policies exist for
--      `authenticated` on any of the three tables. Every mutation goes
--      through narrowly-scoped SECURITY DEFINER RPCs that enforce the
--      permission (health.record / health.review), the site scope, field
--      ownership (recorded_by is always the caller), and allowed
--      transitions. Abnormal-finding flags are computed in the database
--      (private.health_entry_detect_flag), so a direct client cannot forge
--      or clear them.
--   3. Destructive deletion is gone: the app voids entries (voided_at /
--      voided_by / void_reason) and every void is kept in the immutable
--      revision trail. No API role can hard-delete a row.
--   4. Alerts are persisted to health_alert_outbox BEFORE delivery is
--      attempted. Delivery failures stay visible on the entry
--      (alert_delivery = pending/ok/partial/failed + alert_delivery_error)
--      and can be retried; they are never silently swallowed.
--   5. Corrections are amendments with a required reason. An unreviewed
--      flag survives corrections — the original alert and the review
--      obligation stay visible until a reviewer clears them.
--   6. Photo retrieval is bound to the entry's agency/individual/site in
--      both the app layer and storage RLS.
--
-- UNAPPLIED to production — ships with the PR for review only.
begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.health_track_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null
    check (kind in (
      'meal', 'fluid', 'bowel', 'bladder', 'emesis',
      'skin', 'vitals', 'seizure', 'menses', 'blood_sugar'
    )),
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_by_name text not null default '',
  flag_for_nurse boolean not null default false,
  flag_reason text,
  nurse_reviewed_at timestamptz,
  nurse_reviewed_by text,
  nurse_note text,
  -- Soft-delete (void) instead of destructive deletion: actor + timestamp +
  -- reason, preserved in the immutable revision trail.
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text,
  -- Abnormal-finding alert delivery: null when no alert was needed.
  alert_delivery text
    check (alert_delivery in ('pending', 'ok', 'partial', 'failed')),
  alert_delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create index health_track_entries_individual_occurred_idx
  on public.health_track_entries (agency_id, individual_id, occurred_at);
create index health_track_entries_nurse_queue_idx
  on public.health_track_entries (agency_id, occurred_at)
  where flag_for_nurse and nurse_reviewed_at is null and voided_at is null;

-- Immutable revision trail: written only by the health_entry_* RPCs below.
create table public.health_track_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  entry_id uuid not null references public.health_track_entries (id) on delete cascade,
  revision_no integer not null,
  action text not null
    check (action in ('created', 'amended', 'reviewed', 'voided', 'alerts_retried')),
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  flag_for_nurse boolean not null default false,
  flag_reason text,
  voided_at timestamptz,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  reason text,
  created_at timestamptz not null default now(),
  unique (entry_id, revision_no)
);

create index health_track_entry_revisions_entry_idx
  on public.health_track_entry_revisions (entry_id, revision_no);

-- Alert delivery ledger: rows are written (status 'pending') before any
-- delivery is attempted, so a failed send is visible and retryable instead
-- of silently swallowed.
create table public.health_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  entry_id uuid not null references public.health_track_entries (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  target_user_id uuid references public.profiles (id) on delete set null,
  target_role_key text,
  title text not null,
  body text not null,
  deep_link text not null default '',
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (dedupe_key)
);

create index health_alert_outbox_entry_idx
  on public.health_alert_outbox (entry_id, status);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Who may read/write health rows for one site: an active agency member
-- holding health.record or health.review, at an agency-wide role
-- (administrator, compliance_admin, program_manager) or at their own
-- membership site. Used by the write RPCs; reads additionally admit
-- health.view holders (auditors) via private.health_track_read_ok.
create or replace function private.health_track_site_ok(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id)
    and (
      private.has_permission(p_agency_id, 'health.review')
      or private.has_permission(p_agency_id, 'health.record')
    )
    and (
      private.role_key_in(p_agency_id, '{administrator,compliance_admin,program_manager}')
      or exists (
        select 1 from public.memberships m
        where m.user_id = auth.uid()
          and m.agency_id = p_agency_id
          and m.site_id = p_site_id
          and (m.expires_on is null or m.expires_on >= current_date)
      )
    );
$$;

revoke all on function private.health_track_site_ok(uuid, uuid) from public;
grant execute on function private.health_track_site_ok(uuid, uuid) to authenticated;

-- Read gate: the site-scoped read above, OR a holder of the read-only
-- health.view permission (auditors) — agency-wide, no site scoping.
-- HR holds neither and stays out. Writes are unaffected: the RPCs still
-- require health.record / health.review.
create or replace function private.health_track_read_ok(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select private.health_track_site_ok(p_agency_id, p_site_id)
      or (
        private.has_agency(p_agency_id)
        and private.has_permission(p_agency_id, 'health.view')
      );
$$;

revoke all on function private.health_track_read_ok(uuid, uuid) from public;
grant execute on function private.health_track_read_ok(uuid, uuid) to authenticated;

-- Safe numeric extraction from the details jsonb (null on missing/garbage,
-- never raises — a direct client cannot crash flag detection).
create or replace function private.health_num(p_details jsonb, p_key text)
returns numeric
language sql immutable set search_path = public as $$
  select case
    when p_details ->> p_key ~ '^-?[0-9]+(\.[0-9]+)?$'
    then (p_details ->> p_key)::numeric
  end;
$$;

-- Compact number formatting for flag reasons ("101.5", "180", never "180.0").
create or replace function private.health_fmt(p_value numeric)
returns text
language sql immutable set search_path = public as $$
  select rtrim(rtrim(to_char(p_value, 'FM999999990.99'), '0'), '.');
$$;

-- Abnormal-finding detection, enforced in the database so a direct client
-- cannot forge or clear flags. Thresholds mirror
-- detectHealthAlert() in src/data/healthTrack.ts (Complyrer-original).
create or replace function private.health_entry_detect_flag(p_kind text, p_details jsonb)
returns table (flagged boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  reasons text[] := '{}';
  temp_f numeric;
  sys numeric;
  dia numeric;
  pulse numeric;
  o2 numeric;
  sugar numeric;
begin
  if p_kind = 'vitals' then
    temp_f := private.health_num(p_details, 'tempF');
    if temp_f is not null and temp_f >= 100.4 then
      reasons := reasons || format('Fever (%s°F)', private.health_fmt(temp_f));
    elsif temp_f is not null and temp_f <= 95 then
      reasons := reasons || format('Low body temperature (%s°F)', private.health_fmt(temp_f));
    end if;
    sys := private.health_num(p_details, 'bpSystolic');
    dia := private.health_num(p_details, 'bpDiastolic');
    if sys is not null and (sys >= 180 or sys <= 90) then
      reasons := reasons || format(
        'Blood pressure out of range (%s/%s)',
        private.health_fmt(sys), coalesce(private.health_fmt(dia), '?'));
    elsif dia is not null and dia >= 110 then
      reasons := reasons || format(
        'Blood pressure out of range (%s/%s)',
        coalesce(private.health_fmt(sys), '?'), private.health_fmt(dia));
    end if;
    pulse := private.health_num(p_details, 'pulse');
    if pulse is not null and (pulse >= 120 or pulse <= 50) then
      reasons := reasons || format('Pulse out of range (%s)', private.health_fmt(pulse));
    end if;
    o2 := private.health_num(p_details, 'o2Sat');
    if o2 is not null and o2 < 92 then
      reasons := reasons || format('Low oxygen saturation (%s%%)', private.health_fmt(o2));
    end if;
  elsif p_kind = 'bowel' then
    if coalesce(p_details ->> 'blood', 'false') = 'true' then
      reasons := reasons || 'Blood seen in stool';
    end if;
  elsif p_kind = 'skin' then
    if p_details ->> 'observation' = 'open_area' then
      reasons := reasons || 'Open skin area / breakdown';
    end if;
    if coalesce(p_details ->> 'worsening', 'false') = 'true' then
      reasons := reasons || 'Skin issue is new or getting worse';
    end if;
  elsif p_kind = 'seizure' then
    reasons := reasons || 'Seizure recorded';
  elsif p_kind = 'meal' then
    if p_details ->> 'portion' = 'refused' then
      reasons := reasons || 'Meal refused';
    end if;
  elsif p_kind = 'blood_sugar' then
    sugar := private.health_num(p_details, 'readingMgDl');
    if sugar is not null and sugar < 70 then
      reasons := reasons || format('Low blood sugar (%s mg/dL)', private.health_fmt(sugar));
    elsif sugar is not null and sugar > 300 then
      reasons := reasons || format('High blood sugar (%s mg/dL)', private.health_fmt(sugar));
    end if;
  end if;
  flagged := cardinality(reasons) > 0;
  reason := nullif(array_to_string(reasons, '; '), '');
  return next;
end;
$$;

revoke all on function private.health_entry_detect_flag(text, jsonb) from public;
grant execute on function private.health_entry_detect_flag(text, jsonb) to authenticated;

-- Next revision number for an entry (called inside the write RPCs).
create or replace function private.health_next_revision_no(p_entry_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(max(revision_no), 0) + 1
  from public.health_track_entry_revisions
  where entry_id = p_entry_id;
$$;

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.health_track_entries enable row level security;
alter table public.health_track_entries force row level security;
alter table public.health_track_entry_revisions enable row level security;
alter table public.health_track_entry_revisions force row level security;
alter table public.health_alert_outbox enable row level security;
alter table public.health_alert_outbox force row level security;

-- Read: role- and site-scoped; voided rows are hidden from reads (their
-- history remains visible through the revision trail).
create policy health_track_entries_select on public.health_track_entries
for select to authenticated
using (
  voided_at is null
  and (select private.health_track_read_ok(agency_id, site_id))
);

-- No insert / update / delete policies for `authenticated`: direct writes
-- are denied and every mutation must go through the health_entry_* RPCs.
-- (Deliberately no DELETE policy at all — no API role can hard-delete.)

create policy health_track_entry_revisions_select on public.health_track_entry_revisions
for select to authenticated
using (
  exists (
    select 1 from public.health_track_entries e
    where e.id = health_track_entry_revisions.entry_id
      and (select private.health_track_read_ok(e.agency_id, e.site_id))
  )
);
-- No write policies: revisions are append-only, written by the RPCs.

create policy health_alert_outbox_select on public.health_alert_outbox
for select to authenticated
using ((select private.health_track_read_ok(agency_id, site_id)));
-- No write policies: the outbox is written by the RPCs.

-- ----------------------------------------------------------------------------
-- Write RPCs — the only hosted write path for health records
-- ----------------------------------------------------------------------------

-- Create an entry: permission + site checks, caller becomes recorded_by,
-- flags computed in the database, revision #1, and alert outbox rows
-- (status 'pending') written in the same transaction as the entry.
create or replace function public.health_entry_create(
  p_id uuid,
  p_individual_id uuid,
  p_kind text,
  p_occurred_at timestamptz,
  p_details jsonb,
  p_alerts jsonb
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_person record;
  v_flag record;
  v_entry public.health_track_entries;
  v_alert jsonb;
begin
  if p_kind not in (
    'meal', 'fluid', 'bowel', 'bladder', 'emesis',
    'skin', 'vitals', 'seizure', 'menses', 'blood_sugar'
  ) then
    raise exception 'Unknown health entry kind.';
  end if;
  if p_occurred_at is null then
    raise exception 'occurred_at is required.';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'details must be an object.';
  end if;
  select i.id, i.agency_id, i.site_id into v_person
  from public.individuals i
  where i.id = p_individual_id;
  if not found then
    raise exception 'Individual not found.';
  end if;
  if not private.has_permission(v_person.agency_id, 'health.record') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_person.agency_id, v_person.site_id) then
    raise exception 'You cannot log health entries at this site.';
  end if;

  select * into v_flag from private.health_entry_detect_flag(p_kind, p_details);

  insert into public.health_track_entries (
    id, agency_id, individual_id, site_id, kind, occurred_at, details,
    recorded_by, recorded_by_name, flag_for_nurse, flag_reason, alert_delivery
  ) values (
    p_id, v_person.agency_id, p_individual_id, v_person.site_id,
    p_kind, p_occurred_at, p_details,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    v_flag.flagged, v_flag.reason,
    case when v_flag.flagged then 'pending'::text else null end
  )
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, actor_user_id, actor_name
  ) values (
    v_entry.agency_id, v_entry.id, 1, 'created', v_entry.occurred_at,
    v_entry.details, v_entry.flag_for_nurse, v_entry.flag_reason,
    auth.uid(), v_entry.recorded_by_name
  );

  if v_flag.flagged and p_alerts is not null then
    for v_alert in select * from jsonb_array_elements(p_alerts)
    loop
      insert into public.health_alert_outbox (
        agency_id, entry_id, site_id, target_user_id, target_role_key,
        title, body, deep_link, dedupe_key
      ) values (
        v_entry.agency_id, v_entry.id, v_entry.site_id,
        nullif(v_alert ->> 'target_user_id', '')::uuid,
        nullif(v_alert ->> 'target_role_key', ''),
        v_alert ->> 'title', v_alert ->> 'body',
        coalesce(v_alert ->> 'deep_link', ''),
        v_alert ->> 'dedupe_key'
      )
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;

  return v_entry;
end;
$$;

revoke all on function public.health_entry_create(uuid, uuid, text, timestamptz, jsonb, jsonb) from public;
grant execute on function public.health_entry_create(uuid, uuid, text, timestamptz, jsonb, jsonb) to authenticated;

-- Queue additional alert targets for an entry (e.g. the day-level
-- very-low-intake alert). Idempotent on dedupe_key.
create or replace function public.health_alerts_queue(
  p_entry_id uuid,
  p_alerts jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
  v_alert jsonb;
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not private.has_permission(v_entry.agency_id, 'health.record') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;
  for v_alert in select * from jsonb_array_elements(coalesce(p_alerts, '[]'::jsonb))
  loop
    insert into public.health_alert_outbox (
      agency_id, entry_id, site_id, target_user_id, target_role_key,
      title, body, deep_link, dedupe_key
    ) values (
      v_entry.agency_id, v_entry.id, v_entry.site_id,
      nullif(v_alert ->> 'target_user_id', '')::uuid,
      nullif(v_alert ->> 'target_role_key', ''),
      v_alert ->> 'title', v_alert ->> 'body',
      coalesce(v_alert ->> 'deep_link', ''),
      v_alert ->> 'dedupe_key'
    )
    on conflict (dedupe_key) do nothing;
  end loop;
  update public.health_track_entries
  set alert_delivery = 'pending', updated_at = now()
  where id = p_entry_id and alert_delivery is null;
end;
$$;

revoke all on function public.health_alerts_queue(uuid, jsonb) from public;
grant execute on function public.health_alerts_queue(uuid, jsonb) to authenticated;

-- Record per-target delivery outcomes after the app attempts the sends.
-- Aggregates to the entry's alert_delivery (ok / partial / failed) and
-- keeps a retry revision, so failures stay visible instead of swallowed.
create or replace function public.health_alerts_mark(
  p_entry_id uuid,
  p_results jsonb
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
  v_r jsonb;
  v_ok boolean;
  v_sent integer := 0;
  v_failed integer := 0;
  v_first_error text;
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not (
    private.has_permission(v_entry.agency_id, 'health.record')
    or private.has_permission(v_entry.agency_id, 'health.review')
  ) then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;

  for v_r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    v_ok := coalesce((v_r ->> 'ok')::boolean, false);
    update public.health_alert_outbox
    set status = case when v_ok then 'sent' else 'failed' end,
        attempts = attempts + 1,
        last_error = nullif(v_r ->> 'error', ''),
        sent_at = case when v_ok then now() else sent_at end
    where entry_id = p_entry_id
      and dedupe_key = v_r ->> 'dedupe_key';
  end loop;

  select
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed')
  into v_sent, v_failed
  from public.health_alert_outbox
  where entry_id = p_entry_id;

  select last_error into v_first_error
  from public.health_alert_outbox
  where entry_id = p_entry_id and status = 'failed'
  order by created_at
  limit 1;

  update public.health_track_entries
  set alert_delivery = case
      when v_failed = 0 and v_sent > 0 then 'ok'
      when v_failed > 0 and v_sent > 0 then 'partial'
      when v_failed > 0 then 'failed'
      else 'pending'
    end,
    alert_delivery_error = v_first_error,
    updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, actor_user_id, actor_name, reason
  ) values (
    v_entry.agency_id, v_entry.id,
    private.health_next_revision_no(v_entry.id),
    'alerts_retried', v_entry.occurred_at, v_entry.details,
    v_entry.flag_for_nurse, v_entry.flag_reason,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    format('Alert delivery: %s sent, %s failed', v_sent, v_failed)
  );

  return v_entry;
end;
$$;

revoke all on function public.health_alerts_mark(uuid, jsonb) from public;
grant execute on function public.health_alerts_mark(uuid, jsonb) to authenticated;

-- Amend an entry: a correction with a required reason. An unreviewed flag
-- survives the correction — the review obligation stays visible. A
-- reviewed entry that still flags goes back for review.
create or replace function public.health_entry_amend(
  p_entry_id uuid,
  p_occurred_at timestamptz,
  p_details jsonb,
  p_reason text
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
  v_flag record;
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id for update;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not private.has_permission(v_entry.agency_id, 'health.record') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Say why you are correcting this entry.';
  end if;
  if p_occurred_at is null then
    raise exception 'occurred_at is required.';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'details must be an object.';
  end if;

  select * into v_flag from private.health_entry_detect_flag(v_entry.kind, p_details);
  -- The original alert and review obligation survive corrections.
  if v_entry.flag_for_nurse and v_entry.nurse_reviewed_at is null then
    v_flag.flagged := true;
    v_flag.reason := v_entry.flag_reason;
  end if;

  update public.health_track_entries
  set occurred_at = p_occurred_at,
      details = p_details,
      flag_for_nurse = v_flag.flagged,
      flag_reason = v_flag.reason,
      nurse_reviewed_at = case
        when v_flag.flagged and nurse_reviewed_at is not null then null
        else nurse_reviewed_at end,
      nurse_reviewed_by = case
        when v_flag.flagged and nurse_reviewed_at is not null then null
        else nurse_reviewed_by end,
      nurse_note = case
        when v_flag.flagged and nurse_reviewed_at is not null then null
        else nurse_note end,
      updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, actor_user_id, actor_name, reason
  ) values (
    v_entry.agency_id, v_entry.id,
    private.health_next_revision_no(v_entry.id),
    'amended', v_entry.occurred_at, v_entry.details,
    v_entry.flag_for_nurse, v_entry.flag_reason,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    trim(p_reason)
  );

  return v_entry;
end;
$$;

revoke all on function public.health_entry_amend(uuid, timestamptz, jsonb, text) from public;
grant execute on function public.health_entry_amend(uuid, timestamptz, jsonb, text) to authenticated;

-- Void (soft-delete) an entry: actor + timestamp + reason, kept in the
-- immutable revision trail. Voided rows disappear from reads.
create or replace function public.health_entry_void(
  p_entry_id uuid,
  p_reason text
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id for update;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not (
    private.has_permission(v_entry.agency_id, 'health.record')
    or private.has_permission(v_entry.agency_id, 'health.review')
  ) then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Say why you are voiding this entry.';
  end if;

  update public.health_track_entries
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = trim(p_reason),
      updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, voided_at, actor_user_id, actor_name, reason
  ) values (
    v_entry.agency_id, v_entry.id,
    private.health_next_revision_no(v_entry.id),
    'voided', v_entry.occurred_at, v_entry.details,
    v_entry.flag_for_nurse, v_entry.flag_reason, v_entry.voided_at,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    trim(p_reason)
  );

  return v_entry;
end;
$$;

revoke all on function public.health_entry_void(uuid, text) from public;
grant execute on function public.health_entry_void(uuid, text) to authenticated;

-- Review a flagged entry: requires the health.review permission and a
-- meaningful note (an auditable review cannot be empty).
create or replace function public.health_entry_review(
  p_entry_id uuid,
  p_note text
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
  v_note text;
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id for update;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not private.has_permission(v_entry.agency_id, 'health.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;
  if not v_entry.flag_for_nurse then
    raise exception 'Only flagged entries need review.';
  end if;
  v_note := trim(coalesce(p_note, ''));
  if length(v_note) < 3 then
    raise exception 'Add a review note (a few words) so the review is auditable.';
  end if;

  update public.health_track_entries
  set nurse_reviewed_at = now(),
      nurse_reviewed_by = coalesce((select full_name from public.profiles where id = auth.uid()), ''),
      nurse_note = v_note,
      updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, actor_user_id, actor_name, reason
  ) values (
    v_entry.agency_id, v_entry.id,
    private.health_next_revision_no(v_entry.id),
    'reviewed', v_entry.occurred_at, v_entry.details,
    v_entry.flag_for_nurse, v_entry.flag_reason,
    auth.uid(), v_entry.nurse_reviewed_by, v_note
  );

  return v_entry;
end;
$$;

revoke all on function public.health_entry_review(uuid, text) from public;
grant execute on function public.health_entry_review(uuid, text) to authenticated;

-- Attach a skin-check photo to its entry after the upload. The path must
-- belong to the entry's own agency/individual folders.
create or replace function public.health_entry_attach_photo(
  p_entry_id uuid,
  p_photo_path text
)
returns public.health_track_entries
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
  v_parts text[];
begin
  select * into v_entry from public.health_track_entries where id = p_entry_id for update;
  if not found or v_entry.voided_at is not null then
    raise exception 'Health entry not found.';
  end if;
  if not private.has_permission(v_entry.agency_id, 'health.record') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.health_track_site_ok(v_entry.agency_id, v_entry.site_id) then
    raise exception 'Health entry not found.';
  end if;
  v_parts := string_to_array(p_photo_path, '/');
  if cardinality(v_parts) < 3
    or v_parts[1] <> v_entry.agency_id::text
    or v_parts[2] <> v_entry.individual_id::text then
    raise exception 'Photo does not belong to this entry.';
  end if;

  update public.health_track_entries
  set details = details || jsonb_build_object('photoId', p_photo_path),
      updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  insert into public.health_track_entry_revisions (
    agency_id, entry_id, revision_no, action, occurred_at, details,
    flag_for_nurse, flag_reason, actor_user_id, actor_name, reason
  ) values (
    v_entry.agency_id, v_entry.id,
    private.health_next_revision_no(v_entry.id),
    'amended', v_entry.occurred_at, v_entry.details,
    v_entry.flag_for_nurse, v_entry.flag_reason,
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    'Photo attached'
  );

  return v_entry;
end;
$$;

revoke all on function public.health_entry_attach_photo(uuid, text) from public;
grant execute on function public.health_entry_attach_photo(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Health photos bucket (paths: <agencyId>/<individualId>/<uuid>-<file>)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'health-photos',
  'health-photos',
  false,
  5242880,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

-- A photo is readable when its individual lives at a site the caller may
-- read health rows for (auditors: agency-wide via health.view). The uuid
-- casts are guarded so a malformed path denies instead of raising.
create or replace function private.health_photo_ok(p_agency_id uuid, p_individual_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.individuals i
    where i.id = p_individual_id
      and i.agency_id = p_agency_id
      and private.health_track_read_ok(i.agency_id, i.site_id)
  );
$$;

revoke all on function private.health_photo_ok(uuid, uuid) from public;
grant execute on function private.health_photo_ok(uuid, uuid) to authenticated;

create or replace function private.health_photo_scope(p_path text)
returns table (agency_id uuid, individual_id uuid, ok boolean)
language sql stable security definer set search_path = public as $$
  select
    (regexp_match(p_path, '^([0-9a-fA-F-]{36})/([0-9a-fA-F-]{36})/'))[1]::uuid,
    (regexp_match(p_path, '^([0-9a-fA-F-]{36})/([0-9a-fA-F-]{36})/'))[2]::uuid,
    (regexp_match(p_path, '^([0-9a-fA-F-]{36})/([0-9a-fA-F-]{36})/')) is not null;
$$;

drop policy if exists health_photos_storage_select on storage.objects;
drop policy if exists health_photos_storage_insert on storage.objects;
drop policy if exists health_photos_storage_update on storage.objects;
drop policy if exists health_photos_storage_delete on storage.objects;

create policy health_photos_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'health-photos'
  and (select s.ok from private.health_photo_scope(name) s)
  and (select private.health_photo_ok(s.agency_id, s.individual_id)
       from private.health_photo_scope(name) s)
);

create policy health_photos_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'health-photos'
  and (select s.ok from private.health_photo_scope(name) s)
  and (select private.health_photo_ok(s.agency_id, s.individual_id)
       from private.health_photo_scope(name) s)
  and (select private.has_permission(s.agency_id, 'health.record')
       from private.health_photo_scope(name) s)
);

create policy health_photos_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'health-photos'
  and (select s.ok from private.health_photo_scope(name) s)
  and (select private.health_photo_ok(s.agency_id, s.individual_id)
       from private.health_photo_scope(name) s)
  and (select private.has_permission(s.agency_id, 'health.record')
       from private.health_photo_scope(name) s)
)
with check (
  bucket_id = 'health-photos'
  and (select s.ok from private.health_photo_scope(name) s)
);

create policy health_photos_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'health-photos'
  and (select s.ok from private.health_photo_scope(name) s)
  and (select private.health_photo_ok(s.agency_id, s.individual_id)
       from private.health_photo_scope(name) s)
  and (select private.has_permission(s.agency_id, 'health.record')
       from private.health_photo_scope(name) s)
);

-- ----------------------------------------------------------------------------
-- Permission seeding — health.record / health.review / health.view
--
-- These keys are defined in src/data/permissions.ts, but the canonical
-- role_permission_matrix insert lives in an already-applied 2026-09-15
-- migration, so existing databases never received them and
-- private.has_permission(..., 'health.record') stays false (blocking the
-- skin-check photo upload above). Seed the keys here the way mileage and
-- certificates did: add each key only where it is missing so explicit
-- per-agency customizations are preserved.
--
-- Defaults (from ROLE_TEMPLATES):
--   health.record — administrator, compliance_admin, house_manager,
--                    program_manager, dsp, nurse (HR + auditor stay out).
--   health.review — administrator, compliance_admin, house_manager,
--                    program_manager, nurse.
--   health.view   — auditor only (agency-wide read-only; no write path).
-- ----------------------------------------------------------------------------

update public.role_templates
set permissions = permissions || jsonb_build_object(
  'health.record',
  key in ('administrator', 'compliance_admin', 'house_manager',
          'program_manager', 'dsp', 'nurse')
)
where not (permissions ? 'health.record');

update public.role_templates
set permissions = permissions || jsonb_build_object(
  'health.review',
  key in ('administrator', 'compliance_admin', 'house_manager',
          'program_manager', 'nurse')
)
where not (permissions ? 'health.review');

update public.role_templates
set permissions = permissions || jsonb_build_object(
  'health.view',
  key = 'auditor'
)
where not (permissions ? 'health.view');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'health.record',
  template_key in ('administrator', 'compliance_admin', 'house_manager',
                   'program_manager', 'dsp', 'nurse')
)
where not (permissions ? 'health.record');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'health.review',
  template_key in ('administrator', 'compliance_admin', 'house_manager',
                   'program_manager', 'nurse')
)
where not (permissions ? 'health.review');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'health.view',
  template_key = 'auditor'
)
where not (permissions ? 'health.view');

commit;
