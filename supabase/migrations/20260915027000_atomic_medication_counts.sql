-- Each count change and its evidence log commit together. Row locks prevent
-- two staff recording simultaneous PRN doses from overwriting each other.
create or replace function public.record_medication_delivery(p_medication_id uuid, p_remaining numeric, p_daily numeric, p_counted_on date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; daily numeric;
begin
  select * into m from medications where id=p_medication_id for update;
  if m.id is null or not private.can_read_individual(m.agency_id,m.individual_id)
    or not private.role_key_in(m.agency_id,array['administrator','house_manager','degreed_professional_manager','nurse']) then
    raise exception 'Medication not found or count access denied.';
  end if;
  if p_remaining is null or p_remaining::text in ('NaN','Infinity','-Infinity') or p_remaining<0 or p_counted_on is null then
    raise exception 'Enter a valid count and date.';
  end if;
  daily := case when m.kind='prn' then 0 else p_daily end;
  if m.kind='scheduled' and (daily is null or daily::text in ('NaN','Infinity','-Infinity') or daily<=0) then
    raise exception 'Set pills per day for a scheduled medication.';
  end if;
  update medications set remaining_pills=p_remaining,pills_per_day=daily,last_delivery_on=p_counted_on,last_countdown_on=p_counted_on where id=m.id;
  insert into medication_deliveries(agency_id,medication_id,counted_on,remaining_pills,pills_per_day,recorded_by)
    values(m.agency_id,m.id,p_counted_on,p_remaining,daily,auth.uid());
  insert into audit_events(agency_id,actor_id,action,target_type,target_id,detail)
    values(m.agency_id,auth.uid(),'medication.delivery','medication',m.id,'Recorded count: ' || p_remaining::text);
end $$;

create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text;
begin
  select * into m from medications where id=p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id,m.individual_id)
    or not private.role_key_in(m.agency_id,array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
  end if;
  if p_pills is null or p_pills::text in ('NaN','Infinity','-Infinity') or p_pills<=0 then
    raise exception 'Enter how many pills were given.';
  end if;
  if p_pills > m.remaining_pills then
    raise exception 'The dose exceeds the recorded stock. Reconcile the count first.';
  end if;
  remaining := m.remaining_pills-p_pills;
  select full_name into staff_name from profiles where id=auth.uid();
  update medications set remaining_pills=remaining where id=m.id;
  insert into prn_dose_logs(agency_id,medication_id,logged_on,pills_used,remaining_after,logged_by,logged_by_user_id)
    values(m.agency_id,m.id,current_date,p_pills,remaining,coalesce(staff_name,''),auth.uid());
  insert into audit_events(agency_id,actor_id,action,target_type,target_id,detail)
    values(m.agency_id,auth.uid(),'medication.prn','medication',m.id,'Recorded PRN dose: ' || p_pills::text);
end $$;
revoke all on function public.record_medication_delivery(uuid,numeric,numeric,date) from public,anon;
revoke all on function public.record_prn_dose(uuid,numeric) from public,anon;
grant execute on function public.record_medication_delivery(uuid,numeric,numeric,date) to authenticated;
grant execute on function public.record_prn_dose(uuid,numeric) to authenticated;

create policy medication_deliveries_parent_scope on medication_deliveries as restrictive for all to authenticated
using (exists(select 1 from medications m where m.id=medication_id and private.can_read_individual(m.agency_id,m.individual_id)))
with check (exists(select 1 from medications m where m.id=medication_id and private.can_read_individual(m.agency_id,m.individual_id)));
create policy prn_logs_parent_scope on prn_dose_logs as restrictive for all to authenticated
using (exists(select 1 from medications m where m.id=medication_id and private.can_read_individual(m.agency_id,m.individual_id)))
with check (exists(select 1 from medications m where m.id=medication_id and private.can_read_individual(m.agency_id,m.individual_id)));
-- DSPs use the validated dose transaction; direct stock/identity edits are not allowed.
create policy medications_dsp_insert on medications as restrictive for insert to authenticated with check(not private.role_key_in(agency_id,array['dsp']));
create policy medications_dsp_update on medications as restrictive for update to authenticated using(not private.role_key_in(agency_id,array['dsp']));
create policy medications_dsp_delete on medications as restrictive for delete to authenticated using(not private.role_key_in(agency_id,array['dsp']));
