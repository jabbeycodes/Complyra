begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Staff scope repair (20261031160000):
--  * a DSP works at the home site named on their membership, even with
--    zero staff_assignments rows (the invite flow creates none in the
--    hosted path beyond the new explicit site assignment);
--  * a nurse / house_manager whose membership site_id is NULL
--    ("Agency-wide" at invite) can read every site in the agency;
--  * a DSP with a NULL membership site is NOT agency-wide.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a1000000-0000-0000-0000-000000000001','Scope agency','SCOPEA-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Home A'),
 ('c1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d1000000-0000-0000-0000-000000000001','scope-dsp-home@example.invalid'),
 ('d1000000-0000-0000-0000-000000000002','scope-dsp-assign@example.invalid'),
 ('d1000000-0000-0000-0000-000000000003','scope-dsp-none@example.invalid'),
 ('d1000000-0000-0000-0000-000000000004','scope-nurse-wide@example.invalid'),
 ('d1000000-0000-0000-0000-000000000005','scope-nurse-single@example.invalid'),
 ('d1000000-0000-0000-0000-000000000006','scope-hm-wide@example.invalid'),
 ('d1000000-0000-0000-0000-000000000007','scope-hm-single@example.invalid');
update profiles set must_change_password=false
 where id::text like 'd1000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','dsp','dsp','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','dsp','dsp','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000003','dsp','dsp',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000004','nurse','nurse',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000005','nurse','nurse','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000006','manager','house_manager',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000007','manager','house_manager','c1000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Home A one','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Home A two','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','Home B person','1980-01-01');
-- Only ONE assignment in the whole fixture: dsp-assign -> the Home B person.
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002');

set local role authenticated;

-- DSP whose membership names Home A, with NO staff_assignments rows.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000001"}',true);
select ok(private.dsp_works_at_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'DSP works at their membership home site without any assignment');
select ok(not private.dsp_works_at_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'DSP does not work at the other site on membership scope alone');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'DSP reads an Individual at their membership home');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'DSP cannot read an Individual at the other site');
select is((select count(*)::int from individuals),2,
  'RLS: DSP with a membership home and no assignments reads exactly their home');

-- DSP with a membership home AND an assignment to an Individual elsewhere.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000002"}',true);
select ok(private.dsp_works_at_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'DSP works at a site via an Individual assignment there');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'DSP reads the assigned Individual at the other site');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'DSP still reads their membership home');

-- DSP with a NULL membership site and no assignments: NOT agency-wide.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000003"}',true);
select ok(not private.dsp_works_at_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'DSP with no home and no assignment works nowhere');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'DSP with no home and no assignment reads nobody');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'DSP null-site membership is not agency-wide site access');

-- Nurse with a NULL membership site: agency-wide coverage.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000004"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Agency-wide nurse can read Home A');
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Agency-wide nurse can read Home B');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'Agency-wide nurse reads a Home A Individual');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Agency-wide nurse reads a Home B Individual');
select is((select count(*)::int from individuals),3,
  'RLS: agency-wide nurse reads every Individual in the agency');

-- Nurse assigned to Home A only.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000005"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Single-site nurse can read her home');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Single-site nurse cannot read the other site');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Single-site nurse cannot read the other site''s Individual');

-- House manager with a NULL membership site: agency-wide coverage.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000006"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Agency-wide house manager can read Home A');
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Agency-wide house manager can read Home B');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Agency-wide house manager reads a Home B Individual');

-- House manager assigned to Home A only.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000007"}',true);
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Single-site house manager cannot read the other site');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Single-site house manager cannot read the other site''s Individual');

select * from finish();
rollback;
