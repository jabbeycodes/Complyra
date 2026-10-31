-- Simulation med cluster (batches 7/9/10/11, 2026-10-31): count variance
-- evidence, PRN dose audit fields, and Late MAR marks.
--
-- 1. WRONG-COUNT VARIANCE (batch 10): a med count recorded through
--    record_medication_delivery could silently overwrite the book figure
--    (expected 30, entered 28, stock simply became 28). The delivery row
--    now stores the countdown-expected figure and the variance note, and
--    the RPC refuses a mismatching count that carries no note.
--    Reviewer HOLD fix-up (2026-10-31): the expected figure is computed
--    INSIDE the RPC from the persisted baseline (newest delivery/count
--    row, or the medication row's maintained count) minus the persisted
--    administrations / PRN doses / dose exceptions since it — the same
--    definition the clients render (expectedCountNow). The caller's
--    p_expected is advisory only: a supplied figure that disagrees with
--    the server's is rejected outright, and the persisted expected_pills
--    is always the server-computed value.
-- 2. PRN AUDIT RECORD (batch 11): a PRN dose saved with no reason, no
--    follow-up, and no per-dose record beyond a counter. prn_dose_logs
--    gains the reason (required) and an optional follow-up note, and
--    record_prn_dose demands the reason and words its over-stock error
--    for the caller's role (a DSP cannot reconcile a count; the message
--    names who can).
--    CI fix-up (2026-10-31): the reason rule lives on a NEW 4-argument
--    signature; the original 2-argument signature is kept alongside it
--    as a legacy overload (see the bottom of this file). Dropping the
--    2-argument form broke every pre-existing caller of it (the
--    audit_workflows pgTAP suite failed with "function
--    record_prn_dose(unknown, integer) does not exist"), and giving
--    p_reason a default instead would have let the new function be
--    called with no reason at all — so the two signatures coexist:
--    overload resolution is unambiguous because the 4-argument form
--    requires at least 3 arguments (p_reason has no default).
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
-- PostgREST never sees an ambiguous overload. The 6-argument version
-- computes the authoritative expected figure server-side (below) and
-- treats the caller's p_expected as advisory only.
drop function if exists public.record_medication_delivery(uuid, numeric, numeric, date);

create or replace function public.record_medication_delivery(p_medication_id uuid, p_remaining numeric, p_daily numeric, p_counted_on date, p_expected numeric default null, p_variance_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m medications%rowtype;
  daily numeric;
  note text := nullif(btrim(coalesce(p_variance_reason, '')), '');
  base medication_deliveries%rowtype;
  utc_today date := (now() at time zone 'UTC')::date;
  expected numeric := null;
  expected_label text;
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse']) then
    raise exception 'Medication not found or count access denied.';
  end if;
  if p_remaining is null or p_remaining::text in ('NaN','Infinity','-Infinity') or p_remaining < 0 or p_counted_on is null then
    raise exception 'Enter a valid count and date.';
  end if;

  -- SERVER-AUTHORITATIVE EXPECTED COUNT. Computed here from persisted
  -- records only; the caller's p_expected is never trusted (see the
  -- stale/spoofed-expectation rejection below). Mirrors the countdown
  -- the clients render (expectedCountNow -> medCountdown /
  -- projectMedInventory), whose "today" is the UTC date (todayIso):
  --   * Baseline: the newest delivery/count row (counted_on desc, then
  --     created_at desc). With no delivery row, the medication row's
  --     maintained count (dated by last_delivery_on) is the baseline;
  --     with neither, the med was never counted and expected stays null.
  --   * Scheduled, delivery baseline: baseline pills minus one dose's
  --     pills (the baseline row's pills_per_day over the med's recorded
  --     dose times) for every Given MAR mark whose scheduled Central
  --     moment (dose_date + dose_time in America/Chicago) is strictly
  --     after the moment the baseline was recorded and whose date is
  --     not in the future, minus Wasted exception pills recorded after
  --     the baseline. Missed/LOA/on-hold marks and Refused/Held
  --     exceptions never move the count.
  --   * PRN: the projection's current count — baseline pills minus PRN
  --     doses and dose exceptions of every kind dated inside
  --     [baseline date, today]. A baseline with no dose logs at all
  --     falls back to the medication row's lower maintained count (a
  --     direct count correction), exactly as the projection does.
  --   * Scheduled, maintained count: the row's count as-is — both
  --     backends already net recorded doses into it.
  -- The result is rounded to hundredths and floored at zero, as in the
  -- client definition.
  select * into base from medication_deliveries
    where medication_id = m.id
    order by counted_on desc, created_at desc, id desc
    limit 1;
  if base.id is not null then
    if m.kind = 'prn' then
      expected := greatest(0, round((
        case when not exists (select 1 from prn_dose_logs where medication_id = m.id)
               and m.remaining_pills < base.remaining_pills
             then m.remaining_pills else base.remaining_pills end
        - coalesce((select sum(pills_used) from prn_dose_logs
                     where medication_id = m.id and pills_used > 0
                       and logged_on >= base.counted_on and logged_on <= utc_today), 0)
        - coalesce((select sum(pills_affected) from med_dose_exceptions
                     where medication_id = m.id and pills_affected > 0
                       and occurred_on >= base.counted_on and occurred_on <= utc_today), 0)
      ) * 100) / 100);
    else
      expected := greatest(0, round((
        base.remaining_pills
        - (select count(*) from med_dose_marks
            where medication_id = m.id and status = 'given'
              and dose_date <= utc_today
              and (dose_date + dose_time::time) at time zone 'America/Chicago' > base.created_at)
          * (base.pills_per_day / greatest(1, coalesce((select cardinality(dose_times) from med_inventory where medication_id = m.id), 0)))
        - coalesce((select sum(pills_affected) from med_dose_exceptions
                     where medication_id = m.id and kind = 'wasted' and pills_affected > 0
                       and created_at > base.created_at), 0)
      ) * 100) / 100);
    end if;
  elsif m.last_delivery_on is not null then
    if m.kind = 'prn' then
      expected := greatest(0, round((
        m.remaining_pills
        - coalesce((select sum(pills_used) from prn_dose_logs
                     where medication_id = m.id and pills_used > 0
                       and logged_on >= m.last_delivery_on and logged_on <= utc_today), 0)
        - coalesce((select sum(pills_affected) from med_dose_exceptions
                     where medication_id = m.id and pills_affected > 0
                       and occurred_on >= m.last_delivery_on and occurred_on <= utc_today), 0)
      ) * 100) / 100);
    else
      expected := greatest(0, round(m.remaining_pills * 100) / 100);
    end if;
  end if;

  if expected is not null then
    expected_label := case when expected = trunc(expected) then trunc(expected)::bigint::text
                           else rtrim(round(expected, 2)::text, '0') end;
    -- A supplied expectation that disagrees with the server's figure
    -- means the caller's snapshot is stale or fabricated. The count is
    -- refused outright — a variance note cannot launder it — so the
    -- caller re-reads the medication and counts against fresh figures.
    if p_expected is not null and round(p_expected * 100) <> round(expected * 100) then
      raise exception 'The expected count changed on the server: % pills on hand are now expected. Review the medication and record the count again.', expected_label;
    end if;
    if round(p_remaining * 100) <> round(expected * 100) and note is null then
      raise exception 'The count differs from the expected % pills on hand. Add a note explaining the variance.', expected_label;
    end if;
  end if;

  daily := case when m.kind = 'prn' then 0 else p_daily end;
  if m.kind = 'scheduled' and (daily is null or daily::text in ('NaN','Infinity','-Infinity') or daily <= 0) then
    raise exception 'Set pills per day for a scheduled medication.';
  end if;
  update medications set remaining_pills = p_remaining, pills_per_day = daily, last_delivery_on = p_counted_on, last_countdown_on = p_counted_on where id = m.id;
  insert into medication_deliveries(agency_id, medication_id, counted_on, remaining_pills, pills_per_day, recorded_by, expected_pills, variance_reason)
    values(m.agency_id, m.id, p_counted_on, p_remaining, daily, auth.uid(), expected,
      case when expected is not null and round(p_remaining * 100) <> round(expected * 100) then note else null end);
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.delivery', 'medication', m.id,
      'Recorded count: ' || p_remaining::text ||
      case when expected is not null and round(p_remaining * 100) <> round(expected * 100)
        then ' (expected ' || expected_label || ' — variance: ' || note || ')' else '' end);
