-- Simulation med cluster (batches 7/9/10/11, 2026-10-31): count variance
-- evidence, PRN dose audit fields, and Late MAR marks.
--
-- 1. WRONG-COUNT VARIANCE (batch 10): a med count recorded through
--    record_medication_delivery could silently overwrite the book figure
--    (expected 30, entered 28, stock simply became 28). The delivery row
--    now stores the countdown-expected figure and the variance note, and
--    the RPC refuses a mismatching count that carries no note.
-- 2. PRN AUDIT RECORD (batch 11): a PRN dose saved with no reason, no
--    follow-up, and no per-dose record beyond a counter. prn_dose_logs
--    gains the reason (required) and an optional follow-up note, and
--    record_prn_dose demands the reason and words its over-stock error
--    for the caller's role (a DSP cannot reconcile a count; the message
--    names who can).
-- 3. LATE MAR (batch 7): med_dose_marks gains the Late stamp + reason
--    for marks recorded after the dose window ended. The APIs compute
--    lateness (agency window, Central clock) and write these columns;
--    they are nullable/defaulted so existing rows and writers are safe.

alter table public.medication_deliveries
  add column if not exists expected_pills numeric,
  add column if not exists variance_reason text;

alter table public.prn_dose_logs
  add column if not exists reason text,
  add column if not exists follow_up text;

alter table public.med_dose_marks
  add column if not exists late boolean not null default false,
  add column if not exists late_reason text;

-- The 4-argument delivery RPC is replaced by a 6-argument version that
-- carries the expected figure + variance note; drop the old signature so
-- PostgREST never sees an ambiguous overload.
drop function if exists public.record_medication_delivery(uuid, numeric, numeric, date);

create or replace function public.record_medication_delivery(p_medication_id uuid, p_remaining numeric, p_daily numeric, p_counted_on date, p_expected numeric default null, p_variance_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; daily numeric; note text := nullif(btrim(coalesce(p_variance_reason, '')), '');
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse']) then
    raise exception 'Medication not found or count access denied.';
  end if;
  if p_remaining is null or p_remaining::text in ('NaN','Infinity','-Infinity') or p_remaining < 0 or p_counted_on is null then
    raise exception 'Enter a valid count and date.';
  end if;
  if p_expected is not null and p_remaining <> p_expected and note is null then
    raise exception 'The count differs from the expected % pills on hand. Add a note explaining the variance.', p_expected;
  end if;
  daily := case when m.kind = 'prn' then 0 else p_daily end;
  if m.kind = 'scheduled' and (daily is null or daily::text in ('NaN','Infinity','-Infinity') or daily <= 0) then
    raise exception 'Set pills per day for a scheduled medication.';
  end if;
  update medications set remaining_pills = p_remaining, pills_per_day = daily, last_delivery_on = p_counted_on, last_countdown_on = p_counted_on where id = m.id;
  insert into medication_deliveries(agency_id, medication_id, counted_on, remaining_pills, pills_per_day, recorded_by, expected_pills, variance_reason)
    values(m.agency_id, m.id, p_counted_on, p_remaining, daily, auth.uid(), p_expected,
      case when p_expected is not null and p_remaining <> p_expected then note else null end);
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.delivery', 'medication', m.id,
      'Recorded count: ' || p_remaining::text ||
      case when p_expected is not null and p_remaining <> p_expected
        then ' (expected ' || p_expected::text || ' — variance: ' || note || ')' else '' end);
end $$;

revoke all on function public.record_medication_delivery(uuid, numeric, numeric, date, numeric, text) from public, anon;
grant execute on function public.record_medication_delivery(uuid, numeric, numeric, date, numeric, text) to authenticated;

-- Same replacement pattern for the PRN dose RPC: reason becomes a
-- required argument, follow-up optional; the old 2-argument signature
-- is dropped.
drop function if exists public.record_prn_dose(uuid, numeric);

create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric, p_reason text, p_follow_up text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text; why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
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
