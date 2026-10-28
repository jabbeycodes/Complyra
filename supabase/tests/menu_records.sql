begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A: Home A (Person One), Home B (Person Two). Agency B for isolation.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2000000-0000-0000-0000-000000000001','Menu agency A','MENUA-MO','MO','active'),
 ('a2000000-0000-0000-0000-000000000002','Menu agency B','MENUB-MO','MO','active');
-- The production provisioning path: agency roles come from the templates
-- (this is what has_permission reads). Menu records add NO new permission
-- key, so PM access must survive on the provisioned, post-merge pack.
select public.provision_agency_roles('a2000000-0000-0000-0000-000000000001');
insert into programs (id,agency_id,name) values
 ('b2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Home A'),
 ('c2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d2000000-0000-0000-0000-000000000001','menu-hma@example.invalid'),
 ('d2000000-0000-0000-0000-000000000002','menu-dsp@example.invalid'),
 ('d2000000-0000-0000-0000-000000000003','menu-hmb@example.invalid'),
 ('d2000000-0000-0000-0000-000000000004','menu-pm@example.invalid'),
 ('d2000000-0000-0000-0000-000000000005','menu-auditor@example.invalid');
update profiles set must_change_password=(1=0)
 where id::text like 'd2000000-%';
update profiles set home_agency_id='a2000000-0000-0000-0000-000000000001'
 where id::text like 'd2000000-%';
update profiles set full_name='Hannah HM' where id='d2000000-0000-0000-0000-000000000001';
update profiles set full_name='Alex DSP' where id='d2000000-0000-0000-0000-000000000002';
update profiles set full_name='Henry HM' where id='d2000000-0000-0000-0000-000000000003';
update profiles set full_name='Pat PM' where id='d2000000-0000-0000-0000-000000000004';
update profiles set full_name='Ann Auditor' where id='d2000000-0000-0000-0000-000000000005';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','manager','house_manager','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','dsp','dsp','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','manager','house_manager','c2000000-0000-0000-0000-000000000002'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000004','manager','program_manager',null),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000005','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Person One','1980-01-01'),
 ('e2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','Person Two','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001');
-- Seeded records: a DSP breakfast for Person One, an HM-A lunch for Person
-- One, and an HM-B dinner for Person Two.
insert into menu_entries(id,agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by,recorded_by_name,recorded_by_role) values
 ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'breakfast','Oatmeal with berries','most','d2000000-0000-0000-0000-000000000002','Alex DSP','dsp'),
 ('f2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'lunch','Manager meal','all','d2000000-0000-0000-0000-000000000001','Hannah HM','house_manager'),
 ('f2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000002',current_date,'dinner','Grilled salmon','all','d2000000-0000-0000-0000-000000000003','Henry HM','house_manager');

set local role authenticated;

-- ---------------- DSP at Home A ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);

select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000001'),2,
  'DSP reads the menu entries for Individuals at their home');
select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000002'),0,
  'DSP cannot read another home''s menu entries');

select lives_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by,recorded_by_name,recorded_by_role)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'snack','Scrambled eggs','some','d2000000-0000-0000-0000-000000000001','Hannah HM','house_manager')$$,
  'DSP can record food for an Individual at their home');
select is((select recorded_by::text from menu_entries where food_text='Scrambled eggs'),'d2000000-0000-0000-0000-000000000002',
  'The recorder is forced to the signed-in user (no impersonation)');
select is((select recorded_by_role from menu_entries where food_text='Scrambled eggs'),'dsp',
  'The recorder role is stamped from the membership');
select is((select recorded_by_name from menu_entries where food_text='Scrambled eggs'),'Alex DSP',
  'The recorder name comes from the profile');

select throws_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000002',current_date,'lunch','Forbidden soup','all','d2000000-0000-0000-0000-000000000002')$$,
  '42501',null,'DSP cannot record food for an Individual at another home');

select lives_ok($$update menu_entries set amount_eaten='all' where id='f2000000-0000-0000-0000-000000000001'$$,
  'The author can correct their own entry');
