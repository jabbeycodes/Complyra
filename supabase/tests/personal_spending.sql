begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(44);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A: Home A (Person One), Home B (Person Two). Agency B for isolation.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a4000000-0000-0000-0000-000000000001','Personal spending agency A','PSPNDA-MO','MO','active'),
 ('a4000000-0000-0000-0000-000000000002','Personal spending agency B','PSPNDB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home A'),
 ('c4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d4000000-0000-0000-0000-000000000001','ps-hma@example.invalid'),
 ('d4000000-0000-0000-0000-000000000002','ps-dsp@example.invalid'),
 ('d4000000-0000-0000-0000-000000000003','ps-hmb@example.invalid'),
 ('d4000000-0000-0000-0000-000000000004','ps-pm@example.invalid'),
 ('d4000000-0000-0000-0000-000000000005','ps-auditor@example.invalid'),
 ('d4000000-0000-0000-0000-000000000006','ps-nurse@example.invalid');
update profiles set must_change_password=false
 where id::text like 'd4000000-%';
update profiles set home_agency_id='a4000000-0000-0000-0000-000000000001'
 where id::text like 'd4000000-%';
update profiles set full_name='Hannah HM' where id='d4000000-0000-0000-0000-000000000001';
update profiles set full_name='Alex DSP' where id='d4000000-0000-0000-0000-000000000002';
update profiles set full_name='Henry HM' where id='d4000000-0000-0000-0000-000000000003';
update profiles set full_name='Pat PM' where id='d4000000-0000-0000-0000-000000000004';
update profiles set full_name='Ann Auditor' where id='d4000000-0000-0000-0000-000000000005';
update profiles set full_name='Nina Nurse' where id='d4000000-0000-0000-0000-000000000006';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','manager','house_manager','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','dsp','dsp','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000003','manager','house_manager','c4000000-0000-0000-0000-000000000002'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000004','manager','program_manager',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000005','auditor','auditor',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000006','nurse','nurse','c4000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','Person One','1980-01-01'),
 ('e4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','Person Two','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001');
-- Seeded ledger rows (service role): Person One gets a $150 deposit plus
-- one spend; Person Two gets one spend.
insert into personal_spending_entries(id,agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by,recorded_by_name,recorded_by_role) values
 ('f4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'deposit','Monthly personal funds','',15000,'d4000000-0000-0000-0000-000000000001','Hannah HM','house_manager'),
 ('f4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Target','Clothing — new shoes',4299,'d4000000-0000-0000-0000-000000000002','Alex DSP','dsp'),
 ('f4000000-0000-0000-0000-000000000003','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',current_date,'spend','Walmart','Personal care items',2210,'d4000000-0000-0000-0000-000000000003','Henry HM','house_manager');

set local role authenticated;

-- ---------------- DSP assigned to Person One ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000002"}',true);

select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000001'),2,
  'DSP reads the ledger of the Individual they support');
select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000002'),0,
  'DSP cannot read another home''s Individual ledger');

select lives_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by,recorded_by_name,recorded_by_role)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Dollar Tree','Snacks for the week',850,'d4000000-0000-0000-0000-000000000001','Hannah HM','house_manager')$$,
  'DSP can record a spend for the Individual they support');
select is((select recorded_by::text from personal_spending_entries where location='Dollar Tree'),'d4000000-0000-0000-0000-000000000002',
  'The recorder is forced to the signed-in user (no impersonation)');
select is((select recorded_by_role from personal_spending_entries where location='Dollar Tree'),'dsp',
  'The recorder role is stamped from the membership');
select is((select recorded_by_name from personal_spending_entries where location='Dollar Tree'),'Alex DSP',
  'The recorder name comes from the profile');

select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',current_date,'spend','Walmart','Personal care items',1000,'d4000000-0000-0000-0000-000000000002')$$,
  '42501',null,'DSP cannot record a spend for an Individual at another home');
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Target','   ',1000,'d4000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A spend without a purpose is rejected');
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'deposit','Family','Birthday money',2500,'d4000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A deposit cannot carry a spend purpose');
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Target','Socks',0,'d4000000-0000-0000-0000-000000000002')$$,
  '23514',null,'A zero amount is rejected');
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Target','More than the balance holds',999999,'d4000000-0000-0000-0000-000000000002')$$,
  'P0001',null,'A spend that would take the balance below $0 is refused (wave 3, batch 7)');

