-- MEDICATION ORDERS + RECONCILIATION RLS: hosted enforcement for the
-- order / reconciliation tables added by PR #120. The PR-review agent asked
-- for hosted proof that direct database writes cannot do what the API
-- forbids: flip an order's status or forge its activation record, let a
-- house manager sign off a reconciliation, or rewrite the items of a
-- completed (signed) reconciliation. The re-review added the activation
-- link itself: a self-attributed activation must still be rejected when
-- the MAR medication link is missing, belongs to another Individual,
-- does not point back at the order, or has no dose schedule projected.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2710000-0000-0000-0000-000000000001','Orders agency','ORD-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2710000-0000-0000-0000-000000000001','a2710000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2710000-0000-0000-0000-000000000001','a2710000-0000-0000-0000-000000000001','b2710000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d2710000-0000-0000-0000-000000000001','orders-nurse@example.invalid'),
 ('d2710000-0000-0000-0000-000000000002','orders-pm@example.invalid'),
 ('d2710000-0000-0000-0000-000000000003','orders-hm@example.invalid'),
 ('d2710000-0000-0000-0000-000000000004','orders-auditor@example.invalid'),
 ('d2710000-0000-0000-0000-000000000005','orders-dsp@example.invalid');
update profiles set must_change_password=false where id::text like 'd2710000-%';
-- Memberships mirror how the codebase scopes readers: private.can_read_site
-- covers the manager / auditor roles agency-wide, everyone else (nurse
-- included) reads through the home their membership is assigned to.
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000001','nurse','nurse','c2710000-0000-0000-0000-000000000001'),
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000003','manager','house_manager','c2710000-0000-0000-0000-000000000001'),
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000004','auditor','auditor',null),
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000005','dsp','dsp','c2710000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2710000-0000-0000-0000-000000000001','a2710000-0000-0000-0000-000000000001','c2710000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('e2710000-0000-0000-0000-000000000002','a2710000-0000-0000-0000-000000000001','c2710000-0000-0000-0000-000000000001','Person B','1990-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000005','e2710000-0000-0000-0000-000000000001','c2710000-0000-0000-0000-000000000001');
-- Fixture drafts used only by the activation-link cases below: one per
-- bad-link attempt (so the cases stay independent even against a guard
-- that wrongly lets one through), plus one that exists so a medication
-- can point back at the WRONG order.
insert into medication_orders(id,agency_id,individual_id,medication_name,dose,route,schedule,prescriber_name,created_by,created_by_name) values
 ('f2710000-0000-0000-0000-000000000011','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','500 mg','Oral','BID','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One'),
 ('f2710000-0000-0000-0000-000000000012','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Lisinopril','10 mg','Oral','Daily','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One'),
 ('f2710000-0000-0000-0000-000000000015','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','500 mg','Oral','BID','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One'),
 ('f2710000-0000-0000-0000-000000000016','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','500 mg','Oral','BID','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One'),
 ('f2710000-0000-0000-0000-000000000017','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','500 mg','Oral','BID','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One');
-- The MAR medication the order will feed when activated.
insert into medications(id,agency_id,individual_id,name) values
 ('f2710000-0000-0000-0000-000000000001','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin');
-- Link fixtures for the activation cases, each isolating one violation:
-- another Individual's medication (back-link correct), a same-Individual
-- medication whose back-link names a different order, and a
-- same-Individual medication with no back-link at all.
insert into medications(id,agency_id,individual_id,name,source_order_id) values
 ('f2710000-0000-0000-0000-000000000010','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000002','Insulin Glargine','f2710000-0000-0000-0000-000000000015'),
 ('f2710000-0000-0000-0000-000000000013','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin ER','f2710000-0000-0000-0000-000000000012'),
 ('f2710000-0000-0000-0000-000000000014','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin XR',null);

-- ── Orders: inserts start as the caller's own untouched draft ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into medication_orders(id,agency_id,individual_id,medication_name,dose,route,schedule,prescriber_name,created_by,created_by_name)
  values ('f2710000-0000-0000-0000-000000000002','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','500 mg','Oral','BID','Dr. Rao','d2710000-0000-0000-0000-000000000001','Nurse One')$$,
  'A nurse drafts a medication order');
select throws_ok($$insert into medication_orders(agency_id,individual_id,medication_name,status,created_by)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','active','d2710000-0000-0000-0000-000000000001')$$,
  '42501', null, 'An order cannot be inserted already active');
select throws_ok($$insert into medication_orders(agency_id,individual_id,medication_name,created_by)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','d2710000-0000-0000-0000-000000000002')$$,
  '42501', null, 'An order cannot be authored as someone else');
select throws_ok($$insert into medication_orders(agency_id,individual_id,medication_name,created_by,activated_by,activated_at)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','d2710000-0000-0000-0000-000000000001','d2710000-0000-0000-0000-000000000001',now())$$,
  '42501', null, 'An order cannot be inserted with an activation record');

