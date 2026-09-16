-- Complyrer HR / Employee Hub — kiosk time clock.
--
-- Five new tables, RLS enabled + forced on each, following the hr_employee_hub
-- (phase-1) and hr_phase2 (phase-2) migration conventions:
--   - agency rows readable by members with hub.access,
--   - personal rows visible to the owner or through private.hr_team_visible,
--   - writes gated by existing hub.* permissions (no new permission keys).
--
-- Kiosk trust model, documented here so future workstreams don't weaken it:
--   - The raw kiosk token is shown ONCE to the manager who generates it and
--     is never stored: the DB holds only its SHA-256 hex digest. Kiosk
--     devices authenticate with the raw token through
--     public.verify_kiosk_pin(text, text, text), never with table reads.
--   - Staff PINs are stored as bcrypt hashes in hr_clock_credentials; that
--     table is readable/writable only by HR-privileged roles
--     (hub.manage_pay_settings). The verify function returns only
--     ok/staff_id/display_name — hashes never leave the DB through it.
--   - Grant execute on the verify function to anon + authenticated so an
--     unauthenticated kiosk device can clock staff in/out. anon has no RLS
--     policies on any table, so the security-definer function is the ONLY
--     data path available to it.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Per-site kiosk device tokens. Raw tokens are never stored — token_hash is
-- the SHA-256 hex of the raw token shown once at generation.
create table public.hr_kiosk_tokens (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  token_hash text not null,
  label text,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

-- One active token per site.
create unique index hr_kiosk_tokens_site_active_idx
  on public.hr_kiosk_tokens (site_id)
  where active and revoked_at is null;

create index hr_kiosk_tokens_agency_active_idx
  on public.hr_kiosk_tokens (agency_id, active);

-- Staff clock credentials: employee ID number + bcrypt PIN hash. Never read
-- at kiosk time by anything except public.verify_kiosk_pin.
create table public.hr_clock_credentials (
  staff_id uuid primary key references public.profiles (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  employee_id_number text not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pin_updated_at timestamptz,
  updated_by uuid references public.profiles (id),
  unique (agency_id, employee_id_number),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

-- Kiosk verification audit trail: pin_ok / pin_failed / pin_locked /
-- token_rotated / token_revoked. Insert-only through the verify function
-- (no RLS insert policy is granted); readable by HR-privileged roles.
create table public.hr_kiosk_audit (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid,
  employee_id_number text,
  event text not null check (event in ('pin_failed', 'pin_locked', 'pin_ok', 'token_revoked', 'token_rotated')),
  detail text,
  attempted_at timestamptz not null default now()
);

create index hr_kiosk_audit_agency_time_idx
  on public.hr_kiosk_audit (agency_id, attempted_at);

create index hr_kiosk_audit_employee_idx
  on public.hr_kiosk_audit (employee_id_number);

-- Staff-reported missing punches. Reviewers decide; on approval the APP
-- (not this migration) inserts the punch rows and writes a correction-ledger
-- entry into hr_punch_corrections so the paper trail stays complete.
create table public.hr_missed_punch_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  site_id uuid,
  work_date date not null,
  claimed_in_at timestamptz,
  claimed_out_at timestamptz,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  constraint hr_missed_punch_reports_times check (
    claimed_in_at is not null or claimed_out_at is not null
  )
);

create index hr_missed_punch_reports_agency_status_idx
  on public.hr_missed_punch_reports (agency_id, status);

create index hr_missed_punch_reports_staff_idx
  on public.hr_missed_punch_reports (staff_id);

-- Per-agency punch rules: exactly one row per agency.
create table public.hr_punch_rules (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  rounding_minutes integer not null default 0
    check (rounding_minutes in (0, 5, 10, 15)),
  rounding_applies text not null default 'payroll'
    check (rounding_applies in ('payroll', 'display_and_payroll')),
  grace_minutes integer not null default 5 check (grace_minutes >= 0),
  auto_clockout_buffer_minutes integer not null default 30 check (auto_clockout_buffer_minutes >= 0),
  auto_approval_score_threshold integer not null default 90
    check (auto_approval_score_threshold between 0 and 100),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- hr_punches: kiosk-era columns + break/transfer kinds
-- ----------------------------------------------------------------------------

alter table public.hr_punches
  add column service_type text,
  add column individual_id uuid references public.individuals (id) on delete set null,
  add column verification_method text not null default 'web'
    check (verification_method in ('web', 'mobile', 'kiosk_pin', 'qr', 'nfc')),
  add column offline boolean not null default false,
  add column remote boolean not null default false,
  add column rounded_punched_at timestamptz,
  add column attestation jsonb,
  add column transfer_group uuid,
  add column auto_clockout boolean not null default false,
  add column exception_flags text[] not null default '{}';

-- 'in'/'out' were the only kinds; break_in/break_out/transfer are recorded
-- as events on the timeline but never pair into work segments (see
-- analyzePunches in src/data/hr.ts — pairing is in/out only, FIFO).
alter table public.hr_punches drop constraint if exists hr_punches_kind_check;
alter table public.hr_punches
  add constraint hr_punches_kind_check
  check (kind in ('in', 'out', 'break_in', 'break_out', 'transfer'));

create index hr_punches_transfer_group_idx
  on public.hr_punches (transfer_group)
  where transfer_group is not null;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

create trigger hr_punch_rules_updated_at before update on public.hr_punch_rules
for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------------------

alter table public.hr_kiosk_tokens enable row level security;
alter table public.hr_kiosk_tokens force row level security;
alter table public.hr_clock_credentials enable row level security;
alter table public.hr_clock_credentials force row level security;
alter table public.hr_kiosk_audit enable row level security;
alter table public.hr_kiosk_audit force row level security;
alter table public.hr_missed_punch_reports enable row level security;
alter table public.hr_missed_punch_reports force row level security;
alter table public.hr_punch_rules enable row level security;
alter table public.hr_punch_rules force row level security;

-- hr_kiosk_tokens: read for agency members with hub.access; writes for
-- hub.manage_schedule (site-clock operations).
create policy hr_kiosk_tokens_select on public.hr_kiosk_tokens
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (select private.has_permission(agency_id, 'hub.access'))
);

create policy hr_kiosk_tokens_write on public.hr_kiosk_tokens
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_schedule')))
with check ((select private.has_permission(agency_id, 'hub.manage_schedule')));

-- hr_clock_credentials: the strictest table in this migration. Readable and
-- writable ONLY by HR-privileged roles (hub.manage_pay_settings:
-- administrator, program_manager, hr). Kiosk-time verification goes through
-- public.verify_kiosk_pin below — nothing at the kiosk ever reads this
-- table directly.
create policy hr_clock_credentials_select on public.hr_clock_credentials
for select to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

create policy hr_clock_credentials_write on public.hr_clock_credentials
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')))
with check ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- hr_kiosk_audit: insert-only through the verify function (no insert/update/
-- delete policies exist, so app roles cannot write rows directly); readable
-- by HR-privileged roles for the lockout/audit review.
create policy hr_kiosk_audit_select on public.hr_kiosk_audit
for select to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- hr_missed_punch_reports: staff insert their own and edit while pending;
-- decisions by hub.review_timecards (site-scoped for house managers).
create policy hr_missed_punch_reports_select on public.hr_missed_punch_reports
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, site_id))
);