-- Void flow: voiding stamps the actual voider, then the row is final.
select lives_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','ALDI','Favorite foods',1244,'d4000000-0000-0000-0000-000000000002')$$,
  'DSP records an entry for the void checks');
select lives_ok($$update personal_spending_entries set voided_at=now(), void_reason='Keyed the wrong total', voided_by='d4000000-0000-0000-0000-000000000001' where location='ALDI'$$,
  'Voiding while naming someone else as the voider runs');
select is((select voided_by::text from personal_spending_entries where location='ALDI'),'d4000000-0000-0000-0000-000000000002',
  'The void is stamped with the actual voider, not the client-named one');
select throws_ok($$update personal_spending_entries set voided_at=null, voided_by=null, void_reason=null where location='ALDI'$$,
  'P0001',null,'A voided entry cannot be un-voided');
select throws_ok($$update personal_spending_entries set amount_cents=900 where location='Dollar Tree'$$,
  'P0001',null,'A live entry cannot be edited — void and replace is the only path');
select throws_ok($$update personal_spending_entries set voided_at=now(), void_reason='   ' where location='Dollar Tree'$$,
  'P0001',null,'Voiding without a reason is rejected at the database layer');
select throws_ok($$delete from personal_spending_entries where location='Dollar Tree'$$,
  '42501',null,'Entries cannot be deleted — the ledger is append-only');
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),10151,'Alex DSP','Alex DSP','d4000000-0000-0000-0000-000000000002','individual_signed')$$,
  '42501',null,'A DSP cannot sign a month closed');

-- ---------------- House manager, Home A: the month closes ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);

select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000001'),4,
  'HM reads every entry for their home''s Individual, voided rows included');
select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000002'),0,
  'HM at Home A cannot read Home B''s Individual ledger');
select lives_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),9877,'Forged Name','Hannah HM','d4000000-0000-0000-0000-000000000001','individual_signed')$$,
  'HM signs their Individual''s month closed with the Individual''s sign-off');
select is((select printed_name from personal_spending_month_closes where individual_id='e4000000-0000-0000-0000-000000000001' and month=to_char(current_date,'YYYY-MM')),'Hannah HM',
  'The printed name on the sign-off is the closer''s account name');
select is((select closing_balance_cents from personal_spending_month_closes where individual_id='e4000000-0000-0000-0000-000000000001' and month=to_char(current_date,'YYYY-MM')),9851,
  'The stored closing balance is computed from the ledger (15000 - 4299 - 850), not the caller-supplied 9877 (wave 3, batch 7)');
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date,'YYYY-MM'),9877,'Hannah HM','Hannah HM','d4000000-0000-0000-0000-000000000001','individual_signed')$$,
  '23505',null,'A month can only be signed closed once');
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'deposit','Monthly personal funds','',5000,'d4000000-0000-0000-0000-000000000001')$$,
  'P0001',null,'A closed month refuses new entries');

-- Post-close correction, in the app's order: replacement first, then the
-- void that links to it. Both stay inside the closed month they correct.
select lives_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by,replaces_entry_id)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_date,'spend','Target','Clothing — new shoes',4399,'d4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000002')$$,
  'A replacement entry may still land in the closed month it corrects');
select lives_ok($$update personal_spending_entries set voided_at=now(), void_reason='Receipt total was read wrong',
    replaced_by_entry_id=(select id from personal_spending_entries where replaces_entry_id='f4000000-0000-0000-0000-000000000002')
  where id='f4000000-0000-0000-0000-000000000002'$$,
  'Voiding an entry in a closed month stays possible');
select is((select count(*)::int from personal_spending_entries where replaces_entry_id='f4000000-0000-0000-0000-000000000002'),1,
  'The replacement is linked to the entry it corrects');

