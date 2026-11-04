begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Wave 7I: inserting an agency provisions the twelve starter policy
-- documents its New Hire Binder sends new hires to sign (trigger),
-- the provision function is idempotent and never overwrites an
-- agency's own document, and members can read the starters while
-- other agencies cannot.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a7000000-0000-0000-0000-000000000001','Starter agency A','STARTERA-MO','MO','active'),
 ('a7000000-0000-0000-0000-000000000002','Starter agency B','STARTERB-MO','MO','active');
insert into auth.users(id,email) values
 ('d7000000-0000-0000-0000-000000000001','starter-dsp@example.invalid'),
 ('d7000000-0000-0000-0000-000000000002','starter-outsider@example.invalid');
update profiles set must_change_password=<redacted>
 where id::text like 'd7000000-%';
update profiles set home_agency_id='a7000000-0000-0000-0000-000000000001'
 where id='d7000000-0000-0000-0000-000000000001';
update profiles set home_agency_id='a7000000-0000-0000-0000-000000000002'
 where id='d7000000-0000-0000-0000-000000000002';
update profiles set full_name='Dana DSP' where id='d7000000-0000-0000-0000-000000000001';
update profiles set full_name='Omar Outsider' where id='d7000000-0000-0000-0000-000000000002';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','dsp','dsp',null),
 ('a7000000-0000-0000-0000-000000000002','d7000000-0000-0000-0000-000000000002','dsp','dsp',null);

-- 1-5: the agency-insert trigger provisioned the starter library.
select is(
  (select count(*)::int from hr_documents where agency_id='a7000000-0000-0000-0000-000000000001'),
  12,
  'A new agency is provisioned with twelve starter documents');
select is(
  (select count(*)::int from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001'
      and title in ('Onboarding Packet','HIPAA 107','HELP Protocol 207','Abuse & Neglect 200',
                    'Event Reporting 205','Infection Control 210','Emergency Preparedness 204',
                    'Dress Code 203','Vehicle Use Agreement','HCBS',
                    'Individual Rights Cover Page','ISP Acknowledgment')),
  12,
  'The provisioned titles are exactly the twelve the default binder template links to');
select is(
  (select count(*)::int from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001'
      and requires_ack and active and category='policy'),
  12,
  'Every starter is an active, acknowledgment-required policy document');
select is(
  (select count(*)::int from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001'
      and body is not null and length(trim(body)) >= 200),
  12,
  'Every starter carries readable body text a signer can read before signing');
select is(
  (select count(*)::int from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001' and created_by is null),
  12,
  'Starter rows are system-provisioned: created_by is null');

-- 6-9: re-provisioning is idempotent and never clobbers the agency.
update hr_documents set body='AGENCY CUSTOM TEXT'
 where agency_id='a7000000-0000-0000-0000-000000000001' and title='HIPAA 107';
update hr_documents set active=false
 where agency_id='a7000000-0000-0000-0000-000000000001' and title='Dress Code 203';
select public.provision_agency_starter_documents('a7000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from hr_documents where agency_id='a7000000-0000-0000-0000-000000000001'),
  12,
  'Re-provisioning adds no duplicates');
select is(
  (select body from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001' and title='HIPAA 107'),
  'AGENCY CUSTOM TEXT',
  'An agency-edited starter body is never overwritten');
select is(
  (select count(*)::int from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001' and title='Dress Code 203'),
  1,
  'A deactivated starter is not duplicated by re-provisioning');
select is(
  (select active from hr_documents
    where agency_id='a7000000-0000-0000-0000-000000000001' and title='Dress Code 203'),
  false,
  'A deactivated starter stays deactivated');

-- 10-11: created_by now accepts system rows (null) on direct insert.
select lives_ok(
  $$insert into hr_documents (agency_id, title, category, body, requires_ack, active)
    values ('a7000000-0000-0000-0000-000000000002','Extra Notice','notice','Body text.',true,true)$$,
  'A document row can be inserted with no human creator');
select is(
  (select count(*)::int from hr_documents where agency_id='a7000000-0000-0000-0000-000000000002'),
  13,
  'Agency B holds its twelve starters plus its own document');

set local role authenticated;

-- 12: an agency member reads the starter library under RLS.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select is(
  (select count(*)::int from hr_documents where agency_id='a7000000-0000-0000-0000-000000000001'),
  12,
  'An agency member can read the twelve starter documents');

-- 13: another agency's member sees none of them.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000002"}',true);
select is(
  (select count(*)::int from hr_documents where agency_id='a7000000-0000-0000-0000-000000000001'),
  0,
  'Another agency''s member cannot see agency A''s documents');

select * from finish();
rollback;
