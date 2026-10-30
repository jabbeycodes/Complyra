-- Performance records (2026-10-30, New Hire Binder build 3): the paper
-- binder's "Performance Review" and "Corrective Action" sections as
-- first-class HR records in the employee file.
--
-- Both tables are APPEND-ONLY history. Content is frozen at filing by
-- guard triggers; the only post-filing movement is the state fields:
-- a review's acknowledgment (typed signature) and its ONE response
-- note; a corrective action's acknowledgment (signature, or declined
-- with a named witness) and its outcome (issuer or HR, dated + noted).
-- A correction is a new record whose supersedes_id points at the
-- record it replaces — the earlier record is never rewritten.
--
-- Visibility mirrors the Employee Hub's team-management scoping (the
-- time-off chain rule, 20261027210000): the staff member; HR and
-- administrators agency-wide; auditors READ-ONLY (the platform rule);
-- hub.view_team holders in the subject's management chain — program
-- managers agency-wide, house managers only for their own home's
-- staff. Peers never see these records. Filing belongs to the same
-- chain; nobody files on themselves; auditors never file.
--
-- Permissions: NO new permission keys (hub.view_team is reused), so
-- the program_manager template trap (20260916060000) does not apply
-- and no backfill is needed.
--
-- UNAPPLIED: this migration has NOT been run against any hosted
-- database. It joins the pending migration list (house card, personal
-- spending, new hire binder) and applies only on the founder's word.

begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.hr_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  review_date date not null,
  period_start date not null,
  period_end date not null,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewer_name text not null default '',
  rating text not null
    check (rating in (
      'Exceeds expectations', 'Meets expectations', 'Developing', 'Unsatisfactory'
    )),
  strengths text not null default '',
  growth_areas text not null default '',
  goals text not null default '',
  state text not null default 'filed'
    check (state in ('filed', 'acknowledged')),
  ack_signature_name text,
  ack_at timestamptz,
  response_note text,
  response_at timestamptz,
  supersedes_id uuid references public.hr_performance_reviews (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  constraint hr_performance_reviews_period check (period_end >= period_start),
  -- The acknowledgment lands whole (signature + time), only in the
  -- acknowledged state; the response note exists only after that, and
  -- always with its timestamp.
  constraint hr_performance_reviews_ack_shape check (
    (state = 'filed'
      and ack_signature_name is null and ack_at is null
      and response_note is null and response_at is null)
    or (state = 'acknowledged'
      and length(btrim(coalesce(ack_signature_name, ''))) > 0
      and ack_at is not null
      and ((response_note is null) = (response_at is null)))
  )
);

create index hr_performance_reviews_staff_idx
  on public.hr_performance_reviews (agency_id, staff_id, review_date desc);

create table public.hr_staff_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  action_date date not null,
  issuer_id uuid not null references public.profiles (id) on delete cascade,
  issuer_name text not null default '',
  level text not null
    check (level in (
      'Verbal warning', 'Written warning', 'Performance improvement plan',
      'Suspension', 'Final warning'
    )),
  description text not null default '',
  expectations text not null default '',
  follow_up_date date,
  ack_state text not null default 'pending'
    check (ack_state in ('pending', 'signed', 'declined')),
  ack_signature_name text,
  ack_at timestamptz,
  witness_name text,
  outcome text not null default 'open'
    check (outcome in ('open', 'resolved', 'extended', 'escalated')),
  outcome_note text,
  outcome_at timestamptz,
  outcome_by_name text,
  supersedes_id uuid references public.hr_staff_corrective_actions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  -- A performance improvement plan always carries its follow-up date.
  constraint hr_staff_corrective_actions_pip_followup check (
    level <> 'Performance improvement plan' or follow_up_date is not null
  ),
  -- Signing and declining are mutually exclusive, each complete:
  -- signed = signature + time, no witness; declined = witness + time,
  -- no signature; pending = none of them.
  constraint hr_staff_corrective_actions_ack_shape check (
    (ack_state = 'pending'
      and ack_signature_name is null and ack_at is null and witness_name is null)
    or (ack_state = 'signed'
      and length(btrim(coalesce(ack_signature_name, ''))) > 0
      and ack_at is not null and witness_name is null)
    or (ack_state = 'declined'
      and ack_signature_name is null and ack_at is not null
      and length(btrim(coalesce(witness_name, ''))) > 0)
  ),
  -- A decided outcome carries its note, date, and decider together;
  -- an open action carries none of them.
  constraint hr_staff_corrective_actions_outcome_shape check (
    (outcome = 'open'
      and outcome_note is null and outcome_at is null and outcome_by_name is null)
    or (outcome <> 'open'
      and length(btrim(coalesce(outcome_note, ''))) > 0
      and outcome_at is not null
      and length(btrim(coalesce(outcome_by_name, ''))) > 0)
  )
);

