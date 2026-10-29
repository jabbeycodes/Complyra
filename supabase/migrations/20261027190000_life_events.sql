-- Life events — INTENTIONALLY UNAPPLIED.
--
-- A per-Individual timeline of significant life events (moves, hospital
-- stays, family changes, milestones). Life events are CONTEXT, not
-- incident paperwork: they deliberately raise NO alerts, NO dashboard
-- panel, and NO notifications.
--
-- Who sees what:
--   * View: anyone who can read the Individual (private.can_read_individual)
--     — DSPs on their assigned Individuals and AUDITORS read-only included,
--     because the timeline is part of the person's record. HR has no
--     `individuals.view`, so HR has no access path at all.
--   * Add / edit / void: administrator, compliance_admin, program_manager,
--     house_manager, nurse — gated by the `lifeEvents.record` permission
--     AND the editor role list (private.can_record_life_event mirrors
--     canRecordLifeEvents() in src/data/permissions.ts), always within the
--     caller's Individual-read scope. DSPs can never write.
--   * Removal is a soft VOID (voided_by / voided_at / void_reason), never
--     a delete. Voided rows leave the standard read path (non-editors
--     cannot see them at all) but stay in the table for editors/audit.
--
-- Hardening (the PR #119 / #121 pattern):
--   * RLS enabled AND forced.
--   * Per-command policies only — NO `for all` write policy, and NO
--     DELETE policy or grant anywhere (voids are updates).
--   * Restrictive scope policies follow the repo's audit pattern
--     (membership + individual scope + site scope).
--   * Authorship is bound to auth.uid() in the INSERT policy; a guard
--     trigger freezes identity columns, enforces the void transition
--     (reason required, voided_by = auth.uid(), content columns frozen
--     in the same update), stamps updated_by/at server-side, and makes
--     voided rows immutable.
--   * related_ger_id is a bare uuid with NO foreign key on purpose: the
--     event-report table (ger_reports) lands with PR #117, which is not
--     on main yet. The link is stored data until that table exists.
begin;

-- ── Helper ───────────────────────────────────────────────────────────────

-- The write gate: active agency membership + the `lifeEvents.record`
-- permission + an editor role (mirrors canRecordLifeEvents()).
create or replace function private.can_record_life_event(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select private.has_agency(p_agency_id))
    and (select private.has_permission(p_agency_id, 'lifeEvents.record'))
    and (select private.role_key_in(p_agency_id, '{administrator,compliance_admin,program_manager,house_manager,nurse}'));
$$;

-- ── Permission backfill ──────────────────────────────────────────────────
-- The canonical seed (20260915024000_integrated_permissions.sql, regenerated
-- with this key) lands BEFORE the DPM-merge migration
-- (20260916060000_merge_dpm_program_manager.sql), which wholesale replaces
-- the program_manager template/matrix rows with its frozen 2026-09-16 pack
-- — a pack that predates this key. Following the seed's own rule ("missing
-- new capabilities inherit their canonical defaults; existing choices
-- win"), fill the key in wherever it is absent: matrix, templates, and
-- live agency role rows. Values mirror src/data/permissions.ts exactly.

update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('lifeEvents.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'lifeEvents.record');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('lifeEvents.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'lifeEvents.record');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('lifeEvents.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'lifeEvents.record');

-- ── Table ────────────────────────────────────────────────────────────────

create table public.life_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  site_id uuid not null,
  individual_id uuid not null,
  event_date date not null,
  category text not null check (category in (
    'admission_move_in', 'home_transfer', 'hospital_er_stay',
    'family_change', 'guardianship_legal_change', 'day_program_change',
    'school_change', 'bereavement', 'milestone', 'other'
  )),
  title text not null check (length(trim(title)) > 0 and length(title) <= 200),
  note text not null default '' check (length(note) <= 2000),
  -- Optional link to one related event report. No FK yet — see header.
  related_ger_id uuid,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text check (
    void_reason is null
    or (length(trim(void_reason)) > 0 and length(void_reason) <= 500)
  ),
  -- A void is all-or-nothing: the stamp, the actor, and the reason land
  -- together or not at all.
  check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null)
  ),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals(id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites(id, agency_id)
);

create index life_events_individual_idx
  on public.life_events (agency_id, individual_id, event_date desc, created_at desc);

alter table public.life_events enable row level security;
alter table public.life_events force row level security;

