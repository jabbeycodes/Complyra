-- Phase 0 security: shift notes, note scores, MAR dose marks and alone-time
-- windows were agency-wide. Any member could read every Individual's notes,
-- insert a note under another person's staff_user_id, and any DSP could
-- update or delete any MAR mark in the agency with a free-text marked_by.
--
-- This migration:
-- - scopes all four tables to private.can_read_individual (site for managers,
--   exact dated assignment for DSPs), matching 20260914140000 elsewhere;
-- - makes the note author and MAR recorder the signed-in user, stamped by
--   triggers so the client cannot supply another identity;
-- - freezes identity columns on update (agency, Individual, author, dose slot);
-- - removes DELETE on MAR marks and keeps an append-only history of every
--   change to a mark, so a correction never erases what was recorded before.

begin;

-- ---------------------------------------------------------------------------
-- shift_notes
-- ---------------------------------------------------------------------------

drop policy if exists shift_notes_select on public.shift_notes;
create policy shift_notes_select on public.shift_notes
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists shift_notes_insert on public.shift_notes;
create policy shift_notes_insert on public.shift_notes
for insert to authenticated
with check (
  staff_user_id = (select auth.uid())
  and (select private.can_read_individual(agency_id, individual_id))
);

drop policy if exists shift_notes_update on public.shift_notes;
create policy shift_notes_update on public.shift_notes
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    staff_user_id = (select auth.uid())
    or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
  )
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    staff_user_id = (select auth.uid())
    or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
  )
);

drop policy if exists shift_notes_delete on public.shift_notes;
create policy shift_notes_delete on public.shift_notes
for delete to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,program_manager,compliance_admin}'))
);

create or replace function private.shift_notes_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.staff_user_id := v_uid;
      new.staff_name := coalesce(
        (select p.full_name from public.profiles p where p.id = v_uid),
        new.staff_name
      );
    end if;
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.individual_id is distinct from old.individual_id
     or new.staff_user_id is distinct from old.staff_user_id
     or new.staff_name is distinct from old.staff_name
     or new.created_at is distinct from old.created_at then
    raise exception 'A shift note''s Individual and author cannot be changed.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_notes_identity_guard on public.shift_notes;
create trigger shift_notes_identity_guard
before insert or update on public.shift_notes
for each row execute function private.shift_notes_identity_guard();

-- ---------------------------------------------------------------------------
-- shift_note_task_scores (inherit the parent note's scope)
-- ---------------------------------------------------------------------------

drop policy if exists shift_note_task_scores_select on public.shift_note_task_scores;
create policy shift_note_task_scores_select on public.shift_note_task_scores
for select to authenticated
using (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (select private.can_read_individual(n.agency_id, n.individual_id))
  )
);

drop policy if exists shift_note_task_scores_write on public.shift_note_task_scores;
create policy shift_note_task_scores_write on public.shift_note_task_scores
for all to authenticated
using (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (select private.can_read_individual(n.agency_id, n.individual_id))
      and (
        n.staff_user_id = (select auth.uid())
        or (select private.role_key_in(n.agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
      )
  )
)
with check (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (select private.can_read_individual(n.agency_id, n.individual_id))
      and (
        n.staff_user_id = (select auth.uid())
        or (select private.role_key_in(n.agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
      )
  )
);

-- ---------------------------------------------------------------------------
-- med_dose_marks
-- ---------------------------------------------------------------------------

drop policy if exists med_dose_marks_select on public.med_dose_marks;
create policy med_dose_marks_select on public.med_dose_marks
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

-- Replace the FOR ALL policy (which allowed DELETE) with insert + update only.
drop policy if exists med_dose_marks_write on public.med_dose_marks;
drop policy if exists med_dose_marks_insert on public.med_dose_marks;
drop policy if exists med_dose_marks_update on public.med_dose_marks;

create policy med_dose_marks_insert on public.med_dose_marks
for insert to authenticated
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
);

create policy med_dose_marks_update on public.med_dose_marks
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
);