-- The dual sign-off, on the previous month: the unable case is enforced.
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff,second_staff_id,second_staff_name,second_staff_signature)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date - interval '1 month','YYYY-MM'),0,'Hannah HM','Hannah HM','d4000000-0000-0000-0000-000000000001','unable_second_staff',null,null,null)$$,
  '23514',null,'An unable-to-sign close without a second staff member is rejected');
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff,second_staff_id,second_staff_signature)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date - interval '1 month','YYYY-MM'),0,'Hannah HM','Hannah HM','d4000000-0000-0000-0000-000000000001','unable_second_staff','d4000000-0000-0000-0000-000000000001','Hannah HM')$$,
  'P0001',null,'The closer cannot be their own second staff member');
select lives_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff,second_staff_id,second_staff_name,second_staff_signature)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',to_char(current_date - interval '1 month','YYYY-MM'),0,'Hannah HM','Hannah HM','d4000000-0000-0000-0000-000000000001','unable_second_staff','d4000000-0000-0000-0000-000000000002','Forged Name','Alex DSP')$$,
  'An unable-to-sign close with a second staff member succeeds');
select is((select second_staff_name from personal_spending_month_closes where individual_id='e4000000-0000-0000-0000-000000000001' and month=to_char(current_date - interval '1 month','YYYY-MM')),'Alex DSP',
  'The second signer''s printed name comes from their own profile');

-- ---------------- House manager, Home B: no negative closes ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);

-- Person Two's ledger stands at -2210 here (one seeded spend, no funds
-- recorded yet): the close must refuse, whatever balance is supplied.
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',to_char(current_date,'YYYY-MM'),5000,'Henry HM','Henry HM','d4000000-0000-0000-0000-000000000003','individual_signed')$$,
  'P0001',null,'A month cannot be signed closed while the balance is below $0 (wave 3, batch 7)');

-- ---------------- Program manager: the whole agency ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);

select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000002'),1,
  'PM reads the ledger of every Individual in the agency');
select lives_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',current_date,'deposit','Monthly personal funds',12000,'d4000000-0000-0000-0000-000000000004')$$,
  'PM can record a deposit for an Individual at any home');
select lives_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',to_char(current_date,'YYYY-MM'),9790,'Pat PM','Pat PM','d4000000-0000-0000-0000-000000000004','individual_signed')$$,
  'PM can sign a month closed for an Individual at any home');

-- ---------------- Auditor: sees everything, changes nothing ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000005"}',true);

select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000002'),2,
  'Auditor reads the ledger of every Individual in the agency');
-- Dated two months back: this Individual's current month was signed
-- closed above, and the closed-month guard (P0001) fires before the
-- RLS denial this assertion targets. An open month isolates the 42501.
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',(current_date - interval '2 months')::date,'spend','Walmart','Socks',500,'d4000000-0000-0000-0000-000000000005')$$,
  '42501',null,'Auditor cannot record an entry');
select lives_ok($$update personal_spending_entries set location='Auditor edit' where id='f4000000-0000-0000-0000-000000000003'$$,
  'An auditor update runs without error but touches nothing');
select is((select location from personal_spending_entries where id='f4000000-0000-0000-0000-000000000003'),'Walmart',
  'Auditor cannot change an entry');
select throws_ok($$insert into personal_spending_month_closes(agency_id,site_id,individual_id,month,closing_balance_cents,printed_name,signature_text,signed_by,individual_signoff)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','e4000000-0000-0000-0000-000000000002',to_char(current_date,'YYYY-MM'),9790,'Ann Auditor','Ann Auditor','d4000000-0000-0000-0000-000000000005','individual_signed')$$,
  '42501',null,'Auditor cannot sign a month closed');

-- ---------------- Nurse: not their workflow ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);

select is((select count(*)::int from personal_spending_entries where individual_id='e4000000-0000-0000-0000-000000000001'),0,
  'Nurse cannot read a personal spending ledger');
-- Open month, as with the auditor check above: this Individual has
-- both the current and previous months closed in this file, which
-- would mask the RLS denial with P0001.
select throws_ok($$insert into personal_spending_entries(agency_id,site_id,individual_id,entry_date,kind,location,purpose,amount_cents,recorded_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',(current_date - interval '2 months')::date,'spend','CVS','Vitamins',900,'d4000000-0000-0000-0000-000000000006')$$,
  '42501',null,'Nurse cannot record an entry');

select * from finish();
rollback;
