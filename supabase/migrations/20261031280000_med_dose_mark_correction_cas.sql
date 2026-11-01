-- Wave 7M fix-up (PR #228 reviewer HOLD): atomic compare-and-set for MAR
-- corrections.
--
-- The original wave-7M correction path compared baseMarkedAt in the
-- browser (read the stored mark, check equality, then upsert). Two
-- authorized correctors who both loaded the same mark could both pass
-- the equality check, and the second upsert silently overwrote the
-- first correction — exactly the silent-overwrite the wave set out to
-- remove.
--
-- This RPC moves the compare into the UPDATE statement itself: the
-- stored marked_at must still equal the caller's base in the same
-- statement that writes, under the row lock, so exactly one corrector
-- wins. marked_at is a sound version token because the
-- med_dose_marks_identity_guard trigger re-stamps it (now()) on every
-- write and archives the prior version into med_dose_mark_history. The
-- loser updates zero rows and gets DOSE_MARK_CONFLICT (errcode P0001);
-- the client maps that to the standard "Already given by …" refusal,
-- naming the mark that won the race.
--
-- Security invoker: the UPDATE stays subject to the caller's RLS
-- policies on med_dose_marks (med_dose_marks_update — can_read_individual
-- plus the marker role set), so the RPC grants no write reach the
-- corrector does not already have. The app-layer rules are unchanged
-- and still run first: only a deliberate correction (base = the mark
-- the caller saw) reaches this RPC, and canCorrectDoseMark decides who
-- may correct.
create function public.correct_med_dose_mark(
  p_mark_id uuid,
  p_base_marked_at timestamptz,
  p_status text,
  p_late boolean,
  p_late_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.med_dose_marks
     set status = p_status,
         late = p_late,
         late_reason = p_late_reason
   where id = p_mark_id
     and marked_at = p_base_marked_at;

  if not found then
    raise exception 'DOSE_MARK_CONFLICT'
      using errcode = 'P0001',
            detail = 'The MAR entry changed after it was loaded; reload before correcting.';
  end if;
end;
$$;

grant execute on function public.correct_med_dose_mark(uuid, timestamptz, text, boolean, text) to authenticated;
