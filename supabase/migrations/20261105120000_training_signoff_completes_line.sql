-- Wave 4B (simulation retest batches 307-310): a DSP initialing their OWN
-- training line saved the sign-off (hours counted) but the line stayed
-- "pending".
--
-- Cause: the app writes the sign-off, then flips training_requirements.status
-- to 'complete' with a plain UPDATE. training_requirements_update (split out
-- of training_requirements_write in 20260913191500) only admits manager roles,
-- so for a DSP that UPDATE matches zero rows and PostgREST returns success.
-- The line read Pending and its e-initials seal (which signs resolvedStatus
-- 'complete') read invalid.
--
-- Part 1 (record repair): a saved, non-N/A sign-off completes its line's
-- STATUS COLUMN. A trigger on training_signoffs marks its requirement
-- complete (security definer, so the trainee's own insert/update completes
-- their own line without widening the requirements UPDATE policy: who may
-- write a sign-off is still decided by the training_signoffs insert/update
-- policies). Existing rows stranded by the bug are backfilled. Waived lines
-- are never touched.
--
-- Part 2 (PR #259 review HOLD): the status column is NOT authorization.
-- The owner's e-initials stamp lands AFTER the sign-off write — or never: a
-- manager save deliberately leaves the line unstamped ("Needs
-- re-initialing"), and a failed / timed-out stamp or a dropped connection
-- leaves the same state. Every server-side clearance decision therefore
-- counts a line as done only when:
--   * it is waived N/A (status 'waived_na'), or
--   * its non-N/A sign-off carries a signature_events row written by the
--     line's OWNER, kind 'initials', on the sheet `staff:<user>:<site>`,
--     for the sign-off's CURRENT version (field
--     `line:<requirement_id>:v<signoff_version>`). A correction edit bumps
--     signoff_version, so the old version's stamp stops counting until the
--     owner re-initials.
-- private.training_line_initialed is that rule; private.med_admin_cleared is
-- recreated below on it (unchanged otherwise from 20261031240000), and the
-- apply-signature edge function's staff_sign / hm_countersign open-line
-- count applies the same rule (supabase/functions/apply-signature/
-- trainingLines.ts). Signature events are written only by apply-signature
-- (service role), after its owner, version and password checks.

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

-- ---------------------------------------------------------------------------
-- The clearance rule for one line: a non-N/A sign-off whose CURRENT version
-- the line's owner has e-initialed.
-- ---------------------------------------------------------------------------
create or replace function private.training_line_initialed(p_requirement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.training_requirements r
    join public.training_signoffs s
      on s.requirement_id = r.id
     and not s.na
    join public.signature_events e
      on e.document_type = 'training_checklist'
     and e.document_id = 'staff:' || r.user_id::text || ':' || coalesce(r.site_id::text, '')
     and e.field_name = 'line:' || r.id::text || ':v' || s.signoff_version::text
     and e.kind = 'initials'
     and e.signer_user_id = r.user_id
    where r.id = p_requirement_id
  );
$$;

revoke all on function private.training_line_initialed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.med_admin_cleared: 20261031240000's computation, with line
-- resolution and hours tied to the owner's e-initials (above):
--   * waived_na                         -> resolved (no stamp needed);
--   * initialed at the current version  -> complete;
--   * anything else (including a status column that already reads
--     'complete' with no current stamp) -> overdue when its due date has
--     passed, otherwise pending — either blocks clearance;
--   * hours count only from initialed lines.
-- Requirement count, the 20 / 8 hour floors and the per-site
-- countersignature check are unchanged; grants are unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.med_admin_cleared(p_agency_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with reqs as (
    select r.id, r.site_id,
      case
        when r.status = 'waived_na' then 'waived_na'
        when private.training_line_initialed(r.id) then 'complete'
        when r.status = 'overdue' or r.due_on < current_date then 'overdue'
        else 'pending'
      end as resolved_status
    from public.training_requirements r
    where r.agency_id = p_agency_id and r.user_id = p_user_id
  ),
  hours as (
    select coalesce(sum(greatest(s.hours_total, 0)), 0) as total,
           coalesce(sum(greatest(s.hours_with_hm, 0)), 0) as with_hm
    from reqs q
    join public.training_signoffs s on s.requirement_id = q.id
    where not s.na
      and q.resolved_status = 'complete'
  ),
  sites as (select distinct site_id from reqs where site_id is not null)
  select
    (select count(*) from reqs) > 0
    and (select total from hours) >= 20
    and (select with_hm from hours) >= 8
    and not exists (select 1 from reqs where resolved_status = 'overdue')
    and not exists (
      select 1 from reqs
      where resolved_status not in ('complete', 'waived_na', 'overdue')
    )
    and exists (select 1 from sites)
    and not exists (
      select 1 from sites st
      where not exists (
        select 1 from public.training_countersignatures c
        where c.agency_id = p_agency_id
          and c.user_id = p_user_id
          and c.site_id = st.site_id
          and c.staff_signed_at is not null
          and c.hm_signed_at is not null
      )
    );
$$;

grant execute on function private.med_admin_cleared(uuid, uuid) to authenticated;
