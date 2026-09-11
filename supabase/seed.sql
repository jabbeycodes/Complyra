-- Fictional Evergreen Care tenant for local development only.
-- Staff Auth users are created by scripts/seed-evergreen.ts for hosted projects.
-- Do not replace this with real individual or employee records.

insert into public.agencies (id, name, agency_code)
values (
  '00000000-0000-4000-8000-000000000001',
  'Evergreen Care',
  'EVERGREEN'
)
on conflict (id) do update
  set name = excluded.name,
      agency_code = excluded.agency_code;

insert into public.programs (id, agency_id, name)
values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Residential services'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Supported living')
on conflict (id) do nothing;
