-- rights_packets.sql — pgTAP coverage for the annual Rights packet
-- store (migration 20261030170000_rights_packets.sql, written but NOT
-- applied until Joshua approves): read scoping, the manager-only
-- insert, the one-way completion transition, packet immutability,
-- and evidence integrity. Runs in CI (no local harness). Assertions
-- are effect-based where RLS turns a forbidden write into a no-op.
begin;
create extension if not exists pgtap;

select plan(19);

-- Fixtures: two agencies; Agency A has two homes. Roles exercised:
-- home HM (own + other home), program manager, nurse, auditor, DSP.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','hm-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','hm-b@example.com'),
  ('33333333-3333-3333-3333-333333333333','pm@example.com'),
  ('44444444-4444-4444-4444-444444444444','auditor@example.com'),
  ('55555555-5555-5555-5555-555555555555','dsp@example.com'),
  ('66666666-6666-6666-6666-666666666666','nurse@example.com'),
  ('77777777-7777-7777-7777-777777777777','hm-x@example.com')
on conflict (id) do nothing;

insert into public.agencies (id, name, provider_number) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Agency A','EVERGREEN-MO'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Agency B','OTHER-MO')
on conflict (id) do nothing;

insert into public.agency_sites (id, agency_id, name) values
  ('a1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Home A'),
  ('a2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Home B'),
  ('b1111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Home X')
on conflict (id) do nothing;

insert into public.memberships (agency_id, user_id, role, role_key, site_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','manager','house_manager','a1111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','manager','house_manager','a2222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','manager','program_manager',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444','auditor','auditor',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555','staff','dsp','a1111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66666666-6666-6666-6666-666666666666','nurse','nurse',null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','77777777-7777-7777-7777-777777777777','manager','house_manager','b1111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.individuals (id, agency_id, site_id, full_name) values
  ('c1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a1111111-1111-1111-1111-111111111111','Person A')
on conflict (id) do nothing;

-- One awaiting packet, created by the home HM (seeded directly).
insert into public.rights_packets (id, agency_id, individual_id, created_by, signer_name) values
  ('d1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Dana Hart');

-- ── Read scoping (1–5) ──────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.rights_packets), 1, 'home HM reads the packet');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 1, 'auditor reads the packet (read-only)');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 0, 'DSP reads no packets');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 0, 'other-home HM reads none');

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 0, 'cross-agency manager reads none');

-- ── Writes: DSP and auditor cannot start packets (6–7) ─────────────
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','X')$$,
  '42501', null, 'DSP cannot start a packet');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444','X')$$,
  '42501', null, 'auditor cannot start a packet');

-- ── The home HM starts a second (next-year) packet (8) ─────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.rights_packets (id, agency_id, individual_id, created_by, signer_name)
    values ('d2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Dana Hart')$$,
  'home HM starts a packet');

-- A future typed date is rejected on completion (9).
select throws_ok(
  $$update public.rights_packets
    set status = 'signed', packet_on = '2999-01-01', reviewed_by = 'James Wilson',
        signer = '{"printedName":"Dana Hart","authority":"Guardian","authorityOther":"","signature":"Dana Hart","witness":"Casey Adams","accepted":true}'::jsonb,
        signed_at = now()
    where id = 'd2222222-2222-2222-2222-222222222222'$$,
  '23514', null, 'future packet date rejected');

-- ── Completion with a TYPED past date (10–11) ──────────────────────
select lives_ok(
  $$update public.rights_packets
    set status = 'signed', packet_on = '2025-11-29', reviewed_by = 'James Wilson',
        signer = '{"printedName":"Dana Hart","authority":"Guardian","authorityOther":"","signature":"Dana Hart","witness":"Casey Adams","accepted":true}'::jsonb,
        signed_at = now()
    where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'home HM completes the packet with a typed date');
select is((select packet_on from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'), '2025-11-29'::date, 'typed date stored exactly as entered');

-- A pre-completed insert is refused by the insert policy (12).
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name, status, packet_on, signer)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','X','signed','2025-01-01','{}'::jsonb)$$,
  '42501', null, 'cannot insert a pre-completed packet');

-- ── Immutability: completed rows ignore later writes (13–16) ───────
select lives_ok(
  $$update public.rights_packets set packet_on = '2025-01-01' where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'update attempt on a completed packet runs');
select is((select packet_on from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'), '2025-11-29'::date, 'completed packet date is unchanged');
select lives_ok(
  $$delete from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'delete attempt on a packet runs');
select is((select count(*)::int from public.rights_packets), 2, 'both packets survive; prior years stay in history');

-- ── Evidence: insert works for the manager, rows are frozen (17–19)
select lives_ok(
  $$insert into public.rights_packet_evidence (packet_id, agency_id, name, mime, content_base64)
    values ('d1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','scan.pdf','application/pdf','JVBERi0=')$$,
  'manager files signed evidence');
select lives_ok(
  $$update public.rights_packet_evidence set name = 'other.pdf' where packet_id = 'd1111111-1111-1111-1111-111111111111'$$,
  'evidence update attempt runs');
select is((select name from public.rights_packet_evidence where packet_id = 'd1111111-1111-1111-1111-111111111111'), 'scan.pdf', 'evidence row is unchanged');

select * from finish();
rollback;