-- ── Orders: DSPs are excluded entirely ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000005"}',true);
select throws_ok($$insert into medication_orders(agency_id,individual_id,medication_name,created_by)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','Metformin','d2710000-0000-0000-0000-000000000005')$$,
  '42501', null, 'A DSP cannot create a medication order');
select is((select count(*)::int from medication_orders),0,
  'A DSP cannot read medication orders (MAR-only visibility)');

-- ── Orders: a house manager cannot edit them ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000003"}',true);
select lives_ok($$update medication_orders set dose='999 mg' where id='f2710000-0000-0000-0000-000000000002'$$,
  'House-manager update runs without error but must touch no row');
select is((select count(*)::int from medication_orders where id='f2710000-0000-0000-0000-000000000002' and dose='999 mg'),0,
  'A house manager cannot edit a medication order');

-- ── Orders: lifecycle — forge attempts fail, the real path works ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000001"}',true);
select throws_ok($$update medication_orders set status='active', activated_by='d2710000-0000-0000-0000-000000000002', activated_at=now() where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'Activation cannot be forged in another user''s name');
select throws_ok($$update medication_orders set status='discontinued', discontinued_by='d2710000-0000-0000-0000-000000000001', discontinued_at=now(), discontinue_reason='Skip' where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'A draft cannot jump straight to discontinued');

-- ── Orders: activation must record a REAL MAR link (PR #120 re-review) ──
-- Each attempt is self-attributed by the nurse; only the link is wrong.
select throws_ok($$update medication_orders set status='active', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000011'$$,
  '23514', null, 'Activation with no MAR medication linked is rejected');
select throws_ok($$update medication_orders set status='active', medication_id='f2710000-0000-0000-0000-000000000010', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000015'$$,
  '23514', null, 'Activation cannot link a medication belonging to another Individual');
select throws_ok($$update medication_orders set status='active', medication_id='f2710000-0000-0000-0000-000000000013', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000016'$$,
  '23514', null, 'Activation cannot link a medication whose back-link names a different order');
select throws_ok($$update medication_orders set status='active', medication_id='f2710000-0000-0000-0000-000000000014', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000017'$$,
  '23514', null, 'Activation cannot link a medication with no back-link to the order');
-- The path the application takes: project the medication (back-link),
-- project the dose schedule, then activate. Until the schedule exists,
-- even a correctly linked activation is rejected.
select lives_ok($$update medications set source_order_id='f2710000-0000-0000-0000-000000000002' where id='f2710000-0000-0000-0000-000000000001'$$,
  'The nurse projects the order onto its MAR medication (back-link)');
select throws_ok($$update medication_orders set status='active', medication_id='f2710000-0000-0000-0000-000000000001', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'Activation is rejected until the dose schedule is projected to the MAR');
select lives_ok($$insert into med_inventory(agency_id,individual_id,medication_id,dose_times)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','f2710000-0000-0000-0000-000000000001',ARRAY['08:00','20:00'])$$,
  'The nurse projects the dose schedule to the MAR');
select lives_ok($$update medication_orders set status='active', medication_id='f2710000-0000-0000-0000-000000000001', activated_by='d2710000-0000-0000-0000-000000000001', activated_by_name='Nurse One', activated_at=now() where id='f2710000-0000-0000-0000-000000000002'$$,
  'The nurse activates the order as themselves, linking the MAR medication');
select throws_ok($$update medication_orders set dose='250 mg' where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'An active order''s prescriber body cannot be edited in place');
select throws_ok($$update medication_orders set activated_by_name='Forged Name' where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'The activation record cannot be rewritten');
select throws_ok($$update medication_orders set status='discontinued', discontinued_by='d2710000-0000-0000-0000-000000000002', discontinued_at=now(), discontinue_reason='No longer needed' where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'Discontinuation cannot be forged in another user''s name');
select lives_ok($$update medication_orders set status='discontinued', discontinued_by='d2710000-0000-0000-0000-000000000001', discontinued_by_name='Nurse One', discontinued_at=now(), discontinue_reason='No longer needed' where id='f2710000-0000-0000-0000-000000000002'$$,
  'The nurse discontinues the order as themselves, with a reason');
select throws_ok($$update medication_orders set discontinue_reason='Rewritten' where id='f2710000-0000-0000-0000-000000000002'$$,
  '23514', null, 'The discontinuation record cannot be rewritten afterwards');
select throws_ok($$delete from medication_orders where id='f2710000-0000-0000-0000-000000000002'$$,
  '42501', null, 'A medication order cannot be deleted at all');

-- ── Reconciliation: a house manager may run it, never sign it ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000003"}',true);
select lives_ok($$insert into medication_reconciliations(id,agency_id,individual_id,trigger,started_by,started_by_name)
  values ('f2710000-0000-0000-0000-000000000003','a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','admission','d2710000-0000-0000-0000-000000000003','House Manager')$$,
  'A house manager starts a reconciliation for their home');
select throws_ok($$insert into medication_reconciliations(agency_id,individual_id,trigger,status,started_by,signed_off_by,signed_off_at,sign_off_note)
  values ('a2710000-0000-0000-0000-000000000001','e2710000-0000-0000-0000-000000000001','admission','completed','d2710000-0000-0000-0000-000000000003','d2710000-0000-0000-0000-000000000003',now(),'Pre-signed')$$,
  '42501', null, 'A reconciliation cannot be inserted already completed and signed');
select lives_ok($$insert into medication_reconciliation_items(id,agency_id,reconciliation_id,medication_id,medication_label,decision)
  values ('f2710000-0000-0000-0000-000000000004','a2710000-0000-0000-0000-000000000001','f2710000-0000-0000-0000-000000000003','f2710000-0000-0000-0000-000000000001','Metformin 500 mg','continue')$$,
  'The house manager records a checklist decision');
select lives_ok($$update medication_reconciliation_items set decision='change', note='Dose changed at discharge' where id='f2710000-0000-0000-0000-000000000004'$$,
  'Decisions on an in-progress run can still be edited');
select lives_ok($$delete from medication_reconciliation_items where id='f2710000-0000-0000-0000-000000000004'$$,
  'The checklist of an in-progress run can be replaced (delete + re-insert)');
select lives_ok($$insert into medication_reconciliation_items(id,agency_id,reconciliation_id,medication_id,medication_label,decision)
  values ('f2710000-0000-0000-0000-000000000005','a2710000-0000-0000-0000-000000000001','f2710000-0000-0000-0000-000000000003','f2710000-0000-0000-0000-000000000001','Metformin 500 mg','continue')$$,
  'The replacement decision is recorded');
select throws_ok($$update medication_reconciliations set status='completed', signed_off_by='d2710000-0000-0000-0000-000000000003', signed_off_by_name='House Manager', signed_off_at=now(), sign_off_note='Done' where id='f2710000-0000-0000-0000-000000000003'$$,
  '23514', null, 'A house manager cannot sign off a reconciliation, even by direct write');
select throws_ok($$update medication_reconciliations set signed_off_by='d2710000-0000-0000-0000-000000000003' where id='f2710000-0000-0000-0000-000000000003'$$,
  '23514', null, 'Sign-off fields cannot be set without completing the run');

-- ── Reconciliation: sign-off belongs to the signer ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000002"}',true);
select throws_ok($$update medication_reconciliations set status='completed', signed_off_by='d2710000-0000-0000-0000-000000000001', signed_off_by_name='Nurse One', signed_off_at=now(), sign_off_note='Reviewed' where id='f2710000-0000-0000-0000-000000000003'$$,
  '23514', null, 'A sign-off cannot be forged in another user''s name');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update medication_reconciliations set status='completed', signed_off_by='d2710000-0000-0000-0000-000000000001', signed_off_by_name='Nurse One', signed_off_at=now(), sign_off_note='Compared against the discharge list' where id='f2710000-0000-0000-0000-000000000003'$$,
  'The nurse signs off the reconciliation as themselves, with a note');

