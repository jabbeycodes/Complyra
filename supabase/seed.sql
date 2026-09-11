-- Fictional Evergreen Care tenant for local development only.
-- Staff/auth users are created by the application seed in local mode, or in Studio for hosted Supabase.
-- Do not replace this with real individual or employee records.

insert into public.agencies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Evergreen Care')
on conflict (id) do nothing;

insert into public.programs (id, agency_id, name)
values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Residential services'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Supported living')
on conflict (id) do nothing;
