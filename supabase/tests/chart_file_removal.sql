begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Newer storage builds refuse direct SQL deletes from storage.objects unless
-- this setting is on; the RLS policy under test still decides every row.
select set_config('storage.allow_delete_query', 'true', true);

-- Chart-file removal (20261105100000): administrator, program manager, nurse
-- and house manager may delete chart_files rows and care-plan-docs objects;
-- DSPs and auditors may not; storage deletes stay inside the Individual
-- access boundary.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a9100000-0000-0000-0000-000000000001','Chart removal agency','CHARTRM-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','Home A'),
 ('c9100000-0000-0000-0000-000000000002','a9100000-0000-0000-0000-000000000001','b9100000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d9100000-0000-0000-0000-000000000001','rm-admin@example.invalid'),
 ('d9100000-0000-0000-0000-000000000002','rm-pm@example.invalid'),
 ('d9100000-0000-0000-0000-000000000003','rm-rn@example.invalid'),
 ('d9100000-0000-0000-0000-000000000004','rm-hm@example.invalid'),
 ('d9100000-0000-0000-0000-000000000005','rm-dsp@example.invalid'),
 ('d9100000-0000-0000-0000-000000000006','rm-auditor@example.invalid');
update profiles set must_change_password=false,home_agency_id='a9100000-0000-0000-0000-000000000001'
 where id::text like 'd9100000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000003','nurse','nurse','c9100000-0000-0000-0000-000000000001'),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000004','manager','house_manager','c9100000-0000-0000-0000-000000000001'),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000005','dsp','dsp','c9100000-0000-0000-0000-000000000001'),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000006','auditor','auditor',null);
insert into staff_assignments(agency_id,user_id,site_id) values
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000005','c9100000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001','c9100000-0000-0000-0000-000000000001','Home A person','1980-01-01'),
 ('e9100000-0000-0000-0000-000000000002','a9100000-0000-0000-0000-000000000001','c9100000-0000-0000-0000-000000000002','Home B person','1980-01-01');

insert into chart_files(id,agency_id,individual_id,kind,name,storage_path) values
 ('f9100000-0000-0000-0000-000000000001','a9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','renewal','pm.pdf','a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000001/pm.pdf'),
 ('f9100000-0000-0000-0000-000000000002','a9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','renewal','rn.pdf','a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000002/rn.pdf'),
 ('f9100000-0000-0000-0000-000000000003','a9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','renewal','kept.pdf','a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000003/kept.pdf'),
 ('f9100000-0000-0000-0000-000000000004','a9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000002','renewal','home-b.pdf','a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000002/chart/f9100000-0000-0000-0000-000000000004/home-b.pdf');
insert into storage.objects(bucket_id,name)
 select 'care-plan-docs', storage_path from chart_files where id::text like 'f9100000-%';

select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='care_plan_docs_storage_delete' and cmd='DELETE'),
  'care-plan-docs has a storage DELETE policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='chart_files'
  and policyname='chart_files_delete' and cmd='DELETE' and qual like '%program_manager%'),
  'chart_files_delete names program_manager directly');

set local role authenticated;

-- Program manager: write, then remove a chart file and its stored object.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000002"}',true);
select lives_ok($$insert into chart_files(id,agency_id,individual_id,kind,name,storage_path) values
  ('f9100000-0000-0000-0000-000000000005','a9100000-0000-0000-0000-000000000001','e9100000-0000-0000-0000-000000000001','renewal','pm-new.pdf','a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000005/pm-new.pdf')$$,
  'A program manager can file a chart document');
delete from chart_files where id='f9100000-0000-0000-0000-000000000001';
delete from storage.objects where bucket_id='care-plan-docs'
  and name='a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000001/pm.pdf';

-- Nurse at Home A: removes a Home A file and object.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000003"}',true);
delete from chart_files where id='f9100000-0000-0000-0000-000000000002';
delete from storage.objects where bucket_id='care-plan-docs'
  and name like 'a9100000-0000-0000-0000-000000000001/e9100000-0000-0000-0000-000000000001/chart/f9100000-0000-0000-0000-000000000002/%';

-- DSP and auditor: their deletes change nothing.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000005"}',true);
delete from chart_files where id='f9100000-0000-0000-0000-000000000003';
delete from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000003/%';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000006"}',true);
delete from chart_files where id='f9100000-0000-0000-0000-000000000003';
delete from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000003/%';

-- House manager at Home A: cannot remove a Home B stored object.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000004"}',true);
delete from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000004/%';

-- Verification reads run as service_role so row visibility cannot mask a result.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from chart_files where id='f9100000-0000-0000-0000-000000000005'),1,
  'The program manager''s new chart file was saved');
select is((select count(*)::int from chart_files where id='f9100000-0000-0000-0000-000000000001'),0,
  'A program manager removes the chart file record');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000001/%'),0,
  'A program manager removes the stored object');
select is((select count(*)::int from chart_files where id='f9100000-0000-0000-0000-000000000002'),0,
  'A nurse removes the chart file record');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000002/%'),0,
  'A nurse removes the stored object');
select is((select count(*)::int from chart_files where id='f9100000-0000-0000-0000-000000000003'),1,
  'DSP and auditor deletes leave the chart file record');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000003/%'),1,
  'DSP and auditor deletes leave the stored object');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000004/%'),1,
  'A house manager cannot remove another home''s stored object');

-- House manager inside the boundary, then administrator agency-wide.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000004"}',true);
delete from chart_files where id='f9100000-0000-0000-0000-000000000003';
delete from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000003/%';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000001"}',true);
delete from chart_files where id='f9100000-0000-0000-0000-000000000004';
delete from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000004/%';

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from chart_files where id='f9100000-0000-0000-0000-000000000003'),0,
  'A house manager removes a chart file record for their home');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000003/%'),0,
  'A house manager removes a stored object for their home');
select is((select count(*)::int from storage.objects where bucket_id='care-plan-docs' and name like '%/f9100000-0000-0000-0000-000000000004/%'),0,
  'An administrator removes a stored object agency-wide');
select is((select count(*)::int from chart_files where agency_id='a9100000-0000-0000-0000-000000000001'),1,
  'Only the program manager''s new chart file remains');

select * from finish();
rollback;
