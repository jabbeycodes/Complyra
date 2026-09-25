-- Corrections to notes and MAR entries (agency rule, 2026-09-25):
-- - DSPs can go back and edit ONLY their own shift notes, at any time
--   (already enforced by shift_notes_update; access now persists after
--   reassignment via 20260925130000).
-- - DSPs can correct MAR entries at any time, but only entries they recorded.
--   Managers and nurses can correct anyone's entry.
-- - Every edit keeps the previous version, so a correction never erases the
--   original record (MAR history exists since 20260925120000; this adds the
--   same for shift notes).

begin;

drop policy if exists med_dose_marks_update on public.med_dose_marks;
create policy med_dose_marks_update on public.med_dose_marks
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse}'))
    or (
      (select private.role_key_in(agency_id, '{dsp}'))
      and marked_by = (select auth.uid())
    )
  )
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
);

-- Previous versions of a shift note, written by trigger only.
create table public.shift_note_history (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.shift_notes (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  note_date date not null,
  shift text not null,
  summary text not null,
  time_spent_minutes integer,
  deleted_at timestamptz,
  scores jsonb not null default '[]'::jsonb,
  version_saved_at timestamptz not null,
  replaced_by uuid,
  replaced_at timestamptz not null default now()
);

create index shift_note_history_note_idx
  on public.shift_note_history (note_id, replaced_at);

alter table public.shift_note_history enable row level security;
alter table public.shift_note_history force row level security;

create policy shift_note_history_select on public.shift_note_history
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

create or replace function private.shift_notes_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.summary, new.note_date, new.shift, new.time_spent_minutes, new.deleted_at)
     is distinct from
     (old.summary, old.note_date, old.shift, old.time_spent_minutes, old.deleted_at) then
    -- The app saves the note first and replaces its scores afterwards, so the
    -- scores read here are still the previous version's.
    insert into public.shift_note_history (
      note_id, agency_id, individual_id, note_date, shift, summary,
      time_spent_minutes, deleted_at, scores, version_saved_at, replaced_by
    ) values (
      old.id, old.agency_id, old.individual_id, old.note_date, old.shift,
      old.summary, old.time_spent_minutes, old.deleted_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'task_id', s.task_id, 'level_id', s.level_id, 'comment', s.comment))
        from public.shift_note_task_scores s where s.note_id = old.id
      ), '[]'::jsonb),
      old.updated_at, auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists shift_notes_keep_history on public.shift_notes;
create trigger shift_notes_keep_history
after update on public.shift_notes
for each row execute function private.shift_notes_keep_history();

revoke all on public.shift_note_history from anon, authenticated;
grant select on public.shift_note_history to authenticated;

commit;
