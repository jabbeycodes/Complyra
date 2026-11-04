-- Medication-administration clearance gate (simulation batches 40 + 50,
-- 2026-10-31): a brand-new hire whose Training status is NOT CLEARED
-- (0 of 20 required hours, New Hire Binder at 3%) could open a medication
-- chart and RECORD doses — Record follow-up and Log dose exception were
-- enabled and dose recording was blocked nowhere. Medication
-- administration is the highest-risk action in the app, so it is now
-- gated by the SAME clearance computation that renders the NOT CLEARED
-- state: evaluateInRatioGate (src/features/training/gate.ts) over a staff
-- member's training record, surfaced as
-- getStaffTrainingProfile().clearedForInRatio in both APIs:
--
--   * at least one training requirement exists (no record = not cleared);
--   * signed-off (non-N/A) hours total >= 20, with >= 8 hours with the
--     house manager (per-line hours floored at 0, as in sumHours);
--   * every requirement resolves complete or waived N/A — a line whose
--     due date has passed resolves overdue, anything else unresolved is
--     pending, and either blocks clearance;
--   * every site named on the requirements has a countersignature row
--     carrying BOTH the staff signature and the HM countersignature.
--
-- private.med_admin_cleared below is that computation in SQL (the
-- resolved-status "today" is current_date, the database session date,
-- where the clients use the UTC date — the same boundary in practice).
-- The gate applies to role `dsp` only. Oversight roles (administrator,
-- house_manager, program_manager, nurse, compliance_admin) are never
-- subject to the new-hire clearance state, matching the API-layer gate
-- (src/data/medClearance.ts) and the existing role checks, which keep
-- precedence.
--
-- Gated here (the write paths a direct client can reach):
--   * public.record_prn_dose(uuid, numeric, text, text) — recreated
--     verbatim from 20261031180000 with the clearance check added after
--     the existing access check. The service_role-only 2-argument legacy
--     overload is NOT touched: no end-user role can execute it.
--   * med_dose_marks INSERT and UPDATE policies (scheduled dose marks,
--     including DSP corrections of their own marks).
--   * med_dose_exceptions INSERT policy (dose exceptions).
--
-- Deliberately NOT gated:
--   * record_medication_delivery / med counts — counting is a supervised
--     inventory task; the delivery RPC's own role list (administrator,
--     house_manager, degreed_professional_manager, nurse) already
--     excludes DSPs.
--   * PRN follow-up recording — it appends an audit event through the
--     client APIs only; there is no RPC or direct table write for it,
--     so the API-layer gate is the enforcement of record there.
--   * All reads.

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
        when r.status in ('complete', 'waived_na') then r.status
        when r.status = 'overdue' or r.due_on < current_date then 'overdue'
        else r.status
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

-- ---------------------------------------------------------------------------
-- PRN dose RPC: 20261031180000 verbatim, plus the clearance check for DSP
-- callers immediately after the existing access check (the same order the
-- APIs enforce: role check first, clearance second).
-- ---------------------------------------------------------------------------
create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric, p_reason text, p_follow_up text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text; why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
  end if;
  if private.role_key_in(m.agency_id, array['dsp'])
    and not private.med_admin_cleared(m.agency_id, auth.uid()) then
    raise exception 'Medication actions unlock when your training is cleared.';
  end if;
  if why is null then
    raise exception 'Say why the PRN was given.';
  end if;
  if p_pills is null or p_pills::text in ('NaN','Infinity','-Infinity') or p_pills <= 0 then
    raise exception 'Enter how many pills were given.';
  end if;
  if p_pills > m.remaining_pills then
    if m.last_delivery_on is null and not exists (select 1 from medication_deliveries d where d.medication_id = m.id) then
      if private.role_key_in(m.agency_id, array['dsp']) then
        raise exception 'No count has been recorded for this medication yet. Ask your house manager, RN, or PM to record the first count.';
      end if;
      raise exception 'No count has been recorded for this medication yet. Record the first count before logging a dose.';
    end if;
    if private.role_key_in(m.agency_id, array['dsp']) then
      raise exception 'The dose exceeds the recorded stock. Ask your house manager, RN, or PM to record the count first.';
    end if;
    raise exception 'The dose exceeds the recorded stock. Reconcile the count first.';
  end if;
  remaining := m.remaining_pills - p_pills;
  select full_name into staff_name from profiles where id = auth.uid();
  update medications set remaining_pills = remaining where id = m.id;
  insert into prn_dose_logs(agency_id, medication_id, logged_on, pills_used, remaining_after, logged_by, logged_by_user_id, reason, follow_up)
    values(m.agency_id, m.id, current_date, p_pills, remaining, coalesce(staff_name, ''), auth.uid(), why, nullif(btrim(coalesce(p_follow_up, '')), ''));
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.prn', 'medication', m.id, 'Recorded PRN dose: ' || p_pills::text || ' — ' || why);
end $$;

revoke all on function public.record_prn_dose(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_prn_dose(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled dose marks: a DSP may insert a mark, or correct their own
-- mark, only when cleared. Oversight branches are unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists med_dose_marks_insert on public.med_dose_marks;
create policy med_dose_marks_insert on public.med_dose_marks
for insert to authenticated
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
  and (
    not (select private.role_key_in(agency_id, '{dsp}'))
    or (select private.med_admin_cleared(agency_id, (select auth.uid())))
  )
);

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
      and (select private.med_admin_cleared(agency_id, (select auth.uid())))
    )
  )
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
  and (
    not (select private.role_key_in(agency_id, '{dsp}'))
    or (select private.med_admin_cleared(agency_id, (select auth.uid())))
  )
);

-- ---------------------------------------------------------------------------
-- Dose exceptions: same DSP clearance condition on insert.
-- ---------------------------------------------------------------------------
drop policy if exists med_dose_exceptions_insert on public.med_dose_exceptions;
create policy med_dose_exceptions_insert on public.med_dose_exceptions
for insert to authenticated
with check (
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}'))
  and (
    not (select private.role_key_in(agency_id, '{dsp}'))
    or (select private.med_admin_cleared(agency_id, (select auth.uid())))
  )
);