select is((select count(*)::int from menu_entry_history where entry_id='f2000000-0000-0000-0000-000000000001' and amount_eaten='most'),1,
  'The corrected entry keeps its previous version in history');

select lives_ok($$update menu_entries set food_text='Hijacked' where id='f2000000-0000-0000-0000-000000000003'$$,
  'An update by a non-author runs without error but touches nothing');
select is((select food_text from menu_entries where id='f2000000-0000-0000-0000-000000000003'),'Manager meal',
  'A DSP cannot correct another staff member''s entry');

select lives_ok($$update menu_entries set deleted_at=now(), void_reason='Recorded twice' where id='f2000000-0000-0000-0000-000000000001'$$,
  'The author can void their own entry with a reason');
select is((select voided_by::text from menu_entries where id='f2000000-0000-0000-0000-000000000001'),'d2000000-0000-0000-0000-000000000002',
  'The void stamps who voided the entry');

-- ---------------- House manager, Home A ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000001"}',true);

select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000001'),3,
  'HM reads every menu entry at their home (voided rows included; the app filters voids)');
select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000002'),0,
  'HM at Home A cannot read Home B''s menu entries');
select lives_ok($$update menu_entries set amount_eaten='most' where food_text='Scrambled eggs'$$,
  'HM can correct a DSP''s entry at their home');
select throws_ok($$update menu_entries set individual_id='e2000000-0000-0000-0000-000000000002' where id='f2000000-0000-0000-0000-000000000003'$$,
  'P0001',null,'A menu entry cannot be moved to another Individual');

-- ---------------- House manager, Home B ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000003"}',true);

select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000001'),0,
  'HM at Home B cannot read Home A''s menu entries');
select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000002'),1,
  'HM reads the menu entries at their own home');

-- ---------------- Program manager (provisioned roles) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000004"}',true);

select is((select count(*)::int from menu_entries where individual_id='e2000000-0000-0000-0000-000000000001'),3,
  'PM reads menu entries across the agency (provisioned post-merge role pack)');
select lives_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'dinner','PM pasta','all','d2000000-0000-0000-0000-000000000004')$$,
  'PM can record a menu entry (no new permission key was needed)');
select lives_ok($$update menu_entries set note='Checked at review' where food_text='Scrambled eggs'$$,
  'PM can correct an entry in their scope');

-- ---------------- Auditor: sees everything, changes nothing ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000005"}',true);

select is((select count(*)::int from menu_entries where agency_id='a2000000-0000-0000-0000-000000000001'),5,
  'Auditor reads menu entries at every home in the agency');
select throws_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'snack','Auditor snack','all','d2000000-0000-0000-0000-000000000005')$$,
  '42501',null,'Auditor cannot record a menu entry');
select lives_ok($$update menu_entries set food_text='Auditor edit' where id='f2000000-0000-0000-0000-000000000003'$$,
  'An auditor update runs without error but touches nothing');
select is((select food_text from menu_entries where id='f2000000-0000-0000-0000-000000000003'),'Manager meal',
  'Auditor cannot change a menu entry');
select lives_ok($$delete from menu_entries where id='f2000000-0000-0000-0000-000000000003'$$,
  'An auditor delete runs without error but touches nothing');
select is((select count(*)::int from menu_entries where id='f2000000-0000-0000-0000-000000000003'),1,
  'Auditor cannot delete a menu entry');

-- ---------------- Field constraints (as the DSP) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);

select throws_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'brunch','Pancakes','all','d2000000-0000-0000-0000-000000000002')$$,
  '23514',null,'An unknown meal slot is rejected');
select throws_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'snack','Pancakes','half','d2000000-0000-0000-0000-000000000002')$$,
  '23514',null,'An unknown amount eaten is rejected');
select throws_ok($$insert into menu_entries(agency_id,site_id,individual_id,entry_date,meal_slot,food_text,amount_eaten,recorded_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_date,'snack','   ','all','d2000000-0000-0000-0000-000000000002')$$,
  '23514',null,'Blank food text is rejected');

select * from finish();
rollback;