create policy hr_missed_punch_reports_insert on public.hr_missed_punch_reports
for insert to authenticated
with check (staff_id = auth.uid());

create policy hr_missed_punch_reports_self_update on public.hr_missed_punch_reports
for update to authenticated
using (staff_id = auth.uid() and status = 'pending')
with check (staff_id = auth.uid() and status = 'pending');

create policy hr_missed_punch_reports_decide on public.hr_missed_punch_reports
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (select private.hr_team_visible(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (select private.hr_team_visible(agency_id, site_id))
);

-- hr_punch_rules: read for agency members with hub.access; writes for
-- hub.manage_pay_settings (payroll configuration).
create policy hr_punch_rules_select on public.hr_punch_rules
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (select private.has_permission(agency_id, 'hub.access'))
);

create policy hr_punch_rules_write on public.hr_punch_rules
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')))
with check ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- ----------------------------------------------------------------------------
-- SECURITY DEFINER RPC: verify_kiosk_pin(p_token, p_employee_id, p_pin)
--
-- Comment required by convention: hashes never leave the DB through this
-- function. It returns only {ok, reason/staff_id/display_name,
-- attempts_left/locked_until} as jsonb. Lockout: 5 failed attempts in a
-- row lock the credential for 15 minutes; the lockout clears on success.
-- ----------------------------------------------------------------------------