-- ── Permissive policies (per command) ────────────────────────────────────
-- Read: anyone who can read the Individual. Voided rows are visible only
-- to editors (the record is retained for them); everyone else's read path
-- never returns a voided row.
-- Create: an editor recording their own entry about an Individual they
-- can read; a new row can never be born voided or pre-edited.
-- Update: an editor within Individual-read scope. WHICH columns may
-- change (content edits vs. the void transition) is the guard trigger's
-- job — RLS is row-wide. There is deliberately NO delete policy.

create policy life_events_select on public.life_events
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    voided_at is null
    or (select private.can_record_life_event(agency_id))
  )
);

create policy life_events_insert on public.life_events
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and (select private.can_record_life_event(agency_id))
  and (select private.can_read_individual(agency_id, individual_id))
  and voided_at is null
  and voided_by is null
  and void_reason is null
  and updated_by is null
  and updated_at is null
);

create policy life_events_update on public.life_events
for update to authenticated
using (
  (select private.can_record_life_event(agency_id))
  and (select private.can_read_individual(agency_id, individual_id))
)
with check (
  (select private.can_record_life_event(agency_id))
  and (select private.can_read_individual(agency_id, individual_id))
);

-- ── Restrictive scope policies (the repo's audit pattern) ───────────────

create policy life_events_audit_membership on public.life_events
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy life_events_audit_individual_scope on public.life_events
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

create policy life_events_audit_site_scope on public.life_events
as restrictive for all to authenticated
using ((select private.can_read_site(agency_id, site_id)))
with check ((select private.can_read_site(agency_id, site_id)));

-- ── Guard trigger ────────────────────────────────────────────────────────
-- Row-level shape of a write: the INSERT must name an Individual who
-- actually lives at the stated site in this agency; identity columns
-- never move after creation; a content edit stamps updated_by/at from
-- the caller and cannot touch the void columns; a VOID is its own
-- transition (reason required, voided_by is the caller, content frozen);
-- a voided row is immutable.

create or replace function private.guard_life_event_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.individuals i
      where i.id = new.individual_id
        and i.agency_id = new.agency_id
        and i.site_id = new.site_id
    ) then
      raise exception 'The Individual does not belong to this site.';
    end if;
    if auth.role() = 'authenticated' then
      new.recorded_by := (select auth.uid());
    end if;
    return new;
  end if;

  -- UPDATE from here.
  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.site_id is distinct from old.site_id
     or new.individual_id is distinct from old.individual_id
     or new.recorded_by is distinct from old.recorded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A life event''s identity cannot change.';
  end if;

  if old.voided_at is not null then
    raise exception 'A voided life event cannot be changed.';
  end if;

  if new.voided_at is not null then
    -- The void transition: only the three void columns may move, the
    -- reason must be real text, and the void is the caller's own.
    if new.event_date is distinct from old.event_date
       or new.category is distinct from old.category
       or new.title is distinct from old.title
       or new.note is distinct from old.note
       or new.related_ger_id is distinct from old.related_ger_id
       or new.updated_by is distinct from old.updated_by
       or new.updated_at is distinct from old.updated_at then
      raise exception 'Voiding a life event cannot change its content.';
    end if;
    if new.void_reason is null or length(trim(new.void_reason)) = 0 then
      raise exception 'Say why this entry is being voided.';
    end if;
    if auth.role() = 'authenticated' and new.voided_by is distinct from (select auth.uid()) then
      raise exception 'A life event can only be voided by the signed-in user.';
    end if;
    return new;
  end if;

  -- A plain content edit: the void columns stay empty, and the edit is
  -- stamped from the caller server-side.
  if new.voided_by is not null or new.void_reason is not null then
    raise exception 'A life event can only be voided in a void update.';
  end if;
  if auth.role() = 'authenticated' then
    new.updated_by := (select auth.uid());
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger life_events_guard_write
before insert or update on public.life_events
for each row execute function private.guard_life_event_write();

-- ── Grants ───────────────────────────────────────────────────────────────
-- SELECT + INSERT + UPDATE for the hosted API, scoped by the policies
-- above. NO delete grant: removal is a void (an update), never a delete.

revoke all on public.life_events from authenticated, anon;
grant select, insert, update on public.life_events to authenticated;

revoke all on function private.can_record_life_event(uuid) from public;
grant execute on function private.can_record_life_event(uuid) to authenticated;

commit;