end $$;

revoke all on function public.record_medication_delivery(uuid, numeric, numeric, date, numeric, text) from public, anon;
grant execute on function public.record_medication_delivery(uuid, numeric, numeric, date, numeric, text) to authenticated;

-- The PRN dose RPC gains a new 4-argument signature: reason becomes a
-- required argument, follow-up optional. Unlike the delivery RPC
-- above, the old 2-argument signature is NOT dropped — it is restored
-- verbatim as a legacy overload after the new function (see below),
-- because pre-existing callers invoke the 2-argument form and there is
-- no default that could stand in for a reason without defeating the
-- reason requirement itself.
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

-- LEGACY OVERLOAD (CI fix-up, 2026-10-31): the original 2-argument
-- record_prn_dose from 20260915027000_atomic_medication_counts,
-- restored verbatim so every pre-existing caller of that signature
-- keeps working (the audit_workflows pgTAP suite calls it directly).
-- It predates the PRN audit record, so it stores no reason/follow-up
-- (both columns stay null) and keeps the original generic over-stock
-- wording. The reason requirement applies to the new 4-argument
-- signature only, and that is safe: the shipped app has exactly one
-- RPC caller (HostedApi.logPrnDose), which always invokes the
-- 4-argument form and itself refuses a blank reason before calling —
-- the 2-argument form is not reachable from the shipped UI.
create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text;
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
  end if;
  if p_pills is null or p_pills::text in ('NaN','Infinity','-Infinity') or p_pills <= 0 then
    raise exception 'Enter how many pills were given.';
  end if;
  if p_pills > m.remaining_pills then
    raise exception 'The dose exceeds the recorded stock. Reconcile the count first.';
  end if;
  remaining := m.remaining_pills - p_pills;
  select full_name into staff_name from profiles where id = auth.uid();
  update medications set remaining_pills = remaining where id = m.id;
  insert into prn_dose_logs(agency_id, medication_id, logged_on, pills_used, remaining_after, logged_by, logged_by_user_id)
    values(m.agency_id, m.id, current_date, p_pills, remaining, coalesce(staff_name, ''), auth.uid());
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.prn', 'medication', m.id, 'Recorded PRN dose: ' || p_pills::text);
end $$;

revoke all on function public.record_prn_dose(uuid, numeric) from public, anon;
grant execute on function public.record_prn_dose(uuid, numeric) to authenticated;
