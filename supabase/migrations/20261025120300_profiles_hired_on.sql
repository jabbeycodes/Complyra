-- Command Center derives CPI/PBS certificate due dates from each staff member's
-- hire date, but public.profiles never carried one, so hosted loadWorkspace could
-- only report hiredOn as null and those gaps stayed hidden on Complyra.
-- Add the column, backfill existing rows from the profile's creation day (the same
-- "hired = created" default the demo store uses), and default new rows to today so
-- the handle_new_user trigger keeps populating it.

alter table public.profiles
  add column if not exists hired_on date;

update public.profiles
  set hired_on = created_at::date
  where hired_on is null;

alter table public.profiles
  alter column hired_on set default current_date;
