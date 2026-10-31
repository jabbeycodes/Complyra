begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(35);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Staff scope repair (20261031160000), corrected design:
--  * a DSP works at the home site named on their membership, even with
--    zero staff_assignments rows (unchanged from the original design);
--  * nurse / house-manager caseloads come from staff_assignments: the
--    widened staff_assignments branch of private.can_read_site;
--  * a nurse or house manager with a NULL membership site and NO
--    assignments reads NOBODY — coverage is never inferred from a NULL
--    membership site. This pins the therap nurse model:
--    can_read_individual staying false for an unassigned nurse is
--    load-bearing for the GER scope guard (therap_core_gaps_rls).

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
 ('d1000000-0000-0000-0000-000000000004','scope-nurse-none@example.invalid'),
 ('d1000000-0000-0000-0000-000000000005','scope-nurse-single@example.invalid'),
 ('d1000000-0000-0000-0000-000000000006','scope-nurse-assign@example.invalid'),
 ('d1000000-0000-0000-0000-000000000007','scope-nurse-wide@example.invalid'),
 ('d1000000-0000-0000-0000-000000000008','scope-hm-assign@example.invalid'),
 ('d1000000-0000-0000-0000-000000000009','scope-hm-single@example.invalid');
update profiles set must_change_password=<redacted>
 where id::text like 'd1000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','dsp','dsp','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','dsp','dsp','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000003','dsp','dsp',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000004','nurse','nurse',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000005','nurse','nurse','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000006','nurse','nurse',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000007','nurse','nurse',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000008','manager','house_manager',null),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000009','manager','house_manager','c1000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Home A one','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Home A two','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','Home B person','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 -- dsp-assign -> the Home B person (the original fixture's one assignment).
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002'),
 -- nurse-assign -> a site assignment at Home A.
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000006',null,'c1000000-0000-0000-0000-000000000001'),
 -- nurse-wide -> site assignments at both homes (the agency-wide invite shape).
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000007',null,'c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000007',null,'c1000000-0000-0000-0000-000000000002'),
 -- hm-assign -> an Individual assignment to the Home B person, no site_id
 -- on the row (exercises the coalesce through the Individual's site).
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000008','e1000000-0000-0000-0000-000000000003',null);

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

-- Nurse with a NULL membership site and NO assignments: reads nobody.
-- This pins the therap model — an unassigned nurse keeps
-- can_read_individual = false even though she reviews agency-wide
-- through the explicit role widenings on the clinical tables.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000004"}',true);
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Unassigned nurse cannot read Home A');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Unassigned nurse cannot read Home B');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'Unassigned nurse reads no Home A Individual');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Unassigned nurse reads no Home B Individual');
select is((select count(*)::int from individuals),0,
  'RLS: unassigned nurse reads zero Individuals');

-- Nurse whose membership names Home A.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000005"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Single-site nurse can read her home');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Single-site nurse cannot read the other site');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Single-site nurse cannot read the other site''s Individual');

-- Nurse with a NULL membership site and a site assignment at Home A.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000006"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Nurse reads the site a site assignment places her at');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Nurse with one site assignment cannot read the other site');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'Nurse reads an Individual at her assigned site');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Nurse cannot read an Individual at the unassigned site');
select is((select count(*)::int from individuals),2,
  'RLS: nurse with a Home A assignment reads exactly Home A');

-- Nurse with site assignments at both homes (agency-wide invite shape).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000007"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'Nurse with assignments at both homes reads Home A');
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Nurse with assignments at both homes reads Home B');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'Nurse with assignments at both homes reads a Home A Individual');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Nurse with assignments at both homes reads a Home B Individual');
select is((select count(*)::int from individuals),3,
  'RLS: nurse with assignments at both homes reads every Individual');

-- House manager with a NULL membership site and an Individual assignment
-- to the Home B person (no site_id on the assignment row).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000008"}',true);
select ok(private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'House manager reads the site of an Individual assignment');
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
  'House manager with one Individual assignment cannot read the other site');
select ok(private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'House manager reads the assigned Individual');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001'),
  'House manager cannot read an Individual at the unassigned site');

-- House manager whose membership names Home A.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000009"}',true);
select ok(not private.can_read_site('a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'),
  'Single-site house manager cannot read the other site');
select ok(not private.can_read_individual('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003'),
  'Single-site house manager cannot read the other site''s Individual');

select * from finish();
rollback;
