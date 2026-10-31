begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(48);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A: Home A (Person One), Home B (Person Two). Agency B for isolation.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a3000000-0000-0000-0000-000000000001','House card agency A','HCARDA-MO','MO','active'),
 ('a3000000-0000-0000-0000-000000000002','House card agency B','HCARDB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Program'),
 ('b3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000002','Program B');
insert into sites(id,agency_id,program_id,name) values
 ('c3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Home A'),
 ('c3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Home B'),
 ('c3000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000002','Home C');
insert into auth.users(id,email) values
 ('d3000000-0000-0000-0000-000000000001','hc-hma@example.invalid'),
 ('d3000000-0000-0000-0000-000000000002','hc-dsp@example.invalid'),
 ('d3000000-0000-0000-0000-000000000003','hc-hmb@example.invalid'),
 ('d3000000-0000-0000-0000-000000000004','hc-pm@example.invalid'),
 ('d3000000-0000-0000-0000-000000000005','hc-auditor@example.invalid'),
 ('d3000000-0000-0000-0000-000000000006','hc-nurse@example.invalid');
update profiles set must_change_password=false
 where id::text like 'd3000000-%';
update profiles set home_agency_id='a3000000-0000-0000-0000-000000000001'
 where id::text like 'd3000000-%';
update profiles set full_name='Hannah HM' where id='d3000000-0000-0000-0000-000000000001';
update profiles set full_name='Alex DSP' where id='d3000000-0000-0000-0000-000000000002';
update profiles set full_name='Henry HM' where id='d3000000-0000-0000-0000-000000000003';
update profiles set full_name='Pat PM' where id='d3000000-0000-0000-0000-000000000004';
update profiles set full_name='Ann Auditor' where id='d3000000-0000-0000-0000-000000000005';
update profiles set full_name='Nina Nurse' where id='d3000000-0000-0000-0000-000000000006';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','manager','house_manager','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','dsp','dsp','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000003','manager','house_manager','c3000000-0000-0000-0000-000000000002'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000004','manager','program_manager',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000005','auditor','auditor',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000006','nurse','nurse','c3000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','Person One','1980-01-01'),
 ('e3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002','Person Two','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','e3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001');
-- Seeded ledger rows (service role): Home A gets the month's $600 funds
-- credit plus one groceries purchase; Home B gets one groceries purchase.
insert into house_card_entries(id,agency_id,site_id,entry_date,kind,location,amount_cents,category,individual_id,recorded_by,recorded_by_name,recorded_by_role) values
 ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'credit','',60000,null,null,'d3000000-0000-0000-0000-000000000001','Hannah HM','house_manager'),
 ('f3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','Hy-Vee',5000,'groceries_household',null,'d3000000-0000-0000-0000-000000000002','Alex DSP','dsp'),
 ('f3000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',current_date,'purchase','Hy-Vee',7000,'groceries_household',null,'d3000000-0000-0000-0000-000000000003','Henry HM','house_manager'),
 ('f3000000-0000-0000-0000-000000000004','a3000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000003',current_date,'purchase','Hy-Vee',7000,'groceries_household',null,'d3000000-0000-0000-0000-000000000001','Hannah HM','house_manager');

set local role authenticated;

-- ---------------- DSP at Home A ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000002"}',true);

select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000001'),2,
  'DSP reads the ledger at their own home');
select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000002'),0,
  'DSP cannot read another home''s ledger');

select lives_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,individual_id,recorded_by,recorded_by_name,recorded_by_role)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','Shell',4000,'gas','e3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','Hannah HM','house_manager')$$,
  'DSP can record a purchase for an Individual at their home');
select is((select recorded_by::text from house_card_entries where location='Shell'),'d3000000-0000-0000-0000-000000000002',
  'The recorder is forced to the signed-in user (no impersonation)');
select is((select recorded_by_role from house_card_entries where location='Shell'),'dsp',
  'The recorder role is stamped from the membership');
select is((select recorded_by_name from house_card_entries where location='Shell'),'Alex DSP',
  'The recorder name comes from the profile');

