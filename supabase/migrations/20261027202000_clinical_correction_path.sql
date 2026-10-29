-- Clinical correction path for behavior + health entries (PR #117 blocker):
-- - 20261027120000 let nurses UPDATE behavior_entries / health_track_entries
--   agency-wide in place (the restrictive scope policies carry a nurse
--   widening for UPDATE, mirroring their agency-wide READ). The PR-review
--   agent blocked the merge on it: a mutable clinical observation must not
--   be overwritten cross-home with no rationale, no preserved original, and
--   no audit record.
-- - This migration narrows in-place UPDATE back to the author's own home
--   scope (can_read_individual), exactly like INSERT and DELETE already are.
--   The nurse agency-wide READ widening stays — oversight review access is
--   appropriate; direct overwrite is not.
-- - Cross-home changes now go through correct_behavior_entry /
--   correct_health_track_entry: SECURITY DEFINER RPCs that require a
--   rationale, apply the corrected values, and — via the keep-history
--   triggers below, the same pattern as shift_note_history
--   (20260925140000) — preserve the replaced version in an append-only
--   history table stamped with who changed it, when, and why. History rows
--   cannot be inserted, updated, or deleted by authenticated callers, so
--   the correction record is immutable once written.

begin;

-- ── 1. In-place UPDATE returns to home scope ──────────────────────────────
-- The permissive update policies (author, or a manager/nurse role) are
-- unchanged; only the restrictive scope loses its nurse widening for
-- UPDATE, so the conjunction is once again limited to Individuals the
-- caller can read at their own sites.

drop policy if exists behavior_entries_audit_individual_scope_update on public.behavior_entries;
create policy behavior_entries_audit_individual_scope_update on public.behavior_entries
as restrictive for update to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists health_track_entries_audit_individual_scope_update on public.health_track_entries;
create policy health_track_entries_audit_individual_scope_update on public.health_track_entries
as restrictive for update to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

-- ── 2. Version history (previous versions, written by trigger only) ──────

create table public.behavior_entry_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.behavior_entries (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  occurred_on date not null,
  occurred_at_time text not null,
  behavior text not null,
  antecedent text not null,
  duration_minutes integer,
  intensity text not null,
  intervention_used text not null,
  outcome text not null,
  recorded_by_user_id uuid,
  entry_created_at timestamptz not null,
  replaced_by uuid,
  replaced_at timestamptz not null default now(),
  is_correction boolean not null default false,
  correction_rationale text
);

create index behavior_entry_history_entry_idx
  on public.behavior_entry_history (entry_id, replaced_at);

alter table public.behavior_entry_history enable row level security;
alter table public.behavior_entry_history force row level security;

-- Same read scope as the entries themselves (own-home scope, plus the
-- nurse agency-wide read) so a correction is visible exactly where the
-- entry it belongs to is visible.
create policy behavior_entry_history_select on public.behavior_entry_history
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create table public.health_track_entry_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.health_track_entries (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  kind text not null,
  occurred_on date not null,
  title text not null,
  details jsonb not null,
  flagged_abnormal boolean not null,
  note text not null,
  recorded_by_user_id uuid,
  entry_created_at timestamptz not null,
  replaced_by uuid,
  replaced_at timestamptz not null default now(),
  is_correction boolean not null default false,
  correction_rationale text
);

create index health_track_entry_history_entry_idx
  on public.health_track_entry_history (entry_id, replaced_at);

alter table public.health_track_entry_history enable row level security;
alter table public.health_track_entry_history force row level security;

create policy health_track_entry_history_select on public.health_track_entry_history
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

-- ── 3. Keep-history triggers ──────────────────────────────────────────────
-- Every update that changes a clinical field preserves the replaced
-- version. A correction made through the RPCs carries its rationale in
-- the transaction-local app.correction_rationale setting, which the RPC
-- sets immediately before its update and clears immediately after, so a
-- direct in-place edit is never mislabeled as a correction.

create or replace function private.behavior_entries_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rationale text := nullif(current_setting('app.correction_rationale', true), '');
begin
  if (new.occurred_on, new.occurred_at_time, new.behavior, new.antecedent,
      new.duration_minutes, new.intensity, new.intervention_used, new.outcome)
     is distinct from
     (old.occurred_on, old.occurred_at_time, old.behavior, old.antecedent,
      old.duration_minutes, old.intensity, old.intervention_used, old.outcome) then
    insert into public.behavior_entry_history (
      entry_id, agency_id, individual_id, occurred_on, occurred_at_time,
      behavior, antecedent, duration_minutes, intensity, intervention_used,
      outcome, recorded_by_user_id, entry_created_at, replaced_by,
      is_correction, correction_rationale
    ) values (
      old.id, old.agency_id, old.individual_id, old.occurred_on,
      old.occurred_at_time, old.behavior, old.antecedent,
      old.duration_minutes, old.intensity, old.intervention_used,
      old.outcome, old.recorded_by_user_id, old.created_at, auth.uid(),
      v_rationale is not null, v_rationale
    );
  end if;
  return new;
end;
$$;

drop trigger if exists behavior_entries_keep_history on public.behavior_entries;
create trigger behavior_entries_keep_history
after update on public.behavior_entries
for each row execute function private.behavior_entries_keep_history();

create or replace function private.health_track_entries_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rationale text := nullif(current_setting('app.correction_rationale', true), '');
begin
  if (new.kind, new.occurred_on, new.title, new.details,
      new.flagged_abnormal, new.note)
     is distinct from
     (old.kind, old.occurred_on, old.title, old.details,
      old.flagged_abnormal, old.note) then
    insert into public.health_track_entry_history (
      entry_id, agency_id, individual_id, kind, occurred_on, title,
      details, flagged_abnormal, note, recorded_by_user_id,
      entry_created_at, replaced_by, is_correction, correction_rationale
    ) values (
      old.id, old.agency_id, old.individual_id, old.kind, old.occurred_on,
      old.title, old.details, old.flagged_abnormal, old.note,
      old.recorded_by_user_id, old.created_at, auth.uid(),
      v_rationale is not null, v_rationale
    );
  end if;
  return new;
end;
$$;

drop trigger if exists health_track_entries_keep_history on public.health_track_entries;
create trigger health_track_entries_keep_history
after update on public.health_track_entries
for each row execute function private.health_track_entries_keep_history();

-- History is append-only for callers: no insert/update/delete grant or
-- policy, so the trigger (definer) is the only writer and no one can
-- rewrite or erase a preserved version.
revoke all on public.behavior_entry_history from anon, authenticated;
grant select on public.behavior_entry_history to authenticated;
revoke all on public.health_track_entry_history from anon, authenticated;
grant select on public.health_track_entry_history to authenticated;

-- ── 4. Correction RPCs ────────────────────────────────────────────────────
-- The cross-home path. Authorization mirrors the read + update rules the
-- caller already satisfies: agency member, holds the record permission,
-- can read the entry (own-home scope or the nurse agency-wide read), and
-- is the author or an oversight role. The rationale is mandatory, a
-- no-change correction is rejected, and the keep-history trigger records
-- the replaced version with the rationale as an immutable audit row.

create or replace function public.correct_behavior_entry(
  p_entry_id uuid,
  p_rationale text,
  p_occurred_on date,
  p_occurred_at_time text,
  p_behavior text,
  p_antecedent text,
  p_duration_minutes integer,
  p_intensity text,
  p_intervention_used text,
  p_outcome text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.behavior_entries;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_entry from public.behavior_entries where id = p_entry_id;
  if not found then
    raise exception 'Behavior record not found.' using errcode = 'P0002';
  end if;
  if not (select private.has_agency(v_entry.agency_id)) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (select private.has_permission(v_entry.agency_id, 'behavior.record')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (
    (select private.can_read_individual(v_entry.agency_id, v_entry.individual_id))
    or (select private.role_key_in(v_entry.agency_id, '{nurse}'))
  ) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (
    v_entry.recorded_by_user_id = (select auth.uid())
    or (select private.role_key_in(v_entry.agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
  ) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if coalesce(trim(p_rationale), '') = '' then
    raise exception 'A correction rationale is required.' using errcode = 'P0001';
  end if;
  if (p_occurred_on, coalesce(p_occurred_at_time, ''), coalesce(p_behavior, ''),
      coalesce(p_antecedent, ''), p_duration_minutes, coalesce(p_intensity, ''),
      coalesce(p_intervention_used, ''), coalesce(p_outcome, ''))
     is not distinct from
     (v_entry.occurred_on, v_entry.occurred_at_time, v_entry.behavior,
      v_entry.antecedent, v_entry.duration_minutes, v_entry.intensity,
      v_entry.intervention_used, v_entry.outcome) then
    raise exception 'The correction does not change the record.' using errcode = 'P0001';
  end if;

  perform set_config('app.correction_rationale', trim(p_rationale), true);
  update public.behavior_entries set
    occurred_on = p_occurred_on,
    occurred_at_time = coalesce(p_occurred_at_time, ''),
    behavior = coalesce(p_behavior, ''),
    antecedent = coalesce(p_antecedent, ''),
    duration_minutes = p_duration_minutes,
    intensity = coalesce(p_intensity, ''),
    intervention_used = coalesce(p_intervention_used, ''),
    outcome = coalesce(p_outcome, '')
  where id = p_entry_id;
  perform set_config('app.correction_rationale', '', true);
  return p_entry_id;
end;
$$;

create or replace function public.correct_health_track_entry(
  p_entry_id uuid,
  p_rationale text,
  p_kind text,
  p_occurred_on date,
  p_title text,
  p_details jsonb,
  p_flagged_abnormal boolean,
  p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry public.health_track_entries;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_entry from public.health_track_entries where id = p_entry_id;
  if not found then
    raise exception 'Health record not found.' using errcode = 'P0002';
  end if;
  if not (select private.has_agency(v_entry.agency_id)) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (select private.has_permission(v_entry.agency_id, 'health.record')) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (
    (select private.can_read_individual(v_entry.agency_id, v_entry.individual_id))
    or (select private.role_key_in(v_entry.agency_id, '{nurse}'))
  ) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if not (
    v_entry.recorded_by_user_id = (select auth.uid())
    or (select private.role_key_in(v_entry.agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
  ) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  if coalesce(trim(p_rationale), '') = '' then
    raise exception 'A correction rationale is required.' using errcode = 'P0001';
  end if;
  if (coalesce(p_kind, ''), p_occurred_on, coalesce(p_title, ''),
      coalesce(p_details, '{}'::jsonb), coalesce(p_flagged_abnormal, false),
      coalesce(p_note, ''))
     is not distinct from
     (v_entry.kind, v_entry.occurred_on, v_entry.title, v_entry.details,
      v_entry.flagged_abnormal, v_entry.note) then
    raise exception 'The correction does not change the record.' using errcode = 'P0001';
  end if;

  perform set_config('app.correction_rationale', trim(p_rationale), true);
  update public.health_track_entries set
    kind = coalesce(p_kind, ''),
    occurred_on = p_occurred_on,
    title = coalesce(p_title, ''),
    details = coalesce(p_details, '{}'::jsonb),
    flagged_abnormal = coalesce(p_flagged_abnormal, false),
    note = coalesce(p_note, '')
  where id = p_entry_id;
  perform set_config('app.correction_rationale', '', true);
  return p_entry_id;
end;
$$;

revoke all on function public.correct_behavior_entry(uuid, text, date, text, text, text, integer, text, text, text) from public;
grant execute on function public.correct_behavior_entry(uuid, text, date, text, text, text, integer, text, text, text) to authenticated;
revoke all on function public.correct_health_track_entry(uuid, text, text, date, text, jsonb, boolean, text) from public;
grant execute on function public.correct_health_track_entry(uuid, text, text, date, text, jsonb, boolean, text) to authenticated;

commit;