-- ── Completed reconciliations are immutable signed history ──
select lives_ok($$update medication_reconciliation_items set decision='stop' where id='f2710000-0000-0000-0000-000000000005'$$,
  'Post-completion item update runs without error but must touch no row');
select is((select count(*)::int from medication_reconciliation_items where id='f2710000-0000-0000-0000-000000000005' and decision='stop'),0,
  'An item of a completed reconciliation cannot be rewritten');
select lives_ok($$delete from medication_reconciliation_items where id='f2710000-0000-0000-0000-000000000005'$$,
  'Post-completion item delete runs without error but must touch no row');
select is((select count(*)::int from medication_reconciliation_items where id='f2710000-0000-0000-0000-000000000005'),1,
  'An item of a completed reconciliation cannot be deleted');
select throws_ok($$insert into medication_reconciliation_items(agency_id,reconciliation_id,medication_label,decision)
  values ('a2710000-0000-0000-0000-000000000001','f2710000-0000-0000-0000-000000000003','Late addition','continue')$$,
  '23514', null, 'No decision can be added to a completed reconciliation');
select throws_ok($$update medication_reconciliations set sign_off_note='Rewritten' where id='f2710000-0000-0000-0000-000000000003'$$,
  '23514', null, 'A completed reconciliation itself cannot be changed');
select throws_ok($$delete from medication_reconciliations where id='f2710000-0000-0000-0000-000000000003'$$,
  '42501', null, 'A reconciliation cannot be deleted at all');

-- ── Auditors see everything and change nothing ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2710000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from medication_orders),6,
  'An auditor reads medication orders (see everything, read-only)');
select is((select count(*)::int from medication_reconciliations),1,
  'An auditor reads reconciliations');
select lives_ok($$update medication_orders set dose='1 mg' where id='f2710000-0000-0000-0000-000000000002'$$,
  'Auditor update runs without error but must touch no row');
select is((select count(*)::int from medication_orders where id='f2710000-0000-0000-0000-000000000002' and dose='1 mg'),0,
  'An auditor cannot change a medication order');

select * from finish();
rollback;
