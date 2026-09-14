-- One drill per site per day: fire drills cannot share a day with any other drill.
-- Trigger-based (not a unique index) so pre-existing conflicting rows are left
-- untouched; only new/changed writes are blocked.

create or replace function public.prevent_same_day_drills()
returns trigger
language plpgsql
as $$
declare
  clash_type text;
begin
  if new.date is null then
    return new;
  end if;
  select drill_type into clash_type
  from public.emergency_drills
  where site_id = new.site_id
    and date = new.date
    and id <> new.id
  limit 1;
  if found then
    raise exception
      'A % drill is already recorded on % at this home. Only one drill per day is allowed -- fire drills can''t share a day with any other drill. Please choose a different date.',
      case clash_type
        when 'fire' then 'Fire'
        when 'tornado' then 'Tornado'
        when 'earthquake' then 'Earthquake'
        when 'severe_weather' then 'Severe weather'
        when 'intruder' then 'Intruder / threatening situation'
        when 'missing_person' then 'Missing person'
        when 'medical_emergency' then 'Medical emergency'
        else clash_type
      end,
      new.date::text;
  end if;
  return new;
end;
$$;

drop trigger if exists emergency_drills_same_day_guard on public.emergency_drills;
create trigger emergency_drills_same_day_guard
  before insert or update of site_id, date on public.emergency_drills
  for each row execute function public.prevent_same_day_drills();