create or replace function public.verify_kiosk_pin(
  p_token text,
  p_employee_id text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.hr_kiosk_tokens%rowtype;
  v_cred public.hr_clock_credentials%rowtype;
  v_display_name text;
  v_attempts integer;
begin
  -- Token check: bad_token reveals nothing about the agency or its staff.
  select * into v_token
  from public.hr_kiosk_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and active
    and revoked_at is null
  limit 1;

  if v_token.id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  select * into v_cred
  from public.hr_clock_credentials
  where agency_id = v_token.agency_id
    and employee_id_number = p_employee_id;

  if v_cred.staff_id is null then
    -- Unknown employee id: same shape as a wrong PIN, no lockout (no row
    -- to lock), audited so HR can see a kiosk typing a bad ID repeatedly.
    insert into public.hr_kiosk_audit
      (agency_id, site_id, employee_id_number, event, detail)
    values
      (v_token.agency_id, v_token.site_id, p_employee_id, 'pin_failed', 'unknown employee id');
    return jsonb_build_object('ok', false, 'reason', 'bad_pin', 'attempts_left', null);
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_cred.locked_until);
  end if;

  -- pgcrypto crypt(p_pin, pin_hash) recomputes the bcrypt hash with the
  -- stored salt; equality means the PIN matches. Never returns the hash.
  if v_cred.pin_hash = extensions.crypt(p_pin, v_cred.pin_hash) then
    update public.hr_clock_credentials
    set failed_attempts = 0, locked_until = null
    where staff_id = v_cred.staff_id;

    update public.hr_kiosk_tokens
    set last_used_at = now()
    where id = v_token.id;

    insert into public.hr_kiosk_audit
      (agency_id, site_id, employee_id_number, event)
    values
      (v_token.agency_id, v_token.site_id, p_employee_id, 'pin_ok');

    select p.full_name into v_display_name
    from public.profiles p
    where p.id = v_cred.staff_id;

    return jsonb_build_object(
      'ok', true,
      'staff_id', v_cred.staff_id,
      'display_name', v_display_name
    );
  end if;

  -- Wrong PIN: count up, lock at 5.
  v_attempts := coalesce(v_cred.failed_attempts, 0) + 1;

  if v_attempts >= 5 then
    update public.hr_clock_credentials
    set failed_attempts = v_attempts, locked_until = now() + interval '15 minutes'
    where staff_id = v_cred.staff_id;

    insert into public.hr_kiosk_audit
      (agency_id, site_id, employee_id_number, event, detail)
    values
      (v_token.agency_id, v_token.site_id, p_employee_id, 'pin_locked',
       format('locked after %s failed attempts', v_attempts));

    return jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'locked_until', now() + interval '15 minutes'
    );
  end if;

  update public.hr_clock_credentials
  set failed_attempts = v_attempts
  where staff_id = v_cred.staff_id;

  insert into public.hr_kiosk_audit
    (agency_id, site_id, employee_id_number, event, detail)
  values
    (v_token.agency_id, v_token.site_id, p_employee_id, 'pin_failed',
     format('%s of 5 attempts used', v_attempts));

  return jsonb_build_object(
    'ok', false,
    'reason', 'bad_pin',
    'attempts_left', 5 - v_attempts
  );
end;
$$;

comment on function public.verify_kiosk_pin(text, text, text) is
  'Kiosk PIN verification. Hashes (token and PIN) never leave the DB through this function.';

revoke all on function public.verify_kiosk_pin(text, text, text) from public;
grant execute on function public.verify_kiosk_pin(text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed: one default punch-rules row per agency (merge-only)
-- ----------------------------------------------------------------------------

insert into public.hr_punch_rules (agency_id)
select id from public.agencies
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- DEMO SEED — fictional kiosk token for the Evergreen demo agency. Gated on
-- the demo agency existing; idempotent (skips when a token already exists
-- for the site). No real people, no real phone numbers.
--
-- Raw token (shown once to the kiosk admin; stored only as SHA-256 hex):
--   DEMO-KIOSK-0001
-- ----------------------------------------------------------------------------

do $$
declare
  v_agency uuid := '00000000-0000-4000-8000-000000000001';
  v_site uuid;
begin
  if not exists (select 1 from public.agencies where id = v_agency) then
    return;
  end if;

  select id into v_site from public.sites
  where agency_id = v_agency order by name limit 1;
  if v_site is null then
    return;
  end if;

  if not exists (
    select 1 from public.hr_kiosk_tokens
    where agency_id = v_agency and site_id = v_site
  ) then
    -- 57e00b45... = sha256('DEMO-KIOSK-0001'). The raw token is never stored.
    insert into public.hr_kiosk_tokens
      (agency_id, site_id, token_hash, label, active)
    values
      (v_agency, v_site,
       '57e00b45606a04f86f13e7967733f92d0f18be1690e02877897dcab3b1b68100',
       'DEMO SEED — fictional front-desk kiosk', true);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Per-staff permission grants: hub.remote_punch (and future individually
-- granted hub.* permissions). Admins grant these to individual staff; the
-- grant is what lets a staffer punch from a personal device instead of the
-- house kiosk. Revocation is a soft delete (revoked_at).
-- ----------------------------------------------------------------------------

create table public.hr_staff_permission_grants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  permission_key text not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  unique (agency_id, staff_id, permission_key, granted_at),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

create unique index hr_staff_permission_grants_active_idx
  on public.hr_staff_permission_grants (agency_id, staff_id, permission_key)
  where revoked_at is null;

create index hr_staff_permission_grants_staff_idx
  on public.hr_staff_permission_grants (staff_id) where revoked_at is null;

alter table public.hr_staff_permission_grants enable row level security;
alter table public.hr_staff_permission_grants force row level security;

-- Readable by HR-privileged roles and by the staffer themself (so the Time
-- Clock tab can show why punching is kiosk-only); writes by
-- hub.manage_pay_settings only.
create policy hr_staff_permission_grants_select on public.hr_staff_permission_grants
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
);

