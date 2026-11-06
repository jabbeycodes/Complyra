-- Wave 4B (simulation retest batches 307-310): a DSP initialing their OWN
-- training line saved the sign-off (hours counted) but the line stayed
-- "pending".
--
-- Cause: the app writes the sign-off, then flips training_requirements.status
-- to 'complete' with a plain UPDATE. training_requirements_update (split out
-- of training_requirements_write in 20260913191500) only admits manager roles,
-- so for a DSP that UPDATE matches zero rows and PostgREST returns success.
-- The line read Pending, its e-initials seal (which signs resolvedStatus
-- 'complete') read invalid, and every server-side reader of the status
-- column, including private.med_admin_cleared and the staff_sign open-line
-- count in apply-signature, kept counting it as open.
--
-- Fix: a saved, non-N/A sign-off IS the completion record. A trigger on
-- training_signoffs marks its requirement complete (security definer, so the
-- trainee's own insert/update completes their own line without widening the
-- requirements UPDATE policy: who may write a sign-off is still decided by
-- the training_signoffs insert/update policies). Existing rows stranded by
-- the bug are backfilled. Waived lines are never touched.

create or replace function private.training_signoff_completes_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.na is false then
    update public.training_requirements
       set status = 'complete'
     where id = new.requirement_id
       and status not in ('complete', 'waived_na');
  end if;
  return new;
end;
$$;

revoke all on function private.training_signoff_completes_line() from public, anon, authenticated;

drop trigger if exists training_signoffs_complete_line on public.training_signoffs;
create trigger training_signoffs_complete_line
  after insert or update of na, signoff_version on public.training_signoffs
  for each row execute function private.training_signoff_completes_line();

-- Backfill: lines that already carry a non-N/A sign-off but were left open.
update public.training_requirements r
   set status = 'complete'
  from public.training_signoffs s
 where s.requirement_id = r.id
   and s.na is false
   and r.status not in ('complete', 'waived_na');