-- Every prior version of a mark, written by trigger only.
create table public.med_dose_mark_history (
  id uuid primary key default gen_random_uuid(),
  mark_id uuid not null references public.med_dose_marks (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  medication_id uuid not null,
  dose_date date not null,
  dose_time text not null,
  status text not null,
  marked_by uuid,
  marked_by_name text not null default '',
  marked_at timestamptz not null,
  replaced_by uuid,
  replaced_at timestamptz not null default now()
);

create index med_dose_mark_history_mark_idx
  on public.med_dose_mark_history (mark_id, replaced_at);

alter table public.med_dose_mark_history enable row level security;
alter table public.med_dose_mark_history force row level security;

create policy med_dose_mark_history_select on public.med_dose_mark_history
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));
-- No insert/update/delete policies: only the trigger below writes history.

create or replace function private.med_dose_marks_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_med_individual uuid;
begin
  select m.individual_id into v_med_individual
  from public.medications m
  where m.id = new.medication_id and m.agency_id = new.agency_id;

  if v_med_individual is null or v_med_individual <> new.individual_id then
    raise exception 'This medication does not belong to that Individual.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.agency_id is distinct from old.agency_id
       or new.individual_id is distinct from old.individual_id
       or new.medication_id is distinct from old.medication_id
       or new.dose_date is distinct from old.dose_date
       or new.dose_time is distinct from old.dose_time then
      raise exception 'A MAR entry''s medication and dose time cannot be changed.'
        using errcode = 'P0001';
    end if;

    insert into public.med_dose_mark_history (
      mark_id, agency_id, individual_id, medication_id, dose_date, dose_time,
      status, marked_by, marked_by_name, marked_at, replaced_by
    ) values (
      old.id, old.agency_id, old.individual_id, old.medication_id, old.dose_date,
      old.dose_time, old.status, old.marked_by, old.marked_by_name, old.marked_at,
      v_uid
    );
  end if;

  -- The recorder is always the signed-in user (service jobs keep what they set).
  if v_uid is not null then
    new.marked_by := v_uid;
    new.marked_by_name := coalesce(
      (select p.full_name from public.profiles p where p.id = v_uid),
      new.marked_by_name
    );
    new.marked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists med_dose_marks_identity_guard on public.med_dose_marks;
create trigger med_dose_marks_identity_guard
before insert or update on public.med_dose_marks
for each row execute function private.med_dose_marks_identity_guard();

-- ---------------------------------------------------------------------------
-- alone_time_windows
-- ---------------------------------------------------------------------------

drop policy if exists alone_time_windows_select on public.alone_time_windows;
create policy alone_time_windows_select on public.alone_time_windows
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists alone_time_windows_write on public.alone_time_windows;
create policy alone_time_windows_write on public.alone_time_windows
for all to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,house_manager}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,house_manager}'))
);

-- Tables created after 20260915025000 (HR hub, kiosk, shift notes, MAR marks,
-- alone time) never received SQL privileges for `authenticated`, so their RLS
-- policies could not take effect on a database built from migrations. Re-run
-- the same policy-driven grant, limited to tables with RLS enabled: each table
-- gets exactly the operations its authenticated policies allow.
do $$
declare p record; operation text;
begin
  for p in
    select pol.tablename, pol.cmd
    from pg_policies pol
    join pg_class c on c.relname = pol.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = pol.schemaname
    where pol.schemaname = 'public'
      and 'authenticated' = any(pol.roles)
      and pol.permissive = 'PERMISSIVE'
      and c.relrowsecurity
  loop
    foreach operation in array case when p.cmd = 'ALL'
      then array['SELECT','INSERT','UPDATE','DELETE'] else array[p.cmd] end
    loop
      if not has_table_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)
        and (operation = 'DELETE'
             or not has_any_column_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)) then
        execute format('grant %s on public.%I to authenticated', operation, p.tablename);
      end if;
    end loop;
  end loop;
end $$;

-- Belt and braces: RLS already denies these, but remove the SQL privilege too.
revoke delete on public.med_dose_marks from anon, authenticated;
revoke all on public.med_dose_mark_history from anon, authenticated;
grant select on public.med_dose_mark_history to authenticated;

commit;
