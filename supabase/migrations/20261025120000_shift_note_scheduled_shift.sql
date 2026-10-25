-- A Shift note can point at the staff shift it documents.
-- When that shift moves, the note still covers the block the shift now overlaps.
-- Houses with no published shift keep the assigned-DSP check.

alter table public.shift_notes
  add column if not exists hr_shift_id uuid references public.hr_shifts (id) on delete set null;

create index if not exists shift_notes_hr_shift_idx
  on public.shift_notes (hr_shift_id)
  where hr_shift_id is not null and deleted_at is null;

-- A schedule change stops a missing-note reminder for a shift that is no longer owed.
-- Only people whose house was just checked can be cleared, so a partial load cannot
-- mark another house's real gap as read.
create or replace function public.retire_stale_missing_note_notices(
  p_agency_id uuid,
  p_service_date date,
  p_individual_ids uuid[],
  p_live_ids text[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if auth.uid() is null or not private.has_agency(p_agency_id) then
      raise exception 'Not allowed';
    end if;
    if not exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= current_date)
        and coalesce(m.role_key, m.role::text) in (
          'administrator', 'program_manager', 'house_manager', 'nurse', 'dsp'
        )
    ) then
      raise exception 'Not allowed';
    end if;
  end if;

  update public.notifications n
  set read_at = now()
  where n.agency_id = p_agency_id
    and n.type = 'documentation.missing_note'
    and n.read_at is null
    and n.dedupe_key like 'documentation.missing_note:sn:' || to_char(p_service_date, 'YYYY-MM-DD') || ':%'
    and exists (
      select 1
      from unnest(coalesce(p_individual_ids, array[]::uuid[])) as person(id)
      where n.dedupe_key like
        'documentation.missing_note:sn:'
        || to_char(p_service_date, 'YYYY-MM-DD')
        || ':'
        || person.id::text
        || ':%'
    )
    and not exists (
      select 1
      from unnest(coalesce(p_live_ids, array[]::text[])) as live(id)
      where n.dedupe_key like 'documentation.missing_note:' || live.id || ':%'
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

comment on function public.retire_stale_missing_note_notices(uuid, date, uuid[], text[]) is
  'Marks missing-note notices read when that person and date were checked and the shift is no longer owed.';

revoke all on function public.retire_stale_missing_note_notices(uuid, date, uuid[], text[]) from public;
grant execute on function public.retire_stale_missing_note_notices(uuid, date, uuid[], text[]) to authenticated, service_role;