create policy hr_staff_permission_grants_write on public.hr_staff_permission_grants
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')))
with check ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- Helper: does this staffer currently hold an individually granted permission?
create or replace function private.has_staff_permission(
  p_agency_id uuid,
  p_staff_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_staff_permission_grants g
    where g.agency_id = p_agency_id
      and g.staff_id = p_staff_id
      and g.permission_key = p_permission_key
      and g.revoked_at is null
  );
$$;

-- ----------------------------------------------------------------------------
-- hr_punches: server-side remote-punch enforcement.
--
-- The kiosk submits through a SECURITY DEFINER RPC (Worker 3's
-- submit_kiosk_punch) that stamps verification_method='kiosk_pin' and
-- remote=false. Authenticated staff inserting directly (personal phone / web
-- Time Clock) may only do so when they hold an individual hub.remote_punch
-- grant; those rows are always remote punches. Reviewers keep a separate
-- insert path for correction punches.
-- ----------------------------------------------------------------------------

create or replace function private.stamp_punch_remote()
returns trigger
language plpgsql
as $$
begin
  new.remote := (new.verification_method <> 'kiosk_pin');
  return new;
end;
$$;

drop trigger if exists hr_punches_stamp_remote on public.hr_punches;
create trigger hr_punches_stamp_remote before insert on public.hr_punches
for each row execute function private.stamp_punch_remote();

drop policy if exists hr_punches_insert on public.hr_punches;

create policy hr_punches_insert_remote on public.hr_punches
for insert to authenticated
with check (
  staff_id = auth.uid()
  and verification_method <> 'kiosk_pin'
  and (select private.has_staff_permission(agency_id, auth.uid(), 'hub.remote_punch'))
);

create policy hr_punches_insert_review on public.hr_punches
for insert to authenticated
with check (
  verification_method <> 'kiosk_pin'
  and (select private.has_permission(agency_id, 'hub.review_timecards'))
);

-- ----------------------------------------------------------------------------
-- Guardrail: fail loudly if any table is missing, lacks RLS, the verify
-- function is missing, or hr_punches lacks the new columns
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
  c text;
  v_tables text[] := array[
    'hr_kiosk_tokens', 'hr_clock_credentials', 'hr_kiosk_audit',
    'hr_missed_punch_reports', 'hr_punch_rules', 'hr_staff_permission_grants'
  ];
  v_columns text[] := array[
    'service_type', 'individual_id', 'verification_method',
    'offline', 'remote', 'rounded_punched_at', 'attestation', 'transfer_group',
    'auto_clockout', 'exception_flags'
  ];
begin
  foreach t in array v_tables
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'HR kiosk migration guard: table public.% is missing', t;
    end if;
    if not (
      select pgc.relrowsecurity and pgc.relforcerowsecurity
      from pg_class pgc
      where pgc.oid = ('public.' || t)::regclass
    ) then
      raise exception 'HR kiosk migration guard: table public.% lacks row level security', t;
    end if;
  end loop;
  foreach c in array v_columns
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'hr_punches' and column_name = c
    ) then
      raise exception 'HR kiosk migration guard: hr_punches.% is missing', c;
    end if;
  end loop;
  if to_regprocedure('public.verify_kiosk_pin(text, text, text)') is null then
    raise exception 'HR kiosk migration guard: public.verify_kiosk_pin is missing';
  end if;
end
$$;