select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,individual_id,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',current_date,'purchase','Shell',4000,'gas','e3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002')$$,
  '42501',null,'DSP cannot record an entry at another home');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'credit','',5000,'gas','d3000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A credit cannot carry a purchase category');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','Shell',4000,'gas','d3000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A Gas purchase without an Individual is rejected');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','Hy-Vee',0,'groceries_household','d3000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A zero amount is rejected');

-- Void flow: voiding stamps the actual voider, then the row is final.
select lives_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','ALDI',2500,'groceries_household','d3000000-0000-0000-0000-000000000002')$$,
  'DSP records an entry for the void checks');
select lives_ok($$update house_card_entries set voided_at=now(), void_reason='Keyed the wrong total', voided_by='d3000000-0000-0000-0000-000000000001' where location='ALDI'$$,
  'Voiding while naming someone else as the voider runs');
select is((select voided_by::text from house_card_entries where location='ALDI'),'d3000000-0000-0000-0000-000000000002',
  'The void is stamped with the actual voider, not the client-named one');
select throws_ok($$update house_card_entries set voided_at=null, voided_by=null, void_reason=null where location='ALDI'$$,
  'P0001',null,'A voided entry cannot be un-voided');
select throws_ok($$update house_card_entries set amount_cents=2600 where location='Shell'$$,
  'P0001',null,'A live entry cannot be edited — void and replace is the only path');
select throws_ok($$update house_card_entries set voided_at=now(), void_reason='   ' where location='Shell'$$,
  'P0001',null,'Voiding without a reason is rejected at the database layer');
select throws_ok($$delete from house_card_entries where location='Shell'$$,
  '42501',null,'Entries cannot be deleted — the ledger is append-only');
select throws_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),51500,'Alex DSP','Alex DSP','d3000000-0000-0000-0000-000000000002')$$,
  '42501',null,'A DSP cannot sign a month closed');

-- ---------------- House manager, Home A: the month close ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);

select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000001'),4,
  'HM reads every entry at their home, voided rows included');
select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000002'),0,
  'HM at Home A cannot read Home B''s ledger');
select lives_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),51500,'Forged Name','Hannah HM','d3000000-0000-0000-0000-000000000001')$$,
  'HM signs their home''s month closed');
select is((select printed_name from house_card_month_closes where site_id='c3000000-0000-0000-0000-000000000001'),'Hannah HM',
  'The printed name on the sign-off is the closer''s account name');
select throws_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),51500,'Hannah HM','Hannah HM','d3000000-0000-0000-0000-000000000001')$$,
  '23505',null,'A month can only be signed closed once');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'credit','',5000,'d3000000-0000-0000-0000-000000000001')$$,
  'P0001',null,'A closed month refuses new entries');

-- Post-close correction, in the app''s order: replacement first, then the
-- void that links to it. Both stay inside the closed month they correct.
select lives_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,category,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'purchase','Hy-Vee',5050,'groceries_household','d3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002')$$,
  'A replacement entry may still land in the closed month it corrects');
select lives_ok($$update house_card_entries set voided_at=now(), void_reason='Receipt total was read wrong',
    replaced_by_entry_id=(select id from house_card_entries where replaces_entry_id='f3000000-0000-0000-0000-000000000002')
  where id='f3000000-0000-0000-0000-000000000002'$$,
  'Voiding an entry in a closed month stays possible');
select is((select count(*)::int from house_card_entries where replaces_entry_id='f3000000-0000-0000-0000-000000000002'),1,
  'The replacement is linked to the entry it corrects');

-- ---------------- Program manager: the whole agency ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000004"}',true);

select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000002'),1,
  'PM reads the ledger at every home in the agency');
select lives_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',current_date,'credit','',60000,'d3000000-0000-0000-0000-000000000004')$$,
  'PM can record an entry at any home (no new permission key was needed)');
select lives_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',to_char(current_date,'YYYY-MM'),53000,'Pat PM','Pat PM','d3000000-0000-0000-0000-000000000004')$$,
  'PM can sign a month closed at any home');

-- ---------------- Auditor: sees everything, changes nothing ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000005"}',true);

select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000002'),2,
  'Auditor reads the ledger at every home in the agency');