create index hr_staff_corrective_actions_staff_idx
  on public.hr_staff_corrective_actions (agency_id, staff_id, action_date desc);

-- ----------------------------------------------------------------------------
-- Visibility: subject, HR/admin/auditor, and the management chain
-- ----------------------------------------------------------------------------

-- The chain part shared by reads and filing: a hub.view_team holder
-- whose membership places them over the subject — program managers
-- (and the agency-wide roles) anywhere; a house manager only where
-- the subject's home is theirs. Mirrors private.time_off_team_visible
-- with the subject's membership site standing in for the row's site.
create or replace function private.performance_chain_member(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and exists (
      select 1
      from public.memberships viewer
      where viewer.user_id = auth.uid()
        and viewer.agency_id = p_agency_id
        and (viewer.expires_on is null or viewer.expires_on >= current_date)
        and (
          viewer.role_key in ('administrator', 'compliance_admin', 'program_manager')
          or (
            viewer.role_key = 'house_manager'
            and exists (
              select 1
              from public.memberships subj
              where subj.user_id = p_staff_id
                and subj.agency_id = p_agency_id
                and (subj.expires_on is null or subj.expires_on >= current_date)
                and subj.site_id is not null
                and (viewer.site_id is null or viewer.site_id = subj.site_id)
            )
          )
        )
    )
$$;

revoke all on function private.performance_chain_member(uuid, uuid) from public;
grant execute on function private.performance_chain_member(uuid, uuid) to authenticated;

-- Read rule: the subject, the agency-wide HR roles + auditor, or the
-- management chain.
create or replace function private.performance_subject_visible(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_staff_id = auth.uid()
    or (select private.role_key_in(
      p_agency_id, '{administrator,hr,auditor}'))
    or (select private.performance_chain_member(p_agency_id, p_staff_id))
$$;

revoke all on function private.performance_subject_visible(uuid, uuid) from public;
grant execute on function private.performance_subject_visible(uuid, uuid) to authenticated;

-- Filing rule: HR/administrators, or the management chain. Never the
-- subject; the auditor role is deliberately absent — auditors read.
create or replace function private.performance_can_file(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_staff_id <> auth.uid()
    and (
      (select private.role_key_in(p_agency_id, '{administrator,hr}'))
      or (select private.performance_chain_member(p_agency_id, p_staff_id))
    )
$$;

revoke all on function private.performance_can_file(uuid, uuid) from public;
grant execute on function private.performance_can_file(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.hr_performance_reviews enable row level security;
alter table public.hr_performance_reviews force row level security;
alter table public.hr_staff_corrective_actions enable row level security;
alter table public.hr_staff_corrective_actions force row level security;

create policy hr_performance_reviews_select on public.hr_performance_reviews
for select to authenticated
using ((select private.performance_subject_visible(agency_id, staff_id)));

create policy hr_performance_reviews_insert on public.hr_performance_reviews
for insert to authenticated
with check (
  reviewer_id = (select auth.uid())
  and (select private.performance_can_file(agency_id, staff_id))
);

-- Updates are opened to everyone who can see the row; the guard
-- trigger narrows each actor to their own fields (subject: ack +
-- response; issuer/HR: nothing on a review — reviews have no outcome).
create policy hr_performance_reviews_update on public.hr_performance_reviews
for update to authenticated
using ((select private.performance_subject_visible(agency_id, staff_id)))
with check ((select private.performance_subject_visible(agency_id, staff_id)));

create policy hr_staff_corrective_actions_select on public.hr_staff_corrective_actions
for select to authenticated
using ((select private.performance_subject_visible(agency_id, staff_id)));

create policy hr_staff_corrective_actions_insert on public.hr_staff_corrective_actions
for insert to authenticated
with check (
  issuer_id = (select auth.uid())
  and (select private.performance_can_file(agency_id, staff_id))
);

create policy hr_staff_corrective_actions_update on public.hr_staff_corrective_actions
for update to authenticated
using ((select private.performance_subject_visible(agency_id, staff_id)))
with check ((select private.performance_subject_visible(agency_id, staff_id)));

-- No delete policies: performance records are never erased.

-- The audit access boundary (20260915023000), as restrictive policies:
-- an active membership in the row's agency.
create policy hr_performance_reviews_audit_membership on public.hr_performance_reviews
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy hr_staff_corrective_actions_audit_membership on public.hr_staff_corrective_actions
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- ----------------------------------------------------------------------------
-- Guards: freeze content; state transitions belong to their actors
-- ----------------------------------------------------------------------------

create or replace function private.hr_performance_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if v_uid is not null then
      new.reviewer_id := v_uid;
      -- A new review is always freshly filed, whatever the client sent.
      new.state := 'filed';
      new.ack_signature_name := null;
      new.ack_at := null;
      new.response_note := null;
      new.response_at := null;
    end if;
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.staff_id is distinct from old.staff_id
     or new.review_date is distinct from old.review_date
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.reviewer_id is distinct from old.reviewer_id
     or new.reviewer_name is distinct from old.reviewer_name
     or new.rating is distinct from old.rating
     or new.strengths is distinct from old.strengths
     or new.growth_areas is distinct from old.growth_areas
     or new.goals is distinct from old.goals
     or new.supersedes_id is distinct from old.supersedes_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A performance review''s content cannot change after filing.'
      using errcode = 'P0001';
  end if;
  new.updated_at := now();

  -- Acknowledgment: the subject, once, from filed, with a signature.
  if new.state is distinct from old.state then
    if old.state <> 'filed' or new.state <> 'acknowledged' then
      raise exception 'A review can only move from filed to acknowledged.'
        using errcode = 'P0001';
    end if;
    if v_uid is distinct from old.staff_id then
      raise exception 'Only the staff member can acknowledge their review.'
        using errcode = 'P0001';
    end if;
    if length(btrim(coalesce(new.ack_signature_name, ''))) = 0 then
      raise exception 'Acknowledgment needs the staff member''s typed signature.'
        using errcode = 'P0001';
    end if;
    new.ack_at := now();
  elsif new.ack_signature_name is distinct from old.ack_signature_name
     or new.ack_at is distinct from old.ack_at then
    raise exception 'An acknowledgment cannot change once recorded.'
      using errcode = 'P0001';
  end if;

  -- The response note: the subject, once, after acknowledging.
  if new.response_note is distinct from old.response_note
     or new.response_at is distinct from old.response_at then
    if v_uid is distinct from old.staff_id then
      raise exception 'Only the staff member can respond to their review.'
        using errcode = 'P0001';
    end if;
    if old.response_note is not null then
      raise exception 'A review carries one response note; it cannot be replaced.'
        using errcode = 'P0001';
    end if;
    if new.state <> 'acknowledged' then
      raise exception 'Acknowledge the review before responding to it.'
        using errcode = 'P0001';
    end if;
    if length(btrim(coalesce(new.response_note, ''))) = 0 then
      raise exception 'A response cannot be blank.'
        using errcode = 'P0001';
    end if;
    new.response_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists hr_performance_reviews_guard on public.hr_performance_reviews;
create trigger hr_performance_reviews_guard
before insert or update on public.hr_performance_reviews
for each row execute function private.hr_performance_reviews_guard();

create or replace function private.hr_staff_corrective_actions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if v_uid is not null then
      new.issuer_id := v_uid;
      -- A new action is always pending acknowledgment, outcome open.
      new.ack_state := 'pending';
      new.ack_signature_name := null;
      new.ack_at := null;
      new.witness_name := null;
      new.outcome := 'open';
      new.outcome_note := null;
      new.outcome_at := null;
      new.outcome_by_name := null;
    end if;
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.staff_id is distinct from old.staff_id
     or new.action_date is distinct from old.action_date
     or new.issuer_id is distinct from old.issuer_id
     or new.issuer_name is distinct from old.issuer_name
     or new.level is distinct from old.level
     or new.description is distinct from old.description
     or new.expectations is distinct from old.expectations
     or new.follow_up_date is distinct from old.follow_up_date
     or new.supersedes_id is distinct from old.supersedes_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A corrective action''s content cannot change after filing.'
      using errcode = 'P0001';
  end if;
  new.updated_at := now();

  -- Acknowledgment: the subject, once, from pending — signed with a
  -- signature, or declined with a named witness.
  if new.ack_state is distinct from old.ack_state then
    if old.ack_state <> 'pending' then
      raise exception 'This corrective action has already been acknowledged.'
        using errcode = 'P0001';
    end if;
    if v_uid is distinct from old.staff_id then
      raise exception 'Only the staff member can acknowledge a corrective action.'
        using errcode = 'P0001';
    end if;
    if new.ack_state = 'signed' then
      if length(btrim(coalesce(new.ack_signature_name, ''))) = 0
         or new.witness_name is not null then
        raise exception 'Signing needs a typed signature and no witness.'
          using errcode = 'P0001';
      end if;
    elsif new.ack_state = 'declined' then
      if length(btrim(coalesce(new.witness_name, ''))) = 0
         or new.ack_signature_name is not null then
        raise exception 'Declining to sign needs a named witness and no signature.'
          using errcode = 'P0001';
      end if;
    else
      raise exception 'An acknowledgment is either signed or declined.'
        using errcode = 'P0001';
    end if;
    new.ack_at := now();
  elsif new.ack_signature_name is distinct from old.ack_signature_name
     or new.ack_at is distinct from old.ack_at
     or new.witness_name is distinct from old.witness_name then
    raise exception 'An acknowledgment cannot change once recorded.'
      using errcode = 'P0001';
  end if;

  -- Outcome: the issuer, or HR/administrators — always with a note.
  -- Moving back to open clears the decision fields with it.
  if new.outcome is distinct from old.outcome
     or new.outcome_note is distinct from old.outcome_note
     or new.outcome_at is distinct from old.outcome_at
     or new.outcome_by_name is distinct from old.outcome_by_name then
    if not (
      v_uid = old.issuer_id
      or (select private.role_key_in(old.agency_id, '{administrator,hr}'))
    ) then
      raise exception 'Only the issuer or HR can set the outcome.'
        using errcode = 'P0001';
    end if;
    if new.outcome = 'open' then
      new.outcome_note := null;
      new.outcome_at := null;
      new.outcome_by_name := null;
    else
      if length(btrim(coalesce(new.outcome_note, ''))) = 0
         or length(btrim(coalesce(new.outcome_by_name, ''))) = 0 then
        raise exception 'An outcome needs a note and the decider''s name.'
          using errcode = 'P0001';
      end if;
      new.outcome_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hr_staff_corrective_actions_guard on public.hr_staff_corrective_actions;
create trigger hr_staff_corrective_actions_guard
before insert or update on public.hr_staff_corrective_actions
for each row execute function private.hr_staff_corrective_actions_guard();

revoke all on public.hr_performance_reviews from anon, authenticated;
grant select, insert, update on public.hr_performance_reviews to authenticated;
revoke all on public.hr_staff_corrective_actions from anon, authenticated;
grant select, insert, update on public.hr_staff_corrective_actions to authenticated;

commit;