-- Dated two months back: this home's current month was signed closed
-- above, and the closed-month guard (P0001) fires before the RLS
-- denial this assertion targets. An open month isolates the 42501.
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',(current_date - interval '2 months')::date,'credit','',1000,'d3000000-0000-0000-0000-000000000005')$$,
  '42501',null,'Auditor cannot record an entry');
select lives_ok($$update house_card_entries set location='Auditor edit' where id='f3000000-0000-0000-0000-000000000003'$$,
  'An auditor update runs without error but touches nothing');
select is((select location from house_card_entries where id='f3000000-0000-0000-0000-000000000003'),'Hy-Vee',
  'Auditor cannot change an entry');
select throws_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002',to_char(current_date,'YYYY-MM'),53000,'Ann Auditor','Ann Auditor','d3000000-0000-0000-0000-000000000005')$$,
  '42501',null,'Auditor cannot sign a month closed');

-- ---------------- Nurse: not their workflow ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000006"}',true);

select is((select count(*)::int from house_card_entries where site_id='c3000000-0000-0000-0000-000000000001'),0,
  'Nurse cannot read the house card ledger');
-- Open month, as with the auditor check above: Home A's current
-- month is closed, which would mask the RLS denial with P0001.
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '2 months')::date,'credit','',1000,'d3000000-0000-0000-0000-000000000006')$$,
  '42501',null,'Nurse cannot record an entry');

-- ---------------- Integrity hardening (20261031150000) ----------------
-- Back to the program manager, who can write at every home in Agency A.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000004"}',true);

-- Home A's current month is signed closed above. Naming another home's
-- (or another agency's) same-month entry as the "correction" target
-- must not reopen it: the replacement link is scope-checked.
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'credit','',1000,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000003')$$,
  'P0001',null,'A closed month cannot be written into by replacing another home''s entry');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',current_date,'credit','',1000,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000004')$$,
  'P0001',null,'A correction cannot replace an entry from another agency');

-- One replacement per original, in an open month three months back.
select lives_ok($$insert into house_card_entries(id,agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('f3000000-0000-0000-0000-000000000010','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '3 months')::date,'credit','County',5000,'d3000000-0000-0000-0000-000000000004')$$,
  'PM records the entry the correction chain starts from');
select lives_ok($$insert into house_card_entries(id,agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('f3000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '3 months')::date,'credit','County',5500,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000010')$$,
  'A same-home replacement in an open month is recorded');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '3 months')::date,'credit','County',5600,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000010')$$,
  'P0001',null,'An entry cannot be replaced twice');
select lives_ok($$update house_card_entries set voided_at=now(), void_reason='Wrong amount credited',
    replaced_by_entry_id='f3000000-0000-0000-0000-000000000011'
  where id='f3000000-0000-0000-0000-000000000010'$$,
  'Voiding the original and linking its replacement succeeds');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '3 months')::date,'credit','County',5700,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000010')$$,
  'P0001',null,'A replaced entry stays replaced after the void lands');
select throws_ok($$update house_card_entries set replaced_by_entry_id='f3000000-0000-0000-0000-000000000010'
  where id='f3000000-0000-0000-0000-000000000011'$$,
  'P0001',null,'The replacement link cannot be forged from the other side');
select throws_ok($$insert into house_card_entries(agency_id,site_id,entry_date,kind,location,amount_cents,recorded_by,replaces_entry_id)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',(current_date - interval '3 months')::date,'credit','County',1000,'d3000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000009999')$$,
  'P0001',null,'A correction must name an entry that exists');

-- The signed closing balance is computed from the ledger: the chain
-- above leaves exactly one live credit of 5500 in that month.
select lives_ok($$insert into house_card_month_closes(agency_id,site_id,month,closing_balance_cents,printed_name,signature_text,signed_by)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',to_char(current_date - interval '3 months','YYYY-MM'),999999,'Pat PM','Pat PM','d3000000-0000-0000-0000-000000000004')$$,
  'PM can sign that month closed');
select is((select closing_balance_cents from house_card_month_closes where site_id='c3000000-0000-0000-0000-000000000001' and month=to_char(current_date - interval '3 months','YYYY-MM')),5500,
  'A bogus supplied closing balance is replaced by the ledger figure');

select * from finish();
rollback;
